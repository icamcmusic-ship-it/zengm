// UI side of the League extras toggles (registry: common/nativeFeatures.ts). The switches are synced from the worker
// into the local state (gameAttributesSyncedToUi), so these hooks re-render when a setting changes.
import { local } from "./local.ts";
import {
	NATIVE_FEATURES,
	nativeFeatureEnabled,
	nativeFeatureOption,
	type NativeFeatureId,
	type NativeFeatureOptionKey,
} from "../../common/nativeFeatures.ts";
import type { LocalStateUI } from "../../common/types.ts";

const getter = (state: LocalStateUI) => (key: string) =>
	(state as unknown as Record<string, unknown>)[key];

// Non-reactive check, for plain functions (link lists, filters)
export const isFeatureOn = (id: NativeFeatureId) =>
	nativeFeatureEnabled(id, getter(local.getState()));

export const useFeatureOn = (id: NativeFeatureId | undefined) =>
	local((state) =>
		id === undefined ? true : nativeFeatureEnabled(id, getter(state)),
	);

export const useFeatureOption = <T extends boolean | number | string>(
	key: NativeFeatureOptionKey,
) => local((state) => nativeFeatureOption<T>(key, getter(state)));

// League extras feature of a league URL (its parts after /l/:lid/), if any. Used to drop links to disabled features.
export const featureForUrl = (
	url: readonly unknown[] | string,
): NativeFeatureId | undefined => {
	if (typeof url === "string") {
		return undefined;
	}
	const [first, second] = url;
	switch (first) {
		case "newspaper":
			return "newspaper";
		case "wrapped":
			return "wrapped";
		case "storylines":
			return "storylines";
		case "hype":
			return "hype";
		case "best_games":
			return "bestGames";
		case "award_vote":
			return "awardVote";
		case "league_achievements":
			return "leagueAchievements";
		case "trade_grader":
			return "tradeGrader";
		case "rivalries":
			return "rivalries";
		case "series_recaps":
			return "seriesRecaps";
		case "contract_value":
			return "contractValue";
		case "timeline":
			return "timeline";
		case "records_book":
			return "recordsBook";
		case "milestones":
			return "milestones";
		case "trade_market":
			return "tradeMarket";
		case "trade_offers":
			return "aiTradeOffers";
		case "trade_three":
			return "threeTeamTrades";
		case "draft_board":
			return "draftBoard";
		case "mock_draft":
			return "mockDraft";
		case "college_overseas":
			return "collegeSeason";
		case "archetypes":
			return "archetypes";
		case "staff":
		case "coach":
		case "coaches":
			return "coachingStaff";
		case "frivolities":
			if (
				second === "redraft" ||
				second === "pick_value" ||
				second === "family_trees" ||
				second === "economics" ||
				second === "home_court" ||
				(second === "jersey_numbers" && url[2] === "teams")
			) {
				return "frivolities";
			}
			if (second === "skill_badges") {
				return "skillBadges";
			}
			return undefined;
		default:
			return undefined;
	}
};

// Stock pages that a League extra replaces: hidden while that feature is on
export const featureOffForUrl = (
	url: readonly unknown[] | string,
): NativeFeatureId | undefined => {
	if (typeof url !== "string" && url[0] === "trade_proposals") {
		return "aiTradeOffers";
	}
	return undefined;
};

export const isUrlFeatureOn = (url: readonly unknown[] | string) => {
	const feature = featureForUrl(url);
	const replacedBy = featureOffForUrl(url);
	return (
		(feature === undefined || isFeatureOn(feature)) &&
		(replacedBy === undefined || !isFeatureOn(replacedBy))
	);
};

// Reactive: re-renders when any League extras switch changes
export const useFeatureSwitches = () =>
	local((state) =>
		NATIVE_FEATURES.map((f) =>
			nativeFeatureEnabled(f.id, getter(state)) ? "1" : "0",
		).join(""),
	);
