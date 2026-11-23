// Playoff extras (basketball): series storylines (rematches, revenge, rivalries) in the news and on the pages, the bracket archive of
// past seasons, and the Bracket Challenge (predict the bracket before the playoffs, scored after each round).

import { PHASE } from "../../../common/constants.ts";
import {
	BASE_POINTS,
	maxPoints as maxPointsCommon,
	roundPoints,
	roundsDone as roundsDoneCommon,
	winnerOf,
} from "../../../common/bracketChallenge.ts";
import {
	RIVALRY_SEASONS,
	seriesStorylines,
	type PastMeeting,
	type SeriesStoryline,
} from "../../../common/seriesRecap/storylines.ts";
import type {
	BracketChallengeEntry,
	PlayoffSeries,
} from "../../../common/types.ts";
import { idb } from "../../db/index.ts";
import { g, helpers, logEvent } from "../../util/index.ts";
import { isCollege } from "../college/isCollege.ts";
import league from "../league/index.ts";
import getPlayoffsByConf from "../season/getPlayoffsByConf.ts";

export const playoffExtrasOn = () => __SPORT === "basketball";

const teamName = (tid: number) =>
	g.get("teamInfoCache")[tid]?.name ?? `Team ${tid}`;

// ---- Past meetings --------------------------------------------------------------

const meetingsCache = new Map<string, PastMeeting[]>();

// Every finished playoff series of a past season
const seasonMeetings = async (season: number) => {
	const key = `${g.get("lid")}|${season}`;
	const hit = meetingsCache.get(key);
	if (hit) {
		return hit;
	}
	const out: PastMeeting[] = [];
	const ps = await idb.merged.playoffSeries.get(season);
	if (ps) {
		const byConf = await getPlayoffsByConf(season);
		const numRounds = ps.series.length;
		for (const [ri, round] of ps.series.entries()) {
			const numToWin = helpers.numGamesToWinRound(ri, season);
			for (const s of round) {
				const result = winnerOf(s, numToWin);
				if (!result?.loser) {
					continue;
				}
				out.push({
					season,
					round: ri,
					roundName: helpers.playoffRoundName(ri, numRounds, byConf),
					winnerTid: result.winner.tid,
					loserTid: result.loser.tid,
					winnerWon: result.winner.won,
					loserWon: result.loser.won,
				});
			}
		}
	}
	if (season < g.get("season")) {
		meetingsCache.set(key, out);
		if (meetingsCache.size > 40) {
			meetingsCache.delete(meetingsCache.keys().next().value!);
		}
	}
	return out;
};

export const pastMeetings = async (season: number) => {
	const out: PastMeeting[] = [];
	for (
		let s = Math.max(g.get("startingSeason"), season - RIVALRY_SEASONS);
		s < season;
		s++
	) {
		out.push(...(await seasonMeetings(s)));
	}
	return out;
};

export const storylinesFor = async (
	season: number,
	a: number,
	b: number,
	meetings?: PastMeeting[],
): Promise<SeriesStoryline[]> => {
	if (!playoffExtrasOn()) {
		return [];
	}
	return seriesStorylines({
		season,
		a,
		b,
		meetings: meetings ?? (await pastMeetings(season)),
		name: teamName,
		minSeason: g.get("startingSeason"),
	});
};

// News when a round's matchups are set: the series with a storyline (not first meetings, which are only on the pages). Once per round
export const announceStorylines = async () => {
	if (!playoffExtrasOn() || isCollege() || g.get("phase") !== PHASE.PLAYOFFS) {
		return;
	}
	const season = g.get("season");
	const ps = await idb.cache.playoffSeries.get(season);
	if (!ps || ps.currentRound < 0) {
		return;
	}
	const round = ps.currentRound;
	const announced = ps.storylinesAnnounced ?? [];
	if (announced.includes(round) || !ps.series[round]) {
		return;
	}
	const series = ps.series[round];
	if (series.some((s) => s.home.pendingPlayIn || s.away?.pendingPlayIn)) {
		return;
	}
	ps.storylinesAnnounced = [...announced, round];
	await idb.cache.playoffSeries.put(ps);

	const meetings = await pastMeetings(season);
	const byConf = await getPlayoffsByConf(season);
	const roundName = helpers.playoffRoundName(round, ps.series.length, byConf);
	const userTids = new Set(g.get("userTids"));
	for (const s of series) {
		if (!s.away) {
			continue;
		}
		const lines = (
			await storylinesFor(season, s.home.tid, s.away.tid, meetings)
		).filter((x) => x.kind !== "firstMeeting");
		if (lines.length === 0) {
			continue;
		}
		const link = (tid: number) =>
			`<a href="${helpers.leagueUrl([
				"roster",
				`${g.get("teamInfoCache")[tid]?.abbrev}_${tid}`,
				season,
			])}">${teamName(tid)}</a>`;
		await logEvent({
			type: "playoffs",
			text: `${roundName === "finals" ? "Finals" : helpers.upperCaseFirstLetter(roundName)} storyline: the ${link(s.home.tid)} and the ${link(s.away.tid)} meet. ${lines.map((x) => x.text).join(" ")}`,
			tids: [s.home.tid, s.away.tid],
			showNotification: userTids.has(s.home.tid) || userTids.has(s.away.tid),
			score: lines.some((x) => x.kind === "revenge" || x.kind === "rivalry")
				? 10
				: 0,
		});
	}
};

// ---- Bracket archive ------------------------------------------------------------

export const getBracketArchive = async () => {
	const out = [];
	const current = g.get("season");
	for (let season = current; season >= g.get("startingSeason"); season--) {
		const ps = await idb.merged.playoffSeries.get(season);
		if (!ps || ps.series.length === 0) {
			continue;
		}
		const teamSeasons = await idb.merged.teamSeasons.getAll({ season });
		const info = (tid: number) => {
			const ts = teamSeasons.find((x) => x.tid === tid);
			const cache = g.get("teamInfoCache")[tid];
			return {
				abbrev: ts?.abbrev ?? cache?.abbrev ?? "???",
				region: ts?.region ?? cache?.region ?? "",
				name: ts?.name ?? cache?.name ?? "",
				imgURL:
					ts?.imgURLSmall ?? ts?.imgURL ?? cache?.imgURLSmall ?? cache?.imgURL,
			};
		};
		const byConf = await getPlayoffsByConf(season);
		const numRounds = g.get("numGamesPlayoffSeries", season).length;
		const rounds = ps.series.map((round, ri) => ({
			name: helpers.upperCaseFirstLetter(
				helpers.playoffRoundName(ri, numRounds, byConf),
			),
			series: round.map((s) => ({
				home: {
					tid: s.home.tid,
					seed: s.home.seed,
					won: s.home.won,
					...info(s.home.tid),
				},
				away: s.away
					? {
							tid: s.away.tid,
							seed: s.away.seed,
							won: s.away.won,
							...info(s.away.tid),
						}
					: undefined,
			})),
		}));
		const fin = ps.series.at(-1)?.[0];
		const numToWin = helpers.numGamesToWinRound(ps.series.length - 1, season);
		const result =
			fin && ps.series.length === numRounds
				? winnerOf(fin, numToWin)
				: undefined;
		out.push({
			season,
			complete: result !== undefined,
			champion: result
				? {
						tid: result.winner.tid,
						seed: result.winner.seed,
						won: result.winner.won,
						...info(result.winner.tid),
					}
				: undefined,
			runnerUp: result?.loser
				? {
						tid: result.loser.tid,
						seed: result.loser.seed,
						won: result.loser.won,
						...info(result.loser.tid),
					}
				: undefined,
			rounds,
		});
	}
	return out;
};

// ---- Bracket challenge ----------------------------------------------------------

export { BASE_POINTS, roundPoints };

export const getChallengeEntries = (): BracketChallengeEntry[] => {
	try {
		return g.get("bracketChallenge") ?? [];
	} catch {
		return [];
	}
};

const saveEntries = async (entries: BracketChallengeEntry[]) => {
	await league.setGameAttributes({
		bracketChallenge: entries
			.toSorted((a, b) => a.season - b.season)
			.slice(-30),
	});
};

// Picks can be made until the first round's first game, once every first round slot is known (the play-in is over)
export const challengeStatus = (ps: PlayoffSeries | undefined) => {
	if (
		!ps ||
		ps.season !== g.get("season") ||
		g.get("phase") !== PHASE.PLAYOFFS
	) {
		return "closed" as const;
	}
	const first = ps.series[0] ?? [];
	if (first.length === 0) {
		return "closed" as const;
	}
	if (first.some((s) => s.home.pendingPlayIn || s.away?.pendingPlayIn)) {
		return "waiting" as const;
	}
	if (
		ps.currentRound > 0 ||
		first.some((s) => s.home.won > 0 || (s.away?.won ?? 0) > 0)
	) {
		return "closed" as const;
	}
	return "open" as const;
};

// The number of rounds a bracket has (from the format, not just the rounds played so far)
export const numBracketRounds = (season: number) =>
	g.get("numGamesPlayoffSeries", season).length;

// Picks: picks[r][j] is the predicted winner of slot j of round r. Round 0 slots are the first round series; slot j of round r + 1 is
// fed by slots 2j and 2j + 1 of round r. A bye is its team's automatic pick
export const validatePicks = (ps: PlayoffSeries, picks: number[][]) => {
	const first = ps.series[0]!;
	const numRounds = numBracketRounds(ps.season);
	if (picks.length !== numRounds) {
		throw new Error("Pick a winner for every round.");
	}
	for (let r = 0; r < numRounds; r++) {
		const expected = first.length / 2 ** r;
		if (picks[r]!.length !== Math.max(1, expected)) {
			throw new Error("Pick a winner for every series.");
		}
		for (const [j, tid] of picks[r]!.entries()) {
			const options =
				r === 0
					? [first[j]!.home.tid, first[j]!.away?.tid]
					: [picks[r - 1]![2 * j], picks[r - 1]![2 * j + 1]];
			if (!options.includes(tid)) {
				throw new Error("A pick isn't one of the two teams in its series.");
			}
		}
	}
};

export const submitBracketPicks = async (picks: number[][]) => {
	if (!playoffExtrasOn()) {
		throw new Error("The Bracket Challenge is only in Basketball GM.");
	}
	const season = g.get("season");
	const ps = await idb.cache.playoffSeries.get(season);
	if (challengeStatus(ps) !== "open") {
		throw new Error("Picks are closed: the playoffs have started.");
	}
	validatePicks(ps!, picks);
	const entries = getChallengeEntries().filter((x) => x.season !== season);
	await saveEntries([
		...entries,
		{ season, madeAt: "playoffs", picks, points: [], scoredRounds: 0 },
	]);
};

// Points by round: each correct winner of a played series (byes left out) is worth roundPoints(round)
export const scoreEntry = (
	entry: BracketChallengeEntry,
	ps: PlayoffSeries,
	numRoundsDone: number,
) => {
	const points: number[] = [];
	let max = 0;
	for (let r = 0; r < numRoundsDone; r++) {
		const numToWin = helpers.numGamesToWinRound(r, ps.season);
		const winners = new Set<number>();
		for (const s of ps.series[r] ?? []) {
			if (!s.away) {
				continue;
			}
			const result = winnerOf(s, numToWin);
			if (result) {
				winners.add(result.winner.tid);
			}
		}
		let correct = 0;
		for (const tid of entry.picks[r] ?? []) {
			if (winners.has(tid)) {
				correct += 1;
			}
		}
		points.push(correct * roundPoints(r));
		max += winners.size * roundPoints(r);
	}
	return { points, max };
};

// Rounds completed so far
export const roundsDone = (ps: PlayoffSeries) =>
	roundsDoneCommon(ps, (r) => helpers.numGamesToWinRound(r, ps.season));

// Maximum possible points for a full bracket (byes don't count)
export const maxPoints = (ps: PlayoffSeries) =>
	maxPointsCommon(ps, numBracketRounds(ps.season));

// After each playoff day: score the rounds that just finished, with a news item for each
export const scoreBracketChallenge = async () => {
	if (!playoffExtrasOn()) {
		return;
	}
	const season = g.get("season");
	const entries = getChallengeEntries();
	const entry = entries.find((x) => x.season === season);
	if (!entry) {
		return;
	}
	const ps = await idb.cache.playoffSeries.get(season);
	if (!ps) {
		return;
	}
	const done = roundsDone(ps);
	const scored = entry.scoredRounds ?? 0;
	if (done <= scored) {
		return;
	}
	const { points } = scoreEntry(entry, ps, done);
	const total = points.reduce((a, b) => a + b, 0);
	const max = maxPoints(ps);
	const byConf = await getPlayoffsByConf(season);
	for (let r = scored; r < done; r++) {
		const roundName = helpers.playoffRoundName(r, ps.series.length, byConf);
		const finished = r === numBracketRounds(season) - 1;
		await logEvent({
			type: "playoffs",
			text: `<a href="${helpers.leagueUrl(["bracket_challenge", season])}">Bracket Challenge</a>: ${points[r]} points from the ${roundName}${finished ? `, ${total} of ${max} in all` : `, ${total} so far`}.`,
			tids: [g.get("userTid")],
			showNotification: true,
		});
	}
	await saveEntries(
		entries.map((x) =>
			x.season === season ? { ...x, points, scoredRounds: done } : x,
		),
	);
};

// After each playoff day (play.ts): never stops the season
export const playoffExtrasAfterDay = async () => {
	try {
		await scoreBracketChallenge();
		await announceStorylines();
	} catch (error) {
		console.error(error);
	}
};
