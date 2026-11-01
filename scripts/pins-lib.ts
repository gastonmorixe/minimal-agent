/**
 * Shared helpers for the umbrella pin scripts (`pin-mains.ts`,
 * `check-core-pins.ts`). Spec S46.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";

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
