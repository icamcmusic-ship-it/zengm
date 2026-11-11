// AI GM personalities: shared formatting for the Front Offices page and the team page
import { gmHotSeatLabel, gmStyleLabels } from "../../common/gmPersonality.ts";
import type { Gm, Team } from "../../common/types.ts";
import {
	gmEnabled,
	seasonsWithTeam,
	userControlsTeam,
} from "../core/gm/index.ts";
import { idb } from "../db/index.ts";
import { g } from "../util/index.ts";

const abbrev = (tid: number) => g.get("teamInfoCache")[tid]?.abbrev ?? "";

const isTitle = (season: number, playoffRoundsWon: number) =>
	playoffRoundsWon >= 0 &&
	playoffRoundsWon >= g.get("numGamesPlayoffSeries", season).length;

export const formatGm = async (gm: Gm, tid?: number) => {
	const tenure = gm.tenures.at(-1);
	const current = tid !== undefined ? seasonsWithTeam(gm, tid) : [];
	const sum = (rows: Gm["seasons"], key: "won" | "lost") =>
		rows.reduce((total, row) => total + row[key], 0);

	// This season so far, while it's being played
	let seasonWon: number | undefined;
	let seasonLost: number | undefined;
	if (tid !== undefined && gm.expWon !== undefined) {
		const ts = await idb.cache.teamSeasons.indexGet("teamSeasonsBySeasonTid", [
			g.get("season"),
			tid,
		]);
		if (ts) {
			seasonWon = ts.won;
			seasonLost = ts.lost;
		}
	}

	const aboveExp = current.reduce(
		(total, row) =>
			total +
			(row.expWon !== undefined ? row.won - row.expWon : 0) *
				(82 / Math.max(1, row.numGames)),
		0,
	);

	return {
		gmid: gm.gmid,
		name: `${gm.firstName} ${gm.lastName}`,
		age: g.get("season") - gm.born.year,
		born: gm.born,
		face: gm.face,
		traits: gm.traits,
		styleLabels: gmStyleLabels(gm.traits),
		since: tenure?.start,
		tenureSeasons: current.length,
		won: sum(current, "won"),
		lost: sum(current, "lost"),
		aboveExp: Math.round(aboveExp * 10) / 10,
		playoffs: current.filter((row) => row.playoffRoundsWon >= 0).length,
		titles: current.filter((row) => isTitle(row.season, row.playoffRoundsWon))
			.length,
		careerWon: sum(gm.seasons, "won"),
		careerLost: sum(gm.seasons, "lost"),
		careerTitles: gm.seasons.filter((row) =>
			isTitle(row.season, row.playoffRoundsWon),
		).length,
		expWon: gm.expWon,
		seasonWon,
		seasonLost,
		hotSeat: gm.hotSeat,
		hotSeatLabel: gmHotSeatLabel(gm.hotSeat),
		previousTeams: [
			...new Set(
				gm.tenures
					.filter((x) => x.end !== undefined && x.tid !== tid)
					.map((x) => abbrev(x.tid)),
			),
		],
		lastTeam:
			tenure?.end !== undefined
				? { tid: tenure.tid, abbrev: abbrev(tenure.tid), end: tenure.end }
				: undefined,
		retiredYear: gm.retiredYear,
	};
};

export type FormattedGm = Awaited<ReturnType<typeof formatGm>>;

// For the team page: the GM, "you", or nothing when the setting is off
export const getTeamGmInfo = async (
	t: Team | undefined,
): Promise<
	| { type: "off" }
	| { type: "user" }
	| { type: "none" }
	| { type: "gm"; gm: FormattedGm }
> => {
	if (!gmEnabled() || !t) {
		return { type: "off" };
	}
	if (userControlsTeam(t.tid)) {
		return { type: "user" };
	}
	if (!t.gm) {
		return { type: "none" };
	}
	return { type: "gm", gm: await formatGm(t.gm, t.tid) };
};
