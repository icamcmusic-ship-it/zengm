// Rivalry Stories text: Newspaper previews and recaps, and the Games to Watch context line. Read only from results and
// box score stats (never a player rating), so they are the same with or without the No Visible Player Ratings challenge.
import { MARQUEE_LABELS, type MarqueeKind } from "../marquee.ts";
import { sortGames, streaksOf } from "./aggregate.ts";
import type { RivalryGame } from "./types.ts";

type Name = (tid: number) => string;

const ORD = ["first", "second", "third", "fourth", "fifth", "sixth", "seventh"];
const ordinal = (n: number) => ORD[n - 1] ?? `${n}th`;
const WORDS = ["no", "one", "two", "three", "four", "five", "six", "seven"];
const word = (n: number) => WORDS[n] ?? String(n);

const winnerOf = (gm: RivalryGame) =>
	gm.hPts > gm.aPts ? gm.home : gm.aPts > gm.hPts ? gm.away : -1;
const margin = (gm: RivalryGame) => Math.abs(gm.hPts - gm.aPts);
const scoreLine = (gm: RivalryGame, name: Name) => {
	const w = winnerOf(gm);
	const [wt, wp, lt, lp] =
		w === gm.away
			? [gm.away, gm.aPts, gm.home, gm.hPts]
			: [gm.home, gm.hPts, gm.away, gm.aPts];
	return `${name(wt)} ${wp}, ${name(lt)} ${lp}${gm.ot > 0 ? (gm.ot === 1 ? " (OT)" : ` (${gm.ot}OT)`) : ""}`;
};

// "Third meeting this season; the last two were decided by 3 points" for an upcoming game, from this season's logged games
export const rivalryContextLine = (
	seasonGames: RivalryGame[],
	upcoming: { home: number; away: number; playoffs?: boolean },
	name: Name,
): string | undefined => {
	const games = sortGames(seasonGames);
	const n = games.length + 1;
	if (games.length === 0) {
		return undefined;
	}
	const last2 = games.slice(-2);
	const parts: string[] = [];
	parts.push(`${capFirst(ordinal(n))} meeting this season`);
	if (last2.length === 2 && last2.every((gm) => margin(gm) <= 5)) {
		const ms = last2.map(margin);
		parts.push(
			ms[0] === ms[1]
				? `the last two were decided by ${ms[0]} point${ms[0] === 1 ? "" : "s"}`
				: `the last two were decided by ${ms[0]} and ${ms[1]} points`,
		);
	} else {
		const wins = new Map<number, number>();
		for (const gm of games) {
			const w = winnerOf(gm);
			if (w >= 0) {
				wins.set(w, (wins.get(w) ?? 0) + 1);
			}
		}
		const h = wins.get(upcoming.home) ?? 0;
		const aw = wins.get(upcoming.away) ?? 0;
		const last = games.at(-1)!;
		if (games.length >= 2 && (h === 0 || aw === 0)) {
			const t = h > 0 ? upcoming.home : upcoming.away;
			parts.push(
				`the ${name(t)} have won all ${word(games.length)}${games.length >= 2 ? `, by ${Math.round(games.reduce((s, gm) => s + margin(gm), 0) / games.length)} a game` : ""}`,
			);
		} else if (games.length >= 2) {
			parts.push(
				`season series ${Math.max(h, aw)}-${Math.min(h, aw)}${h === aw ? "" : `, ${name(h > aw ? upcoming.home : upcoming.away)} ahead`}`,
			);
		} else {
			parts.push(`last time: ${scoreLine(last, name)}`);
		}
	}
	return `${parts.join("; ")}.`;
};

const capFirst = (s: string) => (s ? s[0]!.toUpperCase() + s.slice(1) : s);

export type RivalryArticleText = {
	kind: "preview" | "upset" | "clincher" | "heated" | "big night" | "classic";
	gid?: number;
	season: number;
	tids: [number, number];
	score: number;
	head: string;
	body: string;
};

// A preview of an upcoming marquee rivalry game
export const rivalryPreview = ({
	game,
	history,
	tier,
	name,
	allTime,
}: {
	game: {
		gid: number;
		season: number;
		home: number;
		away: number;
		marquee?: MarqueeKind;
		playoffs?: boolean;
	};
	// The pair's logged games, any season
	history: RivalryGame[];
	tier: string;
	name: Name;
	// All-time regular season wins of home and away (head-to-head table)
	allTime?: { home: number; away: number };
}): RivalryArticleText => {
	const H = name(game.home);
	const A = name(game.away);
	const stage = game.marquee
		? ` on ${game.marquee === "nationalTv" ? "national TV" : MARQUEE_LABELS[game.marquee]}`
		: "";
	const sentences: string[] = [];
	sentences.push(
		`The ${H} host the ${A}${stage} in ${tier === "Bitter" ? "the league's bitterest rivalry" : tier === "Heated" ? "a heated rivalry" : "a rivalry game"}.`,
	);
	if (allTime && allTime.home + allTime.away > 0) {
		const lead =
			allTime.home === allTime.away
				? `The all-time regular season series is even at ${allTime.home}-${allTime.away}.`
				: `The ${allTime.home > allTime.away ? H : A} lead the all-time regular season series ${Math.max(allTime.home, allTime.away)}-${Math.min(allTime.home, allTime.away)}.`;
		sentences.push(lead);
	}
	const sorted = sortGames(history);
	const { current } = streaksOf(sorted);
	if (current && current.n >= 3) {
		sentences.push(
			`The ${name(current.tid)} have won the last ${word(current.n)} meetings.`,
		);
	}
	const last = sorted.at(-1);
	if (last) {
		sentences.push(
			`Last time out (${last.season}${last.playoffs ? " playoffs" : ""}): ${scoreLine(last, name)}.`,
		);
	}
	const thisSeason = sorted.filter((gm) => gm.season === game.season);
	const ctx = rivalryContextLine(thisSeason, game, name);
	if (ctx && thisSeason.length >= 1) {
		sentences.push(ctx);
	}
	// The player who has hurt the visitors the most (points per game against them, 3+ games)
	const byPlayer = new Map<
		string,
		{ name: string; tid: number; gp: number; pts: number }
	>();
	for (const gm of sorted.slice(-12)) {
		for (const p of gm.players) {
			const k = `${p.pid}|${p.tid}`;
			const e = byPlayer.get(k) ?? { name: p.name, tid: p.tid, gp: 0, pts: 0 };
			e.gp += 1;
			e.pts += p.pts;
			byPlayer.set(k, e);
		}
	}
	const star = [...byPlayer.values()]
		.filter((e) => e.gp >= 3)
		.sort((x, y) => y.pts / y.gp - x.pts / x.gp)[0];
	if (star && star.pts / star.gp >= 20) {
		sentences.push(
			`Watch ${star.name}: ${(star.pts / star.gp).toFixed(1)} points a game against the ${name(star.tid === game.home ? game.away : game.home)} over his last ${word(Math.min(star.gp, 7))} meetings.`,
		);
	}
	return {
		kind: "preview",
		gid: game.gid,
		season: game.season,
		tids: [game.home, game.away],
		score:
			50 +
			(tier === "Bitter" ? 20 : tier === "Heated" ? 10 : 0) +
			(game.marquee ? 10 : 0),
		head: game.marquee
			? `${MARQUEE_LABELS[game.marquee]}: ${A} at ${H}, rivalry renewed`
			: `Rivalry night: ${A} at ${H}`,
		body: sentences.join(" "),
	};
};

// Recaps of a season's big rivalry games: upsets, series clinchers, heated games (technicals, ejections), record nights
// and classics (overtime, a one-possession finish)
export const rivalryRecaps = ({
	games,
	history,
	name,
	isRival,
}: {
	// This season's logged games
	games: RivalryGame[];
	// Every logged game, for "record" performances in a pair
	history: RivalryGame[];
	name: Name;
	// Only pairs that count as rivals (score above the Mild tier, or tagged rivalry games)
	isRival: (gm: RivalryGame) => boolean;
}): RivalryArticleText[] => {
	const out: RivalryArticleText[] = [];
	const pairHigh = new Map<string, number>();
	for (const gm of history) {
		for (const p of gm.players) {
			// Only the games before this season set the bar
			if (games.some((x) => x.gid === gm.gid)) {
				continue;
			}
			pairHigh.set(gm.pair, Math.max(pairHigh.get(gm.pair) ?? 0, p.pts));
		}
	}
	for (const gm of sortGames(games)) {
		if (!isRival(gm)) {
			continue;
		}
		const w = winnerOf(gm);
		if (w < 0) {
			continue;
		}
		const l = w === gm.home ? gm.away : gm.home;
		const W = name(w);
		const L = name(l);
		const score = scoreLine(gm, name);
		const top = [...gm.players].sort((x, y) => y.pts - x.pts)[0];
		const tids: [number, number] = [w, l];
		const base = { gid: gm.gid, season: gm.season, tids };

		// Series clincher
		if (
			gm.playoffs &&
			gm.toWin &&
			gm.hSer !== undefined &&
			gm.aSer !== undefined &&
			Math.max(gm.hSer, gm.aSer) === gm.toWin
		) {
			const wS = Math.max(gm.hSer, gm.aSer);
			const lS = Math.min(gm.hSer, gm.aSer);
			out.push({
				...base,
				kind: "clincher",
				score: 90 + (gm.round ?? 0) * 5 + (lS === wS - 1 ? 10 : 0),
				head:
					lS === wS - 1
						? `${W} outlast the ${L} in game ${wS + lS}`
						: `${W} close out the ${L}, ${wS}-${lS}`,
				body: `${score}. The ${W} won the series ${wS}-${lS}${lS === wS - 1 ? " in a deciding game" : ""}${top ? `, with ${top.name} scoring ${top.pts}` : ""}.`,
			});
			continue;
		}
		// Upset: the winner's record going in was much worse
		const rec = (tid: number) => {
			const r = tid === gm.home ? gm.hRec : gm.aRec;
			if (!r) {
				return undefined;
			}
			const won = r[0] - (tid === w ? 1 : 0);
			const lost = r[1] - (tid === l ? 1 : 0);
			return won + lost > 0 ? { won, lost, p: won / (won + lost) } : undefined;
		};
		const rw = rec(w);
		const rl = rec(l);
		if (
			!gm.playoffs &&
			rw &&
			rl &&
			rl.won + rl.lost >= 10 &&
			rl.p - rw.p >= 0.2
		) {
			out.push({
				...base,
				kind: "upset",
				score: 60 + Math.round((rl.p - rw.p) * 100),
				head: `${W} stun the ${L}`,
				body: `${score}. The ${W} came in at ${rw.won}-${rw.lost}, the ${L} at ${rl.won}-${rl.lost}${top ? `; ${top.name} led everyone with ${top.pts} points` : ""}.`,
			});
			continue;
		}
		if ((gm.ejections ?? 0) > 0 || (gm.techs ?? 0) >= 3) {
			out.push({
				...base,
				kind: "heated",
				score: 55 + (gm.techs ?? 0) * 3 + (gm.ejections ?? 0) * 10,
				head: `Tempers flare as the ${W} beat the ${L}`,
				body: `${score}, in a game with ${plural(gm.techs ?? 0, "technical foul")}${gm.ejections ? ` and ${plural(gm.ejections, "ejection")}` : ""}.`,
			});
			continue;
		}
		const high = pairHigh.get(gm.pair) ?? 0;
		if (
			top &&
			(top.pts >= 40 || (high > 0 && top.pts > high && top.pts >= 30))
		) {
			out.push({
				...base,
				kind: "big night",
				score: 50 + top.pts,
				head: `${top.name} drops ${top.pts} in the rivalry`,
				body: `${top.name} scored ${top.pts}${top.trb >= 10 ? ` with ${top.trb} rebounds` : ""}${top.ast >= 10 ? ` and ${top.ast} assists` : ""} in ${score}${high > 0 && top.pts > high ? `, the most by anyone in this matchup since the log began (the old high was ${high})` : ""}.`,
			});
			continue;
		}
		if (gm.ot > 0 || margin(gm) <= 2) {
			out.push({
				...base,
				kind: "classic",
				score: 45 + gm.ot * 8 + (3 - Math.min(3, margin(gm))) * 3,
				head:
					gm.ot > 0
						? `${W} edge the ${L} in ${gm.ot === 1 ? "overtime" : `${word(gm.ot)} overtimes`}`
						: `${W} hold off the ${L}`,
				body: `${score}.${gm.clutch && gm.clutch.length > 0 ? ` ${gm.clutch[0]}` : ""}`,
			});
		}
	}
	return out.sort((x, y) => y.score - x.score || (y.gid ?? 0) - (x.gid ?? 0));
};

const plural = (n: number, s: string) => `${word(n)} ${s}${n === 1 ? "" : "s"}`;

// The storyline text for two teams meeting in the playoffs again
export const renewedText = ({
	a,
	b,
	season,
	meetings,
	name,
}: {
	a: number;
	b: number;
	season: number;
	// Earlier series, oldest first: winner, wins, losses, season
	meetings: { season: number; winner: number; wWon: number; wLost: number }[];
	name: Name;
}) => {
	const last = meetings.at(-1)!;
	const aWins = meetings.filter((m) => m.winner === a).length;
	const bWins = meetings.length - aWins;
	const n = meetings.length + 1;
	const gap = season - last.season;
	return {
		head: `Rivalry renewed: ${name(a)} and ${name(b)} meet again`,
		body: `The ${name(a)} and the ${name(b)} meet in the ${season} playoffs, their ${ordinal(n)} series${gap === 1 ? " in two seasons" : `, the first since ${last.season}`}, when the ${name(last.winner)} won ${last.wWon}-${last.wLost}. ${aWins === bWins ? `The playoff series stand even at ${aWins}-${bWins}.` : `The ${name(aWins > bWins ? a : b)} lead their playoff series ${Math.max(aWins, bWins)}-${Math.min(aWins, bWins)}.`}`,
	};
};
