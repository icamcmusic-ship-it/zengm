// The fork's main model in every league. The League Extras that are core (common/nativeFeatures.ts `core`) are no longer
// settings: new leagues have them on by their defaults, and an existing league, or a league file, that has one off gets it
// turned on when it is loaded, with the one-time conversions that turning it on used to run from the settings page
// (expanded ratings and sim-calibrated ovr derived and recomputed, sub-ratings filled in, coaching staffs and AI GMs made,
// retired players' tracking folded). A college league keeps off what college mode turns off (`college: false`).
//
// The play-by-play switch (storePlayByPlay) is not forced: it mirrors the storage scope (pbpStore "none" means off), so a
// league that had it off keeps storing nothing, now as the scope "none".
import { nativeCoreSettingsFor } from "../../../common/nativeFeatures.ts";
import type { GameAttributesLeague } from "../../../common/types.ts";
import { g } from "../../util/index.ts";
import { ensureGms } from "../gm/index.ts";
import { foldRetiredAdvCareers } from "../player/advStatsStorage.ts";
import updateExpandedRatingsForLeague from "../player/updateExpandedRatingsForLeague.ts";
import updateSubRatingsForLeague from "../player/updateSubRatingsForLeague.ts";
import * as staff from "../staff/index.ts";
import setGameAttributes from "./setGameAttributes.ts";

const current = (key: string): unknown =>
	Object.hasOwn(g, key) ? g.get(key as any) : undefined;

// The settings a league must change to have the main model (empty when it has it)
export const coreFeatureChanges = (): Partial<GameAttributesLeague> => {
	const want = nativeCoreSettingsFor(
		__SPORT,
		current("leagueType") === "college",
	);
	const out: Record<string, unknown> = {};
	for (const [key, value] of Object.entries(want)) {
		if (key === "storePlayByPlay") {
			continue;
		}
		if (current(key) !== value) {
			out[key] = value;
		}
	}
	// (a league that stored no play-by-play keeps storing none)
	if (
		"storePlayByPlay" in want &&
		current("storePlayByPlay") === false &&
		current("pbpStore") !== "none"
	) {
		out.pbpStore = "none";
		out.storePlayByPlay = false;
	}
	return out as Partial<GameAttributesLeague>;
};

// Returns the settings it changed (empty when the league already had the main model)
const forceCoreFeatures = async (): Promise<string[]> => {
	const changes = coreFeatureChanges();
	const keys = Object.keys(changes);
	if (keys.length === 0) {
		return keys;
	}
	const turnedOn = (key: string) => (changes as any)[key] === true;
	await setGameAttributes(changes);
	if (__SPORT === "basketball") {
		// Expanded ratings or sim-calibrated ovr turned on: derive the new ratings, recompute ovr, pot and skills
		if (turnedOn("expandedRatings") || turnedOn("ovrV2")) {
			await updateExpandedRatingsForLeague();
		}
		if (turnedOn("subRatings")) {
			await updateSubRatingsForLeague();
		}
	}
	// (each a no-op when there is nothing to do or its feature is off)
	await staff.ensureStaff();
	await ensureGms();
	await foldRetiredAdvCareers();
	return keys;
};

export default forceCoreFeatures;
