import { PHASE } from "../../../common/constants.ts";
import { idb } from "../../db/index.ts";
import { g, helpers, logEvent } from "../../util/index.ts";
import checkStatisticalFeatBaseball from "./checkStatisticalFeat.baseball.ts";
import checkStatisticalFeatBasketball from "./checkStatisticalFeat.basketball.ts";
import checkStatisticalFeatFootball from "./checkStatisticalFeat.football.ts";
import checkStatisticalFeatHockey from "./checkStatisticalFeat.hockey.ts";
import type {
	Conditions,
	GamePlayer,
	GameResults,
	Player,
} from "../../../common/types.ts";
import { ledgerGame } from "./featLedger.ts";

// Streak news without a feat (Feat Rarity & Streaks)
const STREAK_NEWS_TEXT = {
	td: "a triple-double",
	dd: "a double-double",
	p30: "scored 30 or more",
} as const;
import getWinner from "../../../common/getWinner.ts";
import formatScoreWithShootout from "../../../common/formatScoreWithShootout.ts";
import { bySport } from "../../../common/sportFunctions.ts";

// Breakout nights: the points (times the feat scale factor) of a bench career high that makes the news
const BENCH_CAREER_HIGH_PTS = 25;

const checkPlayer = bySport({
	baseball: checkStatisticalFeatBaseball,
	basketball: checkStatisticalFeatBasketball,
	football: checkStatisticalFeatFootball,
	hockey: checkStatisticalFeatHockey,
});

const checkStatisticalFeat = (
	pid: number,
	tid: number,
	p: GamePlayer,
	results: GameResults,
	conditions: Conditions,
	// Playoff games, not counting college mode's NIT (a postseason tournament, but not the playoffs)
	playoffs: boolean = g.get("phase") === PHASE.PLAYOFFS,
	nit: boolean = false,
	// The player's record (Feat Rarity & Streaks: career highs)
	p2?: Player,
) => {
	const minFactor = helpers.quarterLengthFactor();
	if (minFactor <= 0.01) {
		// Skip for very short games
		return;
	}

	const logFeat = async (text: string, score: number) => {
		let allStars;

		if (tid < 0 && results.team[0].id === -1 && results.team[1].id === -2) {
			allStars = await idb.cache.allStars.get(g.get("season"));
		}

		let actualTid = tid;

		if (allStars) {
			// Fix team ID to actual team, not All-Star team
			const indTeam = tid === results.team[0].id ? 0 : 1;
			const entry = allStars.teams[indTeam].find((p2) => p2.pid === pid);

			if (entry) {
				actualTid = entry.tid;
			}
		}

		logEvent(
			{
				type: "playerFeat",
				text,
				showNotification: actualTid === g.get("userTid"),
				pids: [pid],
				tids: [actualTid],
				score,
			},
			conditions,
		);
	};

	const [i, j] =
		results.team[0].id === tid ? ([0, 1] as const) : ([1, 0] as const);

	// Cutoffs for this game: its length including overtime, and players on the court
	const factor = helpers.featScaleFactor(results.overtimes, playoffs || nit);
	const { score, feats } = checkPlayer(p, results.team[i].stat, {
		factor,
		playoffs,
	});
	const allStarGame = results.team[0].id === -1 && results.team[1].id === -2;

	// Feat Rarity & Streaks (basketball): rarity labels, career highs, streaks, team feats and the feat score. Undefined when off
	const ledger =
		__SPORT === "basketball" && (p.stat.min ?? 0) > 0
			? ledgerGame({
					pid,
					tid,
					name: p.name,
					line: p.stat,
					p2,
					results,
					playoffs,
					nit,
					factor,
					feat: !!feats,
				})
			: undefined;
	if (ledger && ledger.streakNews.length > 0 && !allStarGame) {
		const s = ledger.streakNews.at(-1)!;
		logEvent(
			{
				type: "playerFeat",
				text: `<a href="${helpers.leagueUrl(["player", pid])}">${p.name}</a> has ${STREAK_NEWS_TEXT[s.kind]} in ${s.n} straight games.`,
				showNotification: false,
				pids: [pid],
				tids: [tid],
				score: 0,
			},
			conditions,
		);
	}

	if (ledger) {
		for (const tf of ledger.teamNews) {
			const abbrev = g.get("teamInfoCache")[tf.tid]?.abbrev ?? "";
			const what =
				tf.kind === "comeback30"
					? `came back from ${tf.value} points down`
					: tf.kind === "pts150"
						? `scored ${tf.value} points`
						: `made ${tf.value} threes`;
			logEvent(
				{
					type: "playerFeat",
					text: `The <a href="${helpers.leagueUrl(["roster", `${abbrev}_${tf.tid}`, tf.season])}">${g.get("teamInfoCache")[tf.tid]?.region ?? ""} ${g.get("teamInfoCache")[tf.tid]?.name ?? ""}</a> ${what} in a <a href="${helpers.leagueUrl(["game_log", `${abbrev}_${tf.tid}`, tf.season, tf.gid])}">${tf.score}</a> game against the ${g.get("teamInfoCache")[tf.oppTid]?.name ?? ""}${tf.rarity ? ` (${tf.rarity})` : ""}.`,
					showNotification: tf.tid === g.get("userTid"),
					tids: [tf.tid],
					score: 10,
				},
				conditions,
			);
		}
	}

	const winner = getWinner([results.team[0].stat, results.team[1].stat]);

	// Breakout nights: a career high off the bench (25+ points, not already a feat) is news too
	const benchHigh = ledger?.notes.find((n) =>
		/^career-high \d+ points$/.test(n),
	);
	if (
		benchHigh &&
		!feats &&
		!allStarGame &&
		(p.stat.gs ?? 0) === 0 &&
		p.stat.pts >= BENCH_CAREER_HIGH_PTS * factor
	) {
		const won = winner === i;
		const tied = winner === -1;
		logEvent(
			{
				type: "playerFeat",
				text: `<a href="${helpers.leagueUrl(["player", pid])}">${p.name}</a> scored a career-high <a href="${helpers.leagueUrl(
					[
						"game_log",
						g.get("teamInfoCache")[tid]?.abbrev ?? "special",
						g.get("season"),
						results.gid,
					],
				)}">${p.stat.pts} points</a> off the bench in a ${formatScoreWithShootout(
					results.team[i].stat,
					results.team[j].stat,
				)} ${tied ? "tie with the" : won ? "win over the" : "loss to the"} ${
					g.get("teamInfoCache")[results.team[j].id]?.name
				}.`,
				showNotification: false,
				pids: [pid],
				tids: [tid],
				score: 0,
			},
			conditions,
		);
	}

	if (feats) {
		const won = winner === i;
		const tied = winner === -1;
		const featTextArr = Object.keys(feats).map((stat) => {
			// Hacky way to convert "1 assists" into "an assist"
			if (feats[stat] === 1 && stat.endsWith("s")) {
				const singular = stat.slice(0, -1);
				const vowels = ["a", "e", "i", "o", "u"];
				return `${vowels.includes(singular[0]!) ? "an" : "a"} ${singular}`;
			}

			return `${feats[stat]} ${stat}`;
		});
		let featText = `<a href="${helpers.leagueUrl(["player", pid])}">${
			p.name
		}</a> had <a href="${helpers.leagueUrl([
			"game_log",
			g.get("teamInfoCache")[tid]?.abbrev ?? "special",
			g.get("season"),
			results.gid,
		])}">`;

		for (let k = 0; k < featTextArr.length; k++) {
			if (featTextArr.length > 1 && k === featTextArr.length - 1) {
				featText += " and ";
			}

			featText += featTextArr[k];

			if (featTextArr.length > 2 && k < featTextArr.length - 2) {
				featText += ", ";
			}
		}

		const scoreText = formatScoreWithShootout(
			results.team[i].stat,
			results.team[j].stat,
		);

		const endPart = allStarGame
			? `${tied ? "tie" : won ? "win" : "loss"} in the All-Star Game`
			: `${tied ? "tie with the" : won ? "win over the" : "loss to the"} ${
					g.get("teamInfoCache")[results.team[j].id]?.name
				}`;
		featText += `</a> in ${
			results.team[i].stat.pts.toString().charAt(0) === "8" ? "an" : "a"
		} ${scoreText} ${endPart}.`;
		if (ledger && ledger.notes.length > 0) {
			featText += ` (${ledger.notes.join("; ")})`;
		}

		logFeat(featText, score);

		const result = tied ? "T" : won ? "W" : "L";

		idb.cache.playerFeats.add({
			pid,
			name: p.name,
			pos: p.pos,
			season: g.get("season"),
			tid,
			oppTid: results.team[j].id,
			playoffs,
			...(nit ? { nit: true } : {}),
			gid: results.gid,
			stats: p.stat,
			score: scoreText,
			overtimes: results.overtimes,
			numPeriods: g.get("numPeriods"),
			factor,
			result,
			...(ledger
				? {
						fs: ledger.fs,
						...(ledger.notes.length > 0 ? { notes: ledger.notes } : {}),
					}
				: {}),
		});
	}

	return !!feats;
};

export default checkStatisticalFeat;
