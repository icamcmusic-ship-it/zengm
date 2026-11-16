// archrules: the archetype judging rulebook, machine-readable (docs/archetype-rulebook.md is the same rules in words).
// arch17 found two judging passes share a build for only 55.5% of players, so every future answer key is judged by these
// rules (rulebook.ts ruleJudge), and what a build's name promises (score.ts promisesOf / promiseChecks, the name-promise
// report) is read from here too, so the two can never disagree.
//
// Scales. `cv` is the blended class reading (score.ts classValues: his standing at his position blended with the shape of
// his own game and his stats), roughly a z (0 = ordinary for him at his position). Judging bars are "top X%" of players on
// it (ruleQuantiles.data.ts: its percentiles over the judged population); the promise floor is on the z itself.
// `sub` is his sub-rating lean against his league's own table (subStyle.ts subFeatures, z), checked only with Sub-Ratings
// on; `pt` his play-type share against his position's peers (subStyle.ts, z), checked only with a real sample of play
// types (weight PT_MIN_W or more).
import type { PtFeat, SubFeat } from "./subStyle.ts";

export type Bar = {
	// The skill classes a word promises (every holder must keep each at FLOOR or better: score.ts promiseChecks)
	classes: string[];
	// The judging bar when the word is what the build is first of all (its head noun: the last non-modifier word), as the
	// top fraction of players on the blended class reading (0.25 = top 25%, read through ruleQuantiles.data.ts) ... (a
	// multi-class word needs one of its classes at `lead`, the others at `support`; 1 = no bar)
	lead: number;
	// ... and when it qualifies another word
	support: number;
	// Sub-rating leans required (Sub-Ratings on): each at least this
	sub?: Partial<Record<SubFeat, number>>;
	// Play-type shares required (Advanced Tracking Stats with a sample): at least one of them at least this
	pt?: Partial<Record<PtFeat, number>>;
	// The words, for the doc and the UI-free consistency test
	words: string;
};

// The promise floor: every class a name promises must be at least this for each holder (score.ts PROMISE_MET reads it)
export const FLOOR = 0;
// Play types count once his sample weight (possessions / (possessions + half)) is at least this
export const PT_MIN_W = 0.3;

// Per concept of twoK/concepts.ts (the vocabulary of build names)
export const RULES: Record<string, Bar> = {
	twoWay: {
		words: "2-Way, Two Way, Both Ends",
		classes: ["def"],
		lead: 0.3,
		support: 0.4,
	},
	lockdown: {
		words:
			"Lockdown, Lock, Clamp, Guard Dog, Defender, 3 & D, Switch-Defending, Tenacious, Warden",
		classes: ["perD"],
		lead: 0.2,
		support: 0.3,
		sub: { pdf: 0.25 },
	},
	steal: {
		words:
			"Ball-Hawking, Ball Snatcher, Thief, Pickpocket, Disruptive, Chaos, Pesky, Pest, Bandit",
		classes: ["perD"],
		lead: 0.2,
		support: 0.3,
		sub: { stl: 0.52 },
	},
	rimD: {
		words:
			"Rim Protector, Shot-Erasing, Eraser, Apex-Erasing, Obliterator, Swats, Backline, Anchor, Guardian, Rim Reaper, Paint Hawk, Paint Defender, Paint Protector, Paint-Protecting, Terror, Shot-Axing, Fortress, Pillar",
		classes: ["rimD"],
		lead: 0.2,
		support: 0.3,
		sub: { blk: 0.52 },
	},
	oreb: {
		words: "Crasher, Putback, Board-Hunting, Tip-In, Possession Extender",
		classes: ["reb"],
		lead: 0.25,
		support: 0.3,
		sub: { orb: 0.25 },
		pt: { pb: 0.25 },
	},
	reb: {
		words: "Glass, Board, Cleaner, Rebounder, Floor-Sweeping, Floor Sweeper",
		classes: ["reb"],
		lead: 0.25,
		support: 0.3,
	},
	outlet: {
		words: "Break Starter, Break Leader",
		classes: ["pass"],
		lead: 0.3,
		support: 0.4,
	},
	threeLevel: {
		words: "3-Level, Versatile Scorer (with Scorer)",
		classes: ["shoot", "mid"],
		lead: 0.3,
		support: 0.4,
	},
	insideOut: {
		words: "Inside-Out",
		classes: ["shoot", "finish"],
		lead: 0.3,
		support: 0.4,
	},
	catchShoot: {
		words:
			"Sharpshooter, Stretch, Pick & Pop, Popper, 3 & D, Catch & Shoot, Off-Screen, Big Range, Automatic, Laser, Silk, Splash",
		classes: ["shoot"],
		lead: 0.25,
		support: 0.3,
		pt: { spot: 0, offs: 0 },
	},
	shotHunt: {
		words: "3PT, Sniper, Shot Hunter, Gunner, Logo, Cash Out, Bomber",
		classes: ["shoot"],
		lead: 0.15,
		support: 0.25,
		sub: { rng: 0.25 },
	},
	midPaint: {
		words: "Mid-Paint",
		classes: ["mid"],
		lead: 0.3,
		support: 0.4,
	},
	midPost: {
		words: "Mid-Post",
		classes: ["mid", "post"],
		lead: 0.3,
		support: 0.4,
	},
	mid: {
		words:
			"Mid-Range, Middy, Mid-Slash, Maestro, Menace, Smooth, Faceup, Hash-Sinking",
		classes: ["mid"],
		lead: 0.25,
		support: 0.4,
	},
	post: {
		words: "Post, Footwork (Bully: see strength; not High-Post)",
		classes: ["post"],
		lead: 0.25,
		support: 0.4,
		sub: { pst: 0.25 },
		pt: { post: 0 },
	},
	paint: {
		words: "Paint (Paint Finisher, Paint Beast; not Paint Defender)",
		classes: ["finish"],
		lead: 0.3,
		support: 0.4,
	},
	slash: {
		words: "Slasher, Slashing, Blow-By, Drive & Rise, Downhill",
		classes: ["finish"],
		lead: 0.25,
		support: 0.4,
	},
	finish: {
		words: "Finisher, Layup, Laymaker, Levitator",
		classes: ["finish"],
		lead: 0.25,
		support: 0.4,
	},
	dunk: {
		words: "Dunker, Rim Rocker, Rim Wrecker, Poster, Masher, Slammer, Flusher",
		classes: ["finish"],
		lead: 0.25,
		support: 0.4,
		sub: { mxv: 0 },
	},
	air: {
		words:
			"High-Flying, Aerial, Glide, Athletic, Athlete, Explosive, Force of Nature, Bouncy, Apex",
		classes: ["ath"],
		lead: 0.25,
		support: 0.3,
		sub: { mxv: 0.25 },
	},
	lob: {
		words: "Lob Threat, Lob City",
		classes: ["finish"],
		lead: 0.25,
		support: 0.3,
		sub: { mxv: 0.25 },
		pt: { prr: 0.25, cut: 0.25 },
	},
	riser: {
		words: "Riser, Rising (a style word: promises nothing measurable)",
		classes: [],
		lead: 1,
		support: 1,
	},
	run: {
		words: "Rim Runner, Wing Runner, Pick-Diving, Speedy",
		classes: ["ath"],
		lead: 0.3,
		support: 0.4,
		pt: { tr: 0, prr: 0 },
	},
	tempo: {
		words: "Tempo, Pilot",
		classes: ["handle"],
		lead: 0.3,
		support: 0.4,
	},
	creator: {
		words:
			"Shot Creator, Iso, Ankle-Breaker, Shifty, Shot Hunter, Dribble Tech, Off-the-Bounce",
		classes: ["handle"],
		lead: 0.25,
		support: 0.4,
	},
	pass: {
		words:
			"Playmaker, Dimer, Diming, Dot, Table Setter, Distributor, Point Forward/Four/Center, Visionary, Engine, Facilitating, General, Dish",
		classes: ["pass"],
		lead: 0.25,
		support: 0.4,
		sub: { vis: 0 },
		pt: { prb: 0 },
	},
	tripleDouble: {
		words: "Triple-Double",
		classes: ["reb"],
		lead: 0.3,
		support: 0.4,
	},
	scorer: {
		words: "Scorer, Bucket, Engine (needs a way to score; never the head)",
		classes: ["score"],
		lead: 1,
		support: 1,
	},
	strength: {
		words:
			"Bully, Physical, Power, Bodyguard, Grinder, Tank, Masher, Pound, Bruiser, Bruising, Punishing, Punisher",
		classes: ["stre"],
		lead: 0.3,
		support: 0.4,
	},
	skill: {
		words:
			"Crafty, Skilled, Fluid, Phenom, Prodigy, Savant, Versatile, King, Finesse, Dynamic (style words: promise nothing measurable)",
		classes: [],
		lead: 1,
		support: 1,
	},
	// archuser2k: the new words of the user's 2K archetypes (user2k.data.ts). Bars as for the nearest existing word; the
	// sub-rating and play-type leans are the ones the user's own players with the word show (twoK/user2k.script.test.ts lift)
	burner: {
		words: "Burner, Open-Lane (speed in the open floor)",
		classes: ["ath"],
		lead: 0.3,
		support: 0.4,
		pt: { tr: 0 },
	},
	hammer: {
		words: "Hammer (finishes above the rim with force)",
		classes: ["finish", "ath"],
		lead: 0.25,
		support: 0.4,
		sub: { mxv: 0 },
	},
	cutter: {
		words: "Cutter, Off-Ball (moves without the ball and finishes)",
		classes: ["ath"],
		lead: 0.3,
		support: 0.4,
		pt: { cut: 0 },
	},
	scoop: {
		words: "Scooper, Scooping (crafty layups)",
		classes: ["finish"],
		lead: 0.25,
		support: 0.4,
		sub: { cls: 0 },
	},
	pullUp: {
		words: "Pull-Up (the jumper off the dribble)",
		classes: ["mid"],
		lead: 0.25,
		support: 0.4,
		sub: { crt: 0 },
	},
	chaser: {
		words: "Chaser, Bucket Chaser (hunts his shot at every level)",
		classes: ["mid", "shoot"],
		lead: 0.3,
		support: 0.4,
	},
	grabGo: {
		words: "Grab & Go (rebounds and pushes)",
		classes: ["reb"],
		lead: 0.25,
		support: 0.3,
	},
	pressure: {
		words: "Pressure Cooker (pressures the ball)",
		classes: ["perD"],
		lead: 0.2,
		support: 0.3,
		sub: { pdf: 0.25 },
	},
	highLow: {
		words: "High-Low Threat (scores and passes from the high and low post)",
		classes: ["post"],
		lead: 0.3,
		support: 0.4,
		sub: { pst: 0 },
	},
	wizard: {
		words: "Wizard (creates for others with the ball)",
		classes: ["pass", "handle"],
		lead: 0.3,
		support: 0.4,
		sub: { vis: 0 },
	},
	// archgaps (user-approved): Glue (perimeter D head, breadth, no standout: v2/tests.ts and the builds' ceilings),
	// Game Manager (passing and handling, no standout), Energy (finishing and athleticism, rim protection, no three)
	glue: {
		words: "Glue (a role player: defends and does a bit of everything)",
		classes: ["perD"],
		lead: 0.5,
		support: 0.5,
	},
	gameManager: {
		words: "Game Manager (runs the offense, no standout)",
		classes: ["pass", "handle"],
		lead: 0.5,
		support: 0.5,
	},
	energy: {
		words: "Energy (finishes and runs, protects the rim)",
		classes: ["finish", "ath"],
		lead: 0.5,
		support: 0.5,
	},
};

// Words matched on the whole name rather than a concept, with a raised bar (they also raise the promise: score.ts)
export const WORD_RULES = {
	// "Sniper / Sharpshooter / Laser / Automatic / Logo / Big Range / Silk": an elite three (top 15%) and range among his
	// own shooting (sub rng lean +0.84 z, about top 20%, with Sub-Ratings). Promise: shoot at least `floor` z for every holder.
	sniper: {
		re: /Snip|Sharp|Laser|Automatic|Logo|Big Range|Silk/,
		cls: "shoot",
		bar: 0.15,
		floor: 0.8,
		sub: { rng: 0.84 } as Partial<Record<SubFeat, number>>,
	},
	// "High-Flying / Aerial / Force of Nature / Explosive / Athletic / Glide": athleticism top 25% and a max-vertical lean
	// (score.ts absoluteParts air checks the leaping itself)
	air: {
		re: /High[ -]Fly|Aerial|Force of Nature|Explosive|Athletic|Athlete|Glide|Bouncy|Apex/,
		cls: "ath",
		bar: 0.25,
		sub: { mxv: 0.25 } as Partial<Record<SubFeat, number>>,
	},
};

// A generic build (generic.ts) qualifies only for a genuinely all-around player: at least ALL_AROUND_N of the ten skill
// classes in the top ALL_AROUND_MIN (fraction) or better, as well as its own words' bars
export const ALL_AROUND_N = 4;
export const ALL_AROUND_MIN = 0.4;
// The head word's class must be one of his HEAD_TOP_N best skill classes (what a build is first of all must be what he is)
export const HEAD_TOP_N = 3;
// Acceptable builds per player
export const MAX_ACCEPT = 3;
// With none qualifying: the nearest specific builds, those within NEAREST_GAP of the nearest's shortfall (z)
export const NEAREST_GAP = 0.25;
