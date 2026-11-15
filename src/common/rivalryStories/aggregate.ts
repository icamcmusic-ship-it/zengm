// Rivalry Stories: everything the rivalry page shows about one pair, built from the pair's game log (rivalryGames), its
// regular season head-to-head by season (headToHeads) and its playoff series. Pure, so it can be tested against raw games.
import {
	isFinals,
	rivalryTimeline,
	type RivalInput,
	type RivalSeries,
} from "../rivalries/index.ts";
import type { RivalryGame } from "./types.ts";

export type TeamSeasonLite = {
	tid: number;
	season: number;
	won: number;
	lost: number;
	playoffRoundsWon: number;
};

export type Crossing = {
	pid: number;
	name: string;
	season: number;
	from: number;
	to: number;
	how: "trade" | "signing" | "moved";
};

export type StoryGame = {
	gid: number;
	season: number;
	playoffs: boolean;
	round?: number;
	home: number;
	away: number;
	hPts: number;
	aPts: number;
	ot: number;
	marquee?: string;
	note: string;
	drama: number;
};

export type Duel = {
	pid: number;
	name: string;
	tid: number;
	gp: number;
	pts: number;
	ppg: number;
	best: number;
	bestGid: number;
	bestSeason: number;
};

export type DefenseRow = {
	pid: number;
	name: string;
	tid: number;
	dfga: number;
	dfgm: number;
	pct: number;
};

export type OnOffRow = {
	pid: number;
	name: string;
	tid: number;
	gp: number;
	onNet: number;
};

export type CoachMatchup = {
	coachA: string;
	coachB: string;
	aW: number;
	bW: number;
};

export type HeatRow = {
	season: number;
	heat: number;
	delta: number;
	why: string[];
};

export type Era = {
	from: number;
	to: number;
	aW: number;
	bW: number;
	seriesA: number;
	seriesB: number;
};

export type Streak = { tid: number; n: number; from?: number; to?: number };

export type RivalryStory = {
	a: number;
	b: number;
	record: {
		rsA: number;
		rsB: number;
		tied: number;
		poA: number;
		poB: number;
		seriesA: number;
		seriesB: number;
	};
	eras: Era[];
	// From the game log (seasons it covers)
	logged: { games: number; from?: number; to?: number };
	current?: Streak;
	longest: Streak[];
	bestGames: StoryGame[];
	closestGames: StoryGame[];
	duels: Duel[];
	defense: DefenseRow[];
	onOff: OnOffRow[];
	crossings: Crossing[];
	coaches: CoachMatchup[];
	marquee: { nationalTv: number; holiday: number; rivalryGames: number };
	heat: HeatRow[];
	avgMargin?: number;
	ot: number;
};

const winnerOf = (gm: RivalryGame) =>
	gm.hPts > gm.aPts ? gm.home : gm.aPts > gm.hPts ? gm.away : -1;

export const sortGames = (games: RivalryGame[]) =>
	[...games].sort(
		(x, y) =>
			x.season - y.season ||
			(x.playoffs ? 1 : 0) - (y.playoffs ? 1 : 0) ||
			(x.day ?? 0) - (y.day ?? 0) ||
			x.gid - y.gid,
	);

const HOLIDAYS = new Set(["openingNight", "christmas", "mlk"]);

// How memorable a game was, from the log alone: close and overtime finishes, playoff stakes (a clinching or elimination
// game, a game 7), big individual lines and clutch plays
export const drama = (gm: RivalryGame) => {
	const margin = Math.abs(gm.hPts - gm.aPts);
	let d = Math.max(0, 12 - margin) * 3 + gm.ot * 10;
	if (gm.playoffs) {
		d += 10 + (gm.round ?? 0) * 4;
		if (gm.toWin && gm.hSer !== undefined && gm.aSer !== undefined) {
			if (gm.hSer === gm.toWin || gm.aSer === gm.toWin) {
				d += 12;
			}
			if (gm.hSer === gm.toWin && gm.aSer === gm.toWin - 1) {
				d += 15;
			} else if (gm.aSer === gm.toWin && gm.hSer === gm.toWin - 1) {
				d += 15;
			}
		}
	}
	const top = Math.max(0, ...gm.players.map((p) => p.pts));
	d += Math.max(0, top - 30) * 1.5;
	d += (gm.clutch?.length ?? 0) * 5;
	d += (gm.techs ?? 0) * 2 + (gm.ejections ?? 0) * 5;
	return Math.round(d);
};

const gameNote = (gm: RivalryGame, name: (tid: number) => string) => {
	const bits: string[] = [];
	if (gm.ot > 0) {
		bits.push(gm.ot === 1 ? "OT" : `${gm.ot}OT`);
	}
	if (gm.playoffs) {
		if (gm.toWin && gm.hSer !== undefined && gm.aSer !== undefined) {
			const w = Math.max(gm.hSer, gm.aSer);
			const l = Math.min(gm.hSer, gm.aSer);
			if (w === gm.toWin) {
				bits.push(
					w === l + 1 && l === gm.toWin - 1
						? `game ${w + l}, won the series`
						: "clinched the series",
				);
			} else {
				bits.push(`playoffs, game ${w + l}`);
			}
		} else {
			bits.push("playoffs");
		}
	}
	const top = [...gm.players].sort((x, y) => y.pts - x.pts)[0];
	if (top && top.pts >= 30) {
		bits.push(`${top.name} ${top.pts} pts`);
	}
	if (gm.clutch && gm.clutch.length > 0 && gm.players.length > 0) {
		bits.push("clutch finish");
	}
	if (gm.ejections) {
		bits.push(gm.ejections === 1 ? "an ejection" : `${gm.ejections} ejections`);
	} else if ((gm.techs ?? 0) >= 3) {
		bits.push(`${gm.techs} technicals`);
	}
	void name;
	return bits.join(", ");
};

const toStoryGame = (
	gm: RivalryGame,
	name: (tid: number) => string,
): StoryGame => ({
	gid: gm.gid,
	season: gm.season,
	playoffs: gm.playoffs,
	...(gm.round !== undefined ? { round: gm.round } : {}),
	home: gm.home,
	away: gm.away,
	hPts: gm.hPts,
	aPts: gm.aPts,
	ot: gm.ot,
	...(gm.marquee ? { marquee: gm.marquee } : {}),
	note: gameNote(gm, name),
	drama: drama(gm),
});

// Streaks over the logged games, oldest first. Ties end a streak.
export const streaksOf = (games: RivalryGame[]) => {
	const sorted = sortGames(games);
	let cur: Streak | undefined;
	const all: Streak[] = [];
	for (const gm of sorted) {
		const w = winnerOf(gm);
		if (w < 0) {
			if (cur) {
				all.push(cur);
			}
			cur = undefined;
			continue;
		}
		if (cur && cur.tid === w) {
			cur.n += 1;
			cur.to = gm.season;
		} else {
			if (cur) {
				all.push(cur);
			}
			cur = { tid: w, n: 1, from: gm.season, to: gm.season };
		}
	}
	const current = cur ? { ...cur } : undefined;
	if (cur) {
		all.push(cur);
	}
	const longest = (tid: number) =>
		all
			.filter((s) => s.tid === tid)
			.sort((x, y) => y.n - x.n || (y.to ?? 0) - (x.to ?? 0))[0];
	return { current, longest };
};

const ERA_LENGTH = 5;

export const buildRivalryStory = ({
	input,
	games,
	teamSeasons = [],
	crossings = [],
	name,
}: {
	input: RivalInput;
	games: RivalryGame[];
	teamSeasons?: TeamSeasonLite[];
	crossings?: Crossing[];
	name: (tid: number) => string;
}): RivalryStory => {
	const { a, b } = input;
	const sorted = sortGames(games);

	// All-time record: regular season from the head-to-head table (whole history), playoff games from the series
	let rsA = 0;
	let rsB = 0;
	let tied = 0;
	for (const r of input.rs) {
		rsA += r.aW;
		rsB += r.bW;
		tied += r.tied;
	}
	let poA = 0;
	let poB = 0;
	let seriesA = 0;
	let seriesB = 0;
	for (const s of input.series) {
		if (s.winner === a) {
			poA += s.wWon;
			poB += s.wLost;
			seriesA += 1;
		} else {
			poB += s.wWon;
			poA += s.wLost;
			seriesB += 1;
		}
	}

	// Eras: blocks of 5 seasons from the first season they met
	const seasons = [
		...input.rs.map((r) => r.season),
		...input.series.map((s) => s.season),
	];
	const eras: Era[] = [];
	if (seasons.length > 0) {
		const first = Math.min(...seasons);
		const last = Math.max(...seasons);
		for (let from = first; from <= last; from += ERA_LENGTH) {
			const to = Math.min(last, from + ERA_LENGTH - 1);
			const inEra = (s: number) => s >= from && s <= to;
			const era: Era = { from, to, aW: 0, bW: 0, seriesA: 0, seriesB: 0 };
			for (const r of input.rs.filter((x) => inEra(x.season))) {
				era.aW += r.aW;
				era.bW += r.bW;
			}
			for (const s of input.series.filter((x) => inEra(x.season))) {
				if (s.winner === a) {
					era.seriesA += 1;
				} else {
					era.seriesB += 1;
				}
			}
			eras.push(era);
		}
	}

	const { current, longest } = streaksOf(sorted);
	const longestList = [longest(a), longest(b)].filter(
		(x): x is Streak => x !== undefined,
	);

	const story = sorted.map((gm) => toStoryGame(gm, name));
	const bestGames = [...story]
		.sort((x, y) => y.drama - x.drama || y.season - x.season || y.gid - x.gid)
		.slice(0, 5);
	const closestGames = [...story]
		.sort(
			(x, y) =>
				Math.abs(x.hPts - x.aPts) - Math.abs(y.hPts - y.aPts) ||
				y.ot - x.ot ||
				y.season - x.season ||
				y.gid - x.gid,
		)
		.slice(0, 5);

	// Players: scoring against the other side, defense and on/off in the pair's games
	const duelMap = new Map<string, Duel>();
	const defMap = new Map<string, DefenseRow>();
	const onMap = new Map<string, OnOffRow>();
	for (const gm of sorted) {
		for (const p of gm.players) {
			const k = `${p.pid}|${p.tid}`;
			let d = duelMap.get(k);
			if (!d) {
				d = {
					pid: p.pid,
					name: p.name,
					tid: p.tid,
					gp: 0,
					pts: 0,
					ppg: 0,
					best: -1,
					bestGid: gm.gid,
					bestSeason: gm.season,
				};
				duelMap.set(k, d);
			}
			d.gp += 1;
			d.pts += p.pts;
			if (p.pts > d.best) {
				d.best = p.pts;
				d.bestGid = gm.gid;
				d.bestSeason = gm.season;
			}
			if (p.dfga !== undefined) {
				let r = defMap.get(k);
				if (!r) {
					r = {
						pid: p.pid,
						name: p.name,
						tid: p.tid,
						dfga: 0,
						dfgm: 0,
						pct: 0,
					};
					defMap.set(k, r);
				}
				r.dfga += p.dfga;
				r.dfgm += p.dfgm ?? 0;
			}
			if (p.onNet !== undefined) {
				let r = onMap.get(k);
				if (!r) {
					r = { pid: p.pid, name: p.name, tid: p.tid, gp: 0, onNet: 0 };
					onMap.set(k, r);
				}
				r.gp += 1;
				r.onNet += p.onNet;
			}
		}
	}
	const duels = [...duelMap.values()]
		.map((d) => ({ ...d, ppg: d.gp > 0 ? d.pts / d.gp : 0 }))
		.sort((x, y) => y.pts - x.pts || x.pid - y.pid)
		.slice(0, 10);
	const defense = [...defMap.values()]
		.filter((r) => r.dfga >= 15)
		.map((r) => ({ ...r, pct: r.dfgm / r.dfga }))
		.sort((x, y) => x.pct - y.pct || y.dfga - x.dfga)
		.slice(0, 6);
	const onOff = [...onMap.values()]
		.filter((r) => r.gp >= 2)
		.sort((x, y) => y.onNet - x.onNet || x.pid - y.pid)
		.slice(0, 6);

	// Coaching matchups (head coaches at the time of each game)
	const coachMap = new Map<string, CoachMatchup>();
	for (const gm of sorted) {
		if (!gm.coaches) {
			continue;
		}
		const ca = gm.home === a ? gm.coaches[0] : gm.coaches[1];
		const cb = gm.home === a ? gm.coaches[1] : gm.coaches[0];
		if (!ca || !cb) {
			continue;
		}
		const k = `${ca}|${cb}`;
		let m = coachMap.get(k);
		if (!m) {
			m = { coachA: ca, coachB: cb, aW: 0, bW: 0 };
			coachMap.set(k, m);
		}
		const w = winnerOf(gm);
		if (w === a) {
			m.aW += 1;
		} else if (w === b) {
			m.bW += 1;
		}
	}
	const coaches = [...coachMap.values()]
		.sort((x, y) => y.aW + y.bW - (x.aW + x.bW))
		.slice(0, 6);

	const marquee = { nationalTv: 0, holiday: 0, rivalryGames: 0 };
	for (const gm of sorted) {
		if (gm.marquee === "nationalTv") {
			marquee.nationalTv += 1;
		} else if (gm.marquee && HOLIDAYS.has(gm.marquee)) {
			marquee.holiday += 1;
		}
		if (gm.rivalry) {
			marquee.rivalryGames += 1;
		}
	}

	const heat = heatTimeline({
		input,
		games: sorted,
		teamSeasons,
		crossings,
		name,
	});

	const margins = sorted.map((gm) => Math.abs(gm.hPts - gm.aPts));
	return {
		a,
		b,
		record: { rsA, rsB, tied, poA, poB, seriesA, seriesB },
		eras,
		logged: {
			games: sorted.length,
			...(sorted.length > 0
				? { from: sorted[0]!.season, to: sorted.at(-1)!.season }
				: {}),
		},
		...(current ? { current } : {}),
		longest: longestList,
		bestGames,
		closestGames,
		duels,
		defense,
		onOff,
		crossings: [...crossings].sort((x, y) => y.season - x.season),
		coaches,
		marquee,
		heat,
		...(margins.length > 0
			? { avgMargin: margins.reduce((s, x) => s + x, 0) / margins.length }
			: {}),
		ot: sorted.filter((gm) => gm.ot > 0).length,
	};
};

const roundName = (s: RivalSeries) => {
	if (isFinals(s)) {
		return "the Finals";
	}
	const fromEnd = s.numRounds - 1 - s.round;
	if (fromEnd === 1) {
		return "the semifinals";
	}
	return `round ${s.round + 1}`;
};

// The rivalry score season by season (the same score as the rest of the Rivalries page) with what moved it: playoff
// meetings, close games, the standings (two good teams close together) and players crossing over
export const heatTimeline = ({
	input,
	games,
	teamSeasons,
	crossings,
	name,
}: {
	input: RivalInput;
	games: RivalryGame[];
	teamSeasons: TeamSeasonLite[];
	crossings: Crossing[];
	name: (tid: number) => string;
}): HeatRow[] => {
	const { a, b } = input;
	const rows = rivalryTimeline(input);
	let prev = 0;
	return rows.map((r) => {
		const why: string[] = [];
		if (r.series) {
			const s = r.series;
			why.push(
				`met in ${roundName(s)}: ${name(s.winner)} won ${s.wWon}-${s.wLost}${s.wSeed !== undefined && s.lSeed !== undefined && s.wSeed > s.lSeed ? " (an upset)" : ""}`,
			);
		}
		const inSeason = games.filter((gm) => gm.season === r.season);
		const close = inSeason.filter(
			(gm) => gm.ot > 0 || Math.abs(gm.hPts - gm.aPts) <= 3,
		).length;
		if (close > 0) {
			why.push(`${close} close game${close === 1 ? "" : "s"}`);
		}
		const ta = teamSeasons.find((t) => t.tid === a && t.season === r.season);
		const tb = teamSeasons.find((t) => t.tid === b && t.season === r.season);
		if (ta && tb && ta.won + ta.lost > 0 && tb.won + tb.lost > 0) {
			const wa = ta.won / (ta.won + ta.lost);
			const wb = tb.won / (tb.won + tb.lost);
			const gb = Math.abs(ta.won - ta.lost - (tb.won - tb.lost)) / 2;
			if (wa >= 0.55 && wb >= 0.55 && gb <= 5) {
				why.push(
					gb === 0
						? "both contenders, level in the standings"
						: `both contenders, ${gb} games apart`,
				);
			} else if (Math.abs(wa - wb) >= 0.3) {
				why.push(
					`lopsided: ${name(wa > wb ? a : b)} ${Math.max(ta.won, tb.won)} wins, ${name(wa > wb ? b : a)} ${wa > wb ? tb.won : ta.won}`,
				);
			}
		}
		const moves = crossings.filter((c) => c.season === r.season);
		for (const c of moves.slice(0, 2)) {
			why.push(
				`${c.name} ${c.how === "trade" ? "was traded" : c.how === "signing" ? "signed" : "moved"} from the ${name(c.from)} to the ${name(c.to)}`,
			);
		}
		if (r.aW + r.bW > 0 && Math.min(r.aW, r.bW) === 0 && r.aW + r.bW >= 3) {
			why.push(`${name(r.aW > r.bW ? a : b)} swept the season series`);
		}
		const delta = r.score - prev;
		if (why.length === 0) {
			why.push(
				delta < 0
					? "no playoff meeting or close games: the history fades"
					: "a quiet season",
			);
		}
		prev = r.score;
		return { season: r.season, heat: r.score, delta, why };
	});
};
