import { afterAll, assert, test } from "vitest";
import GameSim from "./index.ts";
import loadTeams from "../game/loadTeams.ts";
import { player, team } from "../index.ts";
import { g, helpers } from "../../util/index.ts";
import { resetCache, resetG } from "../../../test/helpers.ts";
import { withSeededRandom } from "./simLiveGameForTests.ts";
import createRandomPlayers from "../league/create/createRandomPlayers.ts";
import { DEFAULT_LEVEL } from "../../../common/budgetLevels.ts";
import { COMPOSITE_WEIGHTS } from "../../../common/constants.basketball.ts";
import { compositeWeightsFor } from "../../../common/expandedRatings.ts";
import {
	flatSubs,
	isValidSubArray,
	SUB_INDEX,
} from "../../../common/subRatings.ts";
import { last, range } from "../../../common/utils.ts";
import { simFixCompositeWeights } from "./simSettings.ts";
import {
	CREATION_WEIGHTS,
	CREATION_WEIGHTS_EXPANDED,
} from "./spacingCreation.ts";
import {
	jumperGaps,
	SUB_SIM,
	SUB_SIM_CAL,
	subSimComposite,
	subSimPlayer,
	subSimTouches,
} from "./subRatingsSim.ts";

/*
 * Sub-Ratings in Sim (the subRatingsSim setting): the sub-ratings are folded into the composites at game load. With every sub at its
 * base, every composite is exactly what it was (and every game, but for the league calibration constants); a shape moves the composites it
 * should, within the bound.
 */

afterAll(() => {
	resetG();
});

const I = SUB_INDEX as Record<string, number>;

const BASE_KEYS = [
	"hgt",
	"stre",
	"spd",
	"jmp",
	"endu",
	"ins",
	"dnk",
	"ft",
	"fg",
	"tp",
	"oiq",
	"diq",
	"drb",
	"pss",
	"reb",
];

// A ratings row from a simple LCG (with or without the expanded ratings)
const makeRow = (seed: number, expanded: boolean): any => {
	let x = seed * 9301 + 49297;
	const rand = () => {
		x = (x * 9301 + 49297) % 233280;
		return x / 233280;
	};
	const r: any = {};
	for (const key of BASE_KEYS) {
		r[key] = Math.round(10 + 85 * rand());
	}
	if (expanded) {
		for (const key of ["wng", "pdef", "idef", "csh", "dsh", "bsc"]) {
			r[key] = Math.round(10 + 85 * rand());
		}
		r.oreb = r.reb;
		r.dreb = r.reb;
	}
	return r;
};

const variants = (expanded: boolean) => {
	const base = compositeWeightsFor(COMPOSITE_WEIGHTS, expanded);
	return [
		base,
		simFixCompositeWeights(base, expanded),
		{ creation: expanded ? CREATION_WEIGHTS_EXPANDED : CREATION_WEIGHTS },
	];
};

test("with every sub at its base, every composite is exactly the stock one", () => {
	for (const expanded of [false, true]) {
		for (let seed = 0; seed < 200; seed++) {
			const r = makeRow(seed, expanded);
			r.sub = flatSubs(r);
			const sp = subSimPlayer(r)!;
			for (const weights of variants(expanded)) {
				for (const [k, w] of Object.entries(weights)) {
					const stock = player.compositeRating(r, w.ratings, w.weights, false);
					assert.strictEqual(
						subSimComposite(sp, k, w.ratings, w.weights),
						stock,
						`${k} expanded ${expanded} seed ${seed}`,
					);
				}
				// The new finishing composites are the at-rim one
				const atRim = (weights as any).shootingAtRim;
				if (atRim) {
					const stock = player.compositeRating(
						r,
						atRim.ratings,
						atRim.weights,
						false,
					);
					for (const k of ["shootingAtRimMake", "shootingPutBack"]) {
						assert.strictEqual(
							subSimComposite(sp, k, atRim.ratings, atRim.weights),
							stock,
						);
					}
				}
			}
			const gaps = jumperGaps(sp, 0.07);
			assert.strictEqual(gaps.three, 0.07);
			assert.strictEqual(gaps.mid, 0.07);
		}
	}
});

test("a shape moves the composites it should, within the bound", () => {
	for (const expanded of [false, true]) {
		const weights = compositeWeightsFor(COMPOSITE_WEIGHTS, expanded);
		const r = makeRow(7, expanded);
		r.diq = 50;
		r.spd = 50;
		r.pss = 50;
		r.tp = 50;
		r.dnk = 50;
		r.jmp = 50;
		r.pdef = 50;
		r.idef = 50;
		const flat = { ...r, sub: flatSubs(r) };
		const shaped = { ...r, sub: [...flat.sub] };
		const s = shaped.sub;
		// A shot blocker who doesn't get steals, laterally quick, an off-the-dribble shooter, a contact finisher, a vision passer
		s[I.blk!]! += 12;
		s[I.stl!]! -= 12;
		s[I.lat!]! += 8;
		s[I.sls!]! -= 8;
		s[I.tod!]! += 10;
		s[I.tcs!]! -= 10;
		s[I.con!]! += 10;
		s[I.fns!]! -= 10;
		s[I.vis!]! += 10;
		s[I.acc!]! -= 10;
		const a = subSimPlayer(flat)!;
		const b = subSimPlayer(shaped)!;
		const c = (sp: typeof a, k: string) =>
			subSimComposite(sp, k, weights[k]!.ratings, weights[k]!.weights);
		assert.isAbove(c(b, "blocking"), c(a, "blocking"));
		assert.isBelow(c(b, "stealing"), c(a, "stealing"));
		assert.isAbove(c(b, "defensePerimeter"), c(a, "defensePerimeter"));
		assert.isBelow(c(b, "pace"), c(a, "pace"));
		assert.isAbove(c(b, "drawingFouls"), c(a, "drawingFouls"));
		assert.isAbove(c(b, "passing"), c(a, "passing"));
		// Worse pass accuracy: more of the turnovers
		assert.isAbove(c(b, "turnovers"), c(a, "turnovers"));
		assert.isBelow(jumperGaps(b, 0).three, jumperGaps(a, 0).three);
		if (!expanded) {
			assert.strictEqual(jumperGaps(b, 0).mid, jumperGaps(a, 0).mid);
		}
		const atRim = weights.shootingAtRim!;
		assert.isBelow(
			subSimComposite(b, "shootingAtRimMake", atRim.ratings, atRim.weights),
			subSimComposite(a, "shootingAtRimMake", atRim.ratings, atRim.weights),
		);

		// Bounded: an extreme sub moves its rating at most SUB_SIM.bound
		const extreme: any = { ...r, sub: [...flat.sub] };
		extreme.sub[I.blk!] = 100;
		extreme.diq = 20;
		extreme.idef = 20;
		const e = subSimPlayer(extreme)!;
		const key = expanded ? "idef" : "diq";
		const w = weights.blocking!;
		const moved = { ...extreme, [key]: extreme[key] + SUB_SIM.bound };
		assert.approximately(
			subSimComposite(e, "blocking", w.ratings, w.weights) -
				player.compositeRating(extreme, w.ratings, w.weights, false),
			player.compositeRating(moved, w.ratings, w.weights, false) -
				player.compositeRating(extreme, w.ratings, w.weights, false) +
				// (standing vertical moved too, by the fit of the flat row: nothing)
				0,
			1e-9,
		);
	}
	assert.isFalse(subSimTouches("shootingFT"));
	assert.isTrue(subSimTouches("shootingLowPostMake"));
});

const NUM_TEAMS = 4;

const genLeague = async () => {
	resetG();
	g.setWithoutSavingToDB("subRatings", true);
	g.setWithoutSavingToDB("expandedRatings", false);
	await resetCache({});
	const players: any[] = await createRandomPlayers({
		activeTids: range(NUM_TEAMS),
		onlyFreeAgents: false,
		scoutingLevel: DEFAULT_LEVEL,
		teams: range(NUM_TEAMS).map((tid) => ({ tid })),
	});
	for (const p of players) {
		const r = last(p.ratings) as { ovr: number };
		p.valueNoPot = r.ovr;
		p.valueNoPotFuzz = r.ovr;
		p.value = r.ovr;
		p.valueFuzz = r.ovr;
		if (
			p.tid >= 0 &&
			p.contractDemand &&
			!Number.isFinite(p.contractDemand.exp)
		) {
			p.contractDemand = {
				...p.contractDemand,
				exp: g.get("season") + 1,
				temp: undefined,
			};
		}
	}
	for (const tid of range(NUM_TEAMS)) {
		const roster = players
			.filter((p) => p.tid === tid)
			.sort((a, b) => b.valueNoPot - a.valueNoPot);
		for (const [i, p] of roster.entries()) {
			p.rosterOrder = i;
		}
	}
	const teamsDefault = helpers.getTeamsDefault().slice(0, NUM_TEAMS);
	await resetCache({
		players,
		teams: teamsDefault.map(team.generate),
		teamSeasons: teamsDefault.map((t) => team.genSeasonRow(t)),
		teamStats: teamsDefault.map((t) => team.genStatsRow(t.tid)),
	});
	return players;
};

const boxOf = (result: any) =>
	JSON.stringify(
		result.team.map((t: any) => ({
			stat: t.stat,
			players: t.player.map((p: any) => [p.id, p.stat]),
		})),
	);

const playOne = async (seed: number, subSim: boolean) => {
	let box = "";
	await withSeededRandom(seed, async () => {
		g.setWithoutSavingToDB("subRatingsSim", subSim);
		const teams = await loadTeams([0, 1], {});
		const sim = new GameSim({
			gid: seed,
			teams: [teams[0]!, teams[1]!],
			baseInjuryRate: g.get("injuryRate"),
			doPlayByPlay: false,
			homeCourtFactor: 1,
			allStarGame: false,
			neutralSite: false,
		});
		box = boxOf(sim.run());
	});
	return box;
};

test("games: flat subs play exactly like the setting off, shaped subs differ", async () => {
	const players = await withSeededRandom(5, genLeague);
	assert.isTrue(
		players.every(
			(p) => p.tid < 0 || isValidSubArray((last(p.ratings) as any).sub),
		),
		"generated players have sub-ratings",
	);
	for (const key of [
		"spacingCreation",
		"matchupDefense",
		"simFixes",
		"positionalComposites",
	]) {
		g.setWithoutSavingToDB(key as any, true);
	}
	for (const seed of [31, 32]) {
		const off = await playOne(seed, false);
		const on = await playOne(seed, true);
		assert.notStrictEqual(on, off, `seed ${seed}: shaped subs matter`);
	}
	// Flat subs
	const saved = new Map<any, any>();
	for (const p of players) {
		const r = last(p.ratings) as any;
		saved.set(r, r.sub);
		r.sub = flatSubs(r);
	}
	// ... every composite is the stock one, and the new numbers are what they replace
	g.setWithoutSavingToDB("subRatingsSim", false);
	const teamsOff = await loadTeams([0, 1], {});
	g.setWithoutSavingToDB("subRatingsSim", true);
	const teamsOn = await loadTeams([0, 1], {});
	for (const tid of [0, 1]) {
		for (const [i, pOff] of teamsOff[tid]!.player.entries()) {
			const pOn = teamsOn[tid]!.player[i]! as any;
			const a = pOff.compositeRating;
			const b = pOn.compositeRating;
			for (const k of Object.keys(a)) {
				assert.strictEqual(b[k], a[k], k);
			}
			assert.strictEqual(b.shootingAtRimMake, a.shootingAtRim);
			assert.strictEqual(b.shootingPutBack, a.shootingAtRim);
			assert.strictEqual(b.jumperGap3, 0);
			assert.strictEqual(b.jumperGapMid, 0);
			assert.strictEqual(pOn.simLat, pOn.simSpd);
		}
	}
	// ... and without the calibration constants, games are exactly the same
	const cal = { ...SUB_SIM_CAL };
	Object.assign(SUB_SIM_CAL, {
		three: 0,
		threeNoExpanded: 0,
		mid: 0,
		rim: 0,
		post: 0,
		foul: 1,
		blk: 1,
		stl: 1,
	});
	try {
		for (const seed of [31, 32]) {
			const off = await playOne(seed, false);
			const on = await playOne(seed, true);
			assert.strictEqual(on, off, `seed ${seed}: flat subs`);
		}
	} finally {
		Object.assign(SUB_SIM_CAL, cal);
	}
	// Sub-Ratings off: the setting does nothing
	for (const [r, sub] of saved) {
		r.sub = sub;
	}
	g.setWithoutSavingToDB("subRatings", false);
	const off = await playOne(33, false);
	const on = await playOne(33, true);
	assert.strictEqual(on, off, "needs Sub-Ratings");
}, 120_000);
