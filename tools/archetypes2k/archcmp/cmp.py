# archcmp: variants A-E fitted on the tune split, scored on archv3's held-out split (picks leave-one-out)
# Usage: RUN_ARCHCMP=1 ARCHCMP_OUT=dir npx vitest run src/common/archetypes/v2/archcmp.script.test.ts, then
# ARCHCMP_DIR=dir python3 cmp.py (offline.txt, results.pkl, models.pkl, tree.txt, noise.txt), report.py (compare.txt; needs the
# engine runs full-<tag>.txt / gold-<tag>.txt / speed-<tag>.txt in dir)
import sys, itertools, json, collections
import numpy as np
from sklearn.linear_model import LogisticRegression, LinearRegression
from sklearn.tree import DecisionTreeClassifier, export_text
from sklearn.ensemble import GradientBoostingClassifier
from sklearn.model_selection import GroupKFold
from lib import *

OUTD = D
RK = ['hgt', 'stre', 'spd', 'jmp', 'endu', 'ins', 'dnk', 'ft', 'fg', 'tp', 'oiq', 'diq', 'drb', 'pss', 'reb']
CV = ['shoot', 'mid', 'finish', 'post', 'handle', 'pass', 'reb', 'rimD', 'perD', 'ath', 'stre', 'def', 'score']
CATS = ['Finishing', 'Shooting', 'Playmaking', 'Defense', 'Rebounding', 'Physicals']
MEMBERS = {
    'Finishing': ['cv.finish', 'cv.post', 'r.ins', 'r.dnk'],
    'Shooting': ['cv.shoot', 'cv.mid', 'r.fg', 'r.tp', 'r.ft', 'f.sThree'],
    'Playmaking': ['cv.handle', 'cv.pass', 'r.drb', 'r.pss', 'r.oiq', 'f.sPss'],
    'Defense': ['cv.rimD', 'cv.perD', 'r.diq', 'f.sBlk', 'f.sStl', 'f.fBlk', 'f.fStl', 'f.fPdf'],
    'Rebounding': ['cv.reb', 'r.reb', 'f.sReb'],
    'Physicals': ['cv.ath', 'cv.stre', 'r.spd', 'r.jmp', 'r.stre', 'r.endu', 'r.hgt'],
}
GROUP = {'PG': 'guard', 'SG': 'guard', 'W': 'wing', 'F': 'wing', 'C': 'big'}

def raw(r, m):
    k, n = m.split('.')
    return {'cv': r['cv'], 'r': r['ratings'], 'f': r['famX']}[k].get(n, 0) or 0

TUNE = [r for r in R if r['split'] == 'tune']
PICKS = [r for r in R if r['src'] == 'pick']
TEST = [r for r in R if r['split'] == 'test']
ALLM = sorted({m for ms in MEMBERS.values() for m in ms})
# global z of every member (tune rows)
Mtab = np.array([[raw(r, m) for m in ALLM] for r in TUNE])
mu, sd = Mtab.mean(0), Mtab.std(0) + 1e-6
def zmem(r):
    return (np.array([raw(r, m) for m in ALLM]) - mu) / sd

# ---- B: the 2K-style category layer, calibrated on the 2K overall per position group ----
CAL = {}
calrep = []
for grp in ['guard', 'wing', 'big']:
    rows = [r for r in TUNE if r['ovr2k'] and GROUP[r['bucket']] == grp]
    X = np.array([zmem(r) for r in rows]); y = np.array([r['ovr2k'] for r in rows], float)
    lr = LinearRegression(positive=True).fit(X, y)
    pred = lr.predict(X)
    w = dict(zip(ALLM, lr.coef_))
    CAL[grp] = w
    # (level of our ovr alone, for reference)
    ours = np.array([r['ovr'] for r in rows], float)
    c0 = np.corrcoef(ours, y)[0, 1]
    calrep.append(f"{grp}: n={len(rows)} R2 {lr.score(X, y):.2f} (corr ours ovr vs 2K ovr {c0:.2f}); category weight " +
                  ', '.join(f"{c} {sum(w[m] for m in MEMBERS[c]):.2f}" for c in CATS))
def cats(r):
    z = dict(zip(ALLM, zmem(r)))
    w = CAL[GROUP[r['bucket']]]
    out = []
    for c in CATS:
        ws = [max(w[m], 0.15 * max(1e-6, max(w[x] for x in MEMBERS[c]))) if max(w[x] for x in MEMBERS[c]) > 0 else 1 for m in MEMBERS[c]]
        out.append(sum(wi * z[m] for wi, m in zip(ws, MEMBERS[c])) / sum(ws))
    return np.array(out)
for r in R:
    r['cat'] = cats(r)
# per-bucket standardization of the categories (tune rows)
CB = {}
for b in BUCKETS:
    xs = np.array([r['cat'] for r in TUNE if r['bucket'] == b])
    CB[b] = (xs.mean(0), xs.std(0) + 1e-6)
for r in R:
    m, s = CB[r['bucket']]
    r['catb'] = (r['cat'] - m) / s
    order = np.argsort(-r['catb'])
    r['top1'], r['top2'] = CATS[order[0]], CATS[order[1]]

def onehot(v, vals):
    return [1.0 if v == x else 0.0 for x in vals]
def featB(r):
    return np.concatenate([r['catb'], r['cat'], onehot(r['top1'], CATS), onehot(r['top2'], CATS), onehot(r['bucket'], BUCKETS), [r['ratings']['hgt'] / 25]])
def featC(r):
    return np.concatenate([onehot(r['top1'], CATS), onehot(r['top2'], CATS), onehot(r['bucket'], BUCKETS), [r['ratings']['hgt']], r['catb']])
FEATC_NAMES = [f'top1={c}' for c in CATS] + [f'top2={c}' for c in CATS] + [f'pos={b}' for b in BUCKETS] + ['height'] + [f'{c} (vs position)' for c in CATS]
def featD(r):
    return np.concatenate([r['xa'], [r['cv'][k] for k in CV], onehot(r['bucket'], BUCKETS)])

famT = lambda r: r['target'][0]['family']
roleT = lambda r: r['target'][0]['role'] or 'none'

# role -> family by position group (tune)
R2F = collections.defaultdict(collections.Counter)
for r in TUNE:
    R2F[(roleT(r), GROUP[r['bucket']])][famT(r)] += r['w']

# ---- noise pass: out-of-fold family probability of each tune label; sources weighed by how often they agree ----
def oof_probs(rows, feat, ylab, mk, w=None, folds=5):
    X = np.array([feat(r) for r in rows]); y = np.array([ylab(r) for r in rows])
    grp = [r['key'] for r in rows]
    out = [None] * len(rows)
    for tr, te in GroupKFold(folds).split(X, y, grp):
        m = mk().fit(X[tr], y[tr], sample_weight=None if w is None else w[tr])
        pr = m.predict_proba(X[te])
        for j, i in enumerate(te):
            out[i] = dict(zip(m.classes_, pr[j]))
    return out

def noise_pass():
    ws = np.array([r['w'] for r in TUNE])
    pr = oof_probs(TUNE, featD, famT, lambda: LogisticRegression(C=0.3, max_iter=2000), ws)
    knnp = []
    for r in TUNE:
        v, _ = knn(r)
        knnp.append(v['family'].get(famT(r), 0))
    agree = np.array([0.5 * p.get(famT(r), 0) + 0.5 * k for p, r, k in zip(pr, TUNE, knnp)])
    srcs = collections.defaultdict(list)
    for a, r in zip(agree, TUNE):
        srcs[r['src']].append(a)
    rel = {s: float(np.mean(v)) for s, v in srcs.items()}
    base = rel['2k']
    srcmul = {s: min(1.5, max(0.5, v / base)) for s, v in rel.items()}
    cut = np.quantile(agree, 0.10)
    flagged = [(a, r) for a, r in zip(agree, TUNE) if a <= cut]
    W = {}
    for a, r in zip(agree, TUNE):
        W[(r['key'], r['src'], r['target'][0]['name'])] = srcmul[r['src']] * (0.3 if a <= cut else 1.0)
    return W, rel, srcmul, flagged

W_NOISE, SRC_REL, SRC_MUL, FLAGGED = noise_pass()
# per-ref weights for the neighbours (refs named as their rows: 2K name or the build's name at his position)
def ref_w():
    out = np.ones(len(REFS))
    by = {}
    for (k, s, n), w in W_NOISE.items():
        by[(k, s, normn(n))] = w
    for j, rr in enumerate(REFS):
        out[j] = by.get((rr['key'], rr['src'], normn(rr['name'])), 1.0)
    return out
REFW = ref_w()
def row_w(r, noise):
    if not noise:
        return r['w'] * (1.5 if r['src'] == 'pick' else 1)
    return r['w'] * W_NOISE.get((r['key'], r['src'], r['target'][0]['name']), SRC_MUL.get(r['src'], 1.0))

# ---- models: OOF on tune (for the integration weights), fitted on tune + picks for test, leave-one-out for picks ----
def mkB():
    return LogisticRegression(C=0.5, max_iter=3000)
def mkC():
    return DecisionTreeClassifier(max_depth=4, min_samples_leaf=12, random_state=0)
def mkD():
    return GradientBoostingClassifier(n_estimators=80, max_depth=2, learning_rate=0.08, subsample=0.8, random_state=0)
MODELS = {
    'Bfam': (featB, famT, mkB), 'Brole': (featB, roleT, mkB),
    'Crole': (featC, roleT, mkC),
    'Dfam': (featD, famT, mkD),
}

def fit_predict(name, noise):
    feat, ylab, mk = MODELS[name]
    preds = {}
    ws = np.array([row_w(r, noise) for r in TUNE])
    for p, r in zip(oof_probs(TUNE, feat, ylab, mk, ws), TUNE):
        preds[r['i']] = p
    train = TUNE + PICKS
    X = np.array([feat(r) for r in train]); y = np.array([ylab(r) for r in train]); w = np.array([row_w(r, noise) for r in train])
    m = mk().fit(X, y, sample_weight=w)
    for r in TEST:
        preds[r['i']] = dict(zip(m.classes_, m.predict_proba([feat(r)])[0]))
    for k, r in enumerate(PICKS):
        idx = [i for i in range(len(train)) if train[i] is not r]
        mm = mk().fit(X[idx], y[idx], sample_weight=w[idx])
        preds[r['i']] = dict(zip(mm.classes_, mm.predict_proba([feat(r)])[0]))
    return preds, m

def tree_fam(p, r):
    out = collections.Counter()
    for role, pr in p.items():
        dist = R2F.get((role, GROUP[r['bucket']]))
        if not dist:
            continue
        tot = sum(dist.values())
        for f, c in dist.items():
            out[f] += pr * c / tot
    return out

VCACHE = {}
def run(variant, wts, PR, noise):
    preds = {}
    for r in R:
        votes = VCACHE.setdefault(r['i'], knn(r, REFW)[0]) if noise else r['v2']['votes']
        extra = collections.Counter()
        rb = collections.Counter()
        if 'B' in variant:
            for f, p in PR['Bfam'][r['i']].items(): extra[f] += wts['bF'] * p
            for ro, p in PR['Brole'][r['i']].items(): rb[ro] += wts['bR'] * p
        if 'C' in variant:
            p = PR['Crole'][r['i']]
            for ro, q in p.items(): rb[ro] += wts['cR'] * q
            for f, q in tree_fam(p, r).items(): extra[f] += wts['cF'] * q
        if 'D' in variant:
            for f, p in PR['Dfam'][r['i']].items(): extra[f] += wts['dF'] * p
        fs = fam_score(r, votes, extra)
        first, top, _, _ = rerank(r, votes=votes, fs=fs, role_bonus=rb)
        preds[r['i']] = (first, top)
    return preds

def objective(preds):
    gs = groups('tune')
    a = score_rows(gs['2K tune'], preds); b = score_rows(gs['judged tune'], preds)
    return a['fam'] + a['t3'] + a['role'] + 0.5 * (b['fam'] + b['t3'] + b['role'])

KEYS = {'B': ['bF', 'bR'], 'C': ['cR', 'cF'], 'D': ['dF']}
GRID = [0, 0.25, 0.5, 1.0, 1.5, 2.0, 3.0]
def tune(variant, PR, noise):
    keys = [k for v in variant if v in KEYS for k in KEYS[v]]
    best = (objective(run('A', {}, PR, noise)), {k: 0 for k in keys})
    # coordinate ascent over the grid
    cur = {k: 0.5 for k in keys}
    for it in range(3):
        for k in keys:
            for g in GRID:
                t = dict(cur, **{k: g})
                o = objective(run(variant, t, PR, noise))
                if o > best[0] + 1e-9:
                    best = (o, t)
            cur = dict(best[1])
    return best

import pickle
def boot(rows, pa, pb, metric, n=2000, seed=0):
    rng = np.random.default_rng(seed)
    w = np.array([r['w'] for r in rows])
    def per(p):
        out = []
        for r in rows:
            first, top = p[r['i']][:2]
            tg = r['target']
            if metric == 'fam': out.append(first['family'] in [t['family'] for t in tg])
            elif metric == 't3': out.append(any(c in [t['canon'] for t in tg] for c in top))
            elif metric == 'role': out.append(first['role'] is not None and first['role'] == tg[0]['role'])
        return np.array(out, float)
    a, b = per(pa), per(pb)
    d = []
    for _ in range(n):
        ix = rng.integers(0, len(rows), len(rows))
        d.append(((b[ix] - a[ix]) * w[ix]).sum() / w[ix].sum())
    d = np.array(d)
    return d.mean(), np.quantile(d, 0.05), (d > 0).mean()

if __name__ == '__main__':
    lines = []
    lines.append('2K-style category layer, calibrated on the user\'s 2K overall (tune split; positive least squares):')
    lines += ['  ' + x for x in calrep]
    lines.append(f"noise pass: source agreement {json.dumps({k: round(v, 3) for k, v in SRC_REL.items()})} -> weight x{json.dumps({k: round(v, 2) for k, v in SRC_MUL.items()})}; {len(FLAGGED)} labels flagged (weight 0.3)")
    results = {}
    for noise in [False, True]:
        PR = {}
        FITTED = {}
        for nm in MODELS:
            PR[nm], FITTED[nm] = fit_predict(nm, noise)
        for variant in ['A', 'B', 'C', 'D', 'BC', 'BD', 'CD', 'BCD']:
            o, wts = tune(variant, PR, noise) if variant != 'A' else (objective(run('A', {}, PR, noise)), {})
            preds = run(variant, wts, PR, noise)
            tag = variant + ('+N' if noise else '')
            results[tag] = (wts, o, preds)
            print(tag, wts, round(o, 4), flush=True)
        if noise:
            NOISE_FITTED = FITTED
            pickle.dump({'FITTED': FITTED, 'CAL': CAL, 'CB': {b: (m.tolist(), s.tolist()) for b, (m, s) in CB.items()}, 'mu': mu.tolist(), 'sd': sd.tolist(), 'ALLM': ALLM, 'REFW': REFW.tolist(), 'R2F': {f'{a}|{b}': dict(c) for (a, b), c in R2F.items()}, 'W': {k: v[0] for k, v in results.items()}}, open(f'{OUTD}/models.pkl', 'wb'))
            NOISE_PR = PR
    pickle.dump({k: (v[0], v[1], {i: (f['canon'], f['family'], f['role'], f['descs'], f['name'], f['id'], t) for i, (f, t) in v[2].items()}) for k, v in results.items()}, open(f'{OUTD}/results.pkl', 'wb'))
    # tables
    held = [r for r in R if r['split'] == 'test']
    for tag, (wts, o, preds) in results.items():
        lines.append(f"== {tag} weights {json.dumps(wts)} tune objective {o:.4f}")
        for g, rows in groups('test').items():
            lines.append(f"  {g}: {fmt(score_rows(rows, preds))}")
        if tag != 'A':
            bs = [boot(held, results['A'][2], preds, m) for m in ['fam', 't3', 'role']]
            lines.append('  vs A, all held-out (paired bootstrap; mean, 5th pct, P(>0)): ' + ', '.join(f"{m} {100*x[0]:+.1f} ({100*x[1]:+.1f}, {x[2]:.2f})" for m, x in zip(['fam', 'top-3', 'role'], bs)))
    open(f'{OUTD}/offline.txt', 'w').write('\n'.join(lines) + '\n')
    # the tree's rules (noise-weighted, fitted on tune + picks)
    t = NOISE_FITTED['Crole']
    open(f'{OUTD}/tree.txt', 'w').write('core-role tree (depth 4, leaf 12+, fitted on the tune split + picks, noise-weighted):\n' + export_text(t, feature_names=FEATC_NAMES, show_weights=False, decimals=2))
    with open(f'{OUTD}/noise.txt', 'w') as f:
        f.write(f"flagged labels (lowest agreement with neighbours and an out-of-fold classifier; weight 0.3): {len(FLAGGED)}\n")
        for a, r in sorted(FLAGGED, key=lambda x: x[0]):
            f.write(f"{a:.3f}\t{r['src']}\t{r['who']}\t{r['pos']}\t{r['target'][0]['name']} ({famT(r)})\tv2: {r['v2']['name']} ({r['v2']['family']})\n")
