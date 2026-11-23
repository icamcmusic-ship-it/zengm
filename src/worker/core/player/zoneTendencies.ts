// Game Sim Fixes (basketball): players slowly shift their shot mix toward the zones where they shoot best. Each preseason, a player's
// last regular season in each shot zone (three, mid-range, at the rim, post) is compared with the league's FG% there; the shrunk
// relative make rate moves his zone tendency (a multiplier on how often he picks that zone in the sim), kept partly from the year
// before, centered on his own shot mix (only the mix moves, not how much he shoots) and bounded. Stored on the season's ratings row
// (`zt`: [three, mid, rim, post]); the sim reads it with Game Sim Fixes on. Deterministic: no random numbers.
import type { Player } from "../../../common/types.ts";

export const ZONE_TEND = {
	// Prior attempts at the league's FG% in each zone (so 50 threes say little, 500 a lot)
	prior: 150,
	// How far one season moves the log tendency per unit of relative make rate (+0.1 = 10% better than the league there)
	learn: 0.6,
	// How much of last year's (log) tendency is kept
	keep: 0.7,
	// Below this many FGA in the season, nothing is learned (the old tendency fades by keep)
	minFga: 100,
	min: 0.85,
	max: 1.18,
};

// The order of `zt`, and the stats of each zone
export const ZONES = [
	["tpa", "tp"],
	["fgaMidRange", "fgMidRange"],
	["fgaAtRim", "fgAtRim"],
	["fgaLowPost", "fgLowPost"],
] as const;

type ZoneStats = { fga: number[]; fg: number[] };

const seasonZoneStats = (p: Player, season: number): ZoneStats => {
	const fga = [0, 0, 0, 0];
	const fg = [0, 0, 0, 0];
	for (const row of p.stats) {
		if (row.season !== season || row.playoffs) {
			continue;
		}
		ZONES.forEach(([a, m], i) => {
			fga[i]! += (row as any)[a] ?? 0;
			fg[i]! += (row as any)[m] ?? 0;
		});
	}
	return { fga, fg };
};

const clamp = (x: number) =>
	Math.max(ZONE_TEND.min, Math.min(ZONE_TEND.max, x));

// One player's new tendencies from his old ones, his season's zone stats and the league's FG% by zone
export const nextZoneTendency = (
	old: number[] | undefined,
	stats: ZoneStats,
	leagueFgp: number[],
) => {
	const total = stats.fga.reduce((a, b) => a + b, 0);
	const logs = ZONES.map((_z, i) => {
		const prev = Math.log(old?.[i] ?? 1) * ZONE_TEND.keep;
		const lg = leagueFgp[i]!;
		if (total < ZONE_TEND.minFga || !(lg > 0)) {
			return prev;
		}
		const a = stats.fga[i]!;
		const rel =
			(stats.fg[i]! + ZONE_TEND.prior * lg) / (a + ZONE_TEND.prior) / lg - 1;
		return prev + ZONE_TEND.learn * rel;
	});
	// Centered on his shot mix (his zones' shares this season, or even shares without one), so only the mix moves
	const weights =
		total > 0 ? stats.fga.map((x) => x / total) : ZONES.map(() => 0.25);
	let mean = 0;
	for (const [i, w] of weights.entries()) {
		mean += w * Math.exp(logs[i]!);
	}
	const out = logs.map((x) => clamp(Math.exp(x) / mean));
	// (all 1: nothing stored)
	if (out.every((x) => Math.abs(x - 1) < 0.0005)) {
		return undefined;
	}
	return out.map((x) => Math.round(x * 1000) / 1000);
};

// Every player's tendencies for the new season (on his newest ratings row), from the season before. players: everyone whose stats count
// for the league's averages (the non-retired players)
export const updateZoneTendencies = (players: Player[], newSeason: number) => {
	const season = newSeason - 1;
	const all = players.map((p) => seasonZoneStats(p, season));
	const fga = [0, 0, 0, 0];
	const fg = [0, 0, 0, 0];
	for (const s of all) {
		for (let i = 0; i < 4; i++) {
			fga[i]! += s.fga[i]!;
			fg[i]! += s.fg[i]!;
		}
	}
	const leagueFgp = fga.map((a, i) => (a > 0 ? fg[i]! / a : 0));
	if (leagueFgp.some((x) => x <= 0)) {
		// (no season played, e.g. a new league)
		return;
	}
	players.forEach((p, j) => {
		const r = p.ratings.at(-1) as any;
		if (!r || r.season !== newSeason) {
			return;
		}
		const zt = nextZoneTendency(r.zt, all[j]!, leagueFgp);
		if (zt) {
			r.zt = zt;
		} else {
			delete r.zt;
		}
	});
};
