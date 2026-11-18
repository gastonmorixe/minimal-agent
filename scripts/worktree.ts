#!/usr/bin/env bun
/**
 * Make or remove a full umbrella worktree: one directory with the umbrella,
 * its own checkout of every submodule, and one root install.
 *
 * Why a full worktree: only this layout links the local core checkout into
 * plugins, cli and web (the root workspace does it). A folder with two or
 * three repo checkouts side by side and no umbrella root is a set of
 * standalone installs: plugins there uses the pinned core, so an edit in the
 * core folder next to it does not reach the plugins tests.
 *
 * Usage
 * -----
 *   bun run worktree:new <name>                  # ../<main checkout>_WT-<name>, branch <name>, from origin/main
 *   bun run worktree:new <name> --branch <b>     # another umbrella branch name
 *   bun run worktree:new <name> --from <ref>     # another start commit
 *   bun run worktree:rm <name>                   # remove it; stops when work would be lost
 *   bun run worktree:rm <name> --force           # remove it also then
 *
 * `new` leaves each submodule on a detached HEAD at the commit the umbrella
 * records. Before you commit in a submodule, make a branch there:
 * `git -C minimal-agent-core switch -c <branch>`.
 *
 * `rm` exists because `git worktree remove` refuses a worktree that has
 * submodules, and `--force` deletes the submodule repos of that worktree with
 * every commit that is only there. So `rm` first looks for uncommitted files
 * and for commits that are on no remote, in the umbrella and in each
 * submodule, and stops when it finds one.
 */
import { existsSync, realpathSync } from "node:fs";
import { dirname, join } from "node:path";
import { git, root, submodulePaths } from "./pins-lib.ts";

const args = process.argv.slice(2);
const cmd = args[0] ?? "";
const flag = (name: string): string | undefined => {
  const i = args.indexOf(name);
  return i >= 0 ? args[i + 1] : undefined;
};
const VALUE_FLAGS = ["--branch", "--from"];
const name = args.slice(1).find((a, i, rest) => !a.startsWith("--") && !VALUE_FLAGS.includes(rest[i - 1] ?? ""));
const force = args.includes("--force");

function fail(msg: string): never {
  console.error(`worktree: ${msg}`);
  process.exit(1);
}

/** Run git and return trimmed stdout, or "" when git fails. */
function tryGit(gitArgs: string[], cwd: string): string {
  try {
    return git(gitArgs, cwd);
  } catch {
    return "";
  }
}

/** Run a command with inherited output. Return true on exit 0. */
function run(cwd: string, command: string[]): boolean {
  return Bun.spawnSync(command, { cwd, stdout: "inherit", stderr: "inherit" }).exitCode === 0;
}

if (!name || !/^[A-Za-z0-9][A-Za-z0-9._-]*$/.test(name)) {
  fail("usage: worktree new <name> [--branch <b>] [--from <ref>] | worktree rm <name> [--force]");
}

/** The main checkout: the directory that holds the shared `.git` directory. */
const mainCheckout = dirname(git(["rev-parse", "--path-format=absolute", "--git-common-dir"]));
const dest = `${mainCheckout}_WT-${name}`;
const subs = submodulePaths();

function create(): void {
  const branch = flag("--branch") ?? name ?? "";
  const from = flag("--from") ?? "origin/main";
  if (existsSync(dest)) fail(`${dest} exists`);
  if (tryGit(["show-ref", "--verify", `refs/heads/${branch}`], root) !== "") fail(`the branch "${branch}" exists; give --branch <other>`);
  git(["fetch", "--quiet", "origin"]);
  const base = tryGit(["rev-parse", "--verify", `${from}^{commit}`], root);
  if (!base) fail(`"${from}" is not a commit`);

  git(["worktree", "add", "--quiet", "-b", branch, dest, base]);
  console.log(`worktree: ${dest}`);
  console.log(`  umbrella branch ${branch} at ${base.slice(0, 7)} (${from})`);

  for (const sub of subs) {
    // Copy objects from the main checkout when it has this submodule: no download.
    // `--dissociate` makes the new repo complete, so it does not break when the main one prunes objects.
    const reference = join(mainCheckout, sub);
    const local = existsSync(join(reference, ".git")) ? ["--reference", reference, "--dissociate"] : [];
    const init = (extra: string[]): boolean =>
      Bun.spawnSync(["git", "submodule", "--quiet", "update", "--init", ...extra, "--", sub], { cwd: dest, stderr: "pipe" }).exitCode === 0;
    if (!init(local) && !init([])) {
      fail(`could not check out ${sub} in ${dest}. Is its recorded commit on the remote? Remove the worktree with: bun run worktree:rm ${name} --force`);
    }
    console.log(`  ${sub} at ${git(["rev-parse", "--short", "HEAD"], join(dest, sub))} (detached)`);
  }

  console.log("  bun install");
  if (!run(dest, ["bun", "install"])) fail(`bun install failed in ${dest}`);

  // The commit-msg hooks check the commit format and the agent trailer. `bun install` sets them up
  // through each `prepare` script. Do it here for a repo where that did not run.
  for (const repo of ["", ...subs]) {
    const cwd = join(dest, repo);
    if (!existsSync(join(cwd, ".husky"))) continue;
    if (tryGit(["config", "--get", "core.hooksPath"], cwd) === "") run(cwd, ["bun", "run", "prepare"]);
    if (tryGit(["config", "--get", "core.hooksPath"], cwd) === "") console.log(`  WARNING: no commit hooks in ${repo || "the umbrella"}`);
  }

  // Proof that this worktree uses its own core, not the pinned copy.
  const link = join(dest, "minimal-agent-cli", "node_modules", "@minimal-agent", "core");
  const core = join(dest, "minimal-agent-core");
  const linked = existsSync(link) && existsSync(core) && realpathSync(link) === realpathSync(core);
  console.log(`  core link: ${linked ? "the cli uses the core checkout of this worktree" : "NOT linked to the core checkout of this worktree"}`);

  console.log(`\nNext:\n  cd ${dest}\n  bun run pins        # the state of every pin\n  git -C minimal-agent-core switch -c ${branch}   # before you commit in a submodule`);
  if (!linked) process.exit(1);
}

/** Work in `cwd` that a removal would destroy. `ownRepo` is true for a submodule: its repo is deleted too. */
function lostWork(label: string, cwd: string, ownRepo: boolean): string[] {
  const out: string[] = [];
  const dirty = tryGit(["status", "--porcelain"], cwd)
    .split("\n")
    // A changed submodule pointer in the umbrella is the submodule's own state: it is checked there.
    // The path is the text after the status letters. `git()` trims the output, so the first line
    // can have lost its leading space: do not cut at a fixed column.
    .filter((line) => line !== "" && !(!ownRepo && subs.includes(line.replace(/^\s*\S+\s+/, ""))));
  if (dirty.length > 0) out.push(`${label}: ${dirty.length} uncommitted or untracked file(s)`);
  const refs = ownRepo
    ? ["HEAD", ...tryGit(["for-each-ref", "--format=%(refname)", "refs/heads"], cwd).split("\n").filter(Boolean)]
    : ["HEAD"];
  const seen = new Set<string>();
  for (const ref of refs) {
    const n = Number(tryGit(["rev-list", "--count", ref, "--not", "--remotes"], cwd) || "0");
    const sha = tryGit(["rev-parse", ref], cwd);
    if (n === 0 || seen.has(sha)) continue;
    seen.add(sha);
    out.push(`${label}: ${n} commit(s) on ${ref.replace("refs/heads/", "")} that are on no remote`);
  }
  return out;
}

function remove(): void {
  const listed = git(["worktree", "list", "--porcelain"])
    .split("\n")
    .some((line) => line === `worktree ${dest}` || line === `worktree ${existsSync(dest) ? realpathSync(dest) : dest}`);
  if (!listed) fail(`${dest} is not a worktree of this repo`);
  if (existsSync(dest) && realpathSync(dest) === realpathSync(root)) fail("run this from another checkout, not from the worktree to remove");

  const problems = lostWork("umbrella", dest, false);
  for (const sub of subs) {
    if (existsSync(join(dest, sub, ".git"))) problems.push(...lostWork(sub, join(dest, sub), true));
  }
  if (problems.length > 0) {
    console.log(`worktree: ${dest} has work that a removal deletes:`);
    for (const line of problems) console.log(`  ${line}`);
    if (!force) fail("stopped. Push or commit that work, or run again with --force to delete it.");
  }

  const branch = tryGit(["branch", "--show-current"], dest);
  // `--force` is necessary for a worktree with submodules. The checks above are the guard.
  git(["worktree", "remove", "--force", dest]);
  git(["worktree", "prune"]);
  console.log(`worktree: removed ${dest}`);
  if (branch) console.log(`  the umbrella branch "${branch}" is kept. Delete it with: git branch -d ${branch}`);
}

if (cmd === "new") create();
else if (cmd === "rm") remove();
else fail(`unknown command "${cmd}" (new|rm)`);
