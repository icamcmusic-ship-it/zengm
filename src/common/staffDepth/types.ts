// Scouting Director & Regions and Coaching Staff Depth (League Extras: featureScoutingDepth, featureCoachingDepth). Stored shapes.
import type { CoachRole } from "../types.staff.ts";

export type ScoutRegion = "east" | "west" | "midSouth" | "intl" | "prep";

export type ScoutPriority =
	| "auto"
	| "bpa"
	| "need"
	| "guards"
	| "bigs"
	| "intl"
	| "upside"
	| "ready";

export type DelegationLevel = "auto" | "suggest" | "manual";

export type DelegationArea = "scouting" | "development" | "hiring" | "board";

// What a development plan works on (see devPlans.ts FOCUSES)
export type FocusKey =
	| "three"
	| "pullup"
	| "finish"
	| "post"
	| "handle"
	| "playmaking"
	| "perimD"
	| "rimD"
	| "glass"
	| "ft";

export type SuggestionAction =
	| { type: "assignRegions"; assignments: Record<number, ScoutRegion> }
	| { type: "setPriority"; priority: ScoutPriority }
	| { type: "devPlans"; plans: Record<number, FocusKey> }
	| { type: "teamDevPriority"; focus: FocusKey | "none" }
	| { type: "hire"; cid: number; role: CoachRole }
	| { type: "board"; ranks: Record<number, number> }
	| { type: "watch"; pid: number };

export type StaffSuggestion = {
	id: string;
	area: DelegationArea | "fit" | "conditioning";
	season: number;
	title: string;
	text: string;
	action: SuggestionAction;
	// Suggest mode: a proposal waiting for approval (instead of a one-off recommendation)
	pending?: boolean;
};

// The development report: what each player of the user's team worked on and what changed (focus subs before and after)
export type DevReportRow = {
	pid: number;
	name: string;
	pos: string;
	age: number;
	focus: FocusKey;
	src: PlanSource;
	subs: { key: string; name: string; before: number; after: number }[];
	focusBefore: number;
	focusAfter: number;
	ovrBefore: number;
	ovrAfter: number;
};

export type PlanSource = "staff" | "user" | "team";

// On the user's team object (t.staffDepth)
export type StaffDepthTeam = {
	priority: ScoutPriority;
	delegation: Record<DelegationArea, DelegationLevel>;
	// Scouting delegation Manual (or an accepted suggestion): scout id -> region
	manualRegions?: Record<number, ScoutRegion>;
	// Team-wide development priority (undefined: the staff decides per player)
	devPriority?: FocusKey;
	// Per player overrides of the development plan
	devOverrides?: Record<number, FocusKey>;
	// Development delegation Suggest: the staff's plans the user approved, for that season's development
	devAccepted?: { season: number; plans: Record<number, FocusKey> };
	suggestions?: StaffSuggestion[];
	// Weekly summaries of the Director's draft board changes, most recent last
	boardLog?: { season: number; week: number; lines: string[] }[];
	devReport?: { season: number; rows: DevReportRow[] };
	// Last week of the regular season processed (weekly looks and board)
	week?: { season: number; n: number };
};

// On every team (t.scoutCareer): the scouting department's careers, layered on the seeded chains of common/scoutingReports/scouts.ts
export type ScoutCareerTeam = {
	// Scout id -> the season he left early (poached, promoted, retired); the slot's next scout starts then
	cuts: Record<number, number>;
	cutWhy?: Record<number, "poached" | "promoted" | "retired">;
	// Directors of Scouting, oldest first (a scout id: his own chain, promoted from a slot, or hired away from another team)
	dirs: { id: number; since: number; how: "hired" | "promoted" | "poached" }[];
	// Reputation swings from "our guy" calls, by scout id
	rep: Record<number, number>;
	// Favourite prospects of each scout ("our guy"), by class
	ourGuys: {
		s: number;
		sid: number;
		pid: number;
		name: string;
		judged?: "star" | "bust" | "solid";
	}[];
	// Moves for the department page and the news
	log: { season: number; text: string }[];
};

// On a prospect (p.scoutLooks), the user's view only: looks this season and the fuzz narrowing applied to his latest ratings row
export type ProspectLooks = {
	// season of the latest update
	s: number;
	// looks (weighted)
	n: number;
	// his row's fuzz before the narrowing, and the factor applied
	b: number;
	a: number;
	// season of the ratings row the narrowing was applied to
	r: number;
	// big events already counted this season ("tournament", "showcase", "combine")
	ev?: string[];
	// the region and its coverage at the last update (for the UI)
	reg?: ScoutRegion;
	cov?: number;
};

// On a player (p.devPlan): this season's development focus
export type PlayerDevPlan = {
	s: number;
	f: FocusKey;
	src: PlanSource;
};
