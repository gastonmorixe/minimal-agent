import sys
from probe import run
def chunks(s, n=7): return [s[i:i+n] for i in range(0, len(s), n)]
which = sys.argv[1]
long_line = ("This is a deliberately long paragraph that must wrap across several terminal rows at eighty columns, "
             "because the quick brown fox jumps over the lazy dog again and again until the line is done.")
if which == 'wrap':
    run('LONG single-line paragraph (wraps ~3 rows @80), then next para', chunks(long_line+'\n\nNext.\n'), delay=0.03, env_cols='80')
elif which == 'softbreak':
    run('2-line paragraph (soft break inside)', chunks('First line of one paragraph\nsecond line same paragraph\n\nNext.\n'), delay=0.03, env_cols='80')
elif which == 'list':
    run('bullet list', chunks('- one\n- two **b**\n- three\n\nAfter.\n'), delay=0.03, env_cols='80')
