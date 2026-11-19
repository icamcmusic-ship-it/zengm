// Real Player Comps (League Extras, basketball): for each draft prospect, the 3 real NBA players whose real young seasons look most like
// his ratings as the user's scouts see them (see common/realComps.ts for the match). The real players data file is the one real players
// leagues use (loadData.basketball.ts, fetched once and kept); the small index of real young seasons is built from it once. Nothing is
// stored on the player and nothing draws a random number. When the data can't be loaded (offline), there are no comps, quietly.
import { PLAYER } from "../../../common/constants.ts";
import {
	buildRealCompIndex,
	COMP_RATINGS,
	findRealComps,
	realOutcome,
	realSeasonText,
	similarityLabel,
	type RealComp,
	type RealCompIndex,
} from "../../../common/realComps.ts";
import type { Player } from "../../../common/types.ts";
import { last } from "../../../common/utils.ts";
import { g } from "../../util/index.ts";
import { featureOn } from "../../util/nativeFeatures.ts";
import loadDataBasketball from "../realRosters/loadData.basketball.ts";
import fuzzRating from "../player/fuzzRating.ts";
import ovr from "../player/ovr.ts";
import { ovrV2On } from "../player/ratingsModelSwitch.ts";

let indexPromise: Promise<RealCompIndex | undefined> | undefined;
let failedAt = 0;
let loader: () => Promise<unknown> = loadDataBasketball;

// After a failed load (offline), try again at most this often
const RETRY_MS = 60_000;

export const getRealCompIndex = (): Promise<RealCompIndex | undefined> => {
	if (!indexPromise) {
		if (failedAt > 0 && Date.now() - failedAt < RETRY_MS) {
			return Promise.resolve(undefined);
		}
		indexPromise = (async () => {
			try {
				return buildRealCompIndex((await loader()) as any);
			} catch {
				failedAt = Date.now();
				indexPromise = undefined;
				return undefined;
			}
		})();
	}
	return indexPromise;
};

// Per prospect: keyed by everything the match reads (his shown ratings, age, position), so a new scouting look, a regenerated build or a
// new season gets new comps
const cache = new Map<string, ReturnType<typeof findRealComps>>();
const MAX_CACHE = 3000;
// What each real player became, per ovr formula
const outcomes = new Map<string, ReturnType<typeof realOutcome>>();

export const realCompsOn = () =>
	__SPORT === "basketball" &&
	featureOn("realComps") &&
	// No visible ratings challenge: comps would give the ratings away
	!g.get("challengeNoRatings");

// His ratings as the user sees them (hgt is never fuzzed, like on every page)
export const shownCompInput = (p: Player) => {
	const pr = last(p.ratings) as any;
	const ratings = Object.fromEntries(
		COMP_RATINGS.map((key) => [
			key,
			key === "hgt" ? pr.hgt : fuzzRating(pr[key], pr.fuzz),
		]),
	) as Record<(typeof COMP_RATINGS)[number], number>;
	return {
		ratings,
		age: pr.season - p.born.year,
		pos: pr.pos as string,
		srID: p.srID,
	};
};

export const compsForInput = (
	index: RealCompIndex,
	input: ReturnType<typeof shownCompInput>,
): RealComp[] => {
	const key = JSON.stringify(input);
	let matches = cache.get(key);
	if (!matches) {
		matches = findRealComps(index, input);
		if (cache.size >= MAX_CACHE) {
			cache.clear();
		}
		cache.set(key, matches);
	}
	const v2 = ovrV2On();
	return matches.map((m) => {
		const outcomeKey = `${m.slug}:${v2}`;
		let outcome = outcomes.get(outcomeKey);
		if (!outcome) {
			outcome = realOutcome(index, m.player, (r) => ovr(r as any));
			outcomes.set(outcomeKey, outcome);
		}
		return {
			name: m.name,
			season: realSeasonText(m.season),
			age: m.age,
			similarity: similarityLabel(m.distance),
			distance: m.distance,
			became: outcome.label,
			allStar: outcome.allStar,
			seasons: outcome.seasons,
			active: outcome.active,
		};
	});
};

// Comps for draft prospects (other players get none), by pid. Empty when the feature is off or the data can't be loaded.
export const getRealComps = async (
	players: Player[],
): Promise<Map<number, RealComp[]>> => {
	const out = new Map<number, RealComp[]>();
	if (!realCompsOn()) {
		return out;
	}
	// (not the pros in a fantasy draft)
	const prospects = players.filter(
		(p) => p.tid === PLAYER.UNDRAFTED && p.ratings.length > 0,
	);
	if (prospects.length === 0) {
		return out;
	}
	const index = await getRealCompIndex();
	if (!index) {
		return out;
	}
	for (const p of prospects) {
		out.set(p.pid, compsForInput(index, shownCompInput(p)));
	}
	return out;
};

// Tests: start over, optionally with another loader
export const resetRealCompsForTests = (
	newLoader: () => Promise<unknown> = loadDataBasketball,
) => {
	indexPromise = undefined;
	failedAt = 0;
	loader = newLoader;
	cache.clear();
	outcomes.clear();
};
