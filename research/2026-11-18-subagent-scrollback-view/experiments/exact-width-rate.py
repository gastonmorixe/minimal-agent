#!/usr/bin/env python3
"""Compare a tmux capture (-J joins wrapped rows) with the expected position-coded text."""
import re, subprocess, sys, os, time
HERE=os.path.dirname(os.path.abspath(__file__)); ROOT=os.path.abspath(os.path.join(HERE,'..','..','..')); CLI=os.path.join(ROOT,'minimal-agent-cli')
def run(width, total, seed, tag):
    sock=f"ma-gate-rate-{os.getpid()}"; name=f"r{tag}"; done=f"/tmp/{name}.done"
    if os.path.exists(done): os.remove(done)
    cmd=f"cd {CLI} && bun run ../research/2026-11-18-subagent-scrollback-view/experiments/exact-width-rate.ts {total} {seed} {tag}; touch {done}; sleep 15"
    subprocess.run(["tmux","-L",sock,"new-session","-d","-x",str(width),"-y","40","-s",name,cmd],check=True)
    t0=time.time()
    while not os.path.exists(done) and time.time()-t0<60: time.sleep(0.05)
    time.sleep(0.3)
    out=subprocess.run(["tmux","-L",sock,"capture-pane","-p","-J","-t",name,"-S","-"],capture_output=True,text=True).stdout
    subprocess.run(["tmux","-L",sock,"kill-server"],capture_output=True)
    exp=open(f"/tmp/rate-expected-{tag}.txt").read()
    if os.environ.get("DEBUG"): print("capture bytes",len(out),"rows",out.count("\n"),"first rows",[r[:20] for r in out.split("\n")[:8]],file=sys.stderr)
    rows=[r.rstrip() for r in out.split("\n")]
    body="".join(r for r in rows if re.fullmatch(r"[0-9a-z]+",r) and len(r)>=3)
    return exp, body
import difflib
def lost_chars(exp, out):
    rows=[r for r in out.split("\n")]
    row=max(rows,key=len)            # -J joins the wrapped rows: the streamed text is the longest row
    sm=difflib.SequenceMatcher(None,exp,row,autojunk=False)
    return sum(i2-i1 for tag,i1,i2,j1,j2 in sm.get_opcodes() if tag in("delete","replace")), len(row)
def run_raw(width,total,seed,tag):
    sock=f"ma-gate-rate-{os.getpid()}"; name=f"r{tag}"; done=f"/tmp/{name}.done"
    if os.path.exists(done): os.remove(done)
    cmd=f"cd {CLI} && bun run ../research/2026-11-18-subagent-scrollback-view/experiments/exact-width-rate.ts {total} {seed} {tag}; touch {done}; sleep 15"
    subprocess.run(["tmux","-L",sock,"new-session","-d","-x",str(width),"-y","40","-s",name,cmd],check=True)
    t0=time.time()
    while not os.path.exists(done) and time.time()-t0<60: time.sleep(0.05)
    time.sleep(0.3)
    out=subprocess.run(["tmux","-L",sock,"capture-pane","-p","-J","-t",name,"-S","-"],capture_output=True,text=True).stdout
    subprocess.run(["tmux","-L",sock,"kill-server"],capture_output=True)
    return open(f"/tmp/rate-expected-{tag}.txt").read(), out
print("| width | runs | chars streamed | glyphs lost | per 1000 | rows that wrapped (approx) | share of wrapped rows with a loss |")
print("|---:|---:|---:|---:|---:|---:|---:|")
for width in (40,80,120):
    lost=0; n=0; chars=0
    for seed in (1,2,3,4,5,6):
        exp,out=run_raw(width,3000,seed,f"{width}_{seed}")
        l,_=lost_chars(exp,out); lost+=l; n+=1; chars+=len(exp)
    rows=chars//width
    print(f"| {width} | {n} | {chars} | {lost} | {1000*lost/chars:.2f} | {rows} | {100*lost/rows:.1f}% |")
