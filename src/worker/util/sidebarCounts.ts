// New-item counts for the side menu badges (News Feed, Trade Offers, Newspaper): what's new since the user last opened each page.
// The UI keeps what it has seen per league (ui/util/sidebarBadges.ts) and passes it in; undefined means never seen, which counts as
// nothing new (the first count only sets the baseline).
import { idb } from "../db/index.ts";
import g from "./g.ts";
import helpers from "./helpers.ts";
import { featureOn } from "./nativeFeatures.ts";
import { adjustedNewsScore, IGNORE_EVENT_TYPES } from "../views/news.ts";
import { pickEdition, REBUILD_EVERY_GAMES } from "../views/newspaperFacts.ts";
import type { EditionId } from "../../common/newspaper/types.ts";

export type SidebarSeen = {
	// Highest event id seen in the News Feed
	news?: number;
	// Keys of the trade offers seen (offer ids are reused, so the key has more than the id)
	tradeOffers?: string[];
	// Newspaper issue number seen (see issueNumber)
	newspaper?: number;
};

export type SidebarCounts = {
	news: { count: number; latest: number };
	tradeOffers?: { count: number; keys: string[] };
	newspaper?: { count: number; latest: number };
};

// Events the News Feed shows by default (its "big" level: score 20+, with the user's team's bonus)
const NEWS_MIN_SCORE = 20;

const EDITION_ORDER: Record<EditionId, number> = {
	preseason: 0,
	midseason: 1,
	playoffs: 2,
	final: 3,
};

// A number that goes up with each new paper: the season, the edition, and during the regular season a new issue every
// REBUILD_EVERY_GAMES games (when the paper is rebuilt)
export const issueNumber = (season: number, edition: EditionId, gp: number) =>
	season * 1000 +
	EDITION_ORDER[edition] * 200 +
	(edition === "midseason"
		? Math.min(199, Math.floor(gp / REBUILD_EVERY_GAMES))
		: 0);

export const countNewIssues = (seen: number, latest: number) => {
	if (latest <= seen) {
		return 0;
	}
	// Same season and both in the regular season: one per rebuild, else just "new"
	if (
		Math.floor(seen / 1000) === Math.floor(latest / 1000) &&
		Math.floor((seen % 1000) / 200) === 1 &&
		Math.floor((latest % 1000) / 200) === 1
	) {
		return latest - seen;
	}
	return 1;
};

const offerKey = (offer: {
	id: number;
	tid: number;
	season: number;
	phase: number;
	gp: number;
}) => `${offer.id}|${offer.tid}|${offer.season}|${offer.phase}|${offer.gp}`;

export const getSidebarCounts = async (
	seen: SidebarSeen,
): Promise<SidebarCounts> => {
	const season = g.get("season");
	const userTid = g.get("userTid");

	// News Feed
	const events = await idb.merged.events.getAll({ season });
	let latest = seen.news ?? -1;
	let newsCount = 0;
	for (const event of events) {
		if (event.eid === undefined) {
			continue;
		}
		latest = Math.max(latest, event.eid);
		if (
			seen.news !== undefined &&
			event.eid > seen.news &&
			!IGNORE_EVENT_TYPES.includes(event.type) &&
			(adjustedNewsScore(event, userTid) ?? 0) >= NEWS_MIN_SCORE
		) {
			newsCount += 1;
		}
	}
	const out: SidebarCounts = {
		news: { count: newsCount, latest },
	};

	// Trade Offers (League extra aiTradeOffers)
	if (featureOn("aiTradeOffers")) {
		const keys = g
			.get("aiTradeOffers")
			.filter((offer) => offer.teams[0].tid === userTid)
			.map(offerKey);
		const seenKeys = new Set(seen.tradeOffers ?? keys);
		out.tradeOffers = {
			count: keys.filter((key) => !seenKeys.has(key)).length,
			keys,
		};
	}

	// Newspaper (basketball)
	if (__SPORT === "basketball" && featureOn("newspaper")) {
		const teamSeasons = await idb.cache.teamSeasons.indexGetAll(
			"teamSeasonsBySeasonTid",
			[[season], [season, "Z"]],
		);
		const maxGp = Math.max(
			0,
			...teamSeasons.map((ts) => helpers.getTeamSeasonGp(ts)),
		);
		const edition = pickEdition({
			season,
			currentSeason: season,
			phase: g.get("phase"),
			gp: maxGp,
		});
		const issue = issueNumber(season, edition, maxGp);
		out.newspaper = {
			count:
				seen.newspaper === undefined
					? 0
					: countNewIssues(seen.newspaper, issue),
			latest: issue,
		};
	}

	return out;
};
