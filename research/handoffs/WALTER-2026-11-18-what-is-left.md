# What is left to do and merge (Walter, session 1ccf094b, 2026-11-18 13:20 EST)

Written for the next session. Scott's file `HANDOFFS.md` in this folder covers the tool-result project and the exposed token. This file does not replace it. Facts below were read from git and `gh` at about 13:15. I mark what I did not check.

## 0. First thing, not git: rotate the exposed token
Read `HANDOFFS.md` (top). One real-looking Anthropic OAuth token (`sk-ant-oat01-...`) is in the public history of core (`1b320dc`) and plugins (`10c80fb`). Revoke that session first. Rewriting history does not undo copies. I confirmed the two commits and file paths myself, without printing the value. All six repos are public since 11:44 (you asked for it). Nobody has scanned the rest of the history for other secrets.

## 1. State of main (13:20, after Matthew's push)
| repo | main |
|---|---|
| umbrella | `db38e54` (Matthew's bump of 4 gitlinks; above my docs commit `f8627c6`) |
| core | `48721c3` (prompt-cache fix: anchor marker, cap of 4 markers, append-only thinking, 400 fallback; flags OFF by default) |
| plugins | `e8f1815` |
| cli | `123e80f` |
| web | `dc669db` |
| config | `55623ce` |

- **CI is NOT verified for these mains.** Matthew pushed on Gaston's "don't wait for CI". Push run `44368143530` on `db38e54` was in progress when I wrote this. Do not call it green before it completes. His local results: core 5555 pass 0 fail, plugins 8543 pass 1 fail (the core-pin test reads an ignored local `bun.lock`, a worktree-layout effect), cli 4641 pass 0 fail, web not checked.
- Last complete green run: `44359890627` on `4932c28`. Runs on `edb2e24`, `cbdbb32` and `f8627c6` (my docs commits) were cancelled by later pushes.
- Matthew deleted his three `backup/cache-anchor-append-only` branches. His change is on main.

## 2. Open work, in priority order
1. **Carlos's no-direct-stdio guard (lint rule that bans direct stdout/stderr writes).** One backup commit in each repo: core `feat/no-direct-writes` `7163621`, plugins `a61cd90`, cli `1a00389`, web `6614aa4`, umbrella `5659390` (describes the set). Dry-run merge into each main: 0 conflicts (I ran `git merge-tree`, no test run). Not covered by any CI. His plan: core, then cli/plugins/web with the core pin bump (`pins:core`), then umbrella. Ask him or run the full check on each repo first.
2. **Matthew's cache fix: MERGED at 13:24** (core `48721c3`, plugins `e8f1815`, cli `123e80f`, web `dc669db`, umbrella `db38e54`). Open: the live A/B test on Haiku, and the run `44368143530`. His old worktree `/Users/gaston/Projects/minimal-agent_WT-cache-anchor` may still hold uncommitted files. I did not re-check after his push.
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
Whether the CI run on `cbdbb32` ends green (docs only). The 3 missing top-level files. The CI result on `db38e54`. Anything inside the 183 branches, 57 dirty worktrees and 5 stashes. Whether Deborah's CLI process (pid 82815) still runs: `ps` shows no such pid now.

## 7. Branch scan at 13:16 (read only; nothing deleted for this)
Of 100 local branches that are not merged by commit ID: 28 are already in main by patch content (nothing to merge, deletable); 23 have unique work and merge cleanly (5 are today's: Carlos's `feat/no-direct-writes` in four repos and Matthew's cache branch in plugins, now merged; 17 are old `zt/*` lanes from 11-11/11-12, all local only); 49 conflict with main (28 last touched 11-12, the rest back to May). I checked patch equivalence and a dry-run merge only. I reviewed no code and ran no tests. Raw table: `/tmp/mergeable-scan.tsv` is lost on restart; rerun `git cherry origin/main <branch>` and `git merge-tree --write-tree origin/main <branch>`.
Proposed, waiting for Gaston: delete the 28 already-in-main branches with a restore log; push `backup/` copies of the old `zt/*` lanes; merge nothing without an owner.
## 8. Sandra (bba2ddf4), live at 13:16
Fix for a wrong session identity in multi-session hosts, branches `fix/session-scope-sandra` in core, plugins and web, plus a core pin bump and one umbrella commit. She has NO commits yet (13:16), so the work exists only as uncommitted files in `/Users/gaston/Projects/minimal-agent-monorepo/tmp/sandra-sid` (git-ignored). She will push `backup/session-scope-sandra` and send the commit IDs.
