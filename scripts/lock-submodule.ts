#!/usr/bin/env bun
/**
 * Update the committed `bun.lock` of a submodule to match its `package.json`.
 *
 * Why this exists: inside the umbrella, `bun install` in a submodule is the
 * root workspace install. It never reads or writes the submodule's own
 * `bun.lock`. So that file goes out of date with no error, until a standalone
 * clone runs `bun install --frozen-lockfile`. This script does the update in
 * a clone outside the umbrella and copies the new `bun.lock` back.
 *
 * Usage
 * -----
 *   bun run pins:lock                # core, cli and web (the repos that commit bun.lock)
 *   bun run pins:lock web            # only these (names with or without "minimal-agent-")
 *
 * It uses the `package.json` files of the working tree, also uncommitted
 * edits. It changes only `bun.lock` in the submodule working tree. Review the
 * diff and commit it in that repo. An existing entry keeps its version when
 * `package.json` still allows it.
 */
import { copyFileSync, existsSync, readFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { cloneStandalone, git, root, standaloneBase, submodulePaths } from "./pins-lib.ts";

const PREFIX = "minimal-agent-";
const names = process.argv.slice(2).filter((a) => !a.startsWith("--")).map((a) => (a.startsWith(PREFIX) ? a : `${PREFIX}${a}`));

function fail(msg: string): never {
  console.error(`pins:lock: ${msg}`);
  process.exit(1);
}

function run(cwd: string, cmd: string[]): boolean {
  // HUSKY=0: do not install git hooks in a throwaway clone.
  const res = Bun.spawnSync(cmd, { cwd, stdout: "pipe", stderr: "pipe", env: { ...process.env, HUSKY: "0" } });
  if (res.exitCode !== 0) console.error(res.stderr.toString().trim());
  return res.exitCode === 0;
}

const known = submodulePaths();
for (const name of names) if (!known.includes(name)) fail(`"${name}" is not a submodule (${known.join(", ")})`);

const base = standaloneBase("ma-pins-lock-");
let failed = 0;
for (const path of names.length > 0 ? names : known) {
  const src = join(root, path);
  if (!existsSync(join(src, ".git"))) continue;
  const tracked = git(["ls-files"], src).split("\n");
  if (!tracked.includes("bun.lock")) {
    if (names.length > 0) console.log(`${path}: bun.lock is not tracked in this repo, skipped`);
    continue;
  }
  const dest = cloneStandalone(base, path, git(["rev-parse", "HEAD"], src));
  // The working-tree manifests and lockfile, so uncommitted edits count.
  for (const f of tracked) {
    if (/(^|\/)package\.json$/.test(f) || f === "bun.lock") copyFileSync(join(src, f), join(dest, f));
  }
  // A plain install updates the lockfile. The frozen install then proves it is complete.
  const ok = run(dest, ["bun", "install"]) && run(dest, ["bun", "install", "--frozen-lockfile"]);
  if (!ok) {
    failed++;
    console.log(`${path}: FAILED (bun install in the standalone clone)`);
    continue;
  }
  const next = readFileSync(join(dest, "bun.lock"), "utf8");
  if (next === readFileSync(join(src, "bun.lock"), "utf8")) {
    console.log(`${path}: bun.lock is up to date`);
    continue;
  }
  copyFileSync(join(dest, "bun.lock"), join(src, "bun.lock"));
  const stat = git(["diff", "--shortstat", "--", "bun.lock"], src);
  console.log(
    stat
      ? `${path}: bun.lock updated (${stat}). Review and commit it in ${path}.`
      : `${path}: bun.lock updated. It is now equal to the committed file.`,
  );
}

if (failed > 0) {
  console.log(`clones kept in ${base}`);
  process.exit(1);
}
rmSync(base, { recursive: true, force: true });
