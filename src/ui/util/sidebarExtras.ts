import { safeLocalStorage } from "./safeLocalStorage.ts";
import type {
	SidebarCounts,
	SidebarSeen,
} from "../../worker/util/sidebarCounts.ts";

// Side menu extras, remembered in this browser per league (safeLocalStorage; storage that is missing or throws just starts
// empty): new-item badges on News Feed, Trade Offers and Newspaper (unread since the last visit, hooks/useSidebarBadges.ts), and the
// recently visited pages.

const SEEN_KEY = "sidebarSeen";
const RECENT_KEY = "sidebarRecent";
// Leagues remembered, newest first, so the stored maps don't grow forever
const MAX_LEAGUES = 30;
export const MAX_RECENT = 5;

const readMap = <T>(key: string): Record<string, T> => {
	try {
		const parsed = JSON.parse(safeLocalStorage.getItem(key) ?? "{}");
		return parsed && typeof parsed === "object" && !Array.isArray(parsed)
			? parsed
			: {};
	} catch {
		return {};
	}
};

const writeMap = <T>(key: string, lid: number, value: T) => {
	try {
		const map = readMap<T>(key);
		delete map[lid];
		const entries = [[String(lid), value], ...Object.entries(map)].slice(
			0,
			MAX_LEAGUES,
		);
		safeLocalStorage.setItem(key, JSON.stringify(Object.fromEntries(entries)));
	} catch {}
};

export const readSeen = (lid: number): SidebarSeen =>
	readMap<SidebarSeen>(SEEN_KEY)[lid] ?? {};

export const writeSeen = (lid: number, seen: SidebarSeen) => {
	writeMap(SEEN_KEY, lid, seen);
};

export type SidebarBadgeKey = "news" | "tradeOffers" | "newspaper";

// Page of each badge (pageID of the view)
export const BADGE_PAGE_IDS: Record<SidebarBadgeKey, string> = {
	news: "news",
	tradeOffers: "tradeOffers",
	newspaper: "newspaper",
};

// Side menu link path (its first part) of each badge
export const BADGE_PATHS: Record<string, SidebarBadgeKey> = {
	news: "news",
	trade_offers: "tradeOffers",
	newspaper: "newspaper",
};

// What has been seen after this count: everything on the page being viewed, and the first time a league is opened (nothing is
// new before there is a baseline)
export const nextSeen = (
	seen: SidebarSeen,
	counts: SidebarCounts,
	pageID: string | undefined,
): SidebarSeen => {
	const out = { ...seen };
	if (seen.news === undefined || pageID === BADGE_PAGE_IDS.news) {
		out.news = counts.news.latest;
	}
	if (
		counts.tradeOffers &&
		(seen.tradeOffers === undefined || pageID === BADGE_PAGE_IDS.tradeOffers)
	) {
		out.tradeOffers = counts.tradeOffers.keys;
	}
	if (
		counts.newspaper &&
		(seen.newspaper === undefined || pageID === BADGE_PAGE_IDS.newspaper)
	) {
		out.newspaper = counts.newspaper.latest;
	}
	return out;
};

// Badge numbers to show (0 on the page itself, which is being read)
export const badgeCounts = (
	counts: SidebarCounts,
	pageID: string | undefined,
): Partial<Record<SidebarBadgeKey, number>> => {
	const out: Partial<Record<SidebarBadgeKey, number>> = {};
	const add = (key: SidebarBadgeKey, count: number | undefined) => {
		if (count !== undefined && count > 0 && pageID !== BADGE_PAGE_IDS[key]) {
			out[key] = count;
		}
	};
	add("news", counts.news.count);
	add("tradeOffers", counts.tradeOffers?.count);
	add("newspaper", counts.newspaper?.count);
	return out;
};

export const formatBadgeCount = (count: number) =>
	count > 99 ? "99+" : String(count);

// ---- Recently visited ----

export type RecentPage = {
	path: string;
	label: string;
};

export const readRecent = (lid: number): RecentPage[] => {
	const list = readMap<unknown>(RECENT_KEY)[lid];
	return Array.isArray(list)
		? list.filter(
				(x): x is RecentPage =>
					!!x &&
					typeof x === "object" &&
					typeof x.path === "string" &&
					typeof x.label === "string",
			)
		: [];
};

// Newest first, one entry per path, at most MAX_RECENT + 1 (the page being viewed is one of them and isn't listed)
export const addRecent = (lid: number, page: RecentPage) => {
	const list = [
		page,
		...readRecent(lid).filter((other) => other.path !== page.path),
	].slice(0, MAX_RECENT + 1);
	writeMap(RECENT_KEY, lid, list);
	return list;
};

// ---- Collapsed groups ----

// Whether each side menu group is collapsed, by title, remembered in this browser like sidebarOpen. Only groups the user
// toggled are stored, so a group collapsed by default (Commissioner) stays collapsed until expanded.
const GROUPS_KEY = "sidebarGroups";
// Before the menu was regrouped: the list of collapsed titles
const OLD_COLLAPSED_KEY = "sidebarCollapsedGroups";

// Groups that were split when the menu was regrouped: collapsing the old one collapses all of its parts
export const SPLIT_GROUPS: Record<string, string[]> = {
	League: ["League", "Newsroom", "History"],
	Players: ["Players", "Draft / College"],
	Tools: ["Tools", "Settings", "Commissioner", "Danger"],
};

export const migrateCollapsedGroups = (old: unknown) => {
	const out: Record<string, boolean> = {};
	if (Array.isArray(old)) {
		for (const title of old) {
			if (typeof title === "string") {
				for (const newTitle of SPLIT_GROUPS[title] ?? [title]) {
					out[newTitle] = true;
				}
			}
		}
	}
	return out;
};

export const readGroupsCollapsed = (): Record<string, boolean> => {
	try {
		const stored = safeLocalStorage.getItem(GROUPS_KEY);
		if (stored === null) {
			const old = safeLocalStorage.getItem(OLD_COLLAPSED_KEY);
			if (old === null) {
				return {};
			}
			const migrated = migrateCollapsedGroups(JSON.parse(old));
			safeLocalStorage.setItem(GROUPS_KEY, JSON.stringify(migrated));
			safeLocalStorage.removeItem(OLD_COLLAPSED_KEY);
			return migrated;
		}
		const parsed = JSON.parse(stored);
		if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
			return {};
		}
		return Object.fromEntries(
			Object.entries(parsed).filter(
				(entry): entry is [string, boolean] => typeof entry[1] === "boolean",
			),
		);
	} catch {
		return {};
	}
};

export const isGroupCollapsed = (title: string, collapsedByDefault: boolean) =>
	readGroupsCollapsed()[title] ?? collapsedByDefault;

export const writeGroupCollapsed = (title: string, collapsed: boolean) => {
	try {
		const groups = readGroupsCollapsed();
		groups[title] = collapsed;
		safeLocalStorage.setItem(GROUPS_KEY, JSON.stringify(groups));
	} catch {}
};

// ---- Favorites ----

// Side menu links pinned to the Favorites group, by key (menuLinkKey in util/menuItems.tsx), in the order they were
// pinned, for every league in this browser
const FAVORITES_KEY = "sidebarFavorites";
const MAX_FAVORITES = 50;

export const readFavorites = (): string[] => {
	try {
		const parsed = JSON.parse(safeLocalStorage.getItem(FAVORITES_KEY) ?? "[]");
		return Array.isArray(parsed)
			? [
					...new Set(
						parsed.filter((key): key is string => typeof key === "string"),
					),
				]
			: [];
	} catch {
		return [];
	}
};

export const toggleFavorite = (key: string) => {
	const favorites = readFavorites();
	const next = favorites.includes(key)
		? favorites.filter((other) => other !== key)
		: [...favorites, key].slice(-MAX_FAVORITES);
	try {
		safeLocalStorage.setItem(FAVORITES_KEY, JSON.stringify(next));
	} catch {}
	return next;
};
