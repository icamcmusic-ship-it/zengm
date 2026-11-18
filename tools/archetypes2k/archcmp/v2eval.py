# archv4: v2's own labels in an archcmp dump (no re-ranking), held out as archcmp: top-1 / top-3 / family / role and
# name-parts F1 on the user's 2K list and the judged key, the picks leave-one-out. Several dumps side by side, paired
# bootstrap against the first.
# Usage: python3 v2eval.py base-dir other-dir [...]
import json, sys, os
import numpy as np

def load(d):
    R = json.load(open(os.path.join(d, 'rows.json')))
    out = {}
    for r in R:
        top = []
        for c in r['v2']['cands']:
            if len(top) >= 3:
                break
            if c['canon'] not in top:
                top.append(c['canon'])
        first = r['v2']['cands'][0]
        out[(r['key'], r['src'], r['target'][0]['name'])] = (r, first, top)
    return out

def per(rows):
    """per-row hits: t1, t3, fam, role, parts (tp, fp, fn)"""
    o = []
    for r, f, top in rows:
        tg = r['target']
        cans = [t['canon'] for t in tg]
        t0 = tg[0]
        pr = ({'role:' + f['role']} if f['role'] else set()) | set(f['descs'])
        gt = ({'role:' + t0['role']} if t0['role'] else set()) | set(t0['descs'])
        o.append((r['w'], f['canon'] in cans, any(c in cans for c in top), f['family'] in [t['family'] for t in tg],
                  f['role'] is not None and f['role'] == t0['role'], len(pr & gt), len(pr - gt), len(gt - pr)))
    return np.array(o, float)

def summary(a):
    w = a[:, 0]
    tp, fp, fn = (w * a[:, 5]).sum(), (w * a[:, 6]).sum(), (w * a[:, 7]).sum()
    return [100 * (w * a[:, i]).sum() / w.sum() for i in range(1, 5)] + [100 * 2 * tp / max(1e-9, 2 * tp + fp + fn)]

GROUPS = {
    '2K held-out': lambda r: r['split'] == 'test' and r['src'] in ('2k', '2kAllTime'),
    'judged held-out': lambda r: r['split'] == 'test' and r['src'] == 'judged',
    'picks LOO': lambda r: r['src'] == 'pick',
}

def boot(a, b, i, n=2000):
    rng = np.random.default_rng(0)
    w = a[:, 0]
    d = []
    for _ in range(n):
        ix = rng.integers(0, len(a), len(a))
        d.append(((b[ix, i] - a[ix, i]) * w[ix]).sum() / w[ix].sum())
    d = np.array(d)
    return 100 * d.mean(), (d > 0).mean()

if __name__ == '__main__':
    dirs = sys.argv[1:]
    data = [load(d) for d in dirs]
    keys = [k for k in data[0] if all(k in x for x in data)]
    print(f"{'dump':28s} | " + ' | '.join(f"{g}: t1 t3 fam role parts" for g in GROUPS))
    held = [k for k in keys if data[0][k][0]['split'] == 'test']
    base_all = per([data[0][k] for k in held])
    for d, x in zip(dirs, data):
        cells = []
        for g, f in GROUPS.items():
            ks = [k for k in keys if f(x[k][0])]
            s = summary(per([x[k] for k in ks]))
            cells.append(' '.join(f"{v:4.1f}" for v in s))
        line = f"{os.path.basename(d.rstrip('/')):28s} | " + ' | '.join(cells)
        if x is not data[0]:
            b = per([x[k] for k in held])
            line += ' | vs base all held-out: ' + ', '.join(f"{nm} {m:+.1f} (P {p:.2f})" for nm, (m, p) in zip(['fam', 't3', 'parts-tp'], [boot(base_all, b, 3), boot(base_all, b, 2), boot(base_all, b, 5)]))
        print(line)
