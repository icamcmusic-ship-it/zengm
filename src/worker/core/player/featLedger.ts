// Feat rarity, team feats, streaks and the feat score (featureFeatRarity, basketball): the league side of common/featLedger.ts. Called from
// checkStatisticalFeat for every player of every game (synchronously, so games and players are counted in order), the state lives in the
// "featLedger" game attribute (like the Records Book's: the league's own key-value store, carried by export/import) and is put in the cache
// after each game. Off: nothing runs, nothing is stored.
import {
	addEraGame,
	comebackDeficit,
	emptyLedger,
	eraMultipliers,
	featScore,
	ledgerKinds,
	ordinal,
	rarityLabel,
	recordKinds,
	STREAK_NAMES,
	STREAK_NEWS,
	streakHits,
	TEAM_FEAT_NAMES,
	TEAM_FEATS_MAX,
	teamFeatKinds,
	updateStreaks,
	type GameLine,
	type LedgerState,
	type StreakKind,
	type TeamFeatRow,
} from "../../../common/featLedger.ts";
import formatScoreWithShootout from "../../../common/formatScoreWithShootout.ts";
import getWinner from "../../../common/getWinner.ts";
import type { GameResults, Player } from "../../../common/types.ts";
import { idb } from "../../db/index.ts";
import { g, helpers } from "../../util/index.ts";
import { featureOn } from "../../util/nativeFeatures.ts";

const KEY = "featLedger";

export const featLedgerOn = () =>
	__SPORT === "basketball" && featureOn("featRarity");

export const getLedger = (): LedgerState => {
	const s = Object.hasOwn(g, KEY)
		? (g.get(KEY as any) as LedgerState | undefined)
		: undefined;
	if (s && s.v === 1) {
		return s;
	}
	const fresh = emptyLedger();
	g.setWithoutSavingToDB(KEY as any, fresh);
	return fresh;
};

let savePending = false;
const saveLedger = (state: LedgerState) => {
	g.setWithoutSavingToDB(KEY as any, state);
	if (savePending) {
		return;
	}
	savePending = true;
	// Once per batch of synchronous calls (a game's players)
	queueMicrotask(() => {
		savePending = false;
		void idb.cache.gameAttributes.put({ key: KEY, value: getLedger() } as any);
	});
};

// Retirement (player/retire.ts): his running streaks are over. Without this they would stay in the ledger for good (they only end
// when he plays a game without them). Rows of the longest-streaks lists are kept.
export const endRunningStreaks = (pid: number) => {
	const s = Object.hasOwn(g, KEY)
		? (g.get(KEY as any) as LedgerState | undefined)
		: undefined;
	if (!s || s.v !== 1 || !s.running[String(pid)]) {
		return;
	}
	delete s.running[String(pid)];
	saveLedger(s);
};

// Career highs as this league saw them (p.featHi). "Career high" is only claimed for a player whose every game was seen (tracking started
// with his first game: w)
type FeatHi = { w: boolean; pts: number; trb: number; ast: number };

const careerHighs = (p2: Player | undefined, line: GameLine) => {
	if (!p2) {
		return [];
	}
	const trb = line.orb + line.drb;
	const prev = (p2 as any).featHi as FeatHi | undefined;
	const out: string[] = [];
	if (!prev) {
		// (this game is not in his stats rows yet: none with games means this is his first)
		const played = p2.stats.some((r) => r.tid >= 0 && (r.gp ?? 0) > 0);
		(p2 as any).featHi = {
			w: !played,
			pts: line.pts,
			trb,
			ast: line.ast,
		} satisfies FeatHi;
		return out;
	}
	const check = (key: "pts" | "trb" | "ast", value: number, name: string) => {
		if (value > prev[key]) {
			if (prev.w && prev[key] > 0) {
				out.push(`career-high ${value} ${name}`);
			}
			prev[key] = value;
		}
	};
	check("pts", line.pts, "points");
	check("trb", trb, "rebounds");
	check("ast", line.ast, "assists");
	return out;
};

// Team games already counted (a game's players come one by one)
let teamSeen = { key: "", tids: new Set<number>() };

export type LedgerGameInfo = {
	// Rarity labels, career highs and streak notes for the feat of this game, if it is one
	notes: string[];
	fs: number;
	// Streaks that are news without a feat (30-point games, double-doubles)
	streakNews: { kind: StreakKind; n: number }[];
	// Team feats of his team in this game (only with the team's first player)
	teamNews: TeamFeatRow[];
};

/**
 * One player's game. Returns undefined when off or for All-Star games. Counts the team's game once (era totals, team feats), his streaks
 * (regular season only), his career highs, and, when `feat` is true, the rarity of the game's kinds.
 */
export const ledgerGame = ({
	pid,
	tid,
	name,
	line,
	p2,
	results,
	playoffs,
	nit,
	factor,
	feat,
}: {
	pid: number;
	tid: number;
	name: string;
	line: GameLine;
	p2: Player | undefined;
	results: GameResults;
	playoffs: boolean;
	nit: boolean;
	factor: number;
	feat: boolean;
}): LedgerGameInfo | undefined => {
	if (!featLedgerOn()) {
		return undefined;
	}
	const allStar = results.team[0].id === -1 && results.team[1].id === -2;
	if (allStar || tid < 0) {
		return undefined;
	}
	const state = getLedger();
	const season = g.get("season");
	const firstSeason = g.get("startingSeason");

	// The team's game, once
	const teamNews: TeamFeatRow[] = [];
	const gameKey = `${g.get("lid")}|${results.gid}`;
	if (teamSeen.key !== gameKey) {
		teamSeen = { key: gameKey, tids: new Set() };
	}
	if (!teamSeen.tids.has(tid)) {
		teamSeen.tids.add(tid);
		const i = results.team[0].id === tid ? 0 : 1;
		const j = i === 0 ? 1 : 0;
		const t = results.team[i].stat;
		addEraGame(state, season, {
			pts: t.pts ?? 0,
			trb: (t.orb ?? 0) + (t.drb ?? 0),
			ast: t.ast ?? 0,
			stl: t.stl ?? 0,
			blk: t.blk ?? 0,
			tp: t.tp ?? 0,
		});
		const winner = getWinner([results.team[0].stat, results.team[1].stat]);
		const deficit =
			winner === i && Array.isArray(t.ptsQtrs)
				? comebackDeficit(
						[results.team[0].stat.ptsQtrs, results.team[1].stat.ptsQtrs],
						i,
					)
				: 0;
		const gameFactor = helpers.featScaleFactor(
			results.overtimes,
			playoffs || nit,
		);
		for (const tf of teamFeatKinds(
			{ pts: t.pts ?? 0, tp: t.tp ?? 0 },
			deficit,
			winner === i,
			gameFactor,
		)) {
			const seen = state.team[tf.kind];
			const rarity = rarityLabel(
				TEAM_FEAT_NAMES[tf.kind].replace("+", "-plus"),
				seen,
				season,
				firstSeason,
			);
			state.team[tf.kind] = { n: (seen?.n ?? 0) + 1, last: season };
			const row: TeamFeatRow = {
				season,
				gid: results.gid,
				tid,
				oppTid: results.team[j].id,
				kind: tf.kind,
				value: tf.value,
				score: formatScoreWithShootout(t, results.team[j].stat),
				playoffs,
				...(rarity ? { rarity } : {}),
			};
			state.teamFeats.push(row);
			teamNews.push(row);
			if (state.teamFeats.length > TEAM_FEATS_MAX) {
				state.teamFeats.splice(0, state.teamFeats.length - TEAM_FEATS_MAX);
			}
		}
	}

	const notes: string[] = [];
	if (feat) {
		notes.push(
			...recordKinds(state, ledgerKinds(line, factor), season, firstSeason),
		);
	}
	notes.push(...careerHighs(p2, line));

	let streakNews: { kind: StreakKind; n: number }[] = [];
	if (!playoffs && !nit) {
		streakNews = updateStreaks(
			state,
			{ pid, name, tid },
			streakHits(line, factor),
			season,
		);
	}
	if (feat && !playoffs && !nit) {
		// His running streaks this game extends (triple-doubles and 30-point games from the 2nd, double-doubles once they are news)
		const running = state.running[String(pid)] ?? {};
		for (const kind of ["td", "p30", "dd"] as StreakKind[]) {
			const n = running[kind]?.n ?? 0;
			if (n >= (kind === "dd" ? STREAK_NEWS.dd.from : 2)) {
				notes.push(`${ordinal(n)} straight ${STREAK_NAMES[kind].slice(0, -1)}`);
			}
		}
	}

	saveLedger(state);
	return {
		notes,
		fs: featScore(line, factor, eraMultipliers(state, season)),
		streakNews: feat ? [] : streakNews,
		teamNews,
	};
};

// For the Statistical Feats page
export const ledgerForView = () => {
	if (!featLedgerOn()) {
		return undefined;
	}
	const state = getLedger();
	const running: {
		pid: number;
		kind: StreakKind;
		n: number;
		from: number;
	}[] = [];
	for (const [pid, kinds] of Object.entries(state.running)) {
		for (const [kind, r] of Object.entries(kinds)) {
			if (r && r.n >= 2) {
				running.push({ pid: Number(pid), kind: kind as StreakKind, ...r });
			}
		}
	}
	return {
		teamFeats: state.teamFeats.toReversed(),
		running: running.sort((a, b) => b.n - a.n).slice(0, 50),
		longest: state.longest,
	};
};
