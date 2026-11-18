# archv4: the boosted-trees family voter (archcmp's D) alone, at a reduced weight, with its own per-position reliability
# like v2's other voters. Fitted on the tune split (+ the user's picks for the shipped table), no noise pass. Measured in
# the engine with a runtime (v2/gbdt.ts reading the exported table) that was not kept: no weight passed the guardrails
# (docs/native-features.md, Archetypes, archv4), so nothing shipped.
# Usage: ARCHCMP_DIR=dir python3 gbdt.py sweep            -> gbdt-sweep.txt (offline held-out table per weight)
#        ARCHCMP_DIR=dir python3 gbdt.py export D|DB out.ts -> the compact table v2/gbdt.data.ts
# Variants: D (the neighbours' features, class values, position) and DB (D plus the 2K-style categories of archcmp's B
# as features to the trees only, not as a voter).
import sys, json, collections
import numpy as np
from sklearn.ensemble import GradientBoostingClassifier
from sklearn.model_selection import GroupKFold
from lib import *
import cmp as C

TUNE, PICKS, TEST = C.TUNE, C.PICKS, C.TEST
famT = C.famT

def featD(r):
    return C.featD(r)
def featDB(r):
    return np.concatenate([C.featD(r), r['catb']])
FEATS = {'D': featD, 'DB': featDB}

def mk():
    return GradientBoostingClassifier(n_estimators=80, max_depth=2, learning_rate=0.08, subsample=0.8, random_state=0)

def rw(r):
    return r['w'] * (1.5 if r['src'] == 'pick' else 1)

def fit_predict(feat):
    """OOF on tune (for the weights and the reliability), the tune + picks model for the held-out rows, picks LOO."""
    preds = {}
    X = np.array([feat(r) for r in TUNE]); y = np.array([famT(r) for r in TUNE]); w = np.array([rw(r) for r in TUNE])
    grp = [r['key'] for r in TUNE]
    for tr, te in GroupKFold(5).split(X, y, grp):
        m = mk().fit(X[tr], y[tr], sample_weight=w[tr])
        pr = m.predict_proba(X[te])
        for j, i in enumerate(te):
            preds[TUNE[i]['i']] = dict(zip(m.classes_, pr[j]))
    train = TUNE + PICKS
    Xa = np.array([feat(r) for r in train]); ya = np.array([famT(r) for r in train]); wa = np.array([rw(r) for r in train])
    m = mk().fit(Xa, ya, sample_weight=wa)
    for r in TEST:
        preds[r['i']] = dict(zip(m.classes_, m.predict_proba([feat(r)])[0]))
    for r in PICKS:
        idx = [i for i in range(len(train)) if train[i] is not r]
        mm = mk().fit(Xa[idx], ya[idx], sample_weight=wa[idx])
        preds[r['i']] = dict(zip(mm.classes_, mm.predict_proba([feat(r)])[0]))
    return preds, m

def reliability(preds):
    """As v2.script.test.ts voters mode: per bucket and per family said, smoothed (M 4) toward the bucket and overall."""
    acc = collections.defaultdict(lambda: [0.0, 0.0])
    for r in TUNE:
        p = preds[r['i']]
        f = max(p.items(), key=lambda kv: (kv[1], kv[0]))[0]
        w = r['w'] * (0.5 if r['src'] == 'judged' else 1)
        ok = f in [t['family'] for t in r['target']]
        for k in [(r['bucket'], '*'), (r['bucket'], f), ('*', '*')]:
            acc[k][0] += w; acc[k][1] += w * ok
    M = 4
    a = acc[('*', '*')]
    g0 = (a[1] + M * 0.4) / (a[0] + M)
    rel = {}
    for b in BUCKETS:
        ab = acc.get((b, '*'), [0, 0])
        rb = (ab[1] + M * g0) / (ab[0] + M)
        rel[b] = {'*': round(rb, 3)}
        for (b2, f), (n, ok) in acc.items():
            if b2 == b and f != '*':
                rel[b][f] = round((ok + M * rb) / (n + M), 3)
    return rel

def extra_of(p, rel, b, gV, gP):
    f = max(p.items(), key=lambda kv: (kv[1], kv[0]))[0]
    t = rel.get(b, {})
    out = collections.Counter({k: gP * v for k, v in p.items()})
    out[f] += gV * t.get(f, t.get('*', 0.4))
    return out

def run(pr, rel, gV, gP):
    preds = {}
    for r in R:
        fs = fam_score(r, r['v2']['votes'], extra_of(pr[r['i']], rel, r['bucket'], gV, gP))
        first, top, _, _ = rerank(r, fs=fs)
        preds[r['i']] = (first, top)
    return preds

def parts(rows, preds):
    tp = fp = fn = 0
    for r in rows:
        f = preds[r['i']][0]
        t = r['target'][0]
        pr = ({'role:' + f['role']} if f['role'] else set()) | set(f['descs'])
        gt = ({'role:' + t['role']} if t['role'] else set()) | set(t['descs'])
        w = r['w']
        tp += w * len(pr & gt); fp += w * len(pr - gt); fn += w * len(gt - pr)
    return 2 * tp / max(1e-9, 2 * tp + fp + fn)

def objective(preds):
    gs = groups('tune')
    a = score_rows(gs['2K tune'], preds); b = score_rows(gs['judged tune'], preds)
    return a['fam'] + a['t3'] + a['role'] + 0.5 * (b['fam'] + b['t3'] + b['role'])

def row(tag, preds, base=None):
    gs = groups('test')
    cells = []
    for g in ['2K held-out all', 'judged held-out']:
        m = score_rows(gs[g], preds)
        cells.append(f"{100*m['t1']:4.1f} {100*m['t3']:4.1f} {100*m['fam']:4.1f} {100*m['role']:4.1f} {100*parts(gs[g], preds):4.1f}")
    m = score_rows(gs['user picks (LOO)'], preds)
    cells.append(f"{100*m['t3']:4.1f} {100*m['fam']:4.1f}")
    s = f"{tag:22s} tune {objective(preds):.3f} | " + ' | '.join(cells)
    if base is not None:
        held = [r for r in R if r['split'] == 'test']
        bs = [C.boot(held, base, preds, mm) for mm in ['fam', 't3']]
        s += ' | ' + ', '.join(f"{nm} {100*x[0]:+.1f} (P {x[2]:.2f})" for nm, x in zip(['fam', 't3'], bs))
    return s

if __name__ == '__main__':
    mode = sys.argv[1]
    if mode == 'sweep':
        L = ['archv4: the boosted-trees family voter alone (no noise pass), per weight. gV: its family counts by its measured',
             'reliability at his position (like the other voters); gP: its probability share. Held out as archcmp (2K list /',
             'judged key, 30% by hash; the picks leave-one-out).',
             f"{'variant':22s} tune obj  | 2K t1 t3 fam role parts       | judged t1 t3 fam role parts   | picks t3 fam | vs A (all held-out)"]
        base = {}
        for r in R:
            first, top, _, _ = rerank(r)
            base[r['i']] = (first, top)
        L.append(row('A', base))
        out = {}
        for v, feat in FEATS.items():
            pr, m = fit_predict(feat)
            rel = reliability(pr)
            out[v] = rel
            L.append(f"-- {v}: reliability {json.dumps(rel)}")
            for gV, gP in [(0, 0.5), (0, 1), (0, 2), (0, 3), (0.5, 0), (1, 0), (1.5, 0), (2, 0), (0.5, 0.5), (1, 0.5), (1, 1), (0.5, 1)]:
                L.append(row(f"{v} gV {gV} gP {gP}", run(pr, rel, gV, gP), base))
        open(f'{D}/gbdt-sweep.txt', 'w').write('\n'.join(L) + '\n')
        json.dump(out, open(f'{D}/gbdt-rel.json', 'w'))
        print('\n'.join(L))
    elif mode == 'export':
        v = sys.argv[2]
        pr, gb = fit_predict(FEATS[v])
        rel = reliability(pr)
        r4 = lambda x: float(f"{x:.4g}")
        # Each depth-2 tree as one flat run: [f0, t0, fL, tL, fR, tR, vLL, vLR, vRL, vRR] (a missing split: f -1, its leaf
        # value repeated)
        flat = []
        for est in gb.estimators_:
            for t in est:
                tr = t.tree_
                L_, R_ = tr.children_left, tr.children_right
                def leafval(i):
                    return r4(tr.value[i][0][0])
                def side(i):
                    if L_[i] < 0:
                        return [-1, 0], [leafval(i), leafval(i)]
                    return [int(tr.feature[i]), r4(tr.threshold[i])], [leafval(L_[i]), leafval(R_[i])]
                assert L_[0] >= 0
                sl, vl = side(L_[0]); sr, vr = side(R_[0])
                flat += [int(tr.feature[0]), r4(tr.threshold[0])] + sl + sr + vl + vr
        Xd = np.array([FEATS[v](r) for r in R[:40]])
        init = gb._raw_predict_init(Xd[:1])[0]
        K = len(gb.classes_)
        def pred(x):
            raw = init.copy()
            for e in range(len(gb.estimators_)):
                for k in range(K):
                    o = (e * K + k) * 10
                    f0, t0 = flat[o], flat[o + 1]
                    if x[f0] <= t0:
                        f, t, a, b = flat[o + 2], flat[o + 3], flat[o + 6], flat[o + 7]
                    else:
                        f, t, a, b = flat[o + 4], flat[o + 5], flat[o + 8], flat[o + 9]
                    raw[k] += gb.learning_rate * (a if f < 0 or x[f] <= t else b)
            e_ = np.exp(raw - raw.max())
            return e_ / e_.sum()
        err = max(abs(pred(x) - p).max() for x, p in zip(Xd, gb.predict_proba(Xd)))
        print('max prob error', err)
        cat = None
        if v == 'DB':
            catW = {}
            for grp, w in C.CAL.items():
                o = {}
                for c in C.CATS:
                    mx = max(w[x] for x in C.MEMBERS[c])
                    o[c] = [r4(max(w[mm], 0.15 * mx) if mx > 0 else 1) for mm in C.MEMBERS[c]]
                catW[grp] = o
            cat = {
                'members': {c: C.MEMBERS[c] for c in C.CATS},
                'mu': {k: r4(x) for k, x in zip(C.ALLM, C.mu)},
                'sd': {k: r4(x) for k, x in zip(C.ALLM, C.sd)},
                'w': catW,
                'bucket': {b: [[r4(x) for x in C.CB[b][0]], [r4(x) for x in C.CB[b][1]]] for b in BUCKETS},
            }
        src = f"""// GENERATED by tools/archetypes2k/archcmp/gbdt.py (export {v}, from v2/archcmp.script.test.ts's data). Do not edit by hand.
// archv4: the boosted-trees family voter (archcmp's D{' with the 2K-style categories as features' if cat else ''}), fitted on
// the tune split of the user's 2K list and the judged key plus the user's picks: {len(gb.estimators_)} rounds x {K} families of
// depth-2 trees over the neighbours' features (knn.ts), the class values and the position bucket{', then the six categories' if cat else ''}.
// GBDT_TREES: one run of 10 numbers per tree, round by round, family by family: root feature and threshold, left
// child's feature and threshold, right child's, then the four leaf values (feature -1: no split there).
// GBDT_REL: how often its family is right per position bucket and family it says (out of fold on the tune split,
// smoothed as voters.data.ts).
import type {{ Family }} from "../families.ts";
import type {{ PosBucket }} from "../types.ts";

export const GBDT_CLASSES: Family[] = {json.dumps([str(c) for c in gb.classes_])};
export const GBDT_INIT = {json.dumps([r4(x) for x in init])};
export const GBDT_LR = {gb.learning_rate};
// prettier-ignore
export const GBDT_TREES = {json.dumps(flat, separators=(',', ':'))};
// prettier-ignore
export const GBDT_REL: Record<PosBucket, Partial<Record<Family | "*", number>>> = {json.dumps(rel, separators=(',', ':'))};
// prettier-ignore
export const GBDT_CATS: {{ members: Record<string, string[]>; mu: Record<string, number>; sd: Record<string, number>; w: Record<"guard" | "wing" | "big", Record<string, number[]>>; bucket: Record<PosBucket, [number[], number[]]> }} | undefined = {json.dumps(cat, separators=(',', ':')) if cat else 'undefined'};
"""
        open(sys.argv[3], 'w').write(src)
        print('wrote', sys.argv[3], len(src))
