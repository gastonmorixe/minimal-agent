#!/usr/bin/env bun
/**
 * Move every consumer to one core SHA and point the umbrella at it (spec S46).
 * This is the "core pin refresh" in one command.
 *
 * For each consumer submodule (every submodule but core), it rewrites the core
 * pin in each TRACKED `package.json` and `bun.lock` (`git ls-files`, so ignored
 * dirs like `minimal-agent-plugins/tmp/` and `node_modules/` are skipped). A
 * pin is `minimal-agent-core.git#<sha>`. In `bun.lock` the resolved SHA after
 * the entry is rewritten too. Then it checks out core at the SHA and stages
 * the core gitlink in the umbrella.
 *
 * Usage
 * -----
 *   bun run pins:core                    # core origin/main; edit + stage only
 *   bun run pins:core <sha>              # a given core commit (7-40 hex)
 *   bun run pins:core --dry-run          # print what would change, write nothing
 *   bun run pins:core --commit           # also commit in each changed consumer and the umbrella
 *   bun run pins:core --commit --push    # also push each commit to origin main
 *
 * With `--commit`, each consumer must be on `main`, level with `origin/main`,
 * with no tracked changes, so the pin commit is the only new commit. When
 * `MINIMAL_AGENT_SESSION_ID` is set, each commit gets the agent
 * `Co-authored-by` trailer (AGENTS.md). It does not run the checks: run
 * `bun run check` (or each repo's `check`) before you push.
 *
 * Before it writes anything, it stops when a committed `bun.lock` and its
 * `package.json` pin a git dependency to different SHAs, in the target core
 * commit or in a consumer. `pins:check` rejects that, and it runs only after
 * the consumer commits are pushed.
 *
 * Each commit header is at most 100 characters (commitlint
 * header-max-length): a long core subject is cut with `...` (`fitHeader`).
 *
 * Resumable: if a run stops after the consumer pushes (for example on a
 * commit-msg hook), run it again. Consumers already on the SHA are skipped.
 * With `--commit`, the gitlink of such a consumer is staged too when it is
 * not at the consumer HEAD, and the umbrella commit names every staged
 * consumer gitlink.
 */
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { fitHeader, git, gitlink, gitPinsAt, lockfileProblems, root, submodulePaths } from "./pins-lib.ts";

const CORE = "minimal-agent-core";
const PIN_RE = /minimal-agent-core\.git#([0-9a-f]{7,40})/g;

const args = process.argv.slice(2);
const dryRun = args.includes("--dry-run");
const push = args.includes("--push");
const commit = args.includes("--commit") || push;
const shaArg = args.find((a) => !a.startsWith("--"));

function fail(msg: string): never {
  console.error(`pins:core: ${msg}`);
  process.exit(1);
}

/** The agent trailer for this session, or "" for a human commit. */
function trailer(): string {
  const sid = process.env.MINIMAL_AGENT_SESSION_ID ?? "";
  if (!sid) return "";
  const name = process.env.MINIMAL_AGENT_AGENT_NAME || "agent";
  return `\n\nCo-authored-by: ${name} <${sid.slice(0, 8)}@minimal-agent>`;
}

/** Wrap prose at `width` columns (commitlint body-max-line-length is 100). */
function wrap(text: string, width = 72): string {
  const lines: string[] = [];
  let line = "";
  for (const word of text.split(/\s+/).filter(Boolean)) {
    if (line && line.length + 1 + word.length > width) {
      lines.push(line);
      line = word;
    } else line = line ? `${line} ${word}` : word;
  }
  if (line) lines.push(line);
  return lines.join("\n");
}

function commitAll(cwd: string, subject: string, body = ""): string {
  const msg = `${subject}${body ? `\n\n${wrap(body)}` : ""}${trailer()}`;
  git(["commit", "--quiet", "-m", msg], cwd);
  return git(["rev-parse", "HEAD"], cwd);
}

// 0. With --commit, the umbrella must be on main with nothing else staged.
if (commit && !dryRun) {
  const branch = git(["branch", "--show-current"]);
  if (branch !== "main") fail(`the umbrella is on "${branch || "detached HEAD"}", not main`);
  // Staged submodule gitlinks are fine: they are what a failed earlier run left.
  const subs = new Set(submodulePaths());
  const staged = git(["diff", "--cached", "--name-only"]).split("\n").filter(Boolean);
  const other = staged.filter((f) => !subs.has(f));
  if (other.length > 0) fail(`the umbrella has staged changes; commit or unstage them first:\n${other.join("\n")}`);
}

// 1. Resolve the target core SHA.
const coreDir = join(root, CORE);
git(["fetch", "--quiet", "origin", "main"], coreDir);
if (shaArg && !/^[0-9a-f]{7,40}$/.test(shaArg)) fail(`"${shaArg}" is not a 7-40 char hex SHA`);
const sha = git(["rev-parse", "--verify", `${shaArg ?? "origin/main"}^{commit}`], coreDir);
if (git(["branch", "-r", "--contains", sha], coreDir).trim() === "") {
  fail(`core ${sha.slice(0, 7)} is not on any origin branch; push it first (consumers clone by SHA)`);
}
const subject = git(["log", "-1", "--format=%s", sha], coreDir);
// The committed pin, not the staged one, so a resumed run still names the real "from".
const oldCore = git(["rev-parse", `HEAD:${CORE}`]);
console.log(`core: ${oldCore.slice(0, 7)} -> ${sha.slice(0, 7)}  ${subject}`);

// 1b. Stop before any write when `pins:check` would fail after the pin. Step 4
// runs `pins:check` after the consumer commits are pushed, so a failure there
// leaves the consumers on the new pin and the umbrella on the old one.
const preflight: string[] = [];
for (const line of lockfileProblems(gitPinsAt(CORE, sha))) preflight.push(`${CORE}@${sha.slice(0, 7)}: ${line}`);
for (const path of submodulePaths()) {
  if (path === CORE) continue;
  // Step 4 reads a consumer at its gitlink. A consumer with a core pin gets its gitlink staged at
  // HEAD (or at the pin commit on top of HEAD), so read it at HEAD. One with no core pin is not
  // staged, so read it at its gitlink. The core pin is left out: step 2 rewrites it in both files.
  const head = gitPinsAt(path, "HEAD");
  const pins = head.manifest.has(CORE) || head.lock.has(CORE) ? head : gitPinsAt(path, gitlink(path));
  for (const line of lockfileProblems(pins, [CORE])) preflight.push(`${path}: ${line}`);
}
if (preflight.length > 0) {
  const text = `a committed bun.lock differs from its package.json:\n${preflight.map((l) => `  ${l}`).join("\n")}\nFix: bun run pins:lock, commit and push bun.lock in that repo, then run pins:core again (with the new core commit, when the fix is in core).`;
  if (dryRun) console.log(`WARNING: a real run stops here. ${text}`);
  else fail(text);
}

// 2. Rewrite the pins in each consumer.
const changed: string[] = [];
/** Consumers that already pin the target, but whose gitlink in the umbrella is not at their HEAD. */
const aligned: string[] = [];
for (const path of submodulePaths()) {
  if (path === CORE) continue;
  const cwd = join(root, path);
  const files = git(["ls-files"], cwd)
    .split("\n")
    .filter((f) => /(^|\/)(package\.json|bun\.lock)$/.test(f) && !f.includes("node_modules/"));

  const edits: Array<{ file: string; text: string; n: number }> = [];
  for (const file of files) {
    const full = join(cwd, file);
    const text = readFileSync(full, "utf8");
    const olds = new Set([...text.matchAll(PIN_RE)].map((m) => m[1] ?? "").filter((s) => s !== sha));
    if (olds.size === 0) continue;
    let next = text;
    let n = 0;
    for (const old of olds) {
      // The pin itself.
      next = next.replaceAll(`minimal-agent-core.git#${old}`, () => (n++, `minimal-agent-core.git#${sha}`));
      // bun.lock repeats the resolved SHA as a quoted string after the entry.
      if (old.length === 40) next = next.replaceAll(`"${old}"`, `"${sha}"`);
    }
    edits.push({ file, text: next, n });
  }
  if (edits.length === 0) {
    console.log(`${path}: ok (already on ${sha.slice(0, 7)} or no core pins)`);
    // A run that stopped after this consumer was committed left its gitlink behind. Step 4 reads
    // the gitlink, so stage it with the others. Only a clean consumer: HEAD is then what was pinned.
    const pinned = files.some((file) => readFileSync(join(cwd, file), "utf8").includes(`minimal-agent-core.git#${sha}`));
    const clean = git(["status", "--porcelain", "--untracked-files=no"], cwd) === "";
    if (pinned && clean && git(["rev-parse", "HEAD"], cwd) !== gitlink(path)) aligned.push(path);
    continue;
  }

  if (commit && !dryRun) {
    git(["fetch", "--quiet", "origin", "main"], cwd);
    const branch = git(["branch", "--show-current"], cwd);
    if (branch !== "main") fail(`${path} is on "${branch || "detached HEAD"}", not main`);
    if (git(["rev-parse", "HEAD"], cwd) !== git(["rev-parse", "origin/main"], cwd)) {
      fail(`${path} main is not level with origin/main; pull or push first`);
    }
    if (git(["status", "--porcelain", "--untracked-files=no"], cwd) !== "") {
      fail(`${path} has tracked changes; commit or stash them first`);
    }
  }

  const pins = edits.reduce((a, e) => a + e.n, 0);
  console.log(`${path}: ${pins} pins in ${edits.length} files${dryRun ? " (dry run)" : ""}`);
  for (const e of edits) console.log(`  ${e.file}`);
  if (dryRun) continue;
  for (const e of edits) writeFileSync(join(cwd, e.file), e.text);
  changed.push(path);
}

if (dryRun) process.exit(0);

// 3. Commit (and push) each consumer, then stage the umbrella gitlinks.
const short = sha.slice(0, 7);
for (const path of changed) {
  const cwd = join(root, path);
  if (commit) {
    git(["add", "-u"], cwd);
    const head = commitAll(cwd, fitHeader(`chore: pin core to ${short} (${subject}`, ")"));
    console.log(`${path}: committed ${head.slice(0, 7)}`);
    if (push) {
      git(["push", "--quiet", "origin", "HEAD:main"], cwd);
      console.log(`${path}: pushed to origin main`);
    }
  }
}

git(["checkout", "--quiet", "--detach", sha], coreDir);
git(["add", "--", CORE]);
if (commit) for (const path of [...changed, ...aligned]) git(["add", "--", path]);

if (!commit) {
  console.log(`\nStaged the core gitlink. Next: review each consumer diff, commit and push it,`);
  console.log(`then \`git add\` the consumer gitlinks, run \`bun run pins:check\` and commit the umbrella.`);
  process.exit(0);
}

// 4. Verify and commit the umbrella.
const check = Bun.spawnSync(["bun", "run", "scripts/check-core-pins.ts"], { cwd: root, stdout: "pipe" });
const report = check.stdout.toString().trim().split("\n").at(-1) ?? "";
if (check.exitCode !== 0) fail(`pins:check failed after the pin: ${report}`);
// Name every consumer whose gitlink moved, also those a failed earlier run pushed.
const moved = git(["diff", "--cached", "--name-only"])
  .split("\n")
  .filter((p) => p && p !== CORE && submodulePaths().includes(p));
if (moved.length === 0 && gitlink(CORE) === git(["rev-parse", `HEAD:${CORE}`])) {
  console.log("umbrella: nothing to commit, every pin is already on the target.");
  process.exit(0);
}
const list = moved.map((p) => p.replace("minimal-agent-", "")).join(", ") || "core only";
const head = commitAll(
  root,
  fitHeader(`chore: bump ${list} for the core pin refresh`, ` (${oldCore.slice(0, 7)} to ${short})`),
  `Every consumer now pins core ${short} (${subject}), the core gitlink. ${report}`,
);
console.log(`umbrella: committed ${head.slice(0, 7)} (${report})`);
if (push) {
  git(["push", "--quiet", "origin", "HEAD:main"]);
  console.log("umbrella: pushed to origin main");
}
