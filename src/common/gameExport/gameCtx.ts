// Per-game download (Game Log, "Download game data"): what the basketball sim records with each box score line for the file.

// Recorded with each player's box score line at game time (basketball, writeGameStats), for this file only: his playing time setting
// (ptm, when not 1), minutes restriction (restr, the factor, when below 1), whether he was rested (rest) and the minutes the rotation
// planned for him at tip-off (plan) and at the end (planEnd, Realistic Rotations), his energy at the end of each period (en).
// Presentation only: read after the game is over
export type GameCtx = {
	ptm?: number;
	restr?: number;
	rest?: 1;
	plan?: number;
	planEnd?: number;
	// His energy (0-1, 1 fresh) at the end of each period, overtimes included (players who played)
	en?: number[];
};

const round2 = (x: number) => Math.round(x * 100) / 100;

export const gameCtxOf = (
	rows:
		| readonly {
				pid: number;
				ptm?: number;
				restr?: number;
				rest?: boolean;
				plan?: number;
				planEnd?: number;
				energy?: number[];
		  }[]
		| undefined,
	pid: number,
): GameCtx | undefined => {
	const row = rows?.find((r) => r.pid === pid);
	if (!row) {
		return;
	}
	const out: GameCtx = {};
	if (typeof row.ptm === "number" && row.ptm !== 1) {
		out.ptm = round2(row.ptm);
	}
	if (typeof row.restr === "number" && row.restr < 1) {
		out.restr = round2(row.restr);
	}
	if (row.rest) {
		out.rest = 1;
	}
	if (typeof row.plan === "number" && Number.isFinite(row.plan)) {
		out.plan = Math.round(row.plan * 10) / 10;
	}
	if (typeof row.planEnd === "number" && Number.isFinite(row.planEnd)) {
		out.planEnd = Math.round(row.planEnd * 10) / 10;
	}
	if (Array.isArray(row.energy) && row.energy.length > 0) {
		out.en = row.energy;
	}
	return out;
};
