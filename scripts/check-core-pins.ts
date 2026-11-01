#!/usr/bin/env bun
/**
 * Check that every consumer pins the same core SHA as the umbrella core
 * gitlink (spec S46). Read each consumer `package.json` and `bun.lock` at the
 * consumer's gitlink commit, so the result matches what the umbrella pins.
 *
 * Usage
 * -----
 *   bun run scripts/check-core-pins.ts                 # exit 1 on any stale pin
 *   bun run scripts/check-core-pins.ts --report-only   # print the same report, exit 0
 */
import { join } from "node:path";
import { git, gitlink, root, submodulePaths } from "./pins-lib.ts";

const CORE = "minimal-agent-core";
const PIN_RE = /minimal-agent-core\.git#([0-9a-f]{7,40})/g;
const reportOnly = process.argv.includes("--report-only");

const coreSha = gitlink(CORE);
console.log(`core gitlink: ${coreSha}`);

let stale = 0;
let total = 0;
for (const path of submodulePaths()) {
  if (path === CORE) continue;
  const cwd = join(root, path);
  const rev = gitlink(path);
  const files = git(["ls-tree", "-r", "--name-only", rev], cwd)
    .split("\n")
    .filter((f) => /(^|\/)(package\.json|bun\.lock)$/.test(f) && !f.includes("node_modules/"));
  const bad: string[] = [];
  let count = 0;
  for (const file of files) {
    const text = git(["show", `${rev}:${file}`], cwd);
    for (const m of text.matchAll(PIN_RE)) {
      count++;
      const sha = m[1] ?? "";
      if (sha !== coreSha) bad.push(`${file} -> ${sha}`);
    }
  }
  total += count;
  stale += bad.length;
  const state = count === 0 ? "no core pins" : bad.length === 0 ? `ok (${count} pins)` : `STALE (${bad.length}/${count} pins)`;
  console.log(`${path}@${rev.slice(0, 7)}: ${state}`);
  for (const line of [...new Set(bad)]) console.log(`  ${line}`);
}

console.log(`${stale} of ${total} core pins differ from the core gitlink.`);
if (stale > 0 && !reportOnly) process.exit(1);
