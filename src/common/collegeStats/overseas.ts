import { NON_NCAA } from "./colleges.ts";

/**
 * The overseas (pro club abroad) stat environment and honors, ported from the BBGM Draft Class Workshop (bbgmdraft js/stats.js LEAGUE_ENV and js/awards.js PRO_AWARDS / PRO_SHORT).
 *
 * pace is possessions per game, gameMinutes the length of a game, youthCap the minutes ceiling a teenager gets at a pro club, mpgCap the ceiling for anyone, games the length of a regular season (domestic + continental where a club plays both).
 */
export type LeagueEnv = {
	pace: number;
	gameMinutes: number;
	youthCap: number | undefined;
	mpgCap: number;
	games: number;
	// The usage a young player gets at a pro club, relative to a college star's role
	usageShift: number;
	// Minutes lost relative to a college role: the stronger the league, the less a prospect plays (a teenager in the EuroLeague averages about 15 minutes)
	minShift: number;
};

const env = (
	pace: number,
	gameMinutes: number,
	youthCap: number | undefined,
	mpgCap: number,
	games: number,
	usageShift = -0.035,
	minShift = -6,
): LeagueEnv => ({
	pace,
	gameMinutes,
	youthCap,
	mpgCap,
	games,
	usageShift,
	minShift,
});

export const LEAGUE_ENV: Record<string, LeagueEnv> = {
	EuroLeague: env(70, 40, 18, 30, 36, -0.06, -11),
	// A prospect in the G League is a young player on a pro roster: a top one starts (Ignite-style, about 30 minutes, 15-18 points), most come off the bench
	"NBA G League": env(103, 48, 30, 34, 48, -0.035, -5),
	"Liga ACB": env(72, 40, 18, 30, 36, -0.05, -10),
	NBL: env(76, 40, 24, 34, 30),
	"Chinese CBA": env(82, 48, 26, 38, 46),
	"LNB Pro A": env(74, 40, 24, 33, 34),
	EuroCup: env(72, 40, 22, 32, 32, -0.04, -8),
	"Basketball Bundesliga": env(76, 40, 24, 33, 34),
	"Adriatic League": env(74, 40, 26, 34, 30),
	NBL1: env(82, 40, 30, 36, 22, -0.01, -1),
	"Basketball Champions League": env(73, 40, 24, 33, 32),
	"Turkish BSL": env(74, 40, 20, 31, 32, -0.045, -9),
	"Greek Basket League": env(71, 40, 20, 31, 28, -0.045, -8),
	"Israeli Premier League": env(78, 40, 24, 33, 30),
	"Japan B.League": env(76, 40, 26, 34, 60),
	"Brazil NBB": env(78, 40, 26, 34, 34),
	"Basketball Africa League": env(76, 40, 28, 34, 12, -0.02, -3),
	CEBL: env(84, 40, 30, 35, 20, -0.02, -2),
	"Italian LBA": env(73, 40, 20, 31, 32, -0.045, -8),
	"Lithuanian LKL": env(74, 40, 22, 32, 36),
	"VTB United League": env(76, 40, 22, 32, 34, -0.04, -8),
	"Polish PLK": env(76, 40, 26, 34, 30),
	"BNXT League": env(76, 40, 26, 34, 32),
	"Korean KBL": env(78, 40, 26, 34, 54),
	"Philippine PBA": env(84, 48, 26, 36, 36),
	"Argentine Liga Nacional": env(76, 40, 26, 34, 38),
	"Mexican LNBP": env(80, 40, 28, 34, 40),
};

const DEFAULT_ENV = env(75, 40, 24, 33, 32);

// Short names for honors ("ACB Rising Star")
export const PRO_SHORT: Record<string, string> = {
	EuroLeague: "EuroLeague",
	"NBA G League": "G League",
	"Liga ACB": "ACB",
	NBL: "NBL",
	"Chinese CBA": "CBA",
	"LNB Pro A": "LNB",
	EuroCup: "EuroCup",
	"Basketball Bundesliga": "BBL",
	"Adriatic League": "ABA",
	NBL1: "NBL1",
	"Basketball Champions League": "BCL",
	"Turkish BSL": "BSL",
	"Greek Basket League": "GBL",
	"Israeli Premier League": "Israeli League",
	"Japan B.League": "B.League",
	"Brazil NBB": "NBB",
	"Basketball Africa League": "BAL",
	CEBL: "CEBL",
	"Italian LBA": "LBA",
	"Lithuanian LKL": "LKL",
	"VTB United League": "VTB",
	"Polish PLK": "PLK",
	"BNXT League": "BNXT",
	"Korean KBL": "KBL",
	"Philippine PBA": "PBA",
	"Argentine Liga Nacional": "Liga Nacional",
	"Mexican LNBP": "LNBP",
};

// A pro league (not the NCAA, not a youth/prep program)
export const isProLeague = (name: string) =>
	!!NON_NCAA[name]?.pro && !NON_NCAA[name]?.youth;

// A pro club abroad, as opposed to the (domestic) G League
export const isOverseasLeague = (name: string) =>
	isProLeague(name) && name !== "NBA G League";

export const getLeagueEnv = (name: string): LeagueEnv | undefined =>
	isProLeague(name) ? (LEAGUE_ENV[name] ?? DEFAULT_ENV) : undefined;

/**
 * What a pre-draft stats row is, from where it was played: "Overseas" for a pro club abroad, "G League" for the G League, "College" for everything else (NCAA, prep, youth programs).
 */
export const getPreDraftLabel = (
	teamName: string | undefined,
): "Overseas" | "G League" | "College" => {
	if (teamName === "NBA G League") {
		return "G League";
	}
	if (teamName !== undefined && isOverseasLeague(teamName)) {
		return "Overseas";
	}
	return "College";
};

// Bars on strength-adjusted game score per game (pro box scores run lower than college ones: fewer minutes, slower pace)
export const PRO_BARS = {
	mvp: 16,
	allLeagueFirst: 13.5,
	allLeagueSecond: 11.5,
	risingStar: 8.5,
	bestYoungPlayer: 10,
	allDefensive: 5.5,
	minGp: 10,
	minMpg: 12,
};

/**
 * Honors in a pro league for one season. adj is the strength adjusted game score per game, age his age that season.
 */
export const getProHonorTypes = (
	league: string,
	adj: number,
	def: number,
	age: number,
	noise: number,
) => {
	const short = PRO_SHORT[league] ?? league;
	const types: string[] = [];
	const a = adj + noise;
	if (a >= PRO_BARS.mvp) {
		types.push(`${short} MVP`);
	}
	if (a >= PRO_BARS.allLeagueFirst) {
		types.push(`All-${short} First Team`);
	} else if (a >= PRO_BARS.allLeagueSecond) {
		types.push(`All-${short} Second Team`);
	}
	if (age <= 22) {
		if (a >= PRO_BARS.bestYoungPlayer) {
			types.push(
				league === "NBA G League"
					? "G League Rookie of the Year"
					: `${short} Best Young Player`,
			);
		} else if (a >= PRO_BARS.risingStar) {
			types.push(
				league === "NBA G League"
					? "G League All-Rookie Team"
					: `${short} Rising Star`,
			);
		}
	}
	if (def >= PRO_BARS.allDefensive) {
		types.push(`${short} All-Defensive Team`);
	}
	return types;
};
