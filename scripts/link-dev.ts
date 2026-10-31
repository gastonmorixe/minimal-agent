#!/usr/bin/env bun
/**
 * Link the local core checkout into its consumers for live development.
 *
 * Consumers (minimal-agent-cli, and minimal-agent-web once it depends on core)
 * install `@minimal-agent/core` from a pinned git URL. That pin is right for CI
 * and releases. During development you want edits in `minimal-agent-core/` to
 * reach the consumers without a commit and a re-pin.
 *
 * Usage
 * -----
 *   bun run link:dev     # point each consumer's node_modules/@minimal-agent/core at ./minimal-agent-core
 *   bun run link:reset   # restore the pinned copy from each consumer's bun.lock
 *   bun run link:status  # show linked or pinned per consumer
 *
 * Neither command edits package.json or bun.lock. A plain `bun install` in a
 * consumer also drops the link and restores the pin.
 */
import { existsSync, lstatSync, readFileSync, realpathSync, rmSync } from "node:fs";
import { join, relative } from "node:path";

const root = join(import.meta.dir, "..");
const core = join(root, "minimal-agent-core");
const CORE_NAME = "@minimal-agent/core";
const CONSUMERS = ["minimal-agent-cli", "minimal-agent-web"];

type Manifest = { name?: string; dependencies?: Record<string, string> };

function die(msg: string): never {
  console.error(`link-dev: ${msg}`);
  process.exit(1);
}

function readManifest(dir: string): Manifest | undefined {
  const path = join(dir, "package.json");
  if (!existsSync(path)) return undefined;
  return JSON.parse(readFileSync(path, "utf8")) as Manifest;
}

/** Consumer checkouts that exist and declare the core dependency. */
function consumers(): string[] {
  return CONSUMERS.map((name) => join(root, name)).filter(
    (dir) => readManifest(dir)?.dependencies?.[CORE_NAME] !== undefined,
  );
}

function installedCore(dir: string): string {
  return join(dir, "node_modules", "@minimal-agent", "core");
}

function isLinked(dir: string): boolean {
  const path = installedCore(dir);
  if (!existsSync(path) || !lstatSync(path).isSymbolicLink()) return false;
  return realpathSync(path) === realpathSync(core);
}

function run(cwd: string, args: string[]) {
  const r = Bun.spawnSync(args, { cwd, stdout: "inherit", stderr: "inherit" });
  if ((r.exitCode ?? 1) !== 0) die(`${args.join(" ")} failed in ${relative(root, cwd)}`);
}

function link() {
  const name = readManifest(core)?.name;
  if (name !== CORE_NAME) {
    die(`${relative(root, core)} is "${name ?? "missing"}", not ${CORE_NAME}. Update the core checkout first.`);
  }
  const targets = consumers();
  if (targets.length === 0) die(`no consumer declares ${CORE_NAME}`);
  run(core, ["bun", "link"]);
  for (const dir of targets) {
    run(dir, ["bun", "link", CORE_NAME]);
    if (!isLinked(dir)) die(`${relative(root, dir)}: ${CORE_NAME} is not linked to ${relative(root, core)}`);
    console.log(`linked ${relative(root, dir)} -> ${relative(root, core)}`);
  }
}

function reset() {
  for (const dir of consumers()) {
    const path = installedCore(dir);
    if (existsSync(path) && lstatSync(path).isSymbolicLink()) rmSync(path);
    run(dir, ["bun", "install", "--frozen-lockfile"]);
    console.log(`reset ${relative(root, dir)} to ${readManifest(dir)?.dependencies?.[CORE_NAME]}`);
  }
}

function status() {
  for (const dir of consumers()) {
    const state = isLinked(dir) ? `linked -> ${relative(root, core)}` : "pinned";
    console.log(`${relative(root, dir)}: ${state} (${readManifest(dir)?.dependencies?.[CORE_NAME]})`);
  }
}

const cmd = process.argv[2] ?? "status";
switch (cmd) {
  case "link":
    link();
    break;
  case "reset":
    reset();
    break;
  case "status":
    status();
    break;
  default:
    die(`unknown command: ${cmd} (link|reset|status)`);
}
