// Sub-ratings step 2: real players' shapes from their stats (tools/realSubRatings.ts, stored as `subLean` in the real players data),
// scouting fuzz on subs, scouting report grades, the combine, skill badge drivers and college stats reading the subs.
import "fake-indexeddb/auto";
import { readFileSync, writeFileSync } from "node:fs";
import { env } from "node:process";
import { assert, describe, test } from "vitest";
import { LEAGUE_DATABASE_VERSION, PLAYER } from "../../../common/constants.ts";
import { defaultGameAttributes } from "../../../common/defaultGameAttributes.ts";
import { last } from "../../../common/utils.ts";
import {
	NUM_SUBS,
	SUB_DEFS,
	SUB_INDEX,
	fitSubsToBases,
	subOffsets,
	subsMatchBases,
} from "../../../common/subRatings.ts";
import { parseSubLean, realSubShape } from "../../../common/subRatingsGen.ts";
import { categoryScores } from "../../../common/scoutingReports/categories.ts";
import { generateDraftCombine } from "../../../common/draftCombine.ts";
import { badgeDriver } from "../../../common/skillBadges/subDrivers.ts";
import { generateCollegeClass } from "../../../common/collegeStats/index.ts";
import { Rng } from "../../../common/collegeStats/rng.ts";
import {
	RATING_KEYS,
	type CollegeProspect,
} from "../../../common/collegeStats/types.ts";
import { league } from "../index.ts";
import { idb } from "../../db/index.ts";
import { g, helpers } from "../../util/index.ts";
import { getDefaultSettings } from "../../views/newLeague.ts";
import { resetG } from "../../../test/helpers.ts";
import { ensureSubs, fuzzSubs } from "./subRatings.ts";
import updateSubRatingsForLeague from "./updateSubRatingsForLeague.ts";

const data = JSON.parse(
	readFileSync("data/real-player-data.basketball.json", "utf8"),
);
const rowOf = (slug: string, season: number) =>
	data.ratings.find((r: any) => r.slug === slug && r.season === season);
const off = (sub: number[], r: any, key: string) =>
	sub[SUB_INDEX[key]!]! - r[SUB_DEFS[SUB_INDEX[key]!]!.base];

describe("real players' shapes from their stats", () => {
	const shape = (slug: string, season = 2026) => {
		const r = { ...rowOf(slug, season) };
		const lean = parseSubLean(r.subLean);
		assert.isDefined(lean, slug);
		const { sub, info } = realSubShape(r, 1, lean!);
		r.sub = sub;
		assert.strictEqual(info.rs, 1);
		// Every base exact
		assert.isTrue(subsMatchBases(r), slug);
		return { r, sub };
	};

	test("famous players lean the right way", () => {
		const gobert = shape("goberru01");
		assert.isAbove(
			off(gobert.sub, gobert.r, "blk"),
			off(gobert.sub, gobert.r, "stl") + 10,
		);
		const wemby = shape("wembavi01");
		assert.isAbove(off(wemby.sub, wemby.r, "blk"), 8);
		const curry = shape("curryst01");
		assert.isAbove(
			off(curry.sub, curry.r, "tod"),
			off(curry.sub, curry.r, "tcs"),
		);
		const luka = shape("doncilu01");
		assert.isAbove(off(luka.sub, luka.r, "hnd"), 0);
		assert.isAbove(off(luka.sub, luka.r, "vis"), 0);
		const capela = shape("capelca01");
		assert.isAbove(
			off(capela.sub, capela.r, "orb"),
			off(capela.sub, capela.r, "drd"),
		);
	});

	test("rows without stats have no lean", () => {
		const withLean = data.ratings.filter((r: any) => r.subLean).length;
		assert.isAbove(withLean, 20000);
		for (const r of data.ratings.slice(0, 2000)) {
			if (r.subLean !== undefined) {
				assert.isDefined(parseSubLean(r.subLean));
			}
		}
		assert.isUndefined(parseSubLean("1,2,3"));
		assert.isUndefined(parseSubLean(undefined));
	});

	test("ensureSubs reads a lean once, and the lean replaces a neutral shape given before", () => {
		resetG();
		g.setWithoutSavingToDB("subRatings", true);
		const r = { ...rowOf("goberru01", 2026) };
		const lean = r.subLean;
		delete r.subLean;
		const p: any = {
			pid: 5,
			firstName: "R",
			lastName: "G",
			born: { year: 1992, loc: "France" },
			draft: { year: 2013 },
			tid: 0,
			ratings: [r],
		};
		// Neutral first (no lean known yet)
		ensureSubs(p);
		assert.strictEqual(p.subP.n, 1);
		assert.isUndefined(p.subP.rs);
		const neutral = [...r.sub];
		p.subLean = lean;
		assert.isTrue(ensureSubs(p));
		assert.strictEqual(p.subP.rs, 1);
		assert.isUndefined(p.subLean);
		assert.notDeepEqual(r.sub, neutral);
		assert.isTrue(subsMatchBases(r));
		// Nothing more to do
		assert.isFalse(ensureSubs(p));
	});
});

describe("scouting fuzz on subs", () => {
	test("deterministic, scales with the row's fuzz, narrower for combine-measured subs", () => {
		resetG();
		g.setWithoutSavingToDB("userTids", [0]);
		g.setWithoutSavingToDB("godMode", false);
		const sub = new Array(NUM_SUBS).fill(50);
		const a = fuzzSubs(sub, 4);
		assert.deepStrictEqual(a, fuzzSubs(sub, 4));
		assert.deepStrictEqual(fuzzSubs(sub, 0), sub);
		// Not all subs shifted the same way: the shape is uncertain too
		assert.isAbove(new Set(a).size, 3);
		const spread = (x: number[]) =>
			x.reduce((s, v) => s + Math.abs(v - 50), 0) / x.length;
		assert.isBelow(spread(fuzzSubs(sub, 1)), spread(fuzzSubs(sub, 6)));
		const measured = fuzzSubs(sub, 6, { combine: {} });
		for (const k of ["stj", "mxv", "lat", "blk"]) {
			const i = SUB_INDEX[k]!;
			assert.isAtMost(
				Math.abs(measured[i]! - 50),
				Math.abs(fuzzSubs(sub, 6)[i]! - 50),
			);
		}
		// God Mode: no fuzz
		g.setWithoutSavingToDB("godMode", true);
		assert.deepStrictEqual(fuzzSubs(sub, 6), sub);
	});
});

const ratingsRow = (over: Record<string, number> = {}) => ({
	hgt: 60,
	stre: 55,
	spd: 50,
	jmp: 55,
	endu: 50,
	ins: 50,
	dnk: 55,
	ft: 50,
	fg: 50,
	tp: 45,
	oiq: 50,
	diq: 55,
	drb: 45,
	pss: 45,
	reb: 55,
	...over,
});
const withSubs = (r: any, offsets: Record<string, number>) => ({
	...r,
	sub: fitSubsToBases(
		SUB_DEFS.map((d) => r[d.base] + (offsets[d.key] ?? 0)),
		r,
	),
});

describe("scouting report grades read subs", () => {
	test("a shot blocker grades as an interior defender, a pickpocket as a perimeter one, from the same Defense", () => {
		const base = ratingsRow();
		const rim = withSubs(base, { blk: 15, stl: -10, idf: 5, pdf: -8 });
		const perim = withSubs(base, { blk: -10, stl: 15, idf: -8, pdf: 5 });
		const s = (r: any) =>
			categoryScores({
				ratings: { ...r, ovr: 50, pot: 50 },
				production: undefined,
				group: "big",
			});
		assert.isAbove(s(rim).id, s(perim).id);
		assert.isAbove(s(perim).pd, s(rim).pd);
		// Without subs: as before
		const plain = s(base);
		const plain2 = categoryScores({
			ratings: { ...base, ovr: 50, pot: 50 } as any,
			production: undefined,
			group: "big",
		});
		assert.deepStrictEqual(plain, plain2);
	});
});

describe("draft combine reads subs", () => {
	test("max vertical and lateral quickness move the drills; without subs nothing changes", () => {
		const input = (extra: Record<string, number>) => ({
			pid: 3,
			season: 2030,
			heightInches: 79,
			weight: 210,
			rank: 20,
			injured: false,
			ratings: { ...ratingsRow(), ...extra },
		});
		const plain = generateDraftCombine(input({}) as any);
		const flat = generateDraftCombine(
			input({ stj: 55, mxv: 55, lat: 50, sls: 50 }) as any,
		);
		assert.deepStrictEqual(plain, flat);
		const leaper = generateDraftCombine(
			input({ stj: 45, mxv: 65, lat: 62, sls: 38 }) as any,
		);
		assert.isAbove(leaper.drills.maxVert!, plain.drills.maxVert!);
		assert.isBelow(leaper.drills.laneAgility!, plain.drills.laneAgility!);
	});
});

describe("skill badge drivers", () => {
	test("the best of a badge's subs", () => {
		const r = withSubs(ratingsRow(), { blk: 14, stl: -8 });
		const d = badgeDriver("Bk", r.sub);
		assert.strictEqual(d?.key, "blk");
		assert.strictEqual(d?.name, "Shot Blocking");
		assert.strictEqual(badgeDriver("Di", r.sub)?.key, "blk");
		assert.isUndefined(badgeDriver("Bk", undefined));
		// Every badge has at least one sub (or none, for badges with no sub-rated base)
		assert.isDefined(badgeDriver("3", r.sub));
		assert.isDefined(badgeDriver("Ps", r.sub));
	});
});

// A class of prospects with random shapes
const makeProspects = (n: number, withShapes: boolean): CollegeProspect[] => {
	const rng = new Rng("subs-college");
	return Array.from({ length: n }, (_, i) => {
		const talent = rng.normal(0, 1);
		const ratings: any = {};
		for (const key of RATING_KEYS) {
			ratings[key] = Math.round(
				Math.max(5, Math.min(95, 40 + 8 * talent + 8 * rng.normal(0, 1))),
			);
		}
		ratings.hgt = Math.round(
			Math.max(5, Math.min(95, 50 + 18 * rng.normal(0, 1))),
		);
		const offsets = SUB_DEFS.map(() => 8 * rng.normal(0, 1));
		if (withShapes) {
			const sub = fitSubsToBases(
				SUB_DEFS.map((d, j) => ratings[d.base] + offsets[j]!),
				ratings,
			);
			ratings.subOff = subOffsets(sub, ratings);
		}
		return {
			key: String(i),
			age: [19, 20, 21, 22][i % 4]!,
			ovr: Math.round(44 + 7 * talent),
			pot: Math.round(55 + 7 * talent),
			pos: ratings.hgt > 62 ? "C" : ratings.hgt > 45 ? "SF" : "PG",
			ratings,
			college: ["Duke", "Kansas", "Gonzaga", "Albany"][i % 4]!,
			bornLoc: "Chicago, IL, USA",
		};
	});
};

const corr = (x: number[], y: number[]) => {
	const n = x.length;
	const mx = x.reduce((a, b) => a + b, 0) / n;
	const my = y.reduce((a, b) => a + b, 0) / n;
	let sxy = 0;
	let sxx = 0;
	let syy = 0;
	for (let i = 0; i < n; i++) {
		sxy += (x[i]! - mx) * (y[i]! - my);
		sxx += (x[i]! - mx) ** 2;
		syy += (y[i]! - my) ** 2;
	}
	return sxy / Math.sqrt(sxx * syy);
};

describe("college stats read subs", () => {
	test("flat subs change nothing; shaped subs move production toward them", () => {
		const plain = makeProspects(300, false);
		const flat = plain.map((p) => ({
			...p,
			ratings: {
				...p.ratings,
				subOff: SUB_DEFS.map(() => 0),
			},
		}));
		const opts = { seed: "s", draftYear: 2030 };
		const a = generateCollegeClass(plain, opts);
		const b = generateCollegeClass(flat, opts);
		const strip = (x: any) => JSON.stringify(x.map((y: any) => y.seasons));
		// Flat subs (every sub at its base): exactly the base-only stats
		assert.strictEqual(strip(a), strip(b));

		const shaped = makeProspects(300, true);
		const c = generateCollegeClass(shaped, opts);
		const unshaped = generateCollegeClass(makeProspects(300, false), opts);
		const report: string[] = [];
		const STATS: [string, string, string][] = [
			["blk", "diq", "blk"],
			["stl", "diq", "stl"],
			["vis", "pss", "ast"],
			["sec", "drb", "tov"],
			["rng", "tp", "tpa"],
			["orb", "reb", "orb"],
		];
		for (const [key, base, stat] of STATS) {
			const xs: number[] = [];
			const yOn: number[] = [];
			const yOff: number[] = [];
			shaped.forEach((p, i) => {
				const last1 = c[i]!.seasons.at(-1);
				const last0 = unshaped[i]!.seasons.at(-1);
				if (!last1 || !last0 || !last1.stats.min || !last0.stats.min) {
					return;
				}
				xs.push((p.ratings as any).subOff[SUB_INDEX[key]!]);
				yOn.push(last1.stats[stat]! / last1.stats.min);
				yOff.push(last0.stats[stat]! / last0.stats.min);
			});
			const on = corr(xs, yOn);
			const offC = corr(xs, yOff);
			report.push(
				`${key} -> ${stat} per min: corr ${offC.toFixed(2)} (subs off) -> ${on.toFixed(2)} (subs on)`,
			);
			if (key === "sec") {
				assert.isBelow(on, offC);
			} else {
				assert.isAbove(on, offC);
			}
		}
		if (env.SUB_REPORT) {
			writeFileSync(env.SUB_REPORT, report.join("\n"));
		}
	});
});

describe("real players in a league", () => {
	test(
		"a real player's shape is read from the real players data; with the setting off, nothing is stored",
		{
			timeout: 120_000,
		},
		async () => {
			const create = async (subRatings: boolean) => {
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
					keptKeys: new Set() as any,
					lid: 0,
					name: "subs",
					setLeagueCreationStatus: () => {},
					settings: { ...getDefaultSettings(), subRatings } as any,
					shuffleRosters: false,
					startingSeasonFromInput: "2026",
					teamsFromInput: helpers.addPopRank(helpers.getTeamsDefault()),
					tid: 0,
				});
				await league.loadGameAttributes();
			};
			await create(true);
			const players = await idb.cache.players.indexGetAll("playersByTid", [
				0,
				Infinity,
			]);
			const p: any = players[0];
			p.real = true;
			p.srID = "goberru01";
			delete p.subP;
			await idb.cache.players.put(p);
			await updateSubRatingsForLeague();
			assert.strictEqual(p.subP.rs, 1);
			assert.isUndefined(p.subLean);
			const r = p.ratings.at(-1);
			assert.isTrue(subsMatchBases(r));
			const lean = parseSubLean(rowOf("goberru01", 2026).subLean)!;
			const expected = realSubShape(r, 0, lean).sub;
			assert.deepStrictEqual(
				subOffsets(r.sub, r).map(Math.sign),
				subOffsets(expected, r).map(Math.sign),
			);
			// A real player with no stats keeps a neutral shape and isn't looked up again
			const q: any = players[1];
			q.real = true;
			q.srID = "nobody00";
			delete q.subP;
			await updateSubRatingsForLeague();
			assert.strictEqual(q.subP.rs, 0);
			assert.strictEqual(q.subP.n, 1);

			// Off: an unread lean is dropped, nothing else
			await create(false);
			const p2: any = (
				await idb.cache.players.indexGetAll("playersByTid", [0, Infinity])
			)[0];
			p2.subLean = "1";
			await updateSubRatingsForLeague();
			assert.isUndefined(p2.subLean);
			assert.isUndefined(p2.subP);
			assert.notStrictEqual(p2.tid, PLAYER.RETIRED);
		},
	);
});
