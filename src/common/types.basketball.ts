import type teamStats from "../worker/core/team/stats.basketball.ts";
import type playerStats from "../worker/core/player/stats.basketball.ts";
import type { statFunctions as playerStatFunctions } from "./processPlayerStats.basketball.ts";
import type { PlayerStatMax } from "./types.ts";
import type { AdvStatKey } from "./advStats.ts";

// Should all the extra ones be in teamStats["derived"]?
export type TeamStatAttr =
	| (typeof teamStats)["raw"][number]
	| "fgp"
	| "oppFgp"
	| "fgpAtRim"
	| "oppFgpAtRim"
	| "fgpLowPost"
	| "oppFgpLowPost"
	| "fgpMidRange"
	| "oppFgpMidRange"
	| "tpp"
	| "oppTpp"
	| "ftp"
	| "oppFtp"
	| "mov"
	| "oppMov"
	| "pw"
	| "pl"
	| "ortg"
	| "drtg"
	| "nrtg"
	| "pace"
	| "poss"
	| "tpar"
	| "ftr"
	| "tsp"
	| "efg"
	| "tovp"
	| "orbp"
	| "ftpFga"
	| "trb"
	| "oppTrb"
	| "2p"
	| "2pa"
	| "2pp"
	| "opp2p"
	| "opp2pa"
	| "opp2pp"
	| "oppEfg"
	| "oppTovp"
	| "drbp"
	| "oppFtpFga";

// Stats row as stored in the database, in p.stats
export type PlayerStats = Record<
	(typeof playerStats)["raw"][number] | (typeof playerStats)["derived"][number],
	number | undefined
> &
	Record<(typeof playerStats)["max"][number], PlayerStatMax> & {
		// Only in historical real stats, from before orb/drb were tracked separately
		trb?: number;
	};

// Numeric stats can be undefined in historical data from before a stat was tracked (even gp and min)
export type PlayerStatsPlus = Record<
	| (typeof playerStats)["raw"][number]
	| (typeof playerStats)["derived"][number]
	| keyof typeof playerStatFunctions
	| AdvStatKey,
	number | undefined
> &
	Record<(typeof playerStats)["max"][number], PlayerStatMax>;

export type PlayerRatings = {
	diq: number;
	dnk: number;
	drb: number;
	endu: number;
	fg: number;
	ft: number;
	fuzz: number;
	hgt: number;
	injuryIndex?: number;
	ins: number;
	jmp: number;
	locked?: boolean;
	oiq: number;
	ovr: number;
	pos: string;
	pot: number;
	pss: number;
	reb: number;
	season: number;
	spd: number;
	skills: string[];
	stre: number;
	tp: number;
	// Expanded ratings (the expandedRatings setting, see common/expandedRatings.ts): wingspan, perimeter and interior defense. Missing in
	// leagues that never had the setting on.
	wng?: number;
	pdef?: number;
	idef?: number;
	// Second step: offensive/defensive rebounding, catch-and-shoot/off-the-dribble shooting, ball security
	oreb?: number;
	dreb?: number;
	csh?: number;
	dsh?: number;
	bsc?: number;
	// Sub-ratings (the subRatings setting, see common/subRatings.ts): one int per sub-rating, in the order of SUB_DEFS. Only on a
	// player's last few rows (SUB_HISTORY), and missing in leagues that never had the setting on.
	sub?: number[];
	// Game Sim Fixes: shot zone tendencies learned from his own makes (worker/core/player/zoneTendencies.ts): multipliers on how often he
	// picks [three, mid-range, rim, post]. Missing when all 1
	zt?: number[];
	// Development breakdown (worker/core/player/devParts.ts): the parts of this season's ovr change, in ovr points. Missing on rows from
	// before it and on rows that didn't develop
	devParts?: DevParts;
};

export type DevParts = {
	// The rest: age, random development, his development rates, rounding
	base: number;
	// Coaching (budget or staff, Coaching Staff Depth's plans)
	coach?: number;
	// Veteran savvy mentoring (Player Traits)
	mentor?: number;
	// Work ethic and aging curve (Player Traits)
	traits?: number;
	// Career Aging: wear and tear, style, reinvention, past 39
	aging?: number;
	// Young players' minutes (Career Aging)
	minutes?: number;
	// Ratings lost to injuries during the season
	injury?: number;
};

export type RatingKey =
	| "diq"
	| "dnk"
	| "drb"
	| "endu"
	| "fg"
	| "ft"
	| "hgt"
	| "ins"
	| "jmp"
	| "oiq"
	| "pss"
	| "reb"
	| "spd"
	| "stre"
	| "tp";
