# What is left to do and merge (Walter, session 1ccf094b, 2026-11-18 13:20 EST)

Written for the next session. Scott's file `HANDOFFS.md` in this folder covers the tool-result project and the exposed token. This file does not replace it. Facts below were read from git and `gh` at about 13:15. I mark what I did not check.

## 0. First thing, not git: rotate the exposed token
Read `HANDOFFS.md` (top). One real-looking Anthropic OAuth token (`sk-ant-oat01-...`) is in the public history of core (`1b320dc`) and plugins (`10c80fb`). Revoke that session first. Rewriting history does not undo copies. I confirmed the two commits and file paths myself, without printing the value. All six repos are public since 11:44 (you asked for it). Nobody has scanned the rest of the history for other secrets.

## 1. State of main (13:15)
| repo | main |
|---|---|
| umbrella | `cbdbb32` (docs only, on top of `4932c28`) |
| core | `2c3b308` |
| plugins | `47626fd` |
| cli | `e6b5dee` |
| web | `65fbb30` |
| config | `55623ce` |

- Last complete green push run: `44359890627` on `4932c28`. It covers all five repos at these pins. Attempt 2 of `44354732956` on `9dfce99` was green too. Its attempt 1 failed on a flaky CLI test.
- The runs on my two docs commits are not a verdict: `edb2e24` was cancelled by my next push, and `44366172302` on `cbdbb32` was still running at 13:15. Both commits change only files under `research/`, no code.
- The shared checkout `/Users/gaston/Projects/minimal-agent-monorepo` is fast-forwarded to these mains, clean, 0 of 27 pins differ.

## 2. Open work, in priority order
1. **Carlos's no-direct-stdio guard (lint rule that bans direct stdout/stderr writes).** One backup commit in each repo: core `feat/no-direct-writes` `7163621`, plugins `a61cd90`, cli `1a00389`, web `6614aa4`, umbrella `5659390` (describes the set). Dry-run merge into each main: 0 conflicts (I ran `git merge-tree`, no test run). Not covered by any CI. His plan: core, then cli/plugins/web with the core pin bump (`pins:core`), then umbrella. Ask him or run the full check on each repo first.
2. **Matthew's cache fix (anchor marker, append-only thinking).** Three backup branches `backup/cache-anchor-append-only`: core `c857ffd`, plugins `f689c66`, cli `92125ca`. They are WIP snapshots of uncommitted worktrees, not mergeable. Work is on disk in `/Users/gaston/Projects/minimal-agent_WT-cache-anchor` (core 22 files, plugins 5, cli 9 uncommitted). It waits for the live test on Haiku and your decision. Default behaviour must stay unchanged.
3. **Core event for the per-provider cache design.** Needs your yes. Design: `research/team/walter/2026-11-18-cache-anomaly-per-provider.md`. The plugins-only part is merged (plugins `353ed8f`). Nothing depends on the core event today.
4. **`ste/dictionary` branches** (2026-11-17): core `d373900` (+4 commits), plugins `906d7d8` (+4), cli `3c17eb9` (+1). Owner not known to me. A dry-run merge of core gives 2 conflicts. I did not test plugins or cli. Decide: finish or drop.
5. **Helen's reader chain (Cursor, ACP, CLI hosts).** Scott's `HANDOFFS.md` section 3 says it is local only in her worktree. I did not check. Her E8 is already on core main. I deleted the remote branches `tr/helen-w3` and `tr/helen-w3-e8` because their commits are on main (restore info: section 4).
6. **Flaky CLI test** `src/ui/formatter/mdstream-code-highlighter.test.ts` ("consecutive timeout circuit breaker", 40 ms). It failed attempt 1 of run `44354732956` and passed on rerun. Make it deterministic (fake clock).
7. **Core main commitlint is red.** The tip subject `merge: origin/main (resume fix) into tr/helen-w3-e8` is not a conventional commit type. The umbrella does not lint submodule commits. Decide: leave, or put a conventional commit on top. No force push.
8. **Old core branch** `WT-transport-registry-v2` `dedb081` (2026-06-28, one commit). Probably dead. Decide.

## 3. Work that is not on any remote (this is the real risk)
Full machine-generated lists: `research/team/walter/pending-work-inventory-20261118.md`.
- **183 local branches** besides `main`. Many are old `zt/*` and `WT-*` branches. Examples with commits not on main and no remote copy: core `zt/integrate-5` (+12), `WT-agent-mesh` (+7), `feat/cache-fixes` (+5), `WT-multi-provider-refactor` (+4). I did not read any of them.
- **57 worktrees with uncommitted files** (not in git at all). Largest: `..._WT-zt-integ5/minimal-agent-plugins` (50), `..._WT-zero-prompts` (41), `tmp/christina-wt/plugins` (36), `research/team/samantha/c3-core` (33), `..._WT-zt-integ5/minimal-agent-core` (28), `..._WT-zt-julia/minimal-agent-core` (24).
- **5 stashes**: core 4 (oldest 2026-05-28 on `dev-private`), cli 1 (2026-11-18 on `tr/integrate`).
- **210 worktrees** registered. I deleted none of them.
Proposed next step, if you agree: push every local-only branch to a `backup/<name>` branch, commit uncommitted worktree files onto backup branches, delete nothing. Then review.

## 4. What I did today in the cleanup (13:04 to 13:20)
- Fast-forwarded the shared checkout. Committed Frank's progress note and my notes (docs only).
- Deleted 100 local and 7 remote branches whose commits are already on main and that no worktree used. List with commit IDs: `research/team/walter/branch-cleanup-20261118.txt`. Restore with `git push origin <sha>:refs/heads/<name>`.
- Copied `/tmp` into `./tmp/slash-tmp-20261118/` (section 5). I did NOT delete anything from `/tmp`.

## 5. What was in `/tmp` and where it is now
Everything is in `tmp/slash-tmp-20261118/` (about 1.0 GB, git-ignored on purpose). It has the loose files and folders from `/tmp` without `node_modules` and `.git`. That includes review output, golden baselines, `tui-switch`, `ma-direct-writes`, `ma-review`, `ma-w3`, and the proof logs. File counts match the originals for the five folders I compared (`ma-direct-writes`, `ma-review`, `tui-switch`, `ma-w3`, `golden-baseline-gabriel`). Top-level files: 2197 in `/tmp`, 2194 copied. I did not find which 3 are missing. They may be sockets or files that changed.
Git worktrees that lived in `/tmp` are saved separately in `tmp/slash-tmp-20261118/worktree-state/` with `MANIFEST.txt` (path, branch, head, commits not on main, dirty count). Per worktree: `status.txt`, `uncommitted.patch`, `commits/` (format-patch files), `untracked/`.
- `null-ad75` (Donald): local commit `cacf5e1`, saved as a patch. Its change is already on plugins main (`8261f3f`), so the patch is a backup only.
- `g-core-base`, `g-core-e8`, `g-umb`, `umbrella-pin-bump`: clean, at commits that are on main. Nothing to save.
- `sandra-sid` was removed by its owner while I worked, so I saved nothing from it.
- `null-e2e` is an empty git clone with 28 untracked output files. They were copied as plain files.
After a restart, run `git worktree prune` in the umbrella and in each sub-repo. The deleted `/tmp` worktree entries stay in the lists until then.

## 6. Not verified by me
Whether the CI run on `cbdbb32` ends green (docs only). The 3 missing top-level files. Anything inside the 183 branches, 57 dirty worktrees and 5 stashes. Whether Deborah's CLI process (pid 82815) still runs: `ps` shows no such pid now.
