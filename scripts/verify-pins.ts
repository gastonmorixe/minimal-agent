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
 */
import { existsSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { git, gitlink, root, submodulePaths } from "./pins-lib.ts";

const PREFIX = "minimal-agent-";
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

/** The first `package.json` in a parent of `dir`, or "". A parent workspace root would capture the install. */
function manifestAbove(dir: string): string {
  let at = dirname(dir);
  for (;;) {
    if (existsSync(join(at, "package.json"))) return join(at, "package.json");
    const up = dirname(at);
    if (up === at) return "";
    at = up;
  }
}

/** Run a command with inherited output. Return true on exit 0. */
function run(cwd: string, cmd: string[]): boolean {
  // HUSKY=0: do not install git hooks in a throwaway clone.
  const res = Bun.spawnSync(cmd, { cwd, stdout: "inherit", stderr: "inherit", env: { ...process.env, HUSKY: "0" } });
  return res.exitCode === 0;
}

const base = mkdtempSync(join(tmpdir(), "ma-pins-verify-"));
const above = manifestAbove(join(base, "x"));
if (above) {
  rmSync(base, { recursive: true, force: true });
  fail(`${above} is above the temp directory; set TMPDIR to a directory with no package.json above it`);
}

const failed: string[] = [];
for (const path of targets) {
  const src = join(root, path);
  if (!existsSync(join(src, ".git"))) {
    console.log(`${path}: not checked out, skipped`);
    continue;
  }
  const rev = useHead ? git(["rev-parse", "HEAD"], src) : gitlink(path);
  const dest = join(base, path);
  // A local clone has every commit of the checkout, also one that is not pushed yet.
  git(["clone", "--quiet", "--no-checkout", src, dest]);
  git(["checkout", "--quiet", "--detach", rev], dest);
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
  if (ok && runCheck) {
    console.log(`${path}: bun run check`);
    step = "check";
    ok = run(dest, ["bun", "run", "check"]);
  }
  console.log(`${path}@${rev.slice(0, 7)}: ${ok ? "ok" : `FAILED (${step})`}`);
  if (!ok) failed.push(path);
}

if (keep || failed.length > 0) console.log(`\nclones kept in ${base}`);
else rmSync(base, { recursive: true, force: true });

console.log(
  failed.length === 0
    ? `\n${targets.length} of ${targets.length} standalone installs passed.`
    : `\n${failed.length} of ${targets.length} standalone installs failed: ${failed.join(", ")}`,
);
if (failed.length > 0) process.exit(1);
