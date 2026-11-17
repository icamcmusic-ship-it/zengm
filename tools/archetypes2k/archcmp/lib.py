# archcmp offline library: the v2 re-ranker, the neighbours' vote, metrics
import json, math, os
import numpy as np

# (the data: v2/archcmp.script.test.ts's rows.json and meta.json, in ARCHCMP_DIR; the outputs go there too)
D = os.environ.get('ARCHCMP_DIR', os.path.dirname(os.path.abspath(__file__)))
R = json.load(open(os.path.join(D, 'rows.json')))
M = json.load(open(os.path.join(D, 'meta.json')))
P = M['V2_PARAMS']
FAMS = M['FAMILIES']
REL = M['VOTER_REL']
BUCKETS = ['PG', 'SG', 'W', 'F', 'C']
FEAT_W = np.array(M['FEAT_W'])
SOURCE_W = {'2k': 1, '2kAllTime': 0.5, 'judged': 0.5, 'pick': 1.5}
OWN = {''.join(ch for ch in n.lower() if ch.isalnum()) for n in [
    "Switch Defender", "Rugged Rim Protector", "Pesky Playmaking Creator", "2-Way Middy Playmaker",
    "Wing-Running Sharpshooter", "2-Way Bucket Chaser"]}
normn = lambda s: ''.join(ch for ch in s.lower() if ch.isalnum())

REFS = M['refs']
RX = np.array([r['x'] for r in REFS])
RB = np.array([r['bucket'] for r in REFS])
RTEST = np.array([r['split'] == 'test' for r in REFS])
RKEY = [r['key'] for r in REFS]
RSRC = np.array([SOURCE_W[r['src']] for r in REFS])
for i, r in enumerate(R):
    r['i'] = i
    r['bi'] = BUCKETS.index(r['bucket'])
    r['xa'] = np.array(r['x'])

def knn(r, refw=None, k=15, gap=2):
    """The neighbours' votes as knn.ts (refw: per-ref weight multipliers, the noise pass)."""
    d = gap * np.abs(RB - r['bi']) + ((RX - r['xa']) ** 2 * FEAT_W).sum(1)
    mask = np.ones(len(REFS), bool)
    if r['split'] == 'test':
        mask &= ~RTEST
    if r['key'] in _keyidx:
        mask &= _excl(r['key'])
    d = np.where(mask, d, np.inf)
    idx = np.argsort(d, kind='stable')[:k]
    v = {'family': {}, 'role': {}, 'desc': {}, 'canon': {}}
    tot = 0
    for j in idx:
        rr = REFS[j]
        w = RSRC[j] / (0.5 + math.sqrt(d[j]))
        if refw is not None:
            w *= refw[j]
        tot += w
        v['family'][rr['family']] = v['family'].get(rr['family'], 0) + w
        if rr['role']:
            v['role'][rr['role']] = v['role'].get(rr['role'], 0) + w
        for ds in rr['descs']:
            v['desc'][ds] = v['desc'].get(ds, 0) + w
        v['canon'][rr['canon']] = v['canon'].get(rr['canon'], 0) + w
    if tot > 0:
        for m in v.values():
            for kk in m:
                m[kk] /= tot
    return v, idx

_keyidx = {}
for j, kk in enumerate(RKEY):
    _keyidx.setdefault(kk, []).append(j)
def _excl(ex):
    m = np.ones(len(REFS), bool)
    m[_keyidx[ex]] = False
    return m

def top_of(m):
    if not m:
        return None
    return sorted(m.items(), key=lambda kv: (-kv[1], kv[0]))[0][0]

def rel_of(v, b, f):
    t = REL[v].get(b, {})
    return t.get(f, t.get('*', 0.4))

def fam_score(r, votes, extra=None, voters_extra=None, drop=()):
    """v2's family score (engine.ts), optionally with extra per-family terms and extra voters [(family, weight)]."""
    v2 = r['v2']
    b = r['bucket']
    said = [('classic', v2['voters']['classic']), ('knn', top_of(votes['family'])), ('rule', v2['voters'].get('rule')),
            ('probs', v2['voters']['probs'])]
    said = [s for s in said if s[0] not in drop]
    fs = {}
    for i, f in enumerate(FAMS):
        fv = sum(rel_of(vv, b, f) for vv, sf in said if sf == f)
        fs[f] = P['fV'] * fv + P['fK'] * votes['family'].get(f, 0) + P['fP'] * v2['probs'][i]
        if extra is not None:
            fs[f] += extra.get(f, 0)
    if voters_extra:
        for f, w in voters_extra:
            if f in fs:
                fs[f] += w
    return fs

def rerank(r, votes=None, fs=None, role_bonus=None, desc_bonus=None, cand_bonus=None):
    """Re-score v2's candidates with new votes / family scores / role bonuses; returns (first, top3 canons, ordered)."""
    v2 = r['v2']
    ov = v2['votes']
    votes = votes or ov
    fs = fs or v2['famScore']
    of = v2['famScore']
    family = sorted(FAMS, key=lambda f: (-fs[f], f))[0]
    cl = next(c for c in v2['cands'] if c['classic'])
    out = []
    for c in v2['cands']:
        def delta(fam, role, descs, canon, with_desc):
            d = fs[fam] - of[fam]
            d += P['rK'] * (votes['role'].get(role or '', 0) - ov['role'].get(role or '', 0))
            if with_desc:
                d += P['dK'] * sum(votes['desc'].get(x, 0) - ov['desc'].get(x, 0) for x in descs)
            d += P['kCanon'] * (votes['canon'].get(canon, 0) - ov['canon'].get(canon, 0))
            return d
        k = c['kind']
        if k == 'comp' and c['classic']:
            # (a composed candidate that is the classic label: the better of the two scores; the comp part is not known
            # apart, so the max is kept with the same delta)
            s = c['score'] + delta(c['family'], c['role'], c['descs'], c['canon'], True)
        else:
            s = c['score'] + delta(c['family'], c['role'], c['descs'], c['canon'], k == 'comp')
        if role_bonus and c['role']:
            s += role_bonus.get(c['role'], 0)
        if desc_bonus:
            s += sum(desc_bonus.get(x, 0) for x in c['descs'])
        if cand_bonus:
            s += cand_bonus(c)
        out.append(dict(c, s=s))
    out.sort(key=lambda c: (-c['s'], c['canon']))
    toll = lambda c: 0 if c['family'] == family else P['famOut']
    eff = lambda c: c['s'] - toll(c)
    first = max(out, key=lambda c: eff(c))  # (first max in sorted order)
    best = -1e9
    for c in out:
        if eff(c) > best:
            best = eff(c)
            first = c
    if first['id'].startswith('v2:') and normn(first['name']) not in OWN:
        fsc = eff(first)
        for c in out:
            if not c['id'].startswith('v2:') and (eff(c) >= fsc - P['presetMargin'] or (c['classic'] and v2['classicConf'] >= P['presetConf'])):
                first = c
                break
    ctop = set(v2['classicTop'] or [])
    alt = lambda c: c['s'] + (0 if c['id'].startswith('v2:') else P['altBuild']) + (P['altClassic'] if (c['classic'] or c['id'] in ctop) else 0)
    rest = [first] + sorted([c for c in out if c is not first], key=lambda c: (-alt(c), c['canon']))
    top = []
    for c in rest:
        if len(top) >= 3:
            break
        if c['canon'] not in top:
            top.append(c['canon'])
    return first, top, rest, family

def label_canon(c):
    return c['canon']

# ---- metrics ----
def score_rows(rows, preds):
    """preds: {i: (first, top3)}; returns dict of metrics (weighted)."""
    n = t1 = t3 = fam = role = 0
    tp = fp = fn = 0
    per = {}
    rtp = {}; rfp = {}; rfn = {}
    for r in rows:
        first, top = preds[r['i']][:2]
        w = r['w']
        tg = r['target']
        cans = [t['canon'] for t in tg]
        n += w
        t1 += w * (first['canon'] in cans)
        t3 += w * any(c in cans for c in top)
        fam += w * (first['family'] in [t['family'] for t in tg])
        t0 = tg[0]
        role += w * (first['role'] is not None and first['role'] == t0['role'])
        pr, gr = first['role'], t0['role']
        if pr: rfp[pr] = rfp.get(pr, 0) + w * (pr != gr); rtp[pr] = rtp.get(pr, 0) + w * (pr == gr)
        if gr and pr != gr: rfn[gr] = rfn.get(gr, 0) + w
        pd, gd = set(first['descs']), set(t0['descs'])
        for x in pd | gd:
            e = per.setdefault(x, [0, 0, 0])
            if x in pd and x in gd: e[0] += w; tp += w
            elif x in pd: e[1] += w; fp += w
            else: e[2] += w; fn += w
    f1 = lambda a, b, c: 2 * a / max(1e-9, 2 * a + b + c)
    roles = set(rtp) | set(rfn)
    role_f1_macro = np.mean([f1(rtp.get(x, 0), rfp.get(x, 0), rfn.get(x, 0)) for x in roles]) if roles else 0
    return dict(n=n, t1=t1 / n, t3=t3 / n, fam=fam / n, role=role / n, roleF1=role_f1_macro,
                dP=tp / max(1e-9, tp + fp), dR=tp / max(1e-9, tp + fn), dF1=f1(tp, fp, fn), per=per)

def groups(split='test'):
    if split == 'test':
        return {
            '2K held-out all': [r for r in R if r['split'] == 'test' and r['src'] in ('2k', '2kAllTime')],
            '2K held-out current': [r for r in R if r['split'] == 'test' and r['src'] == '2k'],
            '2K held-out all-time': [r for r in R if r['split'] == 'test' and r['src'] == '2kAllTime'],
            'judged held-out': [r for r in R if r['split'] == 'test' and r['src'] == 'judged'],
            'user picks (LOO)': [r for r in R if r['src'] == 'pick'],
        }
    return {
        '2K tune': [r for r in R if r['split'] == 'tune' and r['src'] in ('2k', '2kAllTime')],
        'judged tune': [r for r in R if r['split'] == 'tune' and r['src'] == 'judged'],
    }

def fmt(m):
    return f"top-1 {100*m['t1']:.1f} top-3 {100*m['t3']:.1f} fam {100*m['fam']:.1f} role {100*m['role']:.1f} roleF1 {100*m['roleF1']:.1f} desc P/R/F1 {100*m['dP']:.0f}/{100*m['dR']:.0f}/{100*m['dF1']:.1f} (n={m['n']:.1f})"
