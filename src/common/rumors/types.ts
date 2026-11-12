// Rumors (League extras). Plain data stored in the `rumors` game attribute: a rolling window of rumors (current and last season)
// and the track record by season and type. See src/worker/core/rumors and docs/native-features.md.

export const RUMOR_TYPES = [
	"shopping",
	"interest",
	"pick",
	"unhappy",
	"extension",
	"freeAgent",
	"coach",
	"gm",
	"draft",
] as const;

export type RumorType = (typeof RUMOR_TYPES)[number];

export type RumorStatus = "open" | "confirmed" | "busted";

export type RumorMoment = {
	season: number;
	phase: number;
};

export type Rumor = {
	rid: number;
	type: RumorType;
	// Finer kind within the type, like "request" or "finalists". Used for dedupe and resolution
	kind?: string;
	season: number;
	phase: number;
	// Count of rumor days when it was made, for ordering and expiry
	tick: number;
	// Teams and players it is about. tids[0] is the team the rumor says will act (for free agents: the teams he could sign with)
	tids: number[];
	pids: number[];
	// Team the player was on (shopping, unhappy, extension, interest), -1 for none
	fromTid?: number;
	// Draft pick (pick), coach (coach), GM (gm), position group (draft)
	dpid?: number;
	cid?: number;
	gmid?: number;
	group?: string;
	// Contract expiration when the rumor was made (extension)
	exp?: number;
	// Text with tokens: {t:TID} team, {p:PID:Name} player, {c:CID:Name} coach, {g:TID:Name} GM
	text: string;
	// Chance it comes true, 0 to 1, as estimated when it was made
	confidence: number;
	// The model's score before calibration (see common/rumors/calibration.ts)
	raw?: number;
	status: RumorStatus;
	// It is busted when the league reaches this moment (or this tick, if set) without it coming true
	until: RumorMoment;
	untilTick?: number;
	// How it ended, text with tokens, and when
	outcome?: string;
	resolved?: RumorMoment;
	// About the user's team or its players when it was made
	user?: true;
};

// Per season and type: confirmed, didn't happen, sum of the confidences of both (what was expected to come true), and the sum of the
// model's chances before the league's own correction (missing in leagues from before it was recorded: then the confidences)
export type RumorTally =
	| [number, number, number]
	| [number, number, number, number];

export type RumorState = {
	// Seed of the rumor mill's own random stream. It never uses the sim's random numbers
	seed: number;
	nextRid: number;
	tick: number;
	items: Rumor[];
	stats: Record<number, Partial<Record<RumorType, RumorTally>>>;
	// Scouting buzz (with Scouting Reports on): "scouts are split on X". Opinions with nothing to confirm, so they are kept apart from
	// the rumors: no confidence, no status, never in the track record or its calibration. Missing in leagues from before it existed
	buzz?: ScoutBuzz[];
	nextBid?: number;
};

export type ScoutBuzz = {
	bid: number;
	season: number;
	phase: number;
	// Part of the season it was made in (a player is talked about once per window)
	window: string;
	tick: number;
	// The player it is about
	pid: number;
	// Text with tokens, like a rumor's
	text: string;
	// The scouts with the highest and lowest take (team region and scout name)
	high: string;
	low: string;
};

export const SCOUT_BUZZ_NAME = "Scouting buzz";

export const RUMOR_TYPE_NAMES: Record<RumorType, string> = {
	shopping: "On the block",
	interest: "Trade interest",
	pick: "Draft pick",
	unhappy: "Unhappy player",
	extension: "Extension talks",
	freeAgent: "Free agent",
	coach: "Coach hot seat",
	gm: "GM hot seat",
	draft: "Draft target",
};

export const RUMOR_STATUS_NAMES: Record<RumorStatus, string> = {
	open: "Open",
	confirmed: "Confirmed",
	busted: "Didn't happen",
};

// Confidence in words. The Rumors page shows how often each level came true
export const RUMOR_LEVELS = [
	{ key: "strong", name: "Strong", min: 0.6 },
	{ key: "solid", name: "Solid", min: 0.35 },
	{ key: "speculative", name: "Speculative", min: 0.15 },
	{ key: "longShot", name: "Long shot", min: 0 },
] as const;

export type RumorLevelKey = (typeof RUMOR_LEVELS)[number]["key"];

export const rumorLevel = (confidence: number) =>
	RUMOR_LEVELS.find((level) => confidence >= level.min) ?? RUMOR_LEVELS.at(-1)!;
