// Pure helpers that turn stored players and games into newspaper facts. They take plain objects and touch no database, so they can be tested directly.

import { PHASE } from "../../common/constants.ts";
import { getProAwards, getProStats } from "../../common/preDraft.ts";
import type {
	EditionId,
	NPCareer,
	NPHeadToHead,
	NPHonors,
	NPLine,
} from "../../common/newspaper/types.ts";
import type { Game, Player } from "../../common/types.ts";

type NPLineExtras = {
	gs: number;
	ftp: number; // -1 when there were no attempts
	tov: number;
	pf: number;
	orb: number;
	ows: number;
	dws: number;
	pm: number;
	fta: number;
	tpa: number;
};

export const num = (x: unknown) =>
	typeof x === "number" && Number.isFinite(x) ? x : 0;

type StatRow = Player["stats"][number];

const sumRows = (rows: StatRow[], key: string) =>
	rows.reduce((acc, row) => acc + num((row as any)[key]), 0);

// Sum a player's stat rows for one season and type, then turn into per game numbers
export const lineFor = (
	p: Pick<Player, "stats">,
	season: number,
	playoffs: boolean,
): (NPLine & NPLineExtras) | undefined => {
	const rows = getProStats(p).filter(
		(s) => s.season === season && s.playoffs === playoffs,
	);
	if (rows.length === 0) {
		return undefined;
	}
	const sum = (key: string) => sumRows(rows, key);
	const gp = sum("gp");
	if (gp === 0) {
		return undefined;
	}
	const min = sum("min");
	const trb = sum("drb") + sum("orb") || sum("trb");
	const fga = sum("fga");
	const tpa = sum("tpa");
	const fta = sum("fta");
	const per =
		min > 0
			? rows.reduce((acc, row) => acc + num(row.per) * num(row.min), 0) / min
			: 0;
	return {
		gp,
		min: min / gp,
		pts: sum("pts") / gp,
		trb: trb / gp,
		ast: sum("ast") / gp,
		stl: sum("stl") / gp,
		blk: sum("blk") / gp,
		per,
		ws: sum("ows") + sum("dws"),
		fgp: fga > 0 ? (100 * sum("fg")) / fga : 0,
		tpp: tpa > 0 ? (100 * sum("tp")) / tpa : 0,
		tp: sum("tp") / gp,
		// Extras the engine reads only when they are present
		gs: sum("gs") / gp,
		ftp: fta > 0 ? (100 * sum("ft")) / fta : -1,
		tov: sum("tov") / gp,
		pf: sum("pf") / gp,
		orb: sum("orb") / gp,
		ows: sum("ows"),
		dws: sum("dws"),
		pm: sum("pm") / gp,
		fta: sum("fta") / gp,
		tpa: sum("tpa") / gp,
	};
};

// The team a player played for most that season (or his current team)
export const seasonTid = (p: Pick<Player, "stats" | "tid">, season: number) => {
	const rows = getProStats(p).filter((s) => s.season === season && !s.playoffs);
	if (rows.length === 0) {
		return p.tid;
	}
	// Last stint is where he ended up
	return rows.at(-1)!.tid;
};

// Regular-season totals before a season
export const careerBefore = (
	p: Pick<Player, "stats">,
	season: number,
): NPCareer | undefined => {
	const rows = getProStats(p).filter((s) => !s.playoffs && s.season < season);
	const gp = sumRows(rows, "gp");
	if (gp === 0) {
		return undefined;
	}
	const trb = sumRows(rows, "orb") + sumRows(rows, "drb") || sumRows(rows, "trb");
	return {
		gp,
		pts: Math.round(sumRows(rows, "pts")),
		trb: Math.round(trb),
		ast: Math.round(sumRows(rows, "ast")),
		stl: Math.round(sumRows(rows, "stl")),
		blk: Math.round(sumRows(rows, "blk")),
		tp: Math.round(sumRows(rows, "tp")),
		ws: sumRows(rows, "ows") + sumRows(rows, "dws"),
		seasons: new Set(rows.filter((r) => num(r.gp) > 0).map((s) => s.season))
			.size,
	};
};

// Honors won in seasons before this one
export const honorsBefore = (
	p: Pick<Player, "awards">,
	season: number,
): NPHonors => {
	const out: NPHonors = { mvp: 0, dpoy: 0, allStar: 0, allLeague: 0, titles: 0 };
	for (const a of getProAwards(p) as any[]) {
		if (a.season >= season) {
			continue;
		}
		const name = String(a.name ?? a.type ?? "");
		if (a.type === "Won Championship") {
			out.titles += 1;
		} else if (a.type === "All-Star") {
			out.allStar += 1;
		} else if (a.group === undefined && a.numTeams === undefined) {
			if (name === "Most Valuable Player") {
				out.mvp += 1;
			} else if (name === "Defensive Player of the Year") {
				out.dpoy += 1;
			}
		}
		if (/All-League/.test(name) && a.group === undefined) {
			out.allLeague += 1;
		}
	}
	return out;
};

export type GameAggregates = {
	teams: Map<
		number,
		{
			close: { w: number; l: number };
			ot: { w: number; l: number };
			bestStreak: number;
			worstStreak: number;
		}
	>;
	players: Map<
		number,
		{ dd: number; td: number; g30: number; g40: number; hi: number; boxGp: number }
	>;
	h2h: NPHeadToHead[];
};

// Facts only the box scores know: close and overtime records, streaks, double-doubles and 30-point games, season series
export const aggregateGames = (games: Game[]): GameAggregates => {
	const teams: GameAggregates["teams"] = new Map();
	const players: GameAggregates["players"] = new Map();
	const pair = new Map<string, NPHeadToHead>();
	const run = new Map<number, number>();

	const team = (tid: number) => {
		let t = teams.get(tid);
		if (!t) {
			t = {
				close: { w: 0, l: 0 },
				ot: { w: 0, l: 0 },
				bestStreak: 0,
				worstStreak: 0,
			};
			teams.set(tid, t);
		}
		return t;
	};

	const ordered = games
		.filter((game) => !game.playoffs && game.won && game.lost)
		.toSorted((a, b) => (a.day ?? a.gid) - (b.day ?? b.gid) || a.gid - b.gid);

	for (const game of ordered) {
		const margin = game.won.pts - game.lost.pts;
		const w = team(game.won.tid);
		const l = team(game.lost.tid);
		if (margin <= 5) {
			w.close.w += 1;
			l.close.l += 1;
		}
		if (game.overtimes > 0) {
			w.ot.w += 1;
			l.ot.l += 1;
		}
		for (const [tid, won] of [
			[game.won.tid, true],
			[game.lost.tid, false],
		] as const) {
			const prev = run.get(tid) ?? 0;
			const next = won ? (prev > 0 ? prev + 1 : 1) : prev < 0 ? prev - 1 : -1;
			run.set(tid, next);
			const t = team(tid);
			t.bestStreak = Math.max(t.bestStreak, next);
			t.worstStreak = Math.max(t.worstStreak, -next);
		}

		const lo = Math.min(game.won.tid, game.lost.tid);
		const hi = Math.max(game.won.tid, game.lost.tid);
		const key = `${lo}-${hi}`;
		let h = pair.get(key);
		if (!h) {
			h = { a: lo, b: hi, aw: 0, bw: 0, margin: 0 };
			pair.set(key, h);
		}
		const aWon = game.won.tid === lo;
		if (aWon) {
			h.aw += 1;
		} else {
			h.bw += 1;
		}
		h.margin += aWon ? margin : -margin;

		for (const t of game.teams) {
			for (const b of (t.players ?? []) as any[]) {
				if (num(b.min) <= 0 || b.pid === undefined) {
					continue;
				}
				const pts = num(b.pts);
				const trb = num(b.trb) || num(b.orb) + num(b.drb);
				const cats = [pts, trb, num(b.ast), num(b.stl), num(b.blk)].filter(
					(x) => x >= 10,
				).length;
				let s = players.get(b.pid);
				if (!s) {
					s = { dd: 0, td: 0, g30: 0, g40: 0, hi: 0, boxGp: 0 };
					players.set(b.pid, s);
				}
				s.boxGp += 1;
				if (cats >= 2) {
					s.dd += 1;
				}
				if (cats >= 3) {
					s.td += 1;
				}
				if (pts >= 30) {
					s.g30 += 1;
				}
				if (pts >= 40) {
					s.g40 += 1;
				}
				s.hi = Math.max(s.hi, pts);
			}
		}
	}

	return { teams, players, h2h: [...pair.values()] };
};

// Which edition a season's paper is: a past season is always the final edition, the season in progress depends on the phase and on whether any game has been played
export const pickEdition = ({
	season,
	currentSeason,
	phase,
	gp,
}: {
	season: number;
	currentSeason: number;
	phase: number;
	gp: number;
}): EditionId => {
	if (season < currentSeason) {
		return "final";
	}
	if (phase >= PHASE.DRAFT_LOTTERY) {
		return "final";
	}
	if (phase === PHASE.PLAYOFFS) {
		return "playoffs";
	}
	if (phase < PHASE.REGULAR_SEASON || gp === 0) {
		return "preseason";
	}
	return "midseason";
};

export const REBUILD_EVERY_GAMES = 6;

// What the view does when something happened: nothing, show the paper it already built, or build a new one. Past seasons never change, so their papers are kept; the season in progress is rebuilt when a phase changes or several days have been played, not on every simmed day.
export const decideRebuild = ({
	inputsChanged,
	structural,
	simmed,
	isCurrent,
	cached,
	sameStamp,
	gpDelta,
}: {
	inputsChanged: boolean;
	structural: boolean;
	simmed: boolean;
	isCurrent: boolean;
	cached: boolean;
	sameStamp: boolean;
	gpDelta: number;
}): "skip" | "reuse" | "build" => {
	if (!inputsChanged && !structural && !(simmed && isCurrent)) {
		return "skip";
	}
	if (cached && sameStamp) {
		const stale = isCurrent && Math.abs(gpDelta) >= REBUILD_EVERY_GAMES;
		if (!stale && !(structural && isCurrent)) {
			return inputsChanged ? "reuse" : "skip";
		}
	}
	return "build";
};
