// Labels and small types shared by the worker and the UI. Kept apart from the catalogue so the UI bundle doesn't carry it.

export type Rarity = "common" | "rare" | "legendary" | "impossible";

export const RARITY_LABEL = {
	common: "Common",
	rare: "Rare",
	legendary: "Legendary",
	impossible: "Impossible",
} as const;

// Bootstrap badge classes, so the colors work in light and dark mode and in notifications
export const RARITY_CLASS = {
	common: "text-bg-secondary",
	rare: "text-bg-primary",
	legendary: "text-bg-warning",
	impossible: "text-bg-danger",
} as const;

export const RARITY_HINT = {
	common: "More than once every two seasons in a typical simulated league",
	rare: "Once every 2 to 7 seasons in a typical simulated league",
	legendary: "Once every 7 to 40 seasons in a typical simulated league",
	impossible:
		"Rarer than once in 40 seasons, or never seen in simulated leagues",
} as const;

// Who/where/when of an occurrence, resolved against the league, for the page and notifications
export type Who = {
	pid?: number;
	name?: string;
	tid?: number;
	abbrev?: string;
	team?: string;
	// The other player (a relative)
	pid2?: number;
	name2?: string;
	// The opposing team
	tid2?: number;
	abbrev2?: string;
	season?: number;
	gid?: number;
	note?: string;
};
