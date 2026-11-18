#!/usr/bin/env bun
/**
 * Install each submodule the way a standalone clone does, to test its
 * committed pins and lockfile.
 *
 * Why this exists: inside the umbrella, `bun install` in any submodule runs
 * the ROOT workspace install. It uses the root lockfile and the root
 * `overrides`, links the local core checkout, and never reads the submodule's
 * own `bun.lock`. So no command inside the umbrella can test a pin. This
 * script clones each submodule at its gitlink commit into a temp directory
 * with no `package.json` above it, and installs there.
 *
 * Usage
 * -----
 *   bun run pins:verify                  # core, plugins, cli and web: clone at the gitlink, install
 *   bun run pins:verify cli web          # only these (names with or without "minimal-agent-")
 *   bun run pins:verify --check          # also run `bun run check` in each clone (slow)
 *   bun run pins:verify --head           # clone the submodule's checked-out HEAD, not the gitlink
 *   bun run pins:verify --keep           # keep the temp directory and print its path
 *
 * A repo with a tracked `bun.lock` installs with `--frozen-lockfile`, so a
 * lockfile that does not match `package.json` fails. A repo that ignores its
 * lockfile (plugins) gets a plain install.
 *
 * `--head` tests a commit before the umbrella gitlink moves to it. The commit
 * must exist in the submodule checkout. Uncommitted changes are not cloned.
 *
 * The git dependencies (`@minimal-agent/core`, `@minimal-agent/config`) are
 * fetched from GitHub, so the pinned commits must be on the remote.
 *
 * `MA_PINS_TMPDIR` sets the parent of the temp directory (default `/tmp`).
 * A standalone clone runs fewer tests than the umbrella: the tests that need
 * a sibling checkout skip themselves.
 *
 * A repo whose files import core SOURCE from a sibling checkout
 * (`../../minimal-agent-core/src/...`) cannot run its gate in a standalone
 * clone. With no core checkout next to the clone, the typecheck fails. With
 * one, the clone has two copies of core (that checkout and the installed
 * pin), and core refuses to load the second copy. For such a commit `--check`
 * installs the repo, skips its gate, and says so. The plugins repo had such
 * imports until its tests moved to the installed package directory
 * (`node_modules/@minimal-agent/core/src/...`), and a plugins guard test now
 * rejects the old form. This skip stays for older commits.
 */
import { existsSync, rmSync } from "node:fs";
import { join } from "node:path";
import { cloneStandalone, git, gitlink, root, standaloneBase, submodulePaths } from "./pins-lib.ts";

const PREFIX = "minimal-agent-";
const CORE = "minimal-agent-core";
/** Submodules with an install of their own. Config has no dependencies to install. */
const DEFAULT = ["minimal-agent-core", "minimal-agent-plugins", "minimal-agent-cli", "minimal-agent-web"];

const args = process.argv.slice(2);
const runCheck = args.includes("--check");
const useHead = args.includes("--head");
const keep = args.includes("--keep");
const names = args.filter((a) => !a.startsWith("--")).map((a) => (a.startsWith(PREFIX) ? a : `${PREFIX}${a}`));

function fail(msg: string): never {
  console.error(`pins:verify: ${msg}`);
  process.exit(1);
}

const known = submodulePaths();
for (const name of names) if (!known.includes(name)) fail(`"${name}" is not a submodule (${known.join(", ")})`);
const targets = names.length > 0 ? names : DEFAULT.filter((p) => known.includes(p));

/** Run a command with inherited output. Return true on exit 0. */
function run(cwd: string, cmd: string[]): boolean {
  // HUSKY=0: do not install git hooks in a throwaway clone.
  const res = Bun.spawnSync(cmd, { cwd, stdout: "inherit", stderr: "inherit", env: { ...process.env, HUSKY: "0" } });
  return res.exitCode === 0;
}

const base = standaloneBase("ma-pins-verify-");

/**
 * True when a tracked file of the clone has an import statement for core source
 * by a relative path. The pattern starts at the line start: an indented match
 * is text inside a test fixture, not an import (the cli has one).
 */
function importsSiblingCore(dest: string): boolean {
  const pattern = `^(import |export |\\} from )[^;]*["'](\\.\\./)+${CORE}/`;
  return Bun.spawnSync(["git", "grep", "-qE", pattern, "--", "*.ts"], { cwd: dest }).exitCode === 0;
}

const failed: string[] = [];
const noGate: string[] = [];
for (const path of targets) {
  const src = join(root, path);
  if (!existsSync(join(src, ".git"))) {
    console.log(`${path}: not checked out, skipped`);
    continue;
  }
  const rev = useHead ? git(["rev-parse", "HEAD"], src) : gitlink(path);
  const dest = cloneStandalone(base, path, rev);
  const frozen = git(["ls-files", "--", "bun.lock"], dest) !== "";
  const install = frozen ? ["bun", "install", "--frozen-lockfile"] : ["bun", "install"];
  console.log(`\n${path}@${rev.slice(0, 7)}: ${install.join(" ")}${frozen ? "" : " (bun.lock is not tracked in this repo)"}`);

  let ok = run(dest, install);
  let step = "install";
  if (ok && git(["status", "--porcelain", "--untracked-files=no"], dest) !== "") {
    ok = false;
    step = "install changed tracked files";
    console.log(git(["status", "--short", "--untracked-files=no"], dest));
  }
  if (ok && runCheck && path !== CORE && importsSiblingCore(dest)) {
    noGate.push(path);
    console.log(`${path}: gate not run. Its tests import core source, so it needs the umbrella layout: bun run --cwd ${path} check`);
  } else if (ok && runCheck) {
    console.log(`${path}: bun run check`);
    step = "check";
    ok = run(dest, ["bun", "run", "check"]);
  }
  console.log(`${path}@${rev.slice(0, 7)}: ${ok ? "ok" : `FAILED (${step})`}`);
  if (!ok) failed.push(path);
}

if (keep || failed.length > 0) console.log(`\nclones kept in ${base}`);
else rmSync(base, { recursive: true, force: true });

const gates = runCheck ? ` Gates run in ${targets.length - noGate.length} of ${targets.length}${noGate.length > 0 ? ` (not in ${noGate.join(", ")})` : ""}.` : "";
console.log(
  failed.length === 0
    ? `\n${targets.length} of ${targets.length} standalone installs passed.${gates}`
    : `\n${failed.length} of ${targets.length} standalone installs failed: ${failed.join(", ")}`,
);
if (failed.length > 0) process.exit(1);
