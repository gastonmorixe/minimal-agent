#!/usr/bin/env python3
"""
Landing delay of `Compositor.writeBlock` for two versions of the rule, computed from the recorded mdstream output,
in INPUT CHUNKS (about 5 characters each; about 17 ms at the median real stream rate of 290 characters per second).

 rule A (10:30 draft): the block lands when the last visible byte the lead has written is a line feed.
 rule B (11:5x, current working tree, diff sha e2dc5cdcbc4d): the block ALSO lands right after the first line feed
        inside a later chunk (it is spliced in), so it never waits for a chunk to END on a line feed.

A block requested at a write boundary b lands at delay 0 when the row is already closed. Usage: python3 landing-delay.py [width=80]
"""
import json, glob, os, re, statistics as st, sys
width = sys.argv[1] if len(sys.argv) > 1 else "80"
ESC = re.compile(r'\x1b\[[0-9;?]*[ -/]*[@-~]|\x1b\][^\x07\x1b]*(?:\x07|\x1b\\)|\x1b.')
MS = 17.0
def table(rule):
    rows = []; allv = []
    for f in sorted(glob.glob(os.path.join(os.path.dirname(os.path.abspath(__file__)), f"recordings/*@{width}.json"))):
        r = json.load(open(f)); name = os.path.basename(f).split('@')[0]
        segs = r['segments']; n = len(segs)
        vis = [ESC.sub('', sg['text']) for sg in segs]
        closed = [True]; lastv = None
        for t in vis:
            if t: lastv = t[-1]
            closed.append(lastv == "\n" or lastv is None)
        at = [0] + [sg['chunk'] + 1 for sg in segs]
        d = []
        for b in range(n + 1):
            if closed[b]: d.append(0); continue
            j = b
            if rule == "B":
                while j < n and "\n" not in vis[j]: j += 1
                land = min(j + 1, n)         # lands inside piece j: after it has been consumed
            else:
                bb = b
                while bb <= n and not closed[bb]: bb += 1
                land = min(bb, n)
            d.append(at[land] - at[b])
        rows.append((name, len(d), st.mean(d), max(d))); allv += d
    return rows, allv
for rule, label in (("A", "rule A: lands when the last visible byte is a line feed"), ("B", "rule B: also lands right after the first line feed inside a later chunk (current)")):
    rows, allv = table(rule)
    print(f"\n{label}")
    print(f"{'scenario':16}{'boundaries':>11}{'mean ch':>9}{'mean ms':>9}{'max ch':>8}{'max ms':>8}")
    for k, n, m, mx in rows: print(f"{k:16}{n:11d}{m:9.1f}{m*MS:9.0f}{mx:8d}{mx*MS:8.0f}")
    print(f"{'ALL':16}{len(allv):11d}{st.mean(allv):9.1f}{st.mean(allv)*MS:9.0f}{max(allv):8d}{max(allv)*MS:8.0f}")
