// Builds the compact rivalry log record of one game from its box score (pure, so the backfill from stored box scores and
// the after-game hook make the same record).
import type { Game } from "../types.ts";
import { pairOf, type RGPlayer, type RivalryGame } from "./types.ts";

export type RecordExtras = {
	round?: number;
	// pid -> [defended FGA, defended FGM, on-floor net points] for this game (Advanced Tracking Stats)
	adv?: Map<number, [number, number, number]>;
	techs?: number;
	ejections?: number;
	coaches?: [string | null, string | null];
};

const plain = (html: string) =>
	html
		.replace(/<[^>]*>/g, "")
		.replace(/\s+/g, " ")
		.trim();

export const rivalryGameFromBox = (
	game: Game,
	extras: RecordExtras = {},
): RivalryGame | undefined => {
	const [t0, t1] = game.teams;
	if (!t0 || !t1 || t0.tid < 0 || t1.tid < 0 || t0.tid === t1.tid) {
		return undefined;
	}
	const players: RGPlayer[] = [];
	for (const t of [t0, t1]) {
		for (const p of (t.players ?? []) as any[]) {
			if (!(p.min > 0)) {
				continue;
			}
			const row: RGPlayer = {
				pid: p.pid,
				name: p.name,
				tid: t.tid,
				min: Math.round(p.min * 10) / 10,
				pts: p.pts ?? 0,
				trb: p.trb ?? (p.orb ?? 0) + (p.drb ?? 0),
				ast: p.ast ?? 0,
				fg: p.fg ?? 0,
				fga: p.fga ?? 0,
			};
			const adv = extras.adv?.get(p.pid);
			if (adv) {
				row.dfga = adv[0];
				row.dfgm = adv[1];
				row.onNet = adv[2];
			}
			players.push(row);
		}
	}
	const out: RivalryGame = {
		gid: game.gid,
		season: game.season,
		pair: pairOf(t0.tid, t1.tid),
		playoffs: !!game.playoffs,
		home: t0.tid,
		away: t1.tid,
		hPts: t0.pts,
		aPts: t1.pts,
		ot: game.overtimes ?? 0,
		players,
	};
	if (game.day !== undefined) {
		out.day = game.day;
	}
	if (extras.round !== undefined && game.playoffs) {
		out.round = extras.round;
	}
	if (typeof t0.won === "number" && typeof t0.lost === "number") {
		out.hRec = [t0.won, t0.lost];
	}
	if (typeof t1.won === "number" && typeof t1.lost === "number") {
		out.aRec = [t1.won, t1.lost];
	}
	if (t0.playoffs && t1.playoffs && game.numGamesToWinSeries) {
		out.hSer = t0.playoffs.won;
		out.aSer = t1.playoffs.won;
		out.toWin = game.numGamesToWinSeries;
	}
	if (game.marquee !== undefined) {
		out.marquee = game.marquee;
	}
	if (game.rivalry) {
		out.rivalry = true;
	}
	if (extras.techs) {
		out.techs = extras.techs;
	}
	if (extras.ejections) {
		out.ejections = extras.ejections;
	}
	if (game.clutchPlays && game.clutchPlays.length > 0) {
		out.clutch = game.clutchPlays.slice(0, 3).map(plain);
	}
	if (extras.coaches && (extras.coaches[0] || extras.coaches[1])) {
		out.coaches = extras.coaches;
	}
	return out;
};
