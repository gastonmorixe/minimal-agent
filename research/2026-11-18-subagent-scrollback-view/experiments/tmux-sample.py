#!/usr/bin/env python3
"""
Real-terminal sampling of the gate experiment (tmux), orchestrated from Python.

What it checks, per sampled cut of a recorded mdstream output stream:
  - replay the stream through the REAL Compositor inside a REAL tmux pane
    (tmux-validate.ts), inject the 4-row marker block at that cut, capture the pane
    (history + screen), and compare with the GOLDEN capture (same stream, no block).
  - a cut is CLEAN when the 4 marker rows appear once each, contiguous, and every
    other non-blank row equals the golden's. (Same test as `analyze()` in gate-sweep.ts.)

Parts
  A  naive block at random offsets (all offsets, live area on)            -> how often a real terminal is corrupted
  B  `restore` write at offsets the gate P6 allows (row < width, not in an open fence/table)
  C  `restore` write where the partial row is EXACTLY `width` cells wide  -> the deferred-wrap edge

The wait is a sentinel file, not a sleep: the first run of this check used fixed sleeps and
2 of 54 captures were taken before the stream had finished (a loaded machine), which looked
like corruption. Re-running those cuts passed.

Usage:  python3 tmux-sample.py [--seed 7] [--a 80] [--b 120] [--c 40] [--jobs 4]
Needs:  tmux, bun, the recordings and results in this folder (run gate-sweep.ts first).
"""
import argparse
import collections
import concurrent.futures as cf
import json
import os
import random
import subprocess
import sys
import time

# PRIVATE tmux socket. Never use the default socket and never `kill-server` on it: that kills every
# tmux session of every other user of the machine. (The first version of this file did, and killed
# another agent's session at 09:17.)
SOCK = f"ma-gate-{os.getpid()}"


def tmux(*args, **kw):
    return subprocess.run(["tmux", "-L", SOCK, *args], **kw)


HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.abspath(os.path.join(HERE, "..", "..", ".."))
CLI = os.path.join(ROOT, "minimal-agent-cli")
VALIDATE = os.path.relpath(os.path.join(HERE, "tmux-validate.ts"), CLI)
RESULTS = os.path.join(HERE, "results")
MARK = [f"⟦L1·row{i}⟧" for i in range(1, 5)]
PREFILL = 5


def run_tmux(tag, scenario, width, la, seg, idx, mode):
    name = f"ts{os.getpid()}_{tag}"
    done = f"/tmp/{name}.done"
    if os.path.exists(done):
        os.remove(done)
    cmd = (
        f"cd {CLI} && PREFILL={PREFILL} bun run {VALIDATE} {scenario} {width} {la} {seg} {idx} {mode}; "
        f"touch {done}; sleep 20"
    )
    tmux("new-session", "-d", "-x", str(width), "-y", "30", "-s", name, cmd, check=True)
    t0 = time.time()
    while not os.path.exists(done) and time.time() - t0 < 40:
        time.sleep(0.05)
    time.sleep(0.2)
    out = tmux("capture-pane", "-p", "-J", "-t", name, "-S", "-", capture_output=True, text=True).stdout
    tmux("kill-session", "-t", name, capture_output=True)
    ok = os.path.exists(done)
    if ok:
        os.remove(done)
    rows = [r.rstrip() for r in out.split("\n")]
    while rows and rows[-1] == "":
        rows.pop()
    return rows[PREFILL:], ok


def classify(rows, gold):
    idx = [[i for i, r in enumerate(rows) if m in r] for m in MARK]
    once = all(len(h) == 1 and rows[h[0]].strip() == m for h, m in zip(idx, MARK))
    contiguous = once and all(idx[i][0] == idx[0][0] + i for i in range(4))
    rest = [r for r in rows if r.strip() not in MARK]
    same = [r for r in rest if r.strip()] == [r for r in gold if r.strip()]
    return once and contiguous and same


def load_units():
    units = {}
    for f in sorted(os.listdir(RESULTS)):
        if not f.endswith(".json") or f.count(".") != 1 or "@" not in f:
            continue
        d = json.load(open(os.path.join(RESULTS, f)))
        units[(d["scenario"], d["width"])] = d
    return units


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--seed", type=int, default=7)
    ap.add_argument("--a", type=int, default=80)
    ap.add_argument("--b", type=int, default=120)
    ap.add_argument("--c", type=int, default=40)
    ap.add_argument("--jobs", type=int, default=4)
    args = ap.parse_args()
    rnd = random.Random(args.seed)
    units = load_units()
    keys = [k for k in units if k[1] in (40, 80)]  # 120 only widens rows; skip for time

    def cuts(pred):
        out = []
        for (sc, w) in keys:
            d = units[(sc, w)]
            L = d["la"]["1"]
            for i, c in enumerate(d["cuts"]):
                if pred(d, L, i, c, w):
                    out.append((sc, w, c["seg"], c["idx"], i))
        return out

    all_cuts = cuts(lambda d, L, i, c, w: True)
    p6_cuts = cuts(
        lambda d, L, i, c, w: (not L["unk"][i])
        and (c["cr"] or L["rw"][i] < w)
        and not d["fence"][i]
        and not d["table"][i]
    )
    exact_cuts = cuts(
        lambda d, L, i, c, w: (not L["unk"][i]) and (not c["cr"]) and L["rw"][i] == w
    )

    def stratified(pool, n):
        by = collections.defaultdict(list)
        for x in pool:
            by[(x[0], x[1])].append(x)
        per = max(1, n // max(1, len(by)))
        pick = []
        for k in sorted(by):
            pick += rnd.sample(by[k], min(per, len(by[k])))
        rnd.shuffle(pick)
        return pick[:n]

    clipped_cuts = cuts(
        lambda d, L, i, c, w: (not L["unk"][i]) and bool(L["ell"][i]) and L["rw"][i] == w
    )
    boundary_p9 = cuts(
        lambda d, L, i, c, w: c["boundary"]
        and (not L["unk"][i])
        and (c["cr"] or L["rw"][i] < w or (bool(L["ell"][i]) and L["rw"][i] == w))
    )
    plan = [
        ("A naive block, any offset", "block", stratified(all_cuts, args.a)),
        ("B restore, P6-allowed (row < width, not in fence/table)", "restore", stratified(p6_cuts, args.b)),
        ("C restore, partial row exactly == width (NOT allowed by P9)", "restore", stratified(exact_cuts, args.c)),
        ("D erase-only, open row is a clipped echo (P8)", "erase", stratified(clipped_cuts, args.c)),
        ("E restore/erase at real write BOUNDARIES allowed by P9", "restore", stratified(boundary_p9, args.c)),
    ]

    golds = {}

    def gold(sc, w):
        k = (sc, w)
        if k not in golds:
            rows, ok = run_tmux(f"g{sc}{w}", sc, w, 1, 0, 0, "none")
            golds[k] = (rows, ok)
        return golds[k]

    # goldens first (sequential, they are shared)
    for k in sorted({(sc, w) for _, _, pool in plan for (sc, w, *_r) in pool}):
        gold(*k)
    bad_gold = [k for k, (_, ok) in golds.items() if not ok]
    if bad_gold:
        print("WARNING: golden capture did not finish for", bad_gold, file=sys.stderr)

    results = []

    def one(job):
        part, mode, (sc, w, seg, idx, i) = job
        rows, ok = run_tmux(f"{abs(hash((part, sc, w, seg, idx))) % 10**8}", sc, w, 1, seg, idx, mode)
        clean = ok and classify(rows, golds[(sc, w)][0])
        return part, sc, w, seg, idx, ok, clean

    jobs = [(name, mode, c) for name, mode, pool in plan for c in pool]
    t0 = time.time()
    with cf.ThreadPoolExecutor(max_workers=args.jobs) as ex:
        for r in ex.map(one, jobs):
            results.append(r)
    print(f"# tmux {subprocess.run(['tmux','-V'],capture_output=True,text=True).stdout.strip()} (private socket {SOCK}), "
          f"TERM={os.environ.get('TERM','?')}, seed={args.seed}, {len(jobs)} captures in {time.time()-t0:.0f}s\n")
    print("| part | captures | unfinished | clean | corrupt |")
    print("|---|---:|---:|---:|---:|")
    for name, _, _ in plan:
        rs = [r for r in results if r[0] == name]
        unf = sum(1 for r in rs if not r[5])
        cl = sum(1 for r in rs if r[6])
        print(f"| {name} | {len(rs)} | {unf} | {cl} | {len(rs) - unf - cl} |")
    bad = [r for r in results if r[5] and not r[6] and not r[0].startswith(("A ", "C "))]
    if bad:
        print("\nCorrupt in B/C (re-run these with tmux-validate.ts):")
        for r in bad[:20]:
            print("  ", r[1], r[2], "seg", r[3], "idx", r[4], r[0][:1])
    json.dump(results, open(os.path.join(RESULTS, "tmux-sample.json"), "w"))
    tmux("kill-server", capture_output=True)  # PRIVATE socket only


if __name__ == "__main__":
    main()
