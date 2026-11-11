import { ALL_ON } from "./harness.ts";
import { nativeFeatureNewLeagueDefaults } from "../../common/nativeFeatures.ts";

export const TOGGLES: Record<string, Record<string, unknown>> = {
	off: {},
	allOn: ALL_ON,
	// A new league with the default League extras, and the same with the stock ovr formula (the ovr v2 anchor check)
	newDefaults: nativeFeatureNewLeagueDefaults(),
	newDefaultsStockOvr: { ...nativeFeatureNewLeagueDefaults(), ovrV2: false },
	// Every extra except Sim-Calibrated Ovr and Realistic Aging
	allOnStockOvrAging: { ...ALL_ON, ovrV2: false, realisticAging: false },
	allOnOvrOnly: { ...ALL_ON, realisticAging: false },
	allOnAgingOnly: { ...ALL_ON, ovrV2: false },
	staff: { coachingStaff: true },
	// Before the fix: staff levels against the fixed STAFF_DEV_SCORE_REF
	staffFixedRef: { coachingStaff: true },
	allOnFixedRef: ALL_ON,
	traits: { playerTraits: true },
	expanded: { expandedRatings: true },
	ovrV2: { ovrV2: true },
	aging: { realisticAging: true },
	ovrAging: { ovrV2: true, realisticAging: true },
	ovrAgingExp: { ovrV2: true, realisticAging: true, expandedRatings: true },
	ovrAgingTraits: { ovrV2: true, realisticAging: true, playerTraits: true },
	injuryDepth: { injuryDepth: true },
	possessions: { realisticPossessions: true, technicalFouls: true },
	regen: { rerandomizeDraftClassRatings: true },
	shapes: { featureDraftClassShapes: true },
	college: { generateCollegeStats: true, featureCollegeStats: true },
	unretire: { featureUnretire: true },
	draftScout: { scoutingSystem: true, featureAiDraftNeeds: true },
	contracts: {
		contractOptions: true,
		contractExtensions: true,
		tradeRequests: true,
		featureHoldouts: true,
		featureAiTradeOffers: true,
		aiTradesNeedBased: true,
	},
};
