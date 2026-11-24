import type { LogEventType } from "./types.ts";

// Pop-up notification filter: which categories of events show a pop-up. Suppressed events still go to the event log/news feed. Stored as the notificationFilter game attribute; missing = every pop-up shows (the stock behavior)

export const NOTIFICATION_CATEGORIES = [
	"games",
	"injuries",
	"trades",
	"contracts",
	"draft",
	"staff",
	"owner",
	"awards",
	"leagueNews",
	"players",
	"other",
] as const;

export type NotificationCategory = (typeof NOTIFICATION_CATEGORIES)[number];

// "system" is never suppressed: errors, upgrades, undo, achievements, game over and similar messages that need the user
export type NotificationCategoryOrSystem = NotificationCategory | "system";

export type NotificationFilter = {
	// Categories whose pop-ups are hidden. Missing/empty = all shown
	hidden?: NotificationCategory[];
	// Only show pop-ups for events that involve one of the user's teams (events with no teams still show)
	onlyMyTeam?: boolean;
};

export const NOTIFICATION_CATEGORY_NAMES: Record<NotificationCategory, string> =
	{
		games: "Games & results",
		injuries: "Injuries & deaths",
		trades: "Trades & transactions",
		contracts: "Contracts & free agency",
		draft: "Draft & scouting",
		staff: "Staff & coaching",
		owner: "Owner & finances",
		awards: "Awards & records",
		leagueNews: "League news & eras",
		players: "Player mood & milestones",
		other: "Other",
	};

// Every LogEventType must be here (enforced by the Record type; isMappedLogEventType is the runtime check for types that arrive untyped)
const TYPE_TO_CATEGORY: Record<LogEventType, NotificationCategoryOrSystem> = {
	achievement: "system",
	ageFraud: "draft",
	award: "awards",
	changes: "system",
	draft: "draft",
	draftLottery: "draft",
	error: "system",
	freeAgent: "contracts",
	gameAttribute: "leagueNews",
	gameLost: "games",
	gameTied: "games",
	gameWon: "games",
	hallOfFame: "awards",
	healed: "injuries",
	healedList: "injuries",
	info: "other",
	injured: "injuries",
	injuredList: "injuries",
	madePlayoffs: "games",
	newLeague: "system",
	newTeam: "system",
	playerFeat: "awards",
	playoffs: "games",
	reSigned: "contracts",
	refuseToSign: "contracts",
	release: "trades",
	retired: "players",
	retiredList: "players",
	retiredJersey: "awards",
	screenshot: "system",
	sisyphus: "system",
	sisyphusTeam: "system",
	success: "system",
	teamContraction: "leagueNews",
	teamExpansion: "leagueNews",
	teamLogo: "leagueNews",
	teamRelocation: "leagueNews",
	teamRename: "leagueNews",
	trade: "trades",
	tragedy: "injuries",
	upgrade: "system",
	luxuryTax: "owner",
	luxuryTaxDist: "owner",
	ownerDistribution: "owner",
	minPayroll: "owner",
	undo: "system",
	contractOption: "contracts",
	extension: "contracts",
	tradeRequest: "players",
	holdout: "contracts",
	discipline: "players",
	draftPickCondition: "trades",
	draftStash: "draft",
	capException: "contracts",
	commercialDeal: "owner",
	ownerSale: "owner",
	revenueSharing: "owner",
	ownerRequest: "owner",
};

export const isMappedLogEventType = (type: string) =>
	Object.hasOwn(TYPE_TO_CATEGORY, type);

export const getNotificationCategory = (
	type: string,
): NotificationCategoryOrSystem => {
	if (isMappedLogEventType(type)) {
		return TYPE_TO_CATEGORY[type as LogEventType];
	}
	return "other";
};

export const NOTIFICATION_PRESETS = {
	all: {
		name: "All",
		filter: { hidden: [], onlyMyTeam: false },
	},
	important: {
		name: "Important only",
		filter: {
			hidden: NOTIFICATION_CATEGORIES.filter(
				(c) => !["injuries", "trades", "owner", "awards"].includes(c),
			),
			onlyMyTeam: true,
		},
	},
	none: {
		name: "None",
		filter: { hidden: [...NOTIFICATION_CATEGORIES], onlyMyTeam: false },
	},
} satisfies Record<string, { name: string; filter: NotificationFilter }>;

export const shouldShowNotification = ({
	category,
	filter,
	persistent,
	tids,
	userTids,
}: {
	category: NotificationCategoryOrSystem;
	filter: NotificationFilter | undefined;
	persistent: boolean | undefined;
	tids: number[] | undefined;
	userTids: number[];
}) => {
	// Critical messages (persistent ones need the user to close or act on them) and system messages always show
	if (!filter || persistent || category === "system") {
		return true;
	}
	if (filter.hidden?.includes(category)) {
		return false;
	}
	if (
		filter.onlyMyTeam &&
		tids &&
		tids.length > 0 &&
		!tids.some((tid) => userTids.includes(tid))
	) {
		return false;
	}
	return true;
};
