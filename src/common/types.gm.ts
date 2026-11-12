import type { FaceConfig } from "facesjs";

// AI general managers (basketball only, gated by the featureGmPersonalities setting). See src/common/gmPersonality.ts

// Each is -1 to 1, fixed for a GM's career
export type GmTraits = {
	// -1 win-now, 1 patient (builds through youth and picks)
	patience: number;
	// -1 old-school (ovr, experience, size), 1 analytics (efficiency, age, potential, advanced stats)
	analytics: number;
	// -1 cautious, 1 gambler (injured players, raw prospects)
	risk: number;
	// -1 tax-averse, 1 spends freely
	taxTolerance: number;
	// -1 trades picks away, 1 hoards picks
	pickValue: number;
	// -1 quiet, 1 dealmaker (how often he trades)
	tradeFreq: number;
	// -1 ruthless, 1 loyal to his own players
	loyalty: number;
	// -1 depth builder, 1 star hunter (free agency)
	faStars: number;
	// -1 drafts for need, 1 best player available
	draftBPA: number;
	// -1 ready-now prospects, 1 upside swings
	draftUpside: number;
};

export type GmSeason = {
	season: number;
	tid: number;
	won: number;
	lost: number;
	tied: number;
	otl: number;
	// Expected wins at the start of the regular season (Season Odds projection, or the roster rating)
	expWon?: number;
	numGames: number;
	playoffRoundsWon: number;
	// Expected wins on an improvement path from the roster he inherited (seasons after his first with the team)
	pathExpWon?: number;
	// Rebuild progress (young core, picks, cap room, win trend) in wins per 82 games, and how much it counted
	progress?: number;
	rebuildWeight?: number;
	// Value of his best young players at the end of the season, for the next season's progress
	youth?: number;
	// He wasn't the GM when the regular season started, so the season isn't held against him
	partial?: boolean;
};

export type GmTenure = {
	tid: number;
	start: number;
	// Last season, undefined while still there
	end?: number;
	reason?: "fired" | "retired" | "left";
	// One of the league's first GMs (or the first when the setting was turned on), not hired in a carousel
	initial?: true;
};

export type Gm = {
	gmid: number;
	firstName: string;
	lastName: string;
	born: {
		year: number;
		loc: string;
	};
	face?: FaceConfig;
	traits: GmTraits;
	seasons: GmSeason[];
	tenures: GmTenure[];
	// Expected wins for the current season, set when the regular season starts
	expWon?: number;
	// Last computed job security score (negative is bad), after the playoffs
	hotSeat?: number;
	retiredYear?: number;
};
