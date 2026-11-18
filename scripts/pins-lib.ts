/**
 * Shared helpers for the umbrella pin scripts (`pin-mains.ts`,
 * `check-core-pins.ts`). Spec S46.
 */
import { existsSync, mkdirSync, mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";

export const root = join(import.meta.dir, "..");

/** Submodule paths from `.gitmodules`, in file order. */
export function submodulePaths(): string[] {
  const text = readFileSync(join(root, ".gitmodules"), "utf8");
  return [...text.matchAll(/^\s*path\s*=\s*(\S+)\s*$/gm)].map((m) => m[1] ?? "").filter(Boolean);
}

/** Run git and return trimmed stdout. Throw on a non-zero exit. */
export function git(args: string[], cwd = root): string {
  const res = Bun.spawnSync(["git", ...args], { cwd, stdout: "pipe", stderr: "pipe" });
  if (res.exitCode !== 0) {
    throw new Error(`git ${args.join(" ")} (in ${cwd}) failed: ${res.stderr.toString().trim()}`);
  }
  return res.stdout.toString().trim();
}

/** The gitlink SHA for `path` in the umbrella index (staged value wins over HEAD). */
export function gitlink(path: string): string {
  const line = git(["ls-files", "--stage", "--", path]);
  const sha = line.split(/\s+/)[1];
  if (!sha || !/^[0-9a-f]{40}$/.test(sha)) throw new Error(`no gitlink for ${path}`);
  return sha;
}

/** Approval line markers in `CHANGELOG.md`. The sweep rewrites only the SHAs between them. */
export const APPROVAL_START = "<!-- pin-approvals:start -->";
export const APPROVAL_END = "<!-- pin-approvals:end -->";


/** The first `package.json` in a parent of `dir`, or "". A workspace root above a clone would capture its install. */
function manifestAbove(dir: string): string {
  let at = dirname(dir);
  for (;;) {
    if (existsSync(join(at, "package.json"))) return join(at, "package.json");
    const up = dirname(at);
    if (up === at) return "";
    at = up;
  }
}

/**
 * Make a temp directory for standalone clones, with no `package.json` above it.
 *
 * `MA_PINS_TMPDIR` sets the parent. The default is `/tmp` when it exists, not
 * the per-user temp directory: on macOS with Bun 1.4.4, a script under
 * `$TMPDIR` (`/var/folders/...`) starts in about 80 ms, against 13 ms under
 * `/tmp`. The cli tests that use a 40 ms sidecar timeout fail there.
 */
export function standaloneBase(prefix: string): string {
  const parent = process.env.MA_PINS_TMPDIR || (existsSync("/tmp") ? "/tmp" : tmpdir());
  const base = mkdtempSync(join(parent, prefix));
  const above = manifestAbove(join(base, "x", "y"));
  if (above) throw new Error(`${above} is above ${base}; set MA_PINS_TMPDIR to a directory with no package.json above it`);
  return base;
}

/**
 * Clone the submodule `path` at `rev` into `base`, and return the clone directory.
 *
 * Each clone gets a parent directory of its own (`<base>/<path>/<path>`), so it
 * has no sibling checkout. A cli test expects the local core link when it
 * finds `../minimal-agent-core`, and a standalone clone has the git pin.
 * The clone is local, so it has every commit of the checkout, also one that is
 * not pushed yet.
 */
export function cloneStandalone(base: string, path: string, rev: string): string {
  const dest = join(base, path, path);
  mkdirSync(dirname(dest), { recursive: true });
  git(["clone", "--quiet", "--no-checkout", join(root, path), dest]);
  git(["checkout", "--quiet", "--detach", rev], dest);
  return dest;
}
