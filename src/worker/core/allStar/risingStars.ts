// Rising Stars game (the allStarRisingStars setting, basketball): first-year players against second-year players, the night
// before the All-Star Game. Picked by this season's play (win shares and EWA, scoring, games played). If either class can't
// field a team, the best of both are mixed into two even teams instead. Played with the All-Star sim on its own seeded stream
// (exhibition.ts), with its own box score and MVP; nothing goes into the players' stats.
import type {
	AllStarPlayer,
	AllStars,
	Conditions,
	Player,
} from "../../../common/types.ts";
import { orderBy } from "../../../common/utils.ts";
import { idb } from "../../db/index.ts";
import { g } from "../../util/index.ts";
import { updatePlayerAwards } from "../awards/awardsByPlayer.ts";
import { simExhibition } from "./exhibition.ts";

export const RISING_STARS_PER_TEAM = 10;

type RisingStars = NonNullable<AllStars["risingStars"]>;

const seasonValue = (p: Player, season: number) => {
	let gp = 0;
	let pts = 0;
	let value = 0;
	for (const row of p.stats) {
		if (row.season === season && !row.playoffs) {
			gp += row.gp ?? 0;
			pts += row.pts ?? 0;
			value += 2.5 * (row.ewa ?? 0) + (row.ows ?? 0) + (row.dws ?? 0);
		}
	}
	return { gp, value: value + 0.1 * pts };
};

// Years in the league this season: 1 for a rookie, 2 for a sophomore
const yearsIn = (p: Player, season: number) => season - p.draft.year;

export const pickRisingStars = (
	activePlayers: Player[],
	season: number,
): RisingStars | undefined => {
	const numPlayersOnCourt = g.get("numPlayersOnCourt");
	const perTeam = Math.max(
		numPlayersOnCourt,
		Math.min(RISING_STARS_PER_TEAM, g.get("allStarNum")),
	);
	const score = new Map(
		activePlayers.map((p) => [p.pid, seasonValue(p, season)]),
	);
	const pool = activePlayers.filter(
		(p) =>
			p.injury.gamesRemaining === 0 &&
			(yearsIn(p, season) === 1 || yearsIn(p, season) === 2) &&
			// Anyone who's played, or anyone at all before the first game
			(score.get(p.pid)!.gp > 0 ||
				activePlayers.every((p2) => score.get(p2.pid)!.gp === 0)),
	);
	const ranked = orderBy(
		pool,
		[(p) => score.get(p.pid)!.value, (p) => p.pid],
		["desc", "asc"],
	);
	const entry = (p: Player): AllStarPlayer => ({
		pid: p.pid,
		tid: p.tid,
		name: `${p.firstName} ${p.lastName}`,
	});

	const rookies = ranked.filter((p) => yearsIn(p, season) === 1);
	const sophomores = ranked.filter((p) => yearsIn(p, season) === 2);
	if (
		rookies.length >= numPlayersOnCourt + 2 &&
		sophomores.length >= numPlayersOnCourt + 2
	) {
		return {
			teamNames: ["Rookies", "Sophomores"],
			teams: [
				rookies.slice(0, perTeam).map(entry),
				sophomores.slice(0, perTeam).map(entry),
			],
		};
	}

	// Mixed: snake draft of the best of both classes
	const best = ranked.slice(0, 2 * perTeam);
	if (best.length < 2 * numPlayersOnCourt) {
		return undefined;
	}
	const teams: [AllStarPlayer[], AllStarPlayer[]] = [[], []];
	const snake = [0, 1, 1, 0] as const;
	for (const [i, p] of best.entries()) {
		teams[snake[i % 4]!].push(entry(p));
	}
	return {
		teamNames: ["Team Rising", "Team Future"],
		teams,
	};
};

export const simRisingStars = async (conditions: Conditions) => {
	const season = g.get("season");
	const allStars = await idb.cache.allStars.get(season);
	const rs = allStars?.risingStars;
	if (!allStars || !rs || rs.game) {
		return;
	}

	// Players hurt or gone since the selection sit out
	const teams = [[], []] as [AllStarPlayer[], AllStarPlayer[]];
	for (const i of [0, 1] as const) {
		for (const entry of rs.teams[i]) {
			const p = await idb.cache.players.get(entry.pid);
			if (p && p.tid >= 0 && p.injury.gamesRemaining === 0) {
				teams[i].push({ ...entry, tid: p.tid });
			}
		}
	}
	const numPlayersOnCourt = g.get("numPlayersOnCourt");
	if (teams.some((t) => t.length < numPlayersOnCourt)) {
		allStars.risingStars = undefined;
		await idb.cache.allStars.put(allStars);
		return;
	}

	rs.game = await simExhibition({
		teams,
		teamNames: rs.teamNames,
		seedKey: "risingStars",
	});
	await idb.cache.allStars.put(allStars);

	const mvp = rs.game.mvp;
	if (mvp) {
		await updatePlayerAwards({
			awardsToDelete: [],
			awardsToSave: [{ ...mvp, award: { type: "Rising Stars MVP" } }],
			logEventInfo: { conditions },
			season,
		});
	}
};
