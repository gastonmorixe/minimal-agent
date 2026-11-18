#!/usr/bin/env bun
/**
 * Show the state of every pin in one report, and the next command to run.
 * It changes nothing.
 *
 * When you code, you do not touch pins: the root workspace links the local
 * core checkout into every repo. Pins matter only when a set of commits must
 * become the record that the umbrella and the standalone clones use. This
 * report tells you if that record is consistent, and what to run when it is
 * not.
 *
 * Usage
 * -----
 *   bun run pins            # report from the local git data
 *   bun run pins --fetch    # first fetch origin/main in every submodule
 *
 * Exit code: 0 when the recorded pins are consistent, 1 when a check fails.
 * Local work that is not recorded yet (new commits, uncommitted edits) does
 * not fail the report. It is listed under "Next".
 */
import { existsSync } from "node:fs";
import { join } from "node:path";
import { git, gitlink, root, submodulePaths } from "./pins-lib.ts";

const CORE = "minimal-agent-core";
const fetch = process.argv.includes("--fetch");
const short = (sha: string): string => sha.slice(0, 7);
const name = (path: string): string => path.replace("minimal-agent-", "");

/** Run git and return trimmed stdout, or "" when git fails. */
function tryGit(args: string[], cwd: string): string {
  try {
    return git(args, cwd);
  } catch {
    return "";
  }
}

/** Run one of the check scripts. Return its exit code and output lines. */
function check(script: string): { ok: boolean; lines: string[] } {
  const res = Bun.spawnSync(["bun", "run", join("scripts", script)], { cwd: root, stdout: "pipe", stderr: "pipe" });
  return { ok: res.exitCode === 0, lines: res.stdout.toString().trim().split("\n") };
}

const next: string[] = [];
const rows: string[][] = [["repo", "checkout", "umbrella records", "origin/main", "state"]];
let coreAhead = "";
let corePushed = false;

for (const path of submodulePaths()) {
  const cwd = join(root, path);
  if (!existsSync(join(cwd, ".git"))) {
    rows.push([name(path), "not checked out", short(gitlink(path)), "", ""]);
    next.push(`${name(path)} is not checked out: bun run submodules:init`);
    continue;
  }
  if (fetch) tryGit(["fetch", "--quiet", "origin", "main"], cwd);
  const head = git(["rev-parse", "HEAD"], cwd);
  const link = gitlink(path);
  const main = tryGit(["rev-parse", "origin/main"], cwd);
  const branch = tryGit(["branch", "--show-current"], cwd) || "detached";
  const dirty = tryGit(["status", "--porcelain", "--untracked-files=no"], cwd) !== "";
  const pushed = tryGit(["branch", "-r", "--contains", head], cwd) !== "";

  const state: string[] = [];
  if (head !== link) {
    const ahead = tryGit(["rev-list", "--count", `${link}..${head}`], cwd);
    const behind = tryGit(["rev-list", "--count", `${head}..${link}`], cwd);
    if (ahead !== "0" && behind === "0") {
      state.push(`${ahead} new commit${ahead === "1" ? "" : "s"}${pushed ? "" : ", not pushed"}`);
      if (path === CORE) {
        // Never `git add` core alone: every consumer pin would then differ from the core gitlink.
        coreAhead = head;
        corePushed = pushed;
        if (!pushed) next.push(`core has ${ahead} commit(s) that are not on its remote: push them (git -C ${path} push origin HEAD:main)`);
      } else {
        next.push(
          pushed
            ? `${name(path)} has ${ahead} pushed commit(s) the umbrella does not record: git add ${path}`
            : `${name(path)} has ${ahead} commit(s) that are not on its remote: push them, then git add ${path}`,
        );
      }
    } else if (ahead === "0") {
      state.push(`${behind} behind the record`);
      next.push(`${name(path)} checkout is older than the umbrella record: git -C ${path} checkout --detach ${short(link)} (when you have no work there)`);
    } else {
      state.push("diverged from the record");
      next.push(`${name(path)} checkout and the umbrella record have different commits: decide which one is right`);
    }
  }
  if (dirty) state.push("uncommitted edits");
  if (main && main !== link && main !== head) {
    if (path === CORE) {
      // Not `pins:mains` and not `git add`: the core gitlink must move together with the consumer pins.
      coreAhead = coreAhead || main;
      corePushed = true;
    } else {
      next.push(
        `${name(path)} origin/main is at ${short(main)}, the umbrella records ${short(link)}. To record it: git -C ${path} checkout --detach ${short(main)} && git add ${path}, then bun run pins:check`,
      );
    }
  }
  rows.push([name(path), `${short(head)} (${branch})`, short(link), main ? short(main) : "unknown", state.join(", ") || "ok"]);
}

const widths = rows[0]?.map((_, i) => Math.max(...rows.map((r) => (r[i] ?? "").length))) ?? [];
console.log("Checkouts");
for (const r of rows) console.log(`  ${r.map((c, i) => c.padEnd(widths[i] ?? 0)).join("  ")}`.trimEnd());

const pins = check("check-core-pins.ts");
const catalogs = check("check-catalogs.ts");
const detail = (lines: string[]): string[] => lines.filter((l) => /STALE|LOCKFILE DIFFERS|DIFFERS \(|^ {2}/.test(l));

console.log("\nChecks");
console.log(`  ${pins.ok ? "ok  " : "FAIL"}  pins:     ${pins.lines.at(-1) ?? ""}`);
for (const l of detail(pins.lines)) console.log(`        ${l.trim()}`);
console.log(`  ${catalogs.ok ? "ok  " : "FAIL"}  versions: ${catalogs.lines.at(-1) ?? ""}`);
for (const l of detail(catalogs.lines)) console.log(`        ${l.trim()}`);
console.log("  not run   standalone installs (slow): bun run pins:verify");

const summary = pins.lines.at(-1) ?? "";
if (!/^0 of/.test(summary)) next.push("consumers pin a core that is not the umbrella core: bun run pins:core --dry-run, then bun run pins:core --commit --push");
if (/lockfile pin/.test(summary)) next.push("a committed bun.lock differs from its package.json: bun run pins:lock, then commit bun.lock in that repo");
// A config pin that is behind. When the main of that repo has the new pin already, the umbrella
// only records an older commit of the repo: the "origin/main" line above covers it.
const configSha = submodulePaths().includes("minimal-agent-config") ? gitlink("minimal-agent-config") : "";
const behind = pins.lines.flatMap((l) => /note: (\S+) pins config /.exec(l)?.[1] ?? []);
const toMove = behind.filter((path) => !tryGit(["show", "origin/main:package.json"], join(root, path)).includes(`minimal-agent-config.git#${configSha}`));
if (toMove.length > 0) {
  next.push(`the config pin of ${toMove.map(name).join(", ")} is behind the config gitlink: bun run pins:config, then commit in each repo it names`);
}
if (!catalogs.ok) next.push("a repo declares a tool version that differs from the root catalog: change the lines above, then bun install");
if (coreAhead) {
  next.push(
    `${corePushed ? "core has pushed commits the umbrella does not record" : "after the core commits are pushed"}: move every consumer pin and the core gitlink to them with the core pin refresh. ` +
      `First ask the other sessions (it pushes to plugins, cli and web): bun run pins:core ${short(coreAhead)} --dry-run`,
  );
}

console.log("\nNext");
if (next.length === 0) console.log("  Nothing. To code, edit and run: the workspace uses your local checkouts.");
for (const [i, line] of next.entries()) console.log(`  ${i + 1}. ${line}`);

if (!pins.ok || !catalogs.ok) process.exit(1);
