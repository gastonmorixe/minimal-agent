#!/usr/bin/env bun
/**
 * Version bump / sync tool for the minimal-agent monorepo and its submodules.
 *
 * Scheme
 * ------
 * - Semver in package.json (`0.1.0`).
 * - Stable git tags: `v0.1.0` (must match package.json when cutting a release).
 * - Core nightlies (existing CI): `v0.1.0-nightly.<UTC-stamp>` from package.json
 *   version + stamp — do not invent nightlies with this script.
 *
 * Targets
 * -------
 *   monorepo  → ./package.json
 *   core      → minimal-agent-core/package.json (+ plugin-api, tools/docs)
 *   plugins   → minimal-agent-plugins/package.json (+ every ma-*-plugin)
 *   all       → monorepo + core + plugins
 *
 * Usage
 * -----
 *   bun run scripts/version.ts status
 *   bun run scripts/version.ts set 0.1.0 [--targets all|core|plugins|monorepo]
 *   bun run scripts/version.ts set 0.1.0 --tag --message "release v0.1.0"
 *   bun run scripts/version.ts set 0.1.0 --tag --push
 *   bun run scripts/version.ts tag 0.1.0 [--targets all] [--push]
 *
 * `set` writes package.json versions (and optionally commits + tags).
 * `tag` only creates annotated tags at HEAD (package.json must already match).
 * Dirty worktrees: only the package.json files this tool touches are staged;
 * other WIP is left alone. Commits require a clean index for unrelated paths
 * or you pass --allow-dirty.
 */
import { existsSync, readdirSync, readFileSync, writeFileSync } from "node:fs"
import { join, relative } from "node:path"

const root = join(import.meta.dir, "..")

type Target = "monorepo" | "core" | "plugins"

type PackageHit = {
  target: Target
  path: string
  rel: string
  name: string
  version: string
}

function parseArgs(argv: string[]) {
  const cmd = argv[0] ?? "status"
  const rest = argv.slice(1)
  let version: string | undefined
  let targets: Target[] = ["monorepo", "core", "plugins"]
  let doTag = false
  let doPush = false
  let doCommit = true
  let allowDirty = false
  let message: string | undefined

  for (let i = 0; i < rest.length; i++) {
    const a = rest[i]!
    if (a === "--targets" || a === "-t") {
      const raw = rest[++i]
      if (!raw) die("missing value for --targets")
      targets = parseTargets(raw)
    } else if (a.startsWith("--targets=")) {
      targets = parseTargets(a.slice("--targets=".length))
    } else if (a === "--tag") {
      doTag = true
    } else if (a === "--push") {
      doPush = true
      doTag = true
    } else if (a === "--no-commit") {
      doCommit = false
    } else if (a === "--allow-dirty") {
      allowDirty = true
    } else if (a === "--message" || a === "-m") {
      message = rest[++i]
    } else if (a.startsWith("--message=")) {
      message = a.slice("--message=".length)
    } else if (a === "--help" || a === "-h") {
      printHelp()
      process.exit(0)
    } else if (!a.startsWith("-") && !version) {
      version = a
    } else {
      die(`unknown arg: ${a}`)
    }
  }

  return { cmd, version, targets, doTag, doPush, doCommit, allowDirty, message }
}

function parseTargets(raw: string): Target[] {
  if (raw === "all") return ["monorepo", "core", "plugins"]
  const parts = raw.split(",").map((s) => s.trim()).filter(Boolean)
  const out: Target[] = []
  for (const p of parts) {
    if (p === "monorepo" || p === "core" || p === "plugins") out.push(p)
    else die(`invalid target: ${p} (use monorepo|core|plugins|all)`)
  }
  if (out.length === 0) die("empty --targets")
  return out
}

function die(msg: string): never {
  console.error(`version: ${msg}`)
  process.exit(1)
}

function printHelp() {
  console.log(`Usage:
  bun run scripts/version.ts status
  bun run scripts/version.ts set <semver> [options]
  bun run scripts/version.ts tag <semver> [options]

Options:
  --targets, -t all|monorepo|core|plugins|a,b
  --tag                 create annotated git tags v<semver>
  --push                push commits + tags to origin (implies --tag for set)
  --no-commit           write package.json only
  --allow-dirty         commit even if other files are dirty
  --message, -m <text>  commit/tag message (default: chore: release vX.Y.Z)
`)
}

function readJson(path: string): Record<string, unknown> {
  return JSON.parse(readFileSync(path, "utf8")) as Record<string, unknown>
}

function writeJson(path: string, data: Record<string, unknown>) {
  writeFileSync(path, `${JSON.stringify(data, null, 2)}\n`)
}

function collectPackages(targets: Target[]): PackageHit[] {
  const hits: PackageHit[] = []

  const add = (target: Target, abs: string) => {
    if (!existsSync(abs)) die(`missing package.json: ${abs}`)
    const data = readJson(abs)
    hits.push({
      target,
      path: abs,
      rel: relative(root, abs),
      name: String(data.name ?? abs),
      version: String(data.version ?? ""),
    })
  }

  if (targets.includes("monorepo")) {
    add("monorepo", join(root, "package.json"))
  }
  if (targets.includes("core")) {
    const core = join(root, "minimal-agent-core")
    add("core", join(core, "package.json"))
    add("core", join(core, "plugin-api", "package.json"))
    add("core", join(core, "tools", "docs", "package.json"))
  }
  if (targets.includes("plugins")) {
    const plug = join(root, "minimal-agent-plugins")
    add("plugins", join(plug, "package.json"))
    for (const name of readdirSync(plug).sort()) {
      if (!/^ma-.+-plugin$/.test(name)) continue
      add("plugins", join(plug, name, "package.json"))
    }
  }

  return hits
}

function normalizeVersion(v: string): string {
  const s = v.startsWith("v") ? v.slice(1) : v
  if (!/^\d+\.\d+\.\d+([.-][0-9A-Za-z.-]+)?$/.test(s)) {
    die(`invalid semver: ${v} (expected e.g. 0.1.0)`)
  }
  return s
}

function tagName(version: string): string {
  return `v${version}`
}

function repoDirForTarget(target: Target): string {
  if (target === "monorepo") return root
  if (target === "core") return join(root, "minimal-agent-core")
  return join(root, "minimal-agent-plugins")
}

function sh(cwd: string, args: string[], opts?: { allowFail?: boolean }) {
  const r = Bun.spawnSync(args, {
    cwd,
    stdout: "pipe",
    stderr: "pipe",
  })
  const out = new TextDecoder().decode(r.stdout)
  const err = new TextDecoder().decode(r.stderr)
  if ((r.exitCode ?? 1) !== 0 && !opts?.allowFail) {
    die(`${args.join(" ")} failed in ${cwd}:\n${err || out}`)
  }
  return { code: r.exitCode ?? 1, out, err }
}

function git(cwd: string, args: string[], opts?: { allowFail?: boolean }) {
  return sh(cwd, ["git", ...args], opts)
}

function status() {
  const hits = collectPackages(["monorepo", "core", "plugins"])
  const byTarget = new Map<Target, PackageHit[]>()
  for (const h of hits) {
    const list = byTarget.get(h.target) ?? []
    list.push(h)
    byTarget.set(h.target, list)
  }

  for (const target of ["monorepo", "core", "plugins"] as Target[]) {
    const list = byTarget.get(target) ?? []
    const versions = [...new Set(list.map((h) => h.version))]
    const dir = repoDirForTarget(target)
    const head = git(dir, ["rev-parse", "--short", "HEAD"]).out.trim()
    const describe = git(dir, ["describe", "--tags", "--always"], {
      allowFail: true,
    }).out.trim()
    const stable = git(dir, ["tag", "-l", "v0.*.*", "v[0-9]*"], {
      allowFail: true,
    })
      .out.split("\n")
      .map((s) => s.trim())
      .filter((t) => t && !t.includes("nightly"))
      .sort()
    console.log(`\n## ${target}  (${relative(root, dir) || "."})  HEAD=${head}  describe=${describe}`)
    console.log(`   package.json versions: ${versions.join(", ") || "(none)"}`)
    if (versions.length > 1) {
      console.log("   DRIFT:")
      for (const h of list) {
        if (h.version !== versions[0]) console.log(`     ${h.rel} = ${h.version}`)
      }
    }
    console.log(
      `   stable tags: ${stable.slice(-5).join(" ") || "(none)"}${stable.length > 5 ? " …" : ""}`,
    )
    for (const h of list.slice(0, target === "plugins" ? 3 : 99)) {
      console.log(`   - ${h.rel}: ${h.name}@${h.version}`)
    }
    if (target === "plugins" && list.length > 3) {
      console.log(`   - … ${list.length - 3} more plugin packages`)
    }
  }
  console.log("")
}

function setVersion(
  versionRaw: string,
  targets: Target[],
  opts: {
    doTag: boolean
    doPush: boolean
    doCommit: boolean
    allowDirty: boolean
    message?: string
  },
) {
  const version = normalizeVersion(versionRaw)
  const tag = tagName(version)
  const msg = opts.message ?? `chore: release ${tag}`
  const hits = collectPackages(targets)

  // write package.json
  let changed = 0
  for (const h of hits) {
    const data = readJson(h.path)
    if (String(data.version) === version) continue
    data.version = version
    writeJson(h.path, data)
    changed++
    console.log(`set ${h.rel}: ${h.version} → ${version}`)
  }
  if (changed === 0) console.log(`all ${hits.length} package.json already at ${version}`)

  if (!opts.doCommit && !opts.doTag) return

  // per-repo commit
  for (const target of targets) {
    const dir = repoDirForTarget(target)
    const paths = hits.filter((h) => h.target === target).map((h) => h.path)

    if (opts.doCommit) {
      const dirty = git(dir, ["status", "--porcelain"]).out
      if (dirty.trim() && !opts.allowDirty) {
        // allow dirty only if every dirty path is one of our package.json files
        const lines = dirty
          .split("\n")
          .map((l) => l.trimEnd())
          .filter(Boolean)
        const foreign = lines.filter((line) => {
          const file = line.slice(3).replace(/^"+|"+$/g, "").split(" -> ").pop()!
          const abs = join(dir, file)
          return !paths.includes(abs)
        })
        if (foreign.length) {
          die(
            `${relative(root, dir) || "."} has unrelated dirty files; commit or stash them, or pass --allow-dirty:\n${foreign.slice(0, 10).join("\n")}`,
          )
        }
      }

      for (const p of paths) {
        git(dir, ["add", "--", p])
      }
      const staged = git(dir, ["diff", "--cached", "--name-only"]).out.trim()
      if (staged) {
        git(dir, ["commit", "-m", msg])
        console.log(`committed in ${relative(root, dir) || "."}: ${msg}`)
      } else {
        console.log(`no commit needed in ${relative(root, dir) || "."}`)
      }
    }

    if (opts.doTag) {
      ensureTag(dir, tag, msg)
    }

    if (opts.doPush) {
      git(dir, ["push", "origin", "HEAD"])
      if (opts.doTag) git(dir, ["push", "origin", tag])
      console.log(`pushed ${relative(root, dir) || "."} HEAD${opts.doTag ? ` + ${tag}` : ""}`)
    }
  }

  // monorepo pin bump when core/plugins moved
  if (opts.doCommit && targets.some((t) => t === "core" || t === "plugins")) {
    const mono = root
    if (targets.includes("core")) git(mono, ["add", "minimal-agent-core"])
    if (targets.includes("plugins")) git(mono, ["add", "minimal-agent-plugins"])
    if (targets.includes("monorepo")) {
      // monorepo package.json already committed above if monorepo was a target
    }
    const staged = git(mono, ["diff", "--cached", "--name-only"]).out.trim()
    if (staged) {
      // if monorepo package was already committed in the loop, only pins may remain
      const pinMsg = `chore: bump submodule pins for ${tag}`
      git(mono, ["commit", "-m", pinMsg])
      console.log(`committed monorepo pin bump: ${pinMsg}`)
      if (opts.doPush) {
        git(mono, ["push", "origin", "HEAD"])
        console.log("pushed monorepo pins")
      }
    }
  }
}

function ensureTag(dir: string, tag: string, message: string) {
  const exists = git(dir, ["rev-parse", "-q", "--verify", `refs/tags/${tag}`], {
    allowFail: true,
  })
  if (exists.code === 0) {
    const at = git(dir, ["rev-list", "-n", "1", tag]).out.trim()
    const head = git(dir, ["rev-parse", "HEAD"]).out.trim()
    if (at === head) {
      console.log(`tag ${tag} already at HEAD in ${relative(root, dir) || "."}`)
      return
    }
    die(
      `tag ${tag} already exists in ${relative(root, dir) || "."} at ${at.slice(0, 7)}, HEAD is ${head.slice(0, 7)}`,
    )
  }
  git(dir, ["tag", "-a", tag, "-m", message])
  console.log(`tagged ${relative(root, dir) || "."} ${tag}`)
}

function tagOnly(
  versionRaw: string,
  targets: Target[],
  opts: { doPush: boolean; message?: string },
) {
  const version = normalizeVersion(versionRaw)
  const tag = tagName(version)
  const msg = opts.message ?? `release ${tag}`
  const hits = collectPackages(targets)
  for (const h of hits) {
    if (h.version !== version) {
      die(`${h.rel} is ${h.version}, expected ${version}. Run set first.`)
    }
  }
  for (const target of targets) {
    const dir = repoDirForTarget(target)
    ensureTag(dir, tag, msg)
    if (opts.doPush) {
      git(dir, ["push", "origin", tag])
      console.log(`pushed tag ${tag} for ${relative(root, dir) || "."}`)
    }
  }
}

const args = parseArgs(process.argv.slice(2))

switch (args.cmd) {
  case "status":
    status()
    break
  case "set":
    if (!args.version) die("set requires a version, e.g. set 0.1.0")
    setVersion(args.version, args.targets, {
      doTag: args.doTag,
      doPush: args.doPush,
      doCommit: args.doCommit,
      allowDirty: args.allowDirty,
      message: args.message,
    })
    break
  case "tag":
    if (!args.version) die("tag requires a version, e.g. tag 0.1.0")
    tagOnly(args.version, args.targets, {
      doPush: args.doPush,
      message: args.message,
    })
    break
  default:
    die(`unknown command: ${args.cmd} (status|set|tag)`)
}
