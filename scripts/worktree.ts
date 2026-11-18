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
 *   bun run worktree:rm <name>                   # remove it; stops when it holds work that is nowhere else
 *   bun run worktree:rm <name> --force           # remove it with no check
 *
 * `new` leaves each submodule on a detached HEAD at the commit the umbrella
 * records. Before you commit in a submodule, make a branch there:
 * `git -C minimal-agent-core switch -c <branch>`.
 *
 * `rm` exists because `git worktree remove` refuses a worktree that has
 * submodules, and `--force` deletes the submodule repos of that worktree with
 * everything that is only there. So `rm` first looks, in the umbrella and in
 * each submodule repo of that worktree, and stops when it finds:
 *
 *   - an uncommitted or untracked file;
 *   - an ignored file that no tool makes again (notes, research, logs);
 *   - a stash;
 *   - a commit that is on no remote, on any branch, under a tag or only in
 *     the reflog. The old copy of a commit that was rebased or cherry-picked
 *     and then pushed does not count.
 *
 * It fetches each submodule first. A remote that is not reachable is a stop.
 */
import { existsSync, readdirSync, realpathSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
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
    // Copy objects from the main checkout when it has this submodule: little or no download.
    // (Git still asks the remote, so the remote must be reachable.)
    // `--dissociate` makes the new repo complete, so it does not break when the main one prunes objects.
    const reference = join(mainCheckout, sub);
    const local = existsSync(join(reference, ".git")) ? ["--reference", reference, "--dissociate"] : [];
    const init = (extra: string[]): boolean =>
      Bun.spawnSync(["git", "submodule", "--quiet", "update", "--init", ...extra, "--", sub], { cwd: dest, stderr: "pipe" }).exitCode === 0;
    if (!init(local) && !init([])) {
      // Nothing of value is in a worktree that was made a moment ago: remove it and its new branch.
      tryGit(["worktree", "remove", "--force", dest], root);
      tryGit(["branch", "-D", branch], root);
      fail(`could not check out ${sub}: is its remote reachable, and is the recorded commit on it? The new worktree and the branch "${branch}" are removed again.`);
    }
    console.log(`  ${sub} at ${git(["rev-parse", "--short", "HEAD"], join(dest, sub))} (detached)`);
  }

  console.log("  bun install");
  if (!run(dest, ["bun", "install"])) {
    fail(`bun install failed in ${dest}. The worktree is kept. To remove it: bun run worktree:rm ${name} --force && git branch -D ${branch}`);
  }

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

/** Run git and return stdout as it is, not trimmed. Throw on a non-zero exit. */
function gitRaw(gitArgs: string[], cwd: string, input?: string): string {
  const res = Bun.spawnSync(["git", ...gitArgs], { cwd, stdin: input === undefined ? "ignore" : Buffer.from(input), stdout: "pipe", stderr: "pipe" });
  if (res.exitCode !== 0) throw new Error(`git ${gitArgs.join(" ")}: ${res.stderr.toString().trim()}`);
  return res.stdout.toString();
}

const lines = (text: string): string[] => text.split("\n").filter(Boolean);

/** Ignored paths that a tool makes again. Any other ignored file can be work (notes, research, logs). */
const GENERATED_DIRS = new Set(["node_modules", "dist", "build", "tmp", ".tmp", "coverage", ".net-dbg", ".node-net-dbg"]);
const GENERATED_FILES = new Set(["bun.lock", ".DS_Store"]);
function isGenerated(path: string): boolean {
  const parts = path.replace(/\/$/, "").split("/");
  const last = parts.at(-1) ?? "";
  if (parts.some((part) => GENERATED_DIRS.has(part)) || GENERATED_FILES.has(last)) return true;
  return last === "_" && parts.at(-2) === ".husky";
}

/** Files in the working tree `cwd` that a removal deletes. `skip` holds paths that are checked elsewhere. */
function lostFiles(label: string, cwd: string, skip: Set<string>): string[] {
  const tokens = gitRaw(["status", "--porcelain", "-z", "--ignored"], cwd).split("\0").filter(Boolean);
  let changed = 0;
  const ignored: string[] = [];
  for (let i = 0; i < tokens.length; i++) {
    const token = tokens[i] ?? "";
    const state = token.slice(0, 2);
    const path = token.slice(3);
    // A rename or a copy has its old path in the next token.
    if (state.includes("R") || state.includes("C")) i++;
    if (skip.has(path.replace(/\/$/, ""))) continue;
    if (state !== "!!") changed++;
    else if (!isGenerated(path)) ignored.push(path);
  }
  const out: string[] = [];
  if (changed > 0) out.push(`${label}: ${changed} uncommitted or untracked file(s)`);
  if (ignored.length > 0) out.push(`${label}: ignored file(s) that no tool makes again: ${ignored.slice(0, 3).join(", ")}${ignored.length > 3 ? ", ..." : ""}`);
  return out;
}

/** The patch id of each commit in `shas` that has a diff, as patch id to commit. */
function patchIds(gitDir: string, shas: string[]): Map<string, string> {
  const ids = new Map<string, string>();
  if (shas.length === 0) return ids;
  const res = Bun.spawnSync(["bash", "-c", "git diff-tree --stdin --root -p | git patch-id --stable"], {
    stdin: Buffer.from(`${shas.join("\n")}\n`),
    stdout: "pipe",
    stderr: "pipe",
    env: { ...process.env, GIT_DIR: gitDir },
  });
  if (res.exitCode !== 0) throw new Error(`git patch-id: ${res.stderr.toString().trim()}`);
  for (const line of lines(res.stdout.toString())) {
    const [id, sha] = line.split(" ");
    if (id && sha) ids.set(id, sha);
  }
  return ids;
}

/**
 * Commits and stashes that only the repo `gitDir` has. The removal deletes that repo.
 *
 * A commit counts when no remote has it and no remote commit has the same change. So the old copy
 * of a commit that was rebased or cherry-picked and then pushed does not count. It looks at every
 * ref and at the reflog: a commit on a deleted branch, under a tag, or left behind on a detached
 * HEAD is found.
 */
function lostCommits(label: string, gitDir: string): string[] {
  const g = (gitArgs: string[], input?: string): string => gitRaw(["--git-dir", gitDir, ...gitArgs], root, input);
  const out: string[] = [];
  try {
    // Without this, a branch that was deleted on the remote still looks pushed.
    g(["fetch", "--prune", "--quiet", "origin"]);
  } catch {
    out.push(`${label}: its remote is not reachable, so a commit that is only here cannot be ruled out`);
  }
  const stashes = lines(tryGit(["--git-dir", gitDir, "stash", "list"], root));
  if (stashes.length > 0) out.push(`${label}: ${stashes.length} stash(es)`);
  const stashShas = new Set(stashes.length > 0 ? lines(g(["reflog", "show", "--format=%H", "refs/stash"])) : []);

  // "On a remote" means: under a remote branch, or under a tag that the remote has. A release
  // tag can hold commits that are on no branch. A tag that exists only here does not count.
  let remoteTags: string[] = [];
  try {
    remoteTags = lines(g(["ls-remote", "--tags", "origin"])).map((line) => line.split("\t")[0] ?? "");
  } catch {
    // The fetch above failed too, and that is reported.
  }
  const only = ["--ignore-missing", "--all", "--reflog", "--not", "--remotes", ...new Set(remoteTags)];
  const merges = lines(g(["rev-list", "--merges", ...only])).filter((sha) => !stashShas.has(sha));
  if (merges.length > 0) out.push(`${label}: ${merges.length} merge commit(s) that are on no remote`);

  const local = lines(g(["rev-list", "--no-merges", ...only]));
  if (local.length === 0) return out;
  const mine = patchIds(gitDir, local);
  // A remote copy of a local commit is not older than that commit: look at the remote commits from the oldest one on.
  const oldest = Math.min(...lines(g(["log", "--no-walk", "--format=%at", "--stdin"], `${local.join("\n")}\n`)).map(Number));
  const theirs = patchIds(gitDir, lines(g(["rev-list", "--ignore-missing", "--no-merges", `--since=${oldest - 86400}`, "--remotes", ...new Set(remoteTags)])));
  const lost = [...mine].filter(([id]) => !theirs.has(id)).map(([, sha]) => sha);
  if (lost.length > 0) {
    const newest = g(["log", "--no-walk", "--date-order", "--format=%h %s", "-1", ...lost.slice(0, 200)]).trim();
    out.push(`${label}: ${lost.length} commit(s) that are on no remote, and no remote commit has the same change (newest: ${newest.slice(0, 70)})`);
  }
  return out;
}

/** Every git repo below `dir`. A worktree keeps the repos of its submodules there, and a removal deletes them. */
function reposBelow(dir: string): string[] {
  if (!existsSync(dir)) return [];
  const out: string[] = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (!entry.isDirectory()) continue;
    const path = join(dir, entry.name);
    if (existsSync(join(path, "HEAD")) && existsSync(join(path, "objects"))) out.push(path, ...reposBelow(join(path, "modules")));
    else out.push(...reposBelow(path));
  }
  return out;
}

function remove(): void {
  const listed = lines(git(["worktree", "list", "--porcelain"])).includes(`worktree ${existsSync(dest) ? realpathSync(dest) : dest}`);
  if (!listed) fail(`${dest} is not a worktree of this repo`);
  if (!existsSync(dest)) {
    // The repos of its submodules are still in the main `.git`. Nothing here can check them through a missing folder.
    fail(`${dest} is a worktree of this repo, but the folder is not there. Nothing is removed. If you moved it: git worktree repair <new path>`);
  }
  const here = realpathSync(root);
  const target = realpathSync(dest);
  if (here === target || here.startsWith(`${target}/`)) fail("run this from another checkout, not from the worktree to remove");

  const problems: string[] = [];
  /** Run one check. A check that cannot run is a problem, not a pass. */
  const check = (label: string, run: () => string[]): void => {
    try {
      problems.push(...run());
    } catch (error) {
      problems.push(`${label}: could not check (${error instanceof Error ? error.message.slice(0, 120) : "error"})`);
    }
  };

  // The umbrella. Its branch stays in the main repo, so only a commit on a detached HEAD can be lost.
  const gitlinks = new Set(lines(tryGit(["ls-files", "--stage"], dest)).filter((line) => line.startsWith("160000")).map((line) => line.split("\t")[1] ?? ""));
  check("umbrella", () => lostFiles("umbrella", dest, gitlinks));
  const branch = tryGit(["branch", "--show-current"], dest);
  if (!branch) {
    check("umbrella", () => {
      const n = Number(git(["rev-list", "--count", "HEAD", "--not", "--remotes", "--branches"], dest));
      return n > 0 ? [`umbrella: ${n} commit(s) on a detached HEAD that are on no remote and on no branch`] : [];
    });
  }

  // Every submodule repo that this worktree owns, also one that is not checked out now.
  const modules = join(git(["rev-parse", "--absolute-git-dir"], dest), "modules");
  for (const repo of reposBelow(modules)) {
    const label = repo.slice(modules.length + 1).replace(/\/modules\//g, "/");
    check(label, () => lostCommits(label, repo));
    const workTree = tryGit(["--git-dir", repo, "config", "--get", "core.worktree"], root);
    const dir = workTree ? resolve(repo, workTree) : "";
    if (dir && existsSync(join(dir, ".git"))) check(label, () => lostFiles(label, dir, new Set()));
  }

  if (problems.length > 0) {
    console.log(`worktree: ${dest} has work that a removal deletes:`);
    for (const line of problems) console.log(`  ${line}`);
    if (!force) fail("stopped. Commit and push that work, or run again with --force to delete it.");
  }

  // `--force` is necessary for a worktree with submodules. The checks above are the guard.
  // No `git worktree prune`: it also deletes the data of every other worktree whose folder is absent just now.
  git(["worktree", "remove", "--force", dest]);
  console.log(`worktree: removed ${dest}`);
  if (branch) console.log(`  the umbrella branch "${branch}" is kept. Delete it with: git branch -d ${branch} (-D when it is not merged)`);
}

if (cmd === "new") create();
else if (cmd === "rm") remove();
else fail(`unknown command "${cmd}" (new|rm)`);
