"""Summarize rating inflation sims (*.jsonl from pop.script.test.ts / run.script.test.ts) into CSV, markdown tables and PNG charts.

    python3 tools/ratingInflation/analyze.py <input dir> <output dir>
"""

import collections
import csv
import json
import math
import os
import sys

import matplotlib

matplotlib.use("Agg")
import matplotlib.pyplot as plt  # noqa: E402

src, out = sys.argv[1], sys.argv[2]
os.makedirs(out, exist_ok=True)

rows = []
for name in sorted(os.listdir(src)):
    if name.endswith(".jsonl"):
        with open(os.path.join(src, name)) as f:
            rows += [json.loads(line) for line in f if line.strip()]

keys = [k for k in rows[0].keys() if k not in ("config", "seed", "season")]
for k in ["coachingEffectMean"]:
    if k not in keys and any(k in r for r in rows):
        keys.append(k)

with open(os.path.join(out, "seasons.csv"), "w", newline="") as f:
    w = csv.DictWriter(f, fieldnames=["config", "seed", "season", *keys])
    w.writeheader()
    for r in rows:
        w.writerow({k: r.get(k) for k in ["config", "seed", "season", *keys]})

# Year index from each run's first season
first = {}
for r in rows:
    key = (r["config"], r["seed"])
    first[key] = min(first.get(key, 1e9), r["season"])
for r in rows:
    r["year"] = r["season"] - first[(r["config"], r["seed"])]

configs = list(dict.fromkeys(r["config"] for r in rows))
METRICS = [
    "ovrMean",
    "ovrSd",
    "potMean",
    "top10",
    "top50",
    "max",
    "n70",
    "n75",
    "n80",
    "rookieOvr",
    "rookiePot",
    "nextClassTop30",
    "age19_22",
    "age23_26",
    "age27_30",
    "age31_34",
    "meanAge",
    "teamOvrSd",
    "coachingMean",
    "coachingEffectMean",
    "injuries",
    "ratingsLossInjuries",
    "ptsPerGame",
    "fgPct",
]


def num(x):
    return isinstance(x, (int, float)) and not (isinstance(x, float) and math.isnan(x))


def agg(config, metric, years):
    vals = [r[metric] for r in rows if r["config"] == config and r["year"] in years and num(r.get(metric))]
    if not vals:
        return None, None, 0
    m = sum(vals) / len(vals)
    # Standard error over seeds (seed means)
    by_seed = collections.defaultdict(list)
    for r in rows:
        if r["config"] == config and r["year"] in years and num(r.get(metric)):
            by_seed[r["seed"]].append(r[metric])
    seed_means = [sum(v) / len(v) for v in by_seed.values()]
    se = (
        math.sqrt(sum((x - m) ** 2 for x in seed_means) / (len(seed_means) - 1) / len(seed_means))
        if len(seed_means) > 1
        else float("nan")
    )
    return m, se, len(seed_means)


max_year = max(r["year"] for r in rows)
early = range(0, 3)
late = range(max(0, max_year - 4), max_year + 1)

lines = []
lines.append(f"Years 0-2 vs years {late.start}-{late.stop - 1} (mean over seeds; ± standard error of the seed means)\n")
lines.append("| config | seeds | metric | early | late | late - early | late vs off |")
lines.append("|---|---|---|---|---|---|---|")
summary = []
for metric in METRICS:
    off_late, _, _ = agg("off", metric, late)
    for config in configs:
        e, _, n = agg(config, metric, early)
        l, se, _ = agg(config, metric, late)
        if e is None or l is None:
            continue
        diff_off = "" if off_late is None or config == "off" else f"{l - off_late:+.2f}"
        se_txt = "" if math.isnan(se) else f" ± {se:.2f}"
        lines.append(f"| {config} | {n} | {metric} | {e:.2f} | {l:.2f}{se_txt} | {l - e:+.2f} | {diff_off} |")
        summary.append(
            {"config": config, "metric": metric, "seeds": n, "early": e, "late": l, "lateSe": se, "lateMinusOff": None if diff_off == "" else l - off_late}
        )
with open(os.path.join(out, "summary.md"), "w") as f:
    f.write("\n".join(lines) + "\n")
with open(os.path.join(out, "summary.csv"), "w", newline="") as f:
    w = csv.DictWriter(f, fieldnames=list(summary[0].keys()))
    w.writeheader()
    w.writerows(summary)

# Charts: metric vs year, one line per config (mean over seeds)
CHARTS = [
    ("ovrMean", "League mean ovr (rostered players)"),
    ("potMean", "League mean pot"),
    ("top10", "Top-10 ovr"),
    ("n70", "Players with ovr 70+"),
    ("rookieOvr", "Second-year class ovr"),
    ("coachingEffectMean", "League mean coaching development effect"),
    ("age23_26", "Mean ovr, ages 23-26"),
    ("teamOvrSd", "Team ovr SD"),
]
fig, axes = plt.subplots(4, 2, figsize=(12, 15))
palette = ["#1f77b4", "#d62728", "#2ca02c", "#ff7f0e", "#9467bd", "#8c564b", "#e377c2", "#7f7f7f", "#bcbd22", "#17becf", "#000000"]
for ax, (metric, title) in zip(axes.flat, CHARTS):
    for i, config in enumerate(configs):
        by_year = collections.defaultdict(list)
        for r in rows:
            if r["config"] == config and num(r.get(metric)):
                by_year[r["year"]].append(r[metric])
        if not by_year:
            continue
        ys = sorted(by_year)
        ax.plot(ys, [sum(by_year[y]) / len(by_year[y]) for y in ys], label=config, color=palette[i % len(palette)], lw=2 if config in ("off", "allOn") else 1.2)
    ax.set_title(title)
    ax.set_xlabel("season")
    ax.grid(alpha=0.3)
axes.flat[0].legend(fontsize=8)
fig.tight_layout()
fig.savefig(os.path.join(out, "inflation.png"), dpi=90)
print("\n".join(lines[:3]))
print(f"wrote {out}")
