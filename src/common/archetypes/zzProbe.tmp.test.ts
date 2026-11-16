/* eslint-disable */
// @ts-nocheck
import { test } from "vitest";
import { writeFileSync } from "node:fs";
import { ARCHETYPES, SCORING_ARCHETYPES, classify, defaultNorms, scoreAll, isPoorFit, archetypeById } from "./classify.ts";
import { realData, realNorms, realPlayer } from "./real.testutil.ts";
import { USER_2K } from "./user2k.data.ts";
import { USER_2K_MAP } from "./twoK/user2kMap.data.ts";
import { TWO_K_NAMES } from "./defs.data.ts";
import { isGenericBuild } from "./generic.ts";
import { GOLD } from "./gold.data.ts";

const BIAS = JSON.parse(process.env.BIAS ?? "{}");
test("probe", () => {
	const d = realData();
	const norms = realNorms(defaultNorms(false), false);
	norms.bias = { ...norms.bias };
	for (const [id, v] of Object.entries(BIAS))
		for (const a of SCORING_ARCHETYPES) if ((a.out ?? a.id) === id) norms.bias[a.id] = v;
	const out = [];
	const cls = (p) => classify(p.ratings, { norms, pos: p.pos, age: p.age, stats: p.stats });
	// real 2025
	const real = d.d.ratings.filter((r) => r.season === 2025).map((row) => { const p = realPlayer(d, row); return { p, row, c: cls(p) }; });
	const top = [...real].sort((a, b) => b.p.ovr - a.p.ovr).slice(0, 150);
	for (const [tag, xs] of [["all", real], ["top150", top]]) {
		const cnt = {}; let gen = 0, poor = 0;
		for (const x of xs) { cnt[x.c.id] = (cnt[x.c.id] ?? 0) + 1; if (isGenericBuild(archetypeById(x.c.id))) gen++; if (isPoorFit(x.c)) poor++; }
		const t = Object.entries(cnt).sort((a, b) => b[1] - a[1]).slice(0, 6).map(([k, v]) => `${k} ${(100 * v / xs.length).toFixed(1)}`);
		out.push(`${tag} shares: ` + (process.env.SHARE ?? "").split(",").filter(Boolean).map((id) => `${id} ${(100 * (cnt[id] ?? 0) / xs.length).toFixed(1)}`).join(", "));
		out.push(`${tag}: generic ${(100 * gen / xs.length).toFixed(1)} poor ${(100 * poor / xs.length).toFixed(1)} | ${t.join(", ")}`);
	}
	for (const id of (process.env.WHO ?? "mid-paint-pro").split(",")) {
		out.push(`${id} in top150: ` + top.filter((x) => x.c.id === id).map((x) => {
			const s = scoreAll(x.p.ratings, norms, ARCHETYPES, x.p.pos, undefined, { age: x.p.age, stats: x.p.stats }).scored;
			return `${x.p.name} [${s.slice(0, 3).map((y) => `${y.a.id} ${y.z.toFixed(2)}`).join(" / ")}]`;
		}).join("; "));
	}
	// user2k exact hits
	let hit = 0, n = 0;
	const want = (arch) => { const m = USER_2K_MAP[arch]; return m?.id; };
	const lost = [];
	for (const r of USER_2K) {
		if (!r.slug) continue;
		const row = d.d.ratings.find((x) => x.slug === r.slug && x.season === r.season);
		if (!row) continue;
		const p = realPlayer(d, row);
		const c = cls(p);
		const w = r.allTime ? 0.5 : 1;
		n += w;
		const id = want(r.arch);
		if (id && c.id === id) hit += w;
		if (["irvinky01"].includes(r.slug) || (process.env.SHOWU ?? "").split(",").includes(r.slug)) {
			const s = scoreAll(p.ratings, norms, ARCHETYPES, p.pos, undefined, { age: p.age, stats: p.stats }).scored;
			out.push(`${r.name} ${r.season} (${r.arch}) -> ${c.id} [${s.slice(0, 4).map((y) => `${y.a.id} ${y.z.toFixed(2)}`).join(" / ")}]`);
		}
	}
	out.push(`user2k top-1 (mapped) ${(100 * hit / n).toFixed(1)}% n=${n}`);
	// gold
	let gh = 0;
	for (const [slug, season, ok] of GOLD) {
		const row = d.d.ratings.find((x) => x.slug === slug && x.season === season);
		if (!row) continue;
		const p = realPlayer(d, row);
		if (ok.includes(cls(p).id)) gh++;
	}
	out.push(`gold(quick, no pos model) ${gh}/${GOLD.length}`);
	writeFileSync(process.env.OUT, out.join("\n") + "\n");
}, 900000);
