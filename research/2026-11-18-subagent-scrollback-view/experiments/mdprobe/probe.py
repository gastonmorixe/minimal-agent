import subprocess, sys, time, os, select, re

MD = os.path.expanduser('~/.minimal-agent/bin/mdstream')

def vis(b):
    s = b.decode('utf8','replace')
    s = re.sub(r'\x1b\[(\d*)A', r'<UP\1>', s)
    s = s.replace('\x1b[J','<ED>').replace('\x1b[K','<EL>').replace('\r','<CR>')
    s = re.sub(r'\x1b\[[0-9;]*m','',s)   # drop SGR for readability
    s = s.replace('\n','<LF>\n')
    return s

def run(label, chunks, delay=0.12, env_cols='80'):
    env = dict(os.environ, COLUMNS=env_cols)
    p = subprocess.Popen([MD], stdin=subprocess.PIPE, stdout=subprocess.PIPE, stderr=subprocess.PIPE, env=env)
    os.set_blocking(p.stdout.fileno(), False)
    out = []
    def drain(tag):
        t_end = time.time()+delay
        while time.time() < t_end:
            r,_,_ = select.select([p.stdout],[],[],0.02)
            if r:
                try: d = os.read(p.stdout.fileno(), 65536)
                except BlockingIOError: d = b''
                if d: out.append((tag, d))
    for c in chunks:
        p.stdin.write(c.encode()); p.stdin.flush()
        drain(repr(c)[:30])
    p.stdin.close()
    t_end=time.time()+1.0
    while time.time()<t_end:
        r,_,_ = select.select([p.stdout],[],[],0.05)
        if r:
            try: d=os.read(p.stdout.fileno(),65536)
            except BlockingIOError: d=b''
            if d: out.append(('EOF',d))
            else: break
        if p.poll() is not None and not r: break
    print('='*10, label)
    for tag,d in out:
        print(f'--[after write {tag}]--')
        print(vis(d))
    print()

if __name__ == '__main__':
    which = sys.argv[1]
    if which == 'para':
        run('paragraph then blank then paragraph', ['Hello **world** this is a paragraph.\n', '\n', 'Second one.\n'])
    elif which == 'table':
        run('table row by row', ['| a | b |\n', '|---|---|\n', '| 1 | 22 |\n', '| 333 | 4 |\n', '\nafter\n'])
    elif which == 'fence':
        run('fence', ['```bash\n', 'echo hi\n', 'ls -la\n', '```\n', 'after\n'])
    elif which == 'list':
        run('list', ['- one\n', '- two **b**\n', '- three\n', '\n'])
