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

/**
 * Fetch `origin main` in each directory, all at the same time. Return the directories where the
 * fetch failed. A report that reads `origin/main` without a fetch can give advice for a state that
 * is hours old: another session can have pushed since.
 */
export async function fetchMains(dirs: string[]): Promise<string[]> {
  const results = await Promise.all(
    dirs.map(async (cwd) => {
      const proc = Bun.spawn(["git", "fetch", "--quiet", "origin", "main"], { cwd, stdout: "ignore", stderr: "ignore", timeout: 30_000 });
      return { cwd, ok: (await proc.exited) === 0 };
    }),
  );
  return results.filter((r) => !r.ok).map((r) => r.cwd);
}

/** The gitlink SHA for `path` in the umbrella index (staged value wins over HEAD). */
export function gitlink(path: string): string {
  const line = git(["ls-files", "--stage", "--", path]);
  const sha = line.split(/\s+/)[1];
  if (!sha || !/^[0-9a-f]{40}$/.test(sha)) throw new Error(`no gitlink for ${path}`);
  return sha;
}

/** Any git dependency pin: `<repo>.git#<sha>`. */
const GIT_PIN_RE = /([\w.-]+)\.git#([0-9a-f]{7,40})/g;

/** The git pins of one commit: repo name to SHAs, for the manifests and for the lockfiles. */
export type GitPins = { manifest: Map<string, Set<string>>; lock: Map<string, Set<string>>; locks: number };

/** Read the git pins of every tracked `package.json` and `bun.lock` of submodule `path` at commit `rev`. */
export function gitPinsAt(path: string, rev: string): GitPins {
  const cwd = join(root, path);
  const pins: GitPins = { manifest: new Map(), lock: new Map(), locks: 0 };
  const files = git(["ls-tree", "-r", "--name-only", rev], cwd)
    .split("\n")
    .filter((f) => /(^|\/)(package\.json|bun\.lock)$/.test(f) && !f.includes("node_modules/"));
  for (const file of files) {
    const isLock = file.endsWith("bun.lock");
    if (isLock) pins.locks++;
    const into = isLock ? pins.lock : pins.manifest;
    for (const m of git(["show", `${rev}:${file}`], cwd).matchAll(GIT_PIN_RE)) {
      const set = into.get(m[1] ?? "") ?? new Set<string>();
      set.add(m[2] ?? "");
      into.set(m[1] ?? "", set);
    }
  }
  return pins;
}

/** Short SHAs, sorted, as one text. */
export function shortShas(shas: Iterable<string>): string {
  return [...shas]
    .map((s) => s.slice(0, 7))
    .sort()
    .join(", ");
}

/** commitlint `header-max-length` of `@commitlint/config-conventional` (all repos). */
export const HEADER_MAX = 100;

/** Marker of a cut header. */
const CUT = "...";

/**
 * A commit header of at most {@link HEADER_MAX} code points: `head + tail`,
 * with `head` cut (at a word end when one is near) and `...` added when the
 * whole text is too long. `tail` always stays (for example `)` or a SHA
 * range). A pin header names the core subject, which can be long, and the
 * commit-msg hook stops a longer header after the pin edits are written.
 */
export function fitHeader(head: string, tail = ""): string {
  const h = [...head];
  const t = [...tail];
  if (h.length + t.length <= HEADER_MAX) return head + tail;
  const room = HEADER_MAX - t.length - CUT.length;
  let cut = h.slice(0, Math.max(0, room)).join("");
  const space = cut.lastIndexOf(" ");
  if (space >= room - 20) cut = cut.slice(0, space);
  return `${cut.replace(/[\s,(:]+$/, "")}${CUT}${tail}`;
}

/**
 * One line for each git dependency that `bun.lock` and `package.json` pin to
 * different SHAs. `bun install --frozen-lockfile` stops on such a difference
 * in a standalone clone. `skip` names dependencies to leave out.
 */
export function lockfileProblems(pins: GitPins, skip: string[] = []): string[] {
  if (pins.locks === 0) return [];
  const out: string[] = [];
  for (const [name, want] of pins.manifest) {
    const got = pins.lock.get(name);
    if (!got || skip.includes(name)) continue;
    if (shortShas(want) !== shortShas(got)) out.push(`bun.lock has ${name} ${shortShas(got)}, package.json has ${shortShas(want)}`);
  }
  return out;
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
