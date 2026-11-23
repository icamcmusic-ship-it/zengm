import { defineView } from "../util/defineView.ts";
import {
	challengeStatus,
	getChallengeEntries,
	maxPoints,
	numBracketRounds,
	pastMeetings,
	roundPoints,
	roundsDone,
	scoreEntry,
	storylinesFor,
} from "../core/playoffExtras/index.ts";
import { idb } from "../db/index.ts";
import { g, helpers } from "../util/index.ts";
import getPlayoffsByConf from "../core/season/getPlayoffsByConf.ts";
import { isCollege } from "../core/college/isCollege.ts";
import type { RouteParams } from "../../ui/router/types.ts";

const processInputs = (params: RouteParams<"bracketChallenge">) => ({
	season:
		params.season !== undefined && /^\d+$/.test(params.season)
			? Number(params.season)
			: g.get("season"),
});

// Bracket Challenge: pick every series before the playoffs start, scored after each round
export default defineView({
	id: "bracketChallenge",
	processInputs,
	load: async ({ inputs, updateEvents, prevInputs }) => {
		if (__SPORT !== "basketball") {
			return {
				errorMessage: "The Bracket Challenge is only in Basketball GM.",
			};
		}
		if (isCollege()) {
			return {
				errorMessage: "The Bracket Challenge isn't in college leagues.",
			};
		}
		if (
			!updateEvents.has("firstRun") &&
			!updateEvents.has("gameAttributes") &&
			!updateEvents.has("playoffs") &&
			!updateEvents.has("newPhase") &&
			!(updateEvents.has("gameSim") && inputs.season === g.get("season")) &&
			inputs.season === prevInputs?.season
		) {
			return;
		}
		const { season } = inputs;
		const ps = await idb.merged.playoffSeries.get(season);
		const entries = getChallengeEntries();
		const entry = entries.find((x) => x.season === season);
		const history = entries
			.filter((x) => x.points && (x.scoredRounds ?? 0) > 0)
			.map((x) => ({
				season: x.season,
				points: x.points!.reduce((a, b) => a + b, 0),
			}))
			.toReversed();
		if (!ps || (ps.series[0] ?? []).length === 0) {
			return {
				season,
				status: "closed" as const,
				noBracket: true,
				entry,
				history,
				first: [],
				roundNames: [],
				roundPoints: [],
				winners: [],
				done: 0,
				max: 0,
				score: undefined,
				storylines: {},
			};
		}
		const byConf = await getPlayoffsByConf(season);
		const numRounds = numBracketRounds(season);
		const roundNames = Array.from({ length: numRounds }, (_, r) =>
			helpers.upperCaseFirstLetter(
				helpers.playoffRoundName(r, numRounds, byConf),
			),
		);
		const teams = g.get("teamInfoCache");
		const first = ps.series[0]!.map((s) => ({
			home: {
				tid: s.home.tid,
				seed: s.home.seed,
				abbrev: teams[s.home.tid]?.abbrev ?? "",
				name: teams[s.home.tid]?.name ?? "",
				pending: !!s.home.pendingPlayIn,
			},
			away: s.away
				? {
						tid: s.away.tid,
						seed: s.away.seed,
						abbrev: teams[s.away.tid]?.abbrev ?? "",
						name: teams[s.away.tid]?.name ?? "",
						pending: !!s.away.pendingPlayIn,
					}
				: undefined,
		}));
		const done = roundsDone(ps);
		// Winners of each round played so far (to mark picks right or wrong)
		const winners: number[][] = ps.series.map((round, r) =>
			round
				.map((s) => {
					const numToWin = helpers.numGamesToWinRound(r, season);
					if (!s.away) {
						return s.home.tid;
					}
					return s.home.won >= numToWin
						? s.home.tid
						: s.away.won >= numToWin
							? s.away.tid
							: -1;
				})
				.filter((tid) => tid >= 0),
		);
		// Series previews: the storylines of the first round matchups
		const meetings = await pastMeetings(season);
		const storylines: Record<string, string[]> = {};
		for (const s of ps.series[0]!) {
			if (s.away && !s.home.pendingPlayIn && !s.away.pendingPlayIn) {
				const lines = await storylinesFor(
					season,
					s.home.tid,
					s.away.tid,
					meetings,
				);
				if (lines.length > 0) {
					storylines[`${s.home.tid}-${s.away.tid}`] = lines.map((x) => x.text);
				}
			}
		}
		const score = entry ? scoreEntry(entry, ps, done) : undefined;
		return {
			season,
			status: challengeStatus(ps),
			noBracket: false,
			entry,
			history,
			first,
			roundNames,
			roundPoints: roundNames.map((_, r) => roundPoints(r)),
			winners,
			done,
			max: maxPoints(ps),
			score: score
				? {
						points: score.points,
						total: score.points.reduce((a, b) => a + b, 0),
						maxSoFar: score.max,
					}
				: undefined,
			storylines,
		};
	},
});
