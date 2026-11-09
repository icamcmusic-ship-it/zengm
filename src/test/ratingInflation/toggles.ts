import { ALL_ON } from "./harness.ts";

export const TOGGLES: Record<string, Record<string, unknown>> = {
	off: {},
	allOn: ALL_ON,
	staff: { coachingStaff: true },
	// Before the fix: staff levels against the fixed STAFF_DEV_SCORE_REF
	staffFixedRef: { coachingStaff: true },
	allOnFixedRef: ALL_ON,
	traits: { playerTraits: true },
	expanded: { expandedRatings: true },
	injuryDepth: { injuryDepth: true },
	possessions: { realisticPossessions: true, technicalFouls: true },
	regen: { rerandomizeDraftClassRatings: true },
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
