// Not a real test: the spread of sub-ratings within their base (Wider Sub-Rating Shapes, subspread). Skipped unless SUB_SPREAD is set:
//
//   SUB_SPREAD=1 node_modules/.bin/vitest run --project basketball src/worker/core/player/subSpread.script.test.ts
//
// Populations, each with the setting off (stock shapes) and on (wide shapes), Expanded Ratings on (new-league default) and off:
// - generated draft prospects (SUB_SPREAD_CLASSES classes of a new league, the same players both ways), and the same prospects after six
//   seasons of development (no games: no role growth here, see longRun for that);
// - real players: every 2026 ratings row with stats, his shape from his stats (stock lean / wide lean) as a real-players league gives it.
// Per base: the mean within-group sd of the subs around the base (weighted like the base), the mean and 90th percentile of max - min, and
// the share of players whose subs spread 15+ / 25+ apart; per contrast (blocks - steals, catch-and-shoot - off the dribble, ...) the sd
// across players; fat tails (players with a sub 15+ / 25+ off its base). The real NBA reference is tools/realSubRatings.ts --reference.
// SUB_SPREAD_OUT=file writes the numbers as JSON.
import { describe, test } from "vitest";
import "fake-indexeddb/auto";
// @ts-expect-error node types are not in the web tsconfig, but tests run in node
import { readFileSync, writeFileSync } from "node:fs";
import { draft, league, player } from "../index.ts";
import { g, helpers } from "../../util/index.ts";
import { LEAGUE_DATABASE_VERSION } from "../../../common/constants.ts";
import { defaultGameAttributes } from "../../../common/defaultGameAttributes.ts";
import { last } from "../../../common/utils.ts";
import { getDefaultSettings } from "../../views/newLeague.ts";
import { DEFAULT_LEVEL } from "../../../common/budgetLevels.ts";
import { makeSeededRandom } from "../../../common/random.ts";
import {
	NUM_SUBS,
	SUB_DEFS,
	SUB_GROUPS,
	SUB_INDEX,
} from "../../../common/subRatings.ts";
import {
	parseSubLean,
	realSubShape,
	seedFromString,
} from "../../../common/subRatingsGen.ts";
import { parseSubZ, wideRealLean } from "../../../common/subRatingsReal.ts";
import {
	deriveExpandedRatings,
	expandedRatingsSeed,
} from "../../../common/expandedRatings.ts";
import { assignClassSubs, realShootingSplit } from "./subRatings.ts";

const env = (globalThis as any).process.env;
const CLASSES = Number(env.SUB_SPREAD_CLASSES ?? 20);
const r1 = (x: number) => Math.round(x * 10) / 10;

type Row = { r: Record<string, any>; sub: readonly number[] };

// Contrasts of two subs of one base, and the reference (tools/realSubRatings.ts --reference, stable sd)
export const CONTRASTS: [string, string, string][] = [
	["blk", "stl", "diq"],
	["idf", "pdf", "diq"],
	["tcs", "tod", "tp"],
	["pst", "flt", "ins"],
	["con", "fns", "dnk"],
	["pul", "spu", "fg"],
	["orb", "drd", "reb"],
	["crt", "sec", "drb"],
	["vis", "acc", "pss"],
	["sls", "lat", "spd"],
	["stj", "mxv", "jmp"],
];

export const measure = (rows: readonly Row[]) => {
	const perBase: Record<string, any> = {};
	for (const group of SUB_GROUPS) {
		const wsd: number[] = [];
		const range: number[] = [];
		for (const { r, sub } of rows) {
			const b = r[group.base] as number;
			let s2 = 0;
			let lo = Infinity;
			let hi = -Infinity;
			group.idx.forEach((i, j) => {
				const o = sub[i]! - b;
				s2 += (group.w[j]! * o * o) / 100;
				lo = Math.min(lo, sub[i]!);
				hi = Math.max(hi, sub[i]!);
			});
			wsd.push(Math.sqrt(s2));
			range.push(hi - lo);
		}
		range.sort((a, b) => a - b);
		perBase[group.base] = {
			sd: r1(wsd.reduce((a, b) => a + b, 0) / wsd.length),
			range: r1(range.reduce((a, b) => a + b, 0) / range.length),
			p90: range[Math.floor(0.9 * range.length)]!,
			ge15: r1((100 * range.filter((x) => x >= 15).length) / range.length),
			ge25: r1((100 * range.filter((x) => x >= 25).length) / range.length),
		};
	}
	const contrasts: Record<string, number> = {};
	for (const [a, b] of CONTRASTS) {
		const xs = rows.map(({ sub }) => sub[SUB_INDEX[a]!]! - sub[SUB_INDEX[b]!]!);
		const m = xs.reduce((s, x) => s + x, 0) / xs.length;
		contrasts[`${a}-${b}`] = r1(
			Math.sqrt(xs.reduce((s, x) => s + (x - m) ** 2, 0) / xs.length),
		);
	}
	const offs = (row: Row) =>
		SUB_DEFS.map((d, i) => Math.abs(row.sub[i]! - row.r[d.base]));
	const tail = (k: number, n: number) =>
		r1(
			(100 *
				rows.filter((row) => offs(row).filter((o) => o >= k).length >= n)
					.length) /
				rows.length,
		);
	const perSub = SUB_DEFS.map((d, i) => {
		const xs = rows.map((row) => row.sub[i]! - row.r[d.base]);
		const m = xs.reduce((s, x) => s + x, 0) / xs.length;
		return {
			key: d.key,
			mean: r1(m),
			sd: r1(Math.sqrt(xs.reduce((s, x) => s + (x - m) ** 2, 0) / xs.length)),
		};
	});
	return {
		n: rows.length,
		perBase,
		contrasts,
		tails: {
			any15: tail(15, 1),
			any25: tail(25, 1),
			two15: tail(15, 2),
		},
		perSub,
	};
};

const printTable = (title: string, results: Record<string, any>) => {
	const names = Object.keys(results);
	console.log(`\n### ${title}\n`);
	console.log(
		`| Base | ${names.map((n) => `${n} sd / range / p90 / >=15% / >=25%`).join(" | ")} |`,
	);
	console.log(`|---|${names.map(() => "---").join("|")}|`);
	for (const group of SUB_GROUPS) {
		console.log(
			`| ${group.base} | ${names
				.map((n) => {
					const x = results[n].perBase[group.base];
					return `${x.sd} / ${x.range} / ${x.p90} / ${x.ge15} / ${x.ge25}`;
				})
				.join(" | ")} |`,
		);
	}
	console.log(`\n| Contrast sd | ${names.join(" | ")} |`);
	console.log(`|---|${names.map(() => "---").join("|")}|`);
	for (const [a, b] of CONTRASTS) {
		console.log(
			`| ${a}-${b} | ${names.map((n) => results[n].contrasts[`${a}-${b}`]).join(" | ")} |`,
		);
	}
	console.log(`\n| Tails (% of players) | ${names.join(" | ")} |`);
	console.log(`|---|${names.map(() => "---").join("|")}|`);
	for (const k of ["any15", "any25", "two15"]) {
		console.log(
			`| ${k} | ${names.map((n) => results[n].tails[k]).join(" | ")} |`,
		);
	}
	console.log(`\nn: ${names.map((n) => `${n} ${results[n].n}`).join(", ")}`);
};

const createLeague = async (expanded: boolean) => {
	Math.random = makeSeededRandom(5);
	await league.createStream({} as any, {
		confs: last(defaultGameAttributes.confs).value,
		divs: last(defaultGameAttributes.divs).value,
		fromFile: {
			gameAttributes: undefined,
			hasRookieContracts: true,
			maxGid: undefined,
			startingSeason: undefined,
			teams: undefined,
			version: LEAGUE_DATABASE_VERSION,
		},
		getLeagueOptions: undefined,
		keptKeys: new Set(),
		lid: 0,
		name: "subspread",
		setLeagueCreationStatus: () => {},
		settings: {
			...getDefaultSettings(),
			subRatings: true,
			subRatingsWide: false,
			expandedRatings: expanded,
		} as any,
		shuffleRosters: false,
		startingSeasonFromInput: "2025",
		teamsFromInput: helpers.addPopRank(helpers.getTeamsDefault()),
		tid: 0,
	});
	await league.loadGameAttributes();
};

const realRows = (wide: boolean, expanded: boolean, season = 2026) => {
	const d = JSON.parse(
		readFileSync(
			new URL(
				"../../../../data/real-player-data.basketball.json",
				import.meta.url,
			),
			"utf8",
		),
	);
	const rows: (Row & { slug: string; name: string })[] = [];
	for (const row of d.ratings) {
		if (row.season !== season) {
			continue;
		}
		const parsed = parseSubZ(row.subZ);
		const lean = wide
			? parsed
				? wideRealLean(
						SUB_DEFS.map((x) => x.key),
						parsed,
					)
				: undefined
			: parseSubLean(row.subLean);
		if (!lean || !parsed) {
			continue;
		}
		const r: Record<string, any> = { ...row };
		delete r.subLean;
		delete r.subZ;
		if (expanded) {
			Object.assign(
				r,
				deriveExpandedRatings(r, expandedRatingsSeed({ srID: row.slug })),
			);
			if (wide) {
				realShootingSplit(r, lean);
			}
		}
		const { sub } = realSubShape(r, seedFromString(row.slug), lean, wide);
		rows.push({ r, sub, slug: row.slug, name: d.bios[row.slug]?.name ?? "" });
	}
	return rows;
};

// Name@season: that season's row (the window of stats up to it)
export const FAMOUS = [
	"Kyle Korver@2015",
	"Ben Simmons@2019",
	"Stephen Curry@2016",
	"Giannis Antetokounmpo@2020",
	"Rudy Gobert@2022",
	"Russell Westbrook@2017",
	"DeMar DeRozan@2018",
];

// A famous player's subs as a real-players league gives them, in a season he's known for
const famous = (wide: boolean, expanded: boolean) => {
	const d = JSON.parse(
		readFileSync(
			new URL(
				"../../../../data/real-player-data.basketball.json",
				import.meta.url,
			),
			"utf8",
		),
	);
	const out: Record<string, string> = {};
	for (const entry of FAMOUS) {
		const [name, season] = entry.split("@");
		const slug = Object.keys(d.bios).find((k) => d.bios[k].name === name);
		const row = d.ratings.find(
			(r: any) => r.slug === slug && r.subZ && r.season === Number(season),
		);
		if (!row) {
			continue;
		}
		const parsed = parseSubZ(row.subZ)!;
		const lean = wide
			? wideRealLean(
					SUB_DEFS.map((x) => x.key),
					parsed,
				)
			: (parseSubLean(row.subLean) ?? new Array(NUM_SUBS).fill(0));
		const r: Record<string, any> = { ...row };
		if (expanded) {
			Object.assign(
				r,
				deriveExpandedRatings(r, expandedRatingsSeed({ srID: row.slug })),
			);
			if (wide) {
				realShootingSplit(r, lean);
			}
		}
		const { sub } = realSubShape(r, seedFromString(row.slug), lean, wide);
		out[`${name} ${row.season}`] = SUB_GROUPS.map(
			(gr) =>
				`${gr.base} ${r[gr.base]}: ${gr.idx
					.map((i) => {
						const o = sub[i]! - r[gr.base];
						return `${SUB_DEFS[i]!.label} ${sub[i]} (${o >= 0 ? "+" : ""}${o})`;
					})
					.join(", ")}`,
		).join("; ");
	}
	return out;
};

describe.skipIf(!env.SUB_SPREAD)("sub-ratings spread", () => {
	test("spread report", { timeout: 60 * 60 * 1000 }, async () => {
		const all: Record<string, any> = {};
		for (const expanded of [true, false]) {
			if (expanded && env.SUB_SPREAD_EXPANDED === "0") {
				continue;
			}
			if (!expanded && env.SUB_SPREAD_EXPANDED === "1") {
				continue;
			}
			const tag = expanded ? "expanded" : "stock ratings";
			await createLeague(expanded);
			const results: Record<string, any> = {};
			const matured: Record<string, any> = {};
			const lopsided: Record<string, number> = {};
			for (const wide of [false, true]) {
				g.setWithoutSavingToDB("subRatingsWide" as any, wide as any);
				Math.random = makeSeededRandom(11);
				const rows: Row[] = [];
				const rowsDev: Row[] = [];
				let lop = 0;
				let gen = 0;
				let spec = 0;
				for (let c = 0; c < CLASSES; c++) {
					const players = await draft.genPlayersWithoutSaving(
						g.get("season") + 1,
						DEFAULT_LEVEL,
						[],
					);
					assignClassSubs(players);
					for (const p of players) {
						const r = p.ratings[0] as any;
						rows.push({ r: { ...r }, sub: [...r.sub] });
						if (p.subP?.lop) {
							lop += 1;
						}
						if (p.subP?.gen) {
							gen += 1;
						}
						if (p.subP?.sp) {
							spec += 1;
						}
					}
					// Six seasons of development (the same random numbers both ways: seeded per class)
					const saved = Math.random;
					Math.random = makeSeededRandom(1000 + c);
					for (const p of players.slice(0, 40)) {
						await player.develop(p as any, 6, true, DEFAULT_LEVEL, true);
						const r = p.ratings.at(-1) as any;
						rowsDev.push({ r: { ...r }, sub: [...r.sub] });
					}
					Math.random = saved;
				}
				const key = wide ? "wide" : "stock";
				results[`prospects ${key}`] = measure(rows);
				matured[`after 6 seasons ${key}`] = measure(rowsDev);
				lopsided[key] = r1((100 * lop) / rows.length);
				console.log(
					`${tag} ${key}: lopsided ${r1((100 * lop) / rows.length)}%, generational ${r1(gen / CLASSES)} a class, specialists ${r1((100 * spec) / rows.length)}%`,
				);
			}
			const real = {
				"real 2026 stock": measure(realRows(false, expanded)),
				"real 2026 wide": measure(realRows(true, expanded)),
			};
			printTable(`Generated prospects (${tag})`, results);
			printTable(`After 6 seasons of development (${tag})`, matured);
			printTable(`Real players (${tag})`, real);
			const fam = {
				stock: famous(false, expanded),
				wide: famous(true, expanded),
			};
			console.log(`\n### Famous players (${tag})`);
			for (const name of Object.keys(fam.stock)) {
				console.log(
					`\n${name}\n  stock: ${fam.stock[name]}\n  wide:  ${fam.wide[name]}`,
				);
			}
			all[tag] = { results, matured, real, lopsided, famous: fam };
		}
		if (env.SUB_SPREAD_OUT) {
			writeFileSync(env.SUB_SPREAD_OUT, JSON.stringify(all, null, 1));
		}
	});
});
