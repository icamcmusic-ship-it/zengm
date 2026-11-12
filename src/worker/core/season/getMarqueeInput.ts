// Marquee Games: what the schedule builder needs to know about the league before the regular season (marqueeSchedule.ts): how much
// each team draws (its strength, hype and market), last season's champion and the rivalries
import { idb } from "../../db/index.ts";
import { g } from "../../util/index.ts";
import { loadRivalries } from "../../util/rivalries.ts";
import { player, team } from "../index.ts";
import type { MarqueeInput } from "./marqueeSchedule.ts";

// Weights of the team's draw: strength (rank of team ovr), hype, market size (rank of population)
const DRAW_OVR = 0.55;
const DRAW_HYPE = 0.3;
const DRAW_POP = 0.15;

const percentile = (values: Map<number, number>) => {
	const sorted = [...values.entries()].sort((a, b) => a[1] - b[1]);
	const out = new Map<number, number>();
	const n = sorted.length;
	for (const [i, [tid]] of sorted.entries()) {
		out.set(tid, n > 1 ? i / (n - 1) : 0.5);
	}
	return out;
};

const getMarqueeInput = async (tids: number[]): Promise<MarqueeInput> => {
	const season = g.get("season");

	const ovrs = new Map<number, number>();
	const hypes = new Map<number, number>();
	const pops = new Map<number, number>();
	const groups = new Map<number, { cid: number; did: number }>();
	for (const tid of tids) {
		const players = await idb.cache.players.indexGetAll("playersByTid", tid);
		ovrs.set(
			tid,
			team.ovr(
				players.map((p) => {
					const r = p.ratings.at(-1)!;
					return {
						injury: p.injury,
						value: p.value,
						ratings: {
							ovr: player.fuzzRating(r.ovr, r.fuzz),
							pos: r.pos,
						},
					};
				}),
			),
		);
		const teamSeason = await idb.cache.teamSeasons.indexGet(
			"teamSeasonsByTidSeason",
			[tid, season],
		);
		hypes.set(tid, teamSeason?.hype ?? 0.5);
		if (teamSeason) {
			groups.set(tid, { cid: teamSeason.cid, did: teamSeason.did });
		}
		pops.set(tid, teamSeason?.pop ?? 0);
	}
	const ovrPct = percentile(ovrs);
	const popPct = percentile(pops);

	const teams = await idb.cache.teams.getAll();
	const regions = new Map(teams.map((t) => [t.tid, t.region]));

	// Last season's champion: the team that won every playoff round
	let champion: number | undefined;
	if (season > g.get("startingSeason")) {
		const numRounds = g.get("numGamesPlayoffSeries", season - 1).length;
		for (const tid of tids) {
			const teamSeason = await idb.cache.teamSeasons.indexGet(
				"teamSeasonsByTidSeason",
				[tid, season - 1],
			);
			if (teamSeason && teamSeason.playoffRoundsWon >= numRounds) {
				champion = tid;
			}
		}
	}

	const tidSet = new Set(tids);
	const rivalries = (await loadRivalries(season, { storedGames: false }))
		.filter((pair) => tidSet.has(pair.a) && tidSet.has(pair.b))
		.map((pair) => ({ a: pair.a, b: pair.b, score: pair.score.score }));

	// Pairs with no history yet (a new league, a new team) still have the rivalry score's geography part
	const known = new Set(rivalries.map((pair) => `${pair.a}-${pair.b}`));
	for (const a of tids) {
		for (const b of tids) {
			const ga = groups.get(a);
			const gb = groups.get(b);
			if (a >= b || !ga || !gb || known.has(`${a}-${b}`)) {
				continue;
			}
			const score = ga.cid === gb.cid ? (ga.did === gb.did ? 3 : 1) : 0;
			if (score > 0) {
				rivalries.push({ a, b, score });
			}
		}
	}

	return {
		teams: tids.map((tid) => ({
			tid,
			draw:
				DRAW_OVR * ovrPct.get(tid)! +
				DRAW_HYPE * hypes.get(tid)! +
				DRAW_POP * popPct.get(tid)!,
			region: regions.get(tid),
		})),
		champion,
		rivalries,
	};
};

export default getMarqueeInput;
