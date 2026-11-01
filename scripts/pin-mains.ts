#!/usr/bin/env bun
/**
 * Set every umbrella gitlink to its submodule's `origin/main` (spec S46,
 * decision 20). Print `old -> new` for each submodule. Then rewrite the SHAs
 * in the `CHANGELOG.md` pin approval lines, so they match the new gitlinks.
 *
 * Usage
 * -----
 *   bun run scripts/pin-mains.ts            # fetch, check out, stage, rewrite CHANGELOG lines
 *   bun run scripts/pin-mains.ts --dry-run  # fetch and print old -> new only
 *
 * The script stages the gitlinks and `CHANGELOG.md`. It does not commit.
 * Run `bun run pins:check` after it to find consumers that pin a stale core.
 */
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { APPROVAL_END, APPROVAL_START, git, gitlink, root, submodulePaths } from "./pins-lib.ts";

const dryRun = process.argv.includes("--dry-run");

const pins = new Map<string, string>();
for (const path of submodulePaths()) {
  const cwd = join(root, path);
  git(["fetch", "--quiet", "origin", "main"], cwd);
  const oldSha = gitlink(path);
  const newSha = git(["rev-parse", "origin/main"], cwd);
  pins.set(path, newSha);
  const mark = oldSha === newSha ? "(no change)" : "";
  console.log(`${path}: ${oldSha} -> ${newSha} ${mark}`.trimEnd());
  if (dryRun) continue;
  git(["checkout", "--quiet", "--detach", newSha], cwd);
  git(["add", "--", path]);
}

if (!dryRun) {
  const file = join(root, "CHANGELOG.md");
  const text = readFileSync(file, "utf8");
  const start = text.indexOf(APPROVAL_START);
  const end = text.indexOf(APPROVAL_END);
  if (start < 0 || end < start) throw new Error("CHANGELOG.md has no pin approval block");
  let block = text.slice(start, end);
  for (const [path, sha] of pins) {
    const re = new RegExp(`(\`${path}\` at \`)[0-9a-f]{40}(\`)`);
    if (!re.test(block)) throw new Error(`CHANGELOG.md has no approval line for ${path}`);
    block = block.replace(re, `$1${sha}$2`);
  }
  writeFileSync(file, text.slice(0, start) + block + text.slice(end));
  git(["add", "--", "CHANGELOG.md"]);
  console.log("CHANGELOG.md: pin approval lines updated and staged.");
}
