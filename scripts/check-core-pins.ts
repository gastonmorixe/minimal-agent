#!/usr/bin/env bun
/**
 * Check the pins that a standalone clone of each submodule installs (spec S46).
 * Read each `package.json` and `bun.lock` at the submodule's gitlink commit, so
 * the result matches what the umbrella pins.
 *
 * Checks
 * ------
 *   1. Core pin: every consumer pins the same core SHA as the umbrella core
 *      gitlink. A stale pin fails.
 *   2. Lockfile: in one repo, `package.json` and the committed `bun.lock` name
 *      the same SHA for each git dependency. A difference fails, because
 *      `bun install --frozen-lockfile` stops on it in a standalone clone. A
 *      root install in the umbrella never reads that lockfile, so nothing else
 *      finds the difference.
 *   3. Config pin: report each `@minimal-agent/config` pin that differs from
 *      the config gitlink. This is a note and never fails: the workspace does
 *      not override config, so each repo moves its config pin on its own.
 *
 * Usage
 * -----
 *   bun run scripts/check-core-pins.ts                 # exit 1 on a stale core pin or a lockfile difference
 *   bun run scripts/check-core-pins.ts --report-only   # print the same report, exit 0
 */
import { join } from "node:path";
import { git, gitlink, root, submodulePaths } from "./pins-lib.ts";

const CORE = "minimal-agent-core";
const CONFIG = "minimal-agent-config";
const PIN_RE = /minimal-agent-core\.git#([0-9a-f]{7,40})/g;
/** Any git dependency pin: `<repo>.git#<sha>`. */
const GIT_PIN_RE = /([\w.-]+)\.git#([0-9a-f]{7,40})/g;
const reportOnly = process.argv.includes("--report-only");

const subs = submodulePaths();
const coreSha = gitlink(CORE);
const configSha = subs.includes(CONFIG) ? gitlink(CONFIG) : "";
console.log(`core gitlink: ${coreSha}`);

/** Git pins in `text`, as repo name -> set of SHAs. */
function gitPins(text: string, into: Map<string, Set<string>>): void {
  for (const m of text.matchAll(GIT_PIN_RE)) {
    const name = m[1] ?? "";
    const set = into.get(name) ?? new Set<string>();
    set.add(m[2] ?? "");
    into.set(name, set);
  }
}

function short(shas: Iterable<string>): string {
  return [...shas]
    .map((s) => s.slice(0, 7))
    .sort()
    .join(", ");
}

/** How far `pin` is behind the config gitlink, as text for a note. */
function configDistance(pin: string): string {
  try {
    const n = git(["rev-list", "--count", `${pin}..${configSha}`], join(root, CONFIG));
    return n === "0" ? "not an ancestor of the config gitlink" : `${n} commit${n === "1" ? "" : "s"} behind the config gitlink`;
  } catch {
    return "distance unknown";
  }
}

let stale = 0;
let total = 0;
let lockDiffs = 0;
const notes: string[] = [];
for (const path of subs) {
  const cwd = join(root, path);
  const rev = gitlink(path);
  const files = git(["ls-tree", "-r", "--name-only", rev], cwd)
    .split("\n")
    .filter((f) => /(^|\/)(package\.json|bun\.lock)$/.test(f) && !f.includes("node_modules/"));
  const bad: string[] = [];
  const manifestPins = new Map<string, Set<string>>();
  const lockPins = new Map<string, Set<string>>();
  let locks = 0;
  let count = 0;
  for (const file of files) {
    const text = git(["show", `${rev}:${file}`], cwd);
    if (file.endsWith("bun.lock")) {
      locks++;
      gitPins(text, lockPins);
    } else gitPins(text, manifestPins);
    if (path === CORE) continue;
    for (const m of text.matchAll(PIN_RE)) {
      count++;
      const sha = m[1] ?? "";
      if (sha !== coreSha) bad.push(`${file} -> ${sha}`);
    }
  }
  total += count;
  stale += bad.length;

  // Check 2: package.json against the committed bun.lock, per git dependency.
  const lockBad: string[] = [];
  if (locks > 0) {
    for (const [name, want] of manifestPins) {
      const got = lockPins.get(name);
      if (!got) continue;
      if (short(want) !== short(got)) lockBad.push(`bun.lock has ${name} ${short(got)}, package.json has ${short(want)}`);
    }
  }
  lockDiffs += lockBad.length;

  // Check 3: the config pin against the config gitlink (a note).
  if (configSha && path !== CONFIG) {
    for (const sha of manifestPins.get(CONFIG) ?? []) {
      if (!configSha.startsWith(sha)) notes.push(`${path} pins config ${sha.slice(0, 7)} (${configDistance(sha)})`);
    }
  }

  const pinState =
    path === CORE
      ? "is the core"
      : count === 0
        ? "no core pins"
        : bad.length === 0
          ? `ok (${count} pins)`
          : `STALE (${bad.length}/${count} pins)`;
  const lockState = lockBad.length > 0 ? ", LOCKFILE DIFFERS" : "";
  console.log(`${path}@${rev.slice(0, 7)}: ${pinState}${lockState}`);
  for (const line of [...new Set(bad)]) console.log(`  ${line}`);
  for (const line of lockBad) console.log(`  ${line}`);
}

if (notes.length > 0) {
  console.log(`config gitlink: ${configSha}`);
  for (const line of notes) console.log(`  note: ${line}`);
}

// One summary line: `pin-core-everywhere.ts` prints the last line of this report.
const lockPart = lockDiffs > 0 ? ` ${lockDiffs} lockfile pin${lockDiffs === 1 ? " differs" : "s differ"} from package.json.` : "";
console.log(`${stale} of ${total} core pins differ from the core gitlink.${lockPart}`);
if ((stale > 0 || lockDiffs > 0) && !reportOnly) process.exit(1);
