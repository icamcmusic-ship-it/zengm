# archcmp: compare.txt from the offline results (results.pkl) and the JS guardrail runs (full-*.txt, gold-*.txt, speed-*)
import pickle, re, os, json, collections
import numpy as np
from lib import *
import cmp as C

res = pickle.load(open(f'{D}/results.pkl', 'rb'))
gs = groups('test')
held = [r for r in R if r['split'] == 'test']

def as_first(P, i):
    canon, fam, role, descs, name, id_, top = P[i]
    return {'canon': canon, 'family': fam, 'role': role, 'descs': descs, 'name': name, 'id': id_}, top
def preds_of(P):
    return {i: as_first(P, i) for i in P}
def parts(rows, P):
    tp = fp = fn = 0
    for r in rows:
        f, _ = P[r['i']]
        t = r['target'][0]
        pr = ({'role:' + f['role']} if f['role'] else set()) | set(f['descs'])
        gt = ({'role:' + t['role']} if t['role'] else set()) | set(t['descs'])
        w = r['w']
        tp += w * len(pr & gt); fp += w * len(pr - gt); fn += w * len(gt - pr)
    return 2 * tp / max(1e-9, 2 * tp + fp + fn)

L = []
L.append('archcmp: v2 (A) against four other architectures, on archv3\'s held-out split (30% of the user\'s 2K list by a hash of')
L.append('the pick id, and of the judged key), the user\'s 8 shipped picks leave-one-out. Every model is fitted on the tune split only')
L.append('(its weight in v2 tuned out of fold on the tune split); "+N": the label-noise pass on the training labels and the neighbours.')
L.append('')
L.append('Variants: A v2 as shipped (archv3, reading 18). B v2 + 2K-style category layer (six categories calibrated on the user\'s 2K')
L.append('overalls; logistic family and core-role voters on them). C a depth-4 decision tree from the top-2 categories, height and')
L.append('position to the core role (tree.txt), its role probability on every candidate of that role and its family through the role;')
L.append('v2\'s yes/no descriptor tests unchanged. D gradient-boosted trees (sklearn, 80 x depth 2 per family) over the neighbours\'')
L.append('features, class values and position, as an extra family voter. Combinations BC, BD, CD, BCD.')
L.append('')
L.append('The 2K list carries only the 2K overall per player (the pastes have no other 2K numbers: every line is name | positions |')
L.append('height | archetype | overall [| team]), so the categories are calibrated on the overall alone:')
L += [l for l in open(f'{D}/offline.txt').read().splitlines()[1:5]]
L.append('')
L.append('== 1. Held-out accuracy (offline re-ranker; reproduces the engine exactly for A, 98.6% for CD+N in the engine)')
L.append('top-1 / top-3 / family: the label\'s build (or name) and family against the target; role: the core role word right;')
L.append('roleF1: macro F1 over core roles; desc F1: micro F1 over descriptors; parts F1: micro F1 over all name parts.')
hdr = f"{'variant':8s} {'weights':52s} | {'2K held-out (n 176.5)':45s} | {'judged held-out (n 165)':45s} | picks LOO (n 8)"
L.append(hdr)
L.append(f"{'':8s} {'':52s} | {'t1   t3   fam  role rF1  dF1  parts':45s} | {'t1   t3   fam  role rF1  dF1  parts':45s} | t3   fam  parts")
for tag, (wts, o, P) in res.items():
    Pp = preds_of(P)
    cells = []
    for g in ['2K held-out all', 'judged held-out']:
        m = score_rows(gs[g], Pp)
        cells.append(f"{100*m['t1']:4.1f} {100*m['t3']:4.1f} {100*m['fam']:4.1f} {100*m['role']:4.1f} {100*m['roleF1']:4.1f} {100*m['dF1']:4.1f} {100*parts(gs[g], Pp):4.1f}".ljust(45))
    m = score_rows(gs['user picks (LOO)'], Pp)
    cells.append(f"{100*m['t3']:4.1f} {100*m['fam']:4.1f} {100*parts(gs['user picks (LOO)'], Pp):4.1f}")
    L.append(f"{tag:8s} {json.dumps(wts):52s} | " + ' | '.join(cells))
L.append('')
L.append('Paired bootstrap against A, all held-out (2K + judged; mean, 5th percentile, P(better)):')
A = preds_of(res['A'][2])
for tag, (wts, o, P) in res.items():
    if tag == 'A':
        continue
    bs = [C.boot(held, A, preds_of(P), m) for m in ['fam', 't3', 'role']]
    L.append(f"  {tag:7s} " + ', '.join(f"{nm} {100*x[0]:+.1f} ({100*x[1]:+.1f}, {x[2]:.2f})" for nm, x in zip(['family', 'top-3', 'role'], bs)) + f"; tune objective {o:.3f}")
L.append('')
# part-level per component, A vs CD+N
L.append('== 2. Part-level scores per name component, all held-out (2K + judged), A -> CD+N (precision / recall / F1)')
def comp_scores(P):
    out = collections.defaultdict(lambda: [0, 0, 0])
    for r in held:
        f, _ = P[r['i']]
        t = r['target'][0]
        w = r['w']
        pr = ({'role ' + f['role']} if f['role'] else set()) | {'desc ' + d for d in f['descs']}
        gt = ({'role ' + t['role']} if t['role'] else set()) | {'desc ' + d for d in t['descs']}
        for x in pr & gt: out[x][0] += w
        for x in pr - gt: out[x][1] += w
        for x in gt - pr: out[x][2] += w
    return out
ca, cb = comp_scores(A), comp_scores(preds_of(res['CD+N'][2]))
def prf(e):
    tp, fp, fn = e
    return (tp / max(1e-9, tp + fp), tp / max(1e-9, tp + fn), 2 * tp / max(1e-9, 2 * tp + fp + fn), tp + fn)
for k in sorted(set(ca) | set(cb), key=lambda k: (-(ca[k][0] + ca[k][2]), k)):
    a, b = prf(ca[k]), prf(cb[k])
    if a[3] < 3 and b[3] < 3:
        continue
    L.append(f"  {k:24s} n {a[3]:5.1f}: {100*a[0]:3.0f} / {100*a[1]:3.0f} / {100*a[2]:3.0f} -> {100*b[0]:3.0f} / {100*b[1]:3.0f} / {100*b[2]:3.0f}")
L.append('')

# JS guardrails
L.append('== 3. In the engine (JS, v2.script.test.ts eval + metrics.script.test.ts gold + speed.script.test.ts): the variants the')
L.append('runtime tables cover (layers.ts: the categories, the tree, the boosted trees, the neighbours\' noise weights)')
def parse_full(tag):
    p = f'{D}/full-{tag}.txt'
    if not os.path.exists(p):
        return None
    s = open(p).read()
    v2 = s.split('== v2')[1] if '== v2' in s else ''
    d = {}
    m = re.search(r'judged key held-out:\n.*\n\s+v2\s+top-1 ([\d.]+)%, top-3 ([\d.]+)%, family ([\d.]+)%', s)
    if m: d['judged'] = '/'.join(m.groups())
    m = re.search(r'user 2K held-out, all:\n.*\n\s+v2\s+top-1 ([\d.]+)%, top-3 ([\d.]+)%, family ([\d.]+)%', s)
    if m: d['2K'] = '/'.join(m.groups())
    for lab, key in [('random league', 'league'), ('veterans', 'vets'), ('draft prospects', 'pros'), ('real 2016-2025', 'real'), ('real 2025 top 150', 'top150')]:
        m = re.search(lab + r' \(n=\d+\): max share (.*?) ([\d.]+)%, effective labels \d+, distinct \d+, generic ([\d.]+)%, poor fit ([\d.]+)%, position conflicts (\d+), name promises kept ([\d.]+)%', v2)
        if m: d[key] = m.groups()
    for dd in ['3', '6']:
        m = re.search(r'stability \+-' + dd + r': same label ([\d.]+)%', v2)
        if m: d['st' + dd] = m.group(1)
    m = re.search(r'churn v2: ([\d.]+)%', s)
    if m: d['churn'] = m.group(1)
    g = f'{D}/gold-{tag}.txt'
    if os.path.exists(g):
        m = re.search(r'gold set: ([\d.]+)% get a listed build, ([\d.]+)% a build', open(g).read())
        if m: d['gold'] = m.groups()
    pk = f'{D}/picks-{tag}.txt'
    if os.path.exists(pk):
        d['picks'] = open(pk).read().count(' OK;')
    return d
TAGS = [('A', 'A (master)'), ('AN', 'A+N'), ('CN', 'C+N'), ('DN', 'D+N'), ('CDN', 'CD+N'), ('CDNh', 'CD+N, famHyst 2, hyst 1')]
L.append(f"{'variant':26s} | 2K t1/t3/fam   | judged t1/t3/fam | gold listed/role | churn | stab +-3/+-6 | max share league / vets / prospects / real / 2025 top 150 | generic lg/real | poor fit lg/real | conflicts | promises lg/real | picks OK (of 8)")
for tag, nm in TAGS:
    d = parse_full(tag)
    if not d or 'league' not in d:
        L.append(f"{nm:26s} | (not run)")
        continue
    L.append(f"{nm:26s} | {d.get('2K','-'):14s} | {d.get('judged','-'):16s} | {'/'.join(d.get('gold', ('-', '-'))):16s} | {d.get('churn','-'):5s} | {d.get('st3','-')}/{d.get('st6','-')}    | "
             f"{d['league'][1]} / {d['vets'][1]} / {d['pros'][1]} / {d['real'][1]} / {d['top150'][1]} ({d['league'][0]})".ljust(60) +
             f" | {d['league'][2]}/{d['real'][2]}         | {d['league'][3]}/{d['real'][3]}          | {int(d['league'][4]) + int(d['real'][4])}         | {d['league'][5]}/{d['real'][5]}       | {d.get('picks','-')}")
L.append('(picks OK: the 8 shipped picks read with the user\'s tuning and the other picks; the layers were fitted with the picks, so')
L.append('this column is in-sample for C/D; the leave-one-out picks numbers are in section 1)')
for tag in ['A', 'CDN']:
    p = f'{D}/speed-{tag}.txt'
    if os.path.exists(p):
        s = open(p).read()
        w = re.search(r'classifyV2 warm: ([\d.]+)', s).group(1); c = re.search(r'classify: ([\d.]+)', s).group(1)
        L.append(f"speed {tag}: classifyV2 warm {w} ms/player (the earlier reading inside it {c} ms; machine shared with the other runs)")
L.append('')
open(f'{D}/compare.txt', 'w').write('\n'.join(L) + '\n')
print('\n'.join(L))
