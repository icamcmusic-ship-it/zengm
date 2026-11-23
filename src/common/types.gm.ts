import type { FaceConfig } from "facesjs";
import type { GmFinanceStyle } from "./gmFinance.ts";

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
	// Hired during the regular season (a team the user gave up, an expansion team), not in an offseason
	midSeason?: true;
	// A retired GM's record in this job: his season rows are dropped when he retires (missing in older leagues and while he works)
	record?: {
		won: number;
		lost: number;
		tied: number;
		otl: number;
		playoffs: number;
		titles: number;
	};
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
	// AI GM finance styles (core gmFinance): how he runs the team's money. Missing in older leagues: derived from his gmid (gmFinance.ts)
	financeStyle?: GmFinanceStyle;
	seasons: GmSeason[];
	// A retired GM's career totals: his season rows are dropped when he retires (long leagues), this keeps his record
	career?: {
		seasons: number;
		won: number;
		lost: number;
		tied: number;
		otl: number;
		playoffs: number;
		titles: number;
	};
	tenures: GmTenure[];
	// Expected wins for the current season, set when the regular season starts
	expWon?: number;
	// Last computed job security score (negative is bad), after the playoffs
	hotSeat?: number;
	// Season of the last "job reportedly in danger" news item about him (hotSeatNews), so he gets at most one a season
	hotSeatNews?: number;
	retiredYear?: number;
	// Hired to run this user team in spectator mode: when the user takes it back he steps aside (on the team's former GMs), and he
	// runs it again the next time spectator mode is turned on, so toggling it doesn't churn through GMs
	spectatorFor?: number;
	// Hall of Fame executives wing (core/hallOfFame): the season he was inducted
	hof?: number;
	// Coach & Executive of the Year (League Extra): Executive of the Year awards he won (missing in older leagues)
	awards?: { season: number; type: string; tid: number }[];
};
