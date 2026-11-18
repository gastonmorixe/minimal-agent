#!/usr/bin/env bun
/**
 * Move the `@minimal-agent/config` pin of every consumer to one config commit.
 *
 * Core, plugins and cli name a config commit in their `package.json`
 * (`minimal-agent-config.git#<sha>`). The root workspace does not link config
 * the way it links core, so each repo installs the config commit that it pins,
 * also inside the umbrella. After a config commit, the pins are behind:
 * `bun run pins` prints a note for each one. This script moves them.
 *
 * It rewrites the pin in each tracked `package.json`. Then it updates the
 * committed `bun.lock` of the repos that have one, with `pins:lock`: the
 * lockfile holds the peer versions of the config package, so the SHA alone is
 * not enough there.
 *
 * Usage
 * -----
 *   bun run pins:config              # to the config gitlink of the umbrella
 *   bun run pins:config <sha>        # to a given config commit (7-40 hex)
 *   bun run pins:config --dry-run    # print what would change, write nothing
 *
 * It commits nothing. Next, in each changed repo: run its gate, commit and push.
 * A commit in core then needs the core pin refresh (`bun run pins:core`).
 */
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { git, gitlink, root, submodulePaths } from "./pins-lib.ts";

const CONFIG = "minimal-agent-config";
const PIN_RE = /minimal-agent-config\.git#([0-9a-f]{7,40})/g;

const args = process.argv.slice(2);
const dryRun = args.includes("--dry-run");
const shaArg = args.find((a) => !a.startsWith("--"));

function fail(msg: string): never {
  console.error(`pins:config: ${msg}`);
  process.exit(1);
}

const subs = submodulePaths();
if (!subs.includes(CONFIG)) fail(`${CONFIG} is not a submodule`);
const configDir = join(root, CONFIG);
if (shaArg && !/^[0-9a-f]{7,40}$/.test(shaArg)) fail(`"${shaArg}" is not a 7-40 char hex SHA`);
let sha = "";
try {
  sha = git(["rev-parse", "--verify", `${shaArg ?? gitlink(CONFIG)}^{commit}`], configDir);
} catch {
  fail(`the config commit ${shaArg ?? gitlink(CONFIG)} is not in ${CONFIG}: git -C ${CONFIG} fetch origin`);
}
git(["fetch", "--quiet", "origin"], configDir);
if (git(["branch", "-r", "--contains", sha], configDir).trim() === "") {
  fail(`config ${sha.slice(0, 7)} is not on any origin branch; push it first (consumers clone by SHA)`);
}
console.log(`config: ${sha.slice(0, 7)}  ${git(["log", "-1", "--format=%s", sha], configDir)}`);

const changed: string[] = [];
const withLock: string[] = [];
for (const path of subs) {
  if (path === CONFIG) continue;
  const cwd = join(root, path);
  const tracked = git(["ls-files"], cwd).split("\n");
  const manifests = tracked.filter((f) => /(^|\/)package\.json$/.test(f) && !f.includes("node_modules/"));
  let pins = 0;
  const olds = new Set<string>();
  for (const file of manifests) {
    const full = join(cwd, file);
    const text = readFileSync(full, "utf8");
    const next = text.replace(PIN_RE, (match, old: string) => {
      if (old === sha) return match;
      pins++;
      olds.add(old.slice(0, 7));
      return `minimal-agent-config.git#${sha}`;
    });
    if (next !== text && !dryRun) writeFileSync(full, next);
  }
  if (pins === 0) {
    console.log(`${path}: ok (already on ${sha.slice(0, 7)} or no config pin)`);
    continue;
  }
  console.log(`${path}: ${pins} pin(s) ${[...olds].join(", ")} -> ${sha.slice(0, 7)}${dryRun ? " (dry run)" : ""}`);
  changed.push(path);
  if (tracked.includes("bun.lock")) withLock.push(path);
}

if (dryRun || changed.length === 0) process.exit(0);

if (withLock.length > 0) {
  console.log(`\nbun.lock: ${withLock.join(", ")}`);
  const res = Bun.spawnSync(["bun", "run", join("scripts", "lock-submodule.ts"), ...withLock], { cwd: root, stdout: "inherit", stderr: "inherit" });
  if (res.exitCode !== 0) fail("pins:lock failed. The package.json files are changed, the lockfiles are not.");
}

console.log(`\nNext, in ${changed.join(", ")}: run the gate, commit ("chore: pin config to ${sha.slice(0, 7)}") and push.`);
if (changed.includes("minimal-agent-core")) console.log("Then, for the core commit: bun run pins:core");
