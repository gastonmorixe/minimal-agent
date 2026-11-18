#!/usr/bin/env bun
/**
 * Check that every repo declares the tool versions of the root `catalog`.
 *
 * Why: the same tool versions are written in several places, because each
 * submodule must also install alone (a standalone clone has no umbrella root
 * above it, and `catalog:` resolves only against the root of the install).
 * A root install uses the root catalog. A standalone install uses the
 * submodule's own catalog or its literal versions. This check keeps the two
 * contexts on the same versions.
 *
 * It reads the working tree: the root `package.json` and every tracked
 * `package.json` in each submodule. A submodule that is not checked out is
 * skipped.
 *
 * Rules
 * -----
 *   1. A submodule catalog entry must equal the root catalog entry.
 *   2. A declared dependency on a catalog tool must be `catalog:` or the exact
 *      root catalog text.
 *   3. A `catalog:` reference in a submodule needs an entry in that submodule's
 *      own catalog. Without it, the standalone install fails.
 *   4. A root `overrides` range (for example `@types/node`) must equal every
 *      direct declaration of that package, and every submodule `overrides`
 *      entry of the same name.
 *
 * Usage
 * -----
 *   bun run scripts/check-catalogs.ts                 # exit 1 on any difference
 *   bun run scripts/check-catalogs.ts --report-only   # print the same report, exit 0
 */
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { git, root, submodulePaths } from "./pins-lib.ts";

type Deps = Record<string, string>;
type Manifest = {
  catalog?: Deps;
  workspaces?: string[] | { catalog?: Deps };
  overrides?: Record<string, unknown>;
  dependencies?: Deps;
  devDependencies?: Deps;
  peerDependencies?: Deps;
  optionalDependencies?: Deps;
};

/**
 * Declarations that differ from the root catalog on purpose.
 * Key: `<path of package.json from the umbrella root>#<package name>`.
 */
const ALLOWED: Record<string, string> = {
  // typedoc needs the TypeScript 6 compiler API (see tools/docs/README.md).
  "minimal-agent-core/tools/docs/package.json#typescript": "^6.0.3",
};

const GROUPS = ["dependencies", "devDependencies", "peerDependencies", "optionalDependencies"] as const;
const reportOnly = process.argv.includes("--report-only");

function read(path: string): Manifest {
  return JSON.parse(readFileSync(join(root, path), "utf8")) as Manifest;
}

function catalogOf(m: Manifest): Deps {
  const nested = Array.isArray(m.workspaces) ? undefined : m.workspaces?.catalog;
  return { ...nested, ...m.catalog };
}

/** Root override entries that are plain version ranges (not `workspace:` links or nested rules). */
function rangeOverrides(m: Manifest): Deps {
  const out: Deps = {};
  for (const [name, value] of Object.entries(m.overrides ?? {})) {
    if (typeof value === "string" && !value.includes(":")) out[name] = value;
  }
  return out;
}

const rootManifest = read("package.json");
const rootCatalog = catalogOf(rootManifest);
const rootOverrides = rangeOverrides(rootManifest);
if (Object.keys(rootCatalog).length === 0) {
  console.error("check-catalogs: the root package.json has no catalog");
  process.exit(1);
}
console.log(`root catalog: ${Object.keys(rootCatalog).length} tools, ${Object.keys(rootOverrides).length} override ranges`);

/** Check one package.json. `ownCatalog` is the catalog a standalone install of its repo would use. */
function check(path: string, ownCatalog: Deps, isRoot: boolean): { count: number; bad: string[] } {
  const m = read(path);
  const bad: string[] = [];
  let count = 0;

  // Rule 1.
  if (!isRoot) {
    for (const [name, spec] of Object.entries(catalogOf(m))) {
      count++;
      const want = rootCatalog[name];
      if (want === undefined) bad.push(`${path}: catalog has "${name}", which the root catalog does not have`);
      else if (spec !== want) bad.push(`${path}: catalog ${name} is "${spec}", root catalog is "${want}"`);
    }
  }

  for (const group of GROUPS) {
    for (const [name, spec] of Object.entries(m[group] ?? {})) {
      const want = rootCatalog[name];
      if (want !== undefined) {
        count++;
        if (ALLOWED[`${path}#${name}`] === spec) continue;
        // Rules 2 and 3.
        if (spec === "catalog:") {
          if (ownCatalog[name] === undefined) {
            bad.push(`${path}: ${group}.${name} is "catalog:" but this repo has no catalog entry for it (standalone install fails)`);
          }
        } else if (spec !== want) {
          bad.push(`${path}: ${group}.${name} is "${spec}", root catalog is "${want}"`);
        }
        continue;
      }
      // Rule 4, direct declarations.
      const forced = rootOverrides[name];
      if (forced !== undefined) {
        count++;
        if (spec !== forced) bad.push(`${path}: ${group}.${name} is "${spec}", root overrides force "${forced}"`);
      }
    }
  }

  // Rule 4, submodule overrides.
  if (!isRoot) {
    for (const [name, spec] of Object.entries(rangeOverrides(m))) {
      const forced = rootOverrides[name];
      if (forced === undefined) continue;
      count++;
      if (spec !== forced) bad.push(`${path}: overrides.${name} is "${spec}", root overrides have "${forced}"`);
    }
  }
  return { count, bad };
}

let total = 0;
let differ = 0;
function report(label: string, results: Array<{ count: number; bad: string[] }>): void {
  const count = results.reduce((a, r) => a + r.count, 0);
  const bad = results.flatMap((r) => r.bad);
  total += count;
  differ += bad.length;
  const state = count === 0 ? "no catalog tools" : bad.length === 0 ? `ok (${count} declarations)` : `DIFFERS (${bad.length}/${count} declarations)`;
  console.log(`${label}: ${state}`);
  for (const line of bad) console.log(`  ${line}`);
}

report("root", [check("package.json", rootCatalog, true)]);

for (const sub of submodulePaths()) {
  if (!existsSync(join(root, sub, "package.json"))) {
    console.log(`${sub}: not checked out, skipped`);
    continue;
  }
  const ownCatalog = catalogOf(read(join(sub, "package.json")));
  const files = git(["ls-files"], join(root, sub))
    .split("\n")
    .filter((f) => /(^|\/)package\.json$/.test(f) && !f.includes("node_modules/"));
  report(
    sub,
    files.map((f) => check(join(sub, f), ownCatalog, false)),
  );
}

console.log(`${differ} of ${total} tool version declarations differ from the root catalog.`);
if (differ > 0 && !reportOnly) process.exit(1);
