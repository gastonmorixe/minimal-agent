#!/usr/bin/env bun
/**
 * Symlink every ma-*-plugin from the plugins submodule into ~/.agents/plugins/.
 * Existing links/dirs with the same name are replaced only if they already point
 * at (or live under) this monorepo's plugins tree; otherwise they are skipped.
 */
import { homedir } from "node:os";
import { join, resolve } from "node:path";
import { readdirSync, mkdirSync, lstatSync, readlinkSync, existsSync } from "node:fs";
import { $ } from "bun";

const monorepoRoot = resolve(import.meta.dir, "..");
const pluginsRoot = join(monorepoRoot, "minimal-agent-plugins");
const targetRoot = join(homedir(), ".agents", "plugins");

if (!existsSync(pluginsRoot)) {
  console.error(`plugins submodule missing: ${pluginsRoot}`);
  console.error("run: git submodule update --init --recursive");
  process.exit(1);
}

mkdirSync(targetRoot, { recursive: true });

const entries = readdirSync(pluginsRoot, { withFileTypes: true })
  .filter((e) => e.isDirectory() && /^ma-.+-plugin$/.test(e.name))
  .map((e) => e.name)
  .sort();

if (entries.length === 0) {
  console.error(`no ma-*-plugin dirs under ${pluginsRoot}`);
  process.exit(1);
}

let linked = 0;
let skipped = 0;

for (const name of entries) {
  const src = join(pluginsRoot, name);
  const dest = join(targetRoot, name);

  if (existsSync(dest) || existsSync(dest.replace(/\/$/, ""))) {
    try {
      const st = lstatSync(dest);
      if (st.isSymbolicLink()) {
        const current = resolve(targetRoot, readlinkSync(dest));
        if (current === src) {
          console.log(`= ${name}`);
          skipped++;
          continue;
        }
        if (!current.startsWith(pluginsRoot + "/") && current !== pluginsRoot) {
          // foreign link — leave it alone
          console.warn(`skip ${name}: already linked to ${current}`);
          skipped++;
          continue;
        }
      } else {
        console.warn(`skip ${name}: ${dest} exists and is not a symlink`);
        skipped++;
        continue;
      }
    } catch {
      // fall through to recreate
    }
  }

  await $`ln -sfn ${src} ${dest}`;
  console.log(`+ ${name} -> ${src}`);
  linked++;
}

console.log(`\nlinked ${linked}, skipped ${skipped}, total ${entries.length}`);
console.log(`target: ${targetRoot}`);
