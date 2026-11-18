import sys
from probe import run
def bytewise(s, n=3):
    return [s[i:i+n] for i in range(0, len(s), n)]

which = sys.argv[1]
if which == 'para':
    run('paragraph, 3-char chunks', bytewise('Hello **world** para.\n\nSecond.\n'), delay=0.03)
elif which == 'table':
    run('table, 3-char chunks', bytewise('| a | b |\n|---|---|\n| 1 | 22 |\n| 333 | 4 |\n\nafter\n'), delay=0.03)
elif which == 'fence':
    run('fence, 3-char chunks', bytewise('```bash\necho hi\nls -la\n```\nafter\n'), delay=0.03)
