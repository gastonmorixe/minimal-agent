# mdstream manual probes (Daniel, 2026-11-18)

Feeds text into the REAL `~/.minimal-agent/bin/mdstream` (v0.3.9) in small chunks
and prints what it writes to stdout, with control bytes made visible:
`<CR>` = \r, `<EL>` = ESC[K, `<ED>` = ESC[J, `<UPn>` = ESC[nA, `<LF>` = \n. SGR is dropped.

    cd research/2026-11-18-subagent-scrollback-view/experiments/mdprobe
    python3 probe2.py table     # table fed 3 chars at a time
    python3 probe2.py fence     # fenced code block
    python3 probe2.py para      # paragraph + blank + paragraph
    python3 probe3.py wrap      # one long paragraph (wraps at 80 cols), 7-char chunks
    python3 probe3.py softbreak # two-line paragraph

Env `COLUMNS=80` is set by `probe.py:run(env_cols=...)`. These are hand probes
for orientation. The authoritative, swept data is in ../../20-gating-experiment.md.
