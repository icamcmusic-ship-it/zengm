// Headless multi-season league simulation for the rating inflation audit (docs/rating-inflation.md).
//
// Runs the real game engine (game sim, phases, draft, free agency, development, retirement, and every League extras
// hook) in memory, using the test cache (no IndexedDB), with Math.random replaced by a seeded generator. After every
// regular season it records league-wide rating and stats summaries.

import { PHASE, PLAYER } from "../../common/constants.ts";
import { DEFAULT_LEVEL } from "../../common/budgetLevels.ts";
import { nativeFeatureNewLeagueDefaults } from "../../common/nativeFeatures.ts";
import { mockIDBLeague, resetCache, resetG } from "../../test/helpers.ts";
import { idb } from "../../worker/db/index.ts";
import { getCurrentContract } from "../../common/contracts.ts";
import { g, helpers, local } from "../../worker/util/index.ts";
import {
	draft,
	finances,
	freeAgents,
	player,
	team,
} from "../../worker/core/index.ts";
import {
	addContract,
	createContract,
} from "../../worker/core/contract/index.ts";
import createRandomPlayers from "../../worker/core/league/create/createRandomPlayers.ts";
import addDraftProspects from "../../worker/core/league/create/addDraftProspects.ts";
import { ensureStaff } from "../../worker/core/staff/index.ts";
import { startAutoPlay } from "../../worker/core/league/autoPlay.ts";

// Settings of an existing league (every new feature at its existing-league default, i.e. upstream behaviour)
export const OFF: Record<string, unknown> = {
	coachingStaff: false,
	injuryDepth: false,
	playerTraits: false,
	realisticPossessions: false,
	technicalFouls: false,
	generateCollegeStats: false,
	rerandomizeDraftClassRatings: false,
	scoutingSystem: false,
	featureAiDraftNeeds: false,
	featureUnretire: false,
	featureHoldouts: false,
	featureAiTradeOffers: false,
	aiTradesNeedBased: false,
	contractOptions: false,
	contractExtensions: false,
	tradeRequests: false,
};

// New-league defaults, plus the two rating-touching extras that are opt-in even for new leagues
export const ALL_ON: Record<string, unknown> = {
	...nativeFeatureNewLeagueDefaults(),
	coachingStaff: true,
	injuryDepth: true,
	playerTraits: true,
	realisticPossessions: true,
	technicalFouls: true,
	generateCollegeStats: true,
	featureCollegeStats: true,
	rerandomizeDraftClassRatings: true,
	scoutingSystem: true,
	featureAiDraftNeeds: true,
	featureUnretire: true,
	featureHoldouts: true,
	featureAiTradeOffers: true,
	aiTradesNeedBased: true,
	contractOptions: true,
	contractExtensions: true,
	tradeRequests: true,
};

export const mulberry32 = (seed: number) => {
	let a = seed >>> 0;
	return () => {
		a = (a + 0x6d2b79f5) >>> 0;
		let t = a;
		t = Math.imul(t ^ (t >>> 15), t | 1);
		t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
		return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
	};
};

export type SeasonSummary = Record<string, number | string>;

const mean = (xs: number[]) =>
	xs.length === 0 ? Number.NaN : xs.reduce((a, b) => a + b, 0) / xs.length;
const sd = (xs: number[]) => {
	const m = mean(xs);
	return Math.sqrt(mean(xs.map((x) => (x - m) ** 2)));
};
const r2 = (x: number) => Math.round(x * 100) / 100;

export const summarize = async (
	config: string,
	seed: number,
): Promise<SeasonSummary> => {
	const season = g.get("season");
	const players = await idb.cache.players.indexGetAll("playersByTid", [
		0,
		Infinity,
	]);
	const rows = players.map((p) => {
		const r = p.ratings.at(-1)!;
		return { ovr: r.ovr, pot: r.pot, age: season - p.born.year, tid: p.tid };
	});
	const ovrs = rows.map((r) => r.ovr).sort((a, b) => b - a);
	const pots = rows.map((r) => r.pot);

	// Rookies: this season's draft class, now on teams
	const rookies = players.filter((p) => p.draft.year === season - 1);
	const rookieOvr = rookies.map((p) => p.ratings.at(-1)!.ovr);
	const rookiePot = rookies.map((p) => p.ratings.at(-1)!.pot);

	// Upcoming class, as prospects
	const prospects = await idb.cache.players.indexGetAll(
		"playersByTid",
		PLAYER.UNDRAFTED,
	);
	const nextClass = prospects.filter((p) => p.draft.year === season);
	const nextTop30 = nextClass
		.map((p) => p.ratings.at(-1)!.ovr)
		.sort((a, b) => b - a)
		.slice(0, 30);

	const byAge = (lo: number, hi: number) =>
		r2(mean(rows.filter((r) => r.age >= lo && r.age <= hi).map((r) => r.ovr)));

	// Team ovr spread
	const teamOvrs: number[] = [];
	const tids = [...new Set(rows.map((r) => r.tid))];
	for (const tid of tids) {
		const sorted = players
			.filter((p) => p.tid === tid)
			.map((p) => ({
				ratings: { ovr: p.ratings.at(-1)!.ovr, pos: p.ratings.at(-1)!.pos },
			}))
			.sort((a, b) => b.ratings.ovr - a.ratings.ovr);
		teamOvrs.push(team.ovr(sorted as any));
	}

	// Stats of the season just played (regular season)
	const teamStats = (await idb.cache.teamStats.getAll()).filter(
		(ts) => ts.season === season && !ts.playoffs,
	);
	let pts = 0;
	let gp = 0;
	let fg = 0;
	let fga = 0;
	let tp = 0;
	let tpa = 0;
	let poss = 0;
	for (const ts of teamStats as any[]) {
		pts += ts.pts;
		gp += ts.gp;
		fg += ts.fg;
		fga += ts.fga;
		tp += ts.tp;
		tpa += ts.tpa;
		poss += ts.fga - ts.orb + ts.tov + 0.44 * ts.fta;
	}

	// MVP ovr
	let mvpOvr = Number.NaN;
	const awardsRow: any = await idb.cache.awards.get(season);
	const mvpPid = awardsRow?.awards?.find((a: any) => a.actAs === "mvp")
		?.winner?.[0]?.pid;
	if (mvpPid !== undefined) {
		const p = await idb.cache.players.get(mvpPid);
		mvpOvr = p?.ratings.find((r) => r.season === season)?.ovr ?? Number.NaN;
	}

	// Coaching levels (budget.coaching follows the staff when it's on)
	const teams = await idb.cache.teams.getAll();
	const coaching: number[] = [];
	for (const t of teams) {
		if (!t.disabled) {
			coaching.push(
				await finances.getLevelLastThree("coaching", { tid: t.tid }),
			);
		}
	}

	let numInjuries = 0;
	let numRatingsLoss = 0;
	for (const p of players) {
		for (const inj of p.injuries) {
			if (inj.season === season) {
				numInjuries += 1;
				if (inj.ovrDrop !== undefined) {
					numRatingsLoss += 1;
				}
			}
		}
	}

	return {
		config,
		seed,
		season,
		n: rows.length,
		ovrMean: r2(mean(ovrs)),
		ovrSd: r2(sd(ovrs)),
		potMean: r2(mean(pots)),
		potSd: r2(sd(pots)),
		top10: r2(mean(ovrs.slice(0, 10))),
		top50: r2(mean(ovrs.slice(0, 50))),
		max: ovrs[0] ?? Number.NaN,
		mvpOvr,
		n70: ovrs.filter((x) => x >= 70).length,
		n75: ovrs.filter((x) => x >= 75).length,
		n80: ovrs.filter((x) => x >= 80).length,
		rookieN: rookieOvr.length,
		rookieOvr: r2(mean(rookieOvr)),
		rookiePot: r2(mean(rookiePot)),
		nextClassTop30: r2(mean(nextTop30)),
		age19_22: byAge(19, 22),
		age23_26: byAge(23, 26),
		age27_30: byAge(27, 30),
		age31_34: byAge(31, 34),
		age35p: byAge(35, 50),
		meanAge: r2(mean(rows.map((r) => r.age))),
		teamOvrSd: r2(sd(teamOvrs)),
		teamOvrMean: r2(mean(teamOvrs)),
		coachingMean: r2(mean(coaching)),
		coachingSd: r2(sd(coaching)),
		injuries: numInjuries,
		ratingsLossInjuries: numRatingsLoss,
		ptsPerGame: gp > 0 ? r2(pts / gp) : Number.NaN,
		fgPct: fga > 0 ? r2((100 * fg) / fga) : Number.NaN,
		tpPct: tpa > 0 ? r2((100 * tp) / tpa) : Number.NaN,
		tpaPerGame: gp > 0 ? r2(tpa / gp) : Number.NaN,
		possPerGame: gp > 0 ? r2(poss / gp) : Number.NaN,
	};
};

export const createLeague = async (settings: Record<string, unknown>) => {
	resetG();
	idb.league = mockIDBLeague();
	Object.assign(g, OFF, settings, {
		lid: 0,
		phase: PHASE.PRESEASON,
		userTid: 0,
		userTids: [0],
		spectator: true,
		saveOldBoxScores: { pastSeasons: 0, pastSeasonsType: "all", note: "none" },
		storePlayByPlay: false,
		pbpStore: "none",
		playerTraitsSeed: 12345,
	});

	const teams = helpers_getTeams();
	await resetCache({ teams });
	for (const t of teams) {
		await idb.cache.teamSeasons.add(team.genSeasonRow(t));
		await idb.cache.teamStats.add(team.genStatsRow(t.tid));
	}

	const activeTids = teams.map((t) => t.tid);
	const players = await createRandomPlayers({
		activeTids,
		onlyFreeAgents: false,
		scoutingLevel: DEFAULT_LEVEL,
		teams,
	});
	await addDraftProspects({ players, scoutingLevel: DEFAULT_LEVEL });
	await idb.cache.players.addAll(players as any);

	const all = await idb.cache.players.getAll();
	for (const p of all) {
		// Basketball only (the audit runs in the basketball test project)
		player.ensureTraits(p as any);
		await player.updateValues(p);
	}

	// Like finalizeActivePlayers in createStream.ts
	const finalizeContract = (p: any) => {
		if (p.contractDemand) {
			delete p.contractDemand.temp;
		}
		if (p.tid >= 0 && p.contractDemand) {
			addContract(
				p,
				createContract({
					contract: p.contractDemand,
					type: p.contractDemand.rookie ? "rookie" : "unknown",
				}),
			);
		}
	};
	for (const p of all) {
		if (!p.contractDemand?.temp) {
			finalizeContract(p);
		}
	}
	await freeAgents.normalizeContractDemands({
		type: "newLeague",
		pids: all.filter((p) => p.contractDemand?.temp).map((p) => p.pid),
	});
	for (const p of await idb.cache.players.getAll()) {
		if (!getCurrentContract(p) && p.tid >= 0) {
			finalizeContract(p);
		} else if (p.contractDemand?.temp) {
			delete p.contractDemand.temp;
		}
		await idb.cache.players.put(p);
	}
	for (const tid of activeTids) {
		await team.rosterAutoSort(tid);
	}
	await draft.genPicks({});
	await draft.processNewDraftClasses();
	await ensureStaff();
};

// Population ranks as in a new random league, so default budget levels spread like they do there
const helpers_getTeams = () =>
	helpers
		.getTeamsDefault()
		.map((t, i) =>
			team.generate({ ...t, popRank: (t as any).popRank ?? i + 1 }),
		);

export const runLeague = async ({
	config,
	settings,
	seed,
	seasons,
	onSeason,
}: {
	config: string;
	settings: Record<string, unknown>;
	seed: number;
	seasons: number;
	onSeason?: (s: SeasonSummary) => void;
}) => {
	// The full engine reads the meta database (scheduled events), so it needs an IndexedDB. Only installed here, so that
	// importing this file (from skipped script tests too) doesn't change the globals other tests see.
	const { indexedDB } = await import("fake-indexeddb");
	globalThis.indexedDB ??= indexedDB;
	const origRandom = Math.random;
	Math.random = mulberry32(seed);
	try {
		await createLeague(settings);
		const out: SeasonSummary[] = [];
		for (let i = 0; i < seasons; i++) {
			// Summarize at the end of the regular season + playoffs, i.e. right before the next preseason
			const target = g.get("season") + 1;
			await startAutoPlay(g.get("season"), PHASE.DRAFT_LOTTERY, {});
			const s = await summarize(config, seed);
			out.push(s);
			onSeason?.(s);
			await startAutoPlay(target, PHASE.PRESEASON, {});
		}
		return out;
	} finally {
		Math.random = origRandom;
		local.autoPlayUntil = undefined;
	}
};
