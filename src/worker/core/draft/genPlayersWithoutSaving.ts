import { PLAYER } from "../../../common/constants.ts";
import { player } from "../index.ts";
import { g } from "../../util/index.ts";
import type { PlayerWithoutKey } from "../../../common/types.ts";
import { bySport } from "../../../common/sportFunctions.ts";
import { minBy, assertDefined } from "../../../common/utils.ts";
import { randInt, shuffle } from "../../../common/random.ts";
import { defaultGameAttributes } from "../../../common/defaultGameAttributes.ts";
import { markNewClass } from "./classShape.ts";
import { featureOn } from "../../util/nativeFeatures.ts";
import { ballSecurityBase } from "../../../common/expandedRatings.ts";
import { expandedRatingsApply } from "../player/expandedRatings.ts";
import limitRating from "../player/limitRating.ts";
import { assignClassSubs } from "../player/subRatings.ts";
import { Rng } from "../../../common/ratingsBuilds/rng.ts";
import {
	CLASS_TALENT,
	DECLARE_FUDGE,
	FIFTH_YEAR_SHARE,
	classTalentShift,
	TALENT_CYCLE,
	talentCycle,
	type GenVariety,
} from "../../../common/prospectVariety.ts";
import { ovrRaw } from "../player/ovr.basketball.ts";
import {
	polishSenior,
	separateNearDuplicates,
	shiftToRawOvr,
	steerArchetypeLabels,
	steerArchetypeMix,
	labelSteerOptions,
} from "../player/prospectVariety.ts";
import { fuzzedArchetypeLabel } from "../player/archetype.ts";
import { DEFAULT_NORMS } from "../../../common/archetypes/index.ts";
import { helpers } from "../../../common/helpers.ts";

// arch13: small guards in the draft. BBGM's prospect generator was tuned to the stock ovr, which flatters small guards;
// the sim-calibrated ovr (ovrV2, on for new leagues) takes about 2-3 points from them, so far fewer 6'3" and shorter
// prospects made the first round than in real drafts (2010-2025: 13.6% of first-rounders, about 16% of the top 60), and
// fewer of them read as point guards. A prospect who comes into the draft at that size has made it on skill: with ovrV2
// on, a 6'3" or shorter prospect gets SMALL_GUARD_SKILL more handle, passing and offensive IQ (half at 6'3"), the skills a
// point guard is built on (his ball security follows them with expanded ratings).
export const SMALL_GUARD_SKILL = 6;
const SMALL_GUARD_MAX_INCHES = 75;
export const smallGuardPolish = (p: PlayerWithoutKey) => {
	if (__SPORT !== "basketball" || !featureOn("ovrV2")) {
		return;
	}
	// His generated height, before the league's height factor and the women's league scale (player.generate applies
	// both to p.hgt), so the polish reaches the same share of every class
	let inches = p.hgt / g.get("heightFactor");
	if (g.get("gender") === "female") {
		inches /= 0.92;
	}
	inches = Math.round(inches);
	if (inches > SMALL_GUARD_MAX_INCHES) {
		return;
	}
	const k =
		inches === SMALL_GUARD_MAX_INCHES
			? SMALL_GUARD_SKILL / 2
			: SMALL_GUARD_SKILL;
	const r = p.ratings[0] as any;
	const expanded = expandedRatingsApply(r);
	const bscResidual = expanded ? r.bsc - ballSecurityBase(r) : 0;
	for (const key of ["drb", "pss", "oiq"]) {
		r[key] = limitRating(r[key] + k);
	}
	if (expanded) {
		r.bsc = limitRating(ballSecurityBase(r) + bscResidual);
	}
};

// To improve the distribution of DP ages in leagues with modified draftAges, this code will change the % of players who declare for draft each year to work better with modified draftAges settings. Previously, it was just a constant defaultFractionPerYear.
const defaultFractionPerYear = bySport({
	baseball: 0.5,
	basketball: 0.5,
	football: 0.5,
	hockey: 0.75,
});

// For default values of numYearsBeforeLastYear, output is: basketball/football = 0.5, hockey = 0.75
const getFractionPerYear = (ageGap: number) => {
	if (ageGap === 0) {
		return 1;
	}

	// For small number of years, just do default - this handles the defaults for all sports currently
	if (ageGap <= 3) {
		return defaultFractionPerYear;
	}

	// Find fractionPerYear such that the amount remaining in the last year is below 1/ageGap. This will result in a larger number of players in the last year than the year before (or possibly many years before), but that's okay I guess.
	for (let fractionPerYear = 0; fractionPerYear < 1; fractionPerYear += 0.01) {
		let result = 1;
		let enteringDraftThisYear = 0;
		for (let i = 0; i < ageGap; i++) {
			enteringDraftThisYear = result * fractionPerYear;
			result -= enteringDraftThisYear;
		}
		if (result < 1 / ageGap) {
			return fractionPerYear;
		}
	}

	// Should never happen
	return 1 / ageGap;
};

const genVarOf = (p: PlayerWithoutKey) => (p as { genVar?: GenVariety }).genVar;

const developOneSeason = async (p: PlayerWithoutKey) => {
	// Prospect variety: the ages he develops at before the draft, for his hidden trajectory once he has a pid (draft/genPlayers.ts)
	const gv = genVarOf(p);
	if (gv) {
		const age = p.ratings.at(-1)!.season - p.born.year + 1;
		gv.pre = [...(gv.pre ?? []), age];
	}
	await player.develop(p, 1, true);
};

// The league's seed (a league id may be missing in tests), and the class's for its talent draw
const leagueSeed = () => {
	let lid: unknown;
	try {
		lid = g.get("lid");
	} catch {
		lid = undefined;
	}
	return String(lid);
};
const classSeed = (draftYear: number) => `${leagueSeed()}|${draftYear}`;

const genPlayersWithoutSaving = async (
	draftYear: number,
	scoutingLevel: number,
	existingPlayers: PlayerWithoutKey[],
	forceScrubs?: boolean,
): Promise<PlayerWithoutKey[]> => {
	// If user has increased the number of rounds - code below ensures excess players are scrubs.
	// If user has descreased the number of rounds - keep number of prospects the same, more will go undrafted.
	const normalNumPlayers = Math.round(
		(defaultGameAttributes.numDraftRounds * g.get("numActiveTeams") * 7) / 6,
	);
	let baseNumPlayers = Math.max(
		Math.round((g.get("numDraftRounds") * g.get("numActiveTeams") * 7) / 6),
		normalNumPlayers,
	);

	// Based on draftAges, forceRetireAge, and forceRetireSeasons settings, check how many players we need per draft class to fill the league. KEEP IN SYNC WITH LEAGUE CREATION seasonsSimmed
	const draftAges = g.get("draftAges");
	const forceRetireAge = g.get("forceRetireAge");
	const forceRetireSeasons = g.get("forceRetireSeasons");
	const averageDraftAge = Math.round((draftAges[0] + draftAges[1]) / 2); // Ideally this would be more intelligently determined, based on getFractionPerYear
	const forceRetireAgeDiff = forceRetireAge - averageDraftAge;
	let forceRetireDiff = 0;
	if (forceRetireAgeDiff > 0 && forceRetireSeasons > 0) {
		forceRetireDiff = Math.min(forceRetireAgeDiff, forceRetireSeasons);
	} else {
		forceRetireDiff = Math.max(forceRetireAgeDiff, forceRetireSeasons);
	}
	if (forceRetireAgeDiff > 0 || forceRetireSeasons > 0) {
		const numActivePlayers =
			(g.get("maxRosterSize") + 1) * g.get("numActiveTeams");
		const numSeasonsPerPlayer = forceRetireDiff;
		const numPlayersNeededPerYear = Math.ceil(
			numActivePlayers / numSeasonsPerPlayer,
		);
		if (numPlayersNeededPerYear > baseNumPlayers) {
			baseNumPlayers = numPlayersNeededPerYear;
		}
	}

	const numPlayers = baseNumPlayers - existingPlayers.length;

	if (numPlayers <= 0) {
		return [];
	}

	if (!forceScrubs) {
		// If it's mostly real players, generate scrubs
		const numRealPlayers = existingPlayers.filter((p) => p.real).length;
		forceScrubs = numRealPlayers > 0.5 * normalNumPlayers;
	}

	let baseAge = draftAges[0] - (draftYear - g.get("season"));
	if (__SPORT === "football") {
		// See below comment about FBGM
		baseAge -= 2;
	}
	const minMaxAgeDiff = draftAges[1] - draftAges[0];

	let remaining = [];
	for (let i = 0; i < numPlayers; i++) {
		const name = await player.name();
		const p = await player.generate(
			PLAYER.UNDRAFTED,
			baseAge,
			draftYear,
			false,
			scoutingLevel,
			name,
		);
		smallGuardPolish(p);

		// Just for ovr/pot
		await player.develop(p, 0);

		remaining.push(p);
	}

	// Do one season at a time, keeping the lowest pot players in college for another season
	let enteringDraft: typeof remaining = [];

	const fractionPerYear = getFractionPerYear(minMaxAgeDiff);

	// FBGM was originally written to assume players were generated at 19 and developed for two seasons before declaring.
	// If `draftAges` existed when FBGM was written, it would not make sense to do that. Doing something about that now
	// is difficult, so we want to keep developing prospects for 2 seasons currently.
	if (__SPORT === "football") {
		for (let i = 0; i < 2; i++) {
			for (const p of remaining) {
				await developOneSeason(p);
			}
		}
	}

	const fudgeFactors = new WeakMap<PlayerWithoutKey, number>();
	const getFudgeFactor = (p: PlayerWithoutKey) => {
		// Add a fudge factor, used when sorting below to add a little randomness to players entering draft. Stock: +/-50, which swamps the
		// spread in pot, so who declared early was close to random. Basketball prospect variety: +/-DECLARE_FUDGE, so the best prospects tend
		// to come out young (the same random number, scaled).
		return fudgeFactors.getOrInsertComputed(p, () => {
			const fudge = randInt(-50, 50);
			return __SPORT === "basketball" && genVarOf(p)
				? Math.round((fudge * DECLARE_FUDGE) / 50)
				: fudge;
		});
	};

	for (let i = 0; i < minMaxAgeDiff + 1; i++) {
		// The % of players declaring each year is determined by fractionPerYear, except in last year when all players declare.
		const cutoff =
			i === minMaxAgeDiff
				? remaining.length
				: Math.round(fractionPerYear * remaining.length);

		remaining.sort(
			(a, b) =>
				b.ratings[0].pot +
				getFudgeFactor(b) -
				(a.ratings[0].pot + getFudgeFactor(a)),
		);
		enteringDraft = enteringDraft.concat(remaining.slice(0, cutoff));
		remaining = remaining.slice(cutoff); // Each player staying in college, develop 1 year more

		// Prospect variety: in the last year a few stay one more (fifth-year seniors, medical redshirts), so a class has a few 23-year-olds
		if (__SPORT === "basketball" && i === minMaxAgeDiff && minMaxAgeDiff >= 2) {
			for (const p of enteringDraft) {
				const gv = genVarOf(p);
				if (
					gv &&
					p.draft.year - p.born.year === draftAges[1] &&
					new Rng(`fifthYear|${gv.s}`).chance(FIFTH_YEAR_SHARE)
				) {
					await developOneSeason(p);
				}
			}
		}

		for (const p of remaining) {
			await developOneSeason(p);
		}
	}

	// Small chance of making top 4 players (in 70 player draft) special - on average, one per draft class
	if (existingPlayers.length === 0) {
		const numSpecialPlayerChances = Math.round((4 / 70) * numPlayers);

		// The top of the class by potential (with the same fudge factor as declaring, already drawn, so no new random numbers), not the
		// first declarers: enteringDraft is in declaration order, so its first players are always the youngest
		const byPot = enteringDraft
			.map((p, i) => ({
				p,
				i,
				v: p.ratings[0].pot + (fudgeFactors.get(p) ?? 0),
			}))
			.sort((a, b) => b.v - a.v || a.i - b.i)
			.map((x) => x.p);

		for (let i = 0; i < numSpecialPlayerChances; i++) {
			if (Math.random() < 1 / numSpecialPlayerChances) {
				const p = byPot[i];
				assertDefined(p);
				player.bonus(p);
				await player.develop(p, 0); // Recalculate ovr/pot
			}
		}
	}

	// Basketball prospect variety, for a class made from scratch: seniors' polish, the class's talent draw (the top of the board up or down
	// together), near-identical prospects pulled apart and a light steer of the archetype mix. Seeded, no Math.random.
	if (
		__SPORT === "basketball" &&
		existingPlayers.length === 0 &&
		!forceScrubs
	) {
		const changed = new Set<PlayerWithoutKey>();
		for (const p of enteringDraft) {
			const age = p.draft.year - p.born.year;
			if (
				genVarOf(p) &&
				minMaxAgeDiff >= 2 &&
				age >= draftAges[1] &&
				p.college !== "" &&
				helpers.isAmerican(p.born.loc)
			) {
				polishSenior(p);
				changed.add(p);
			}
		}
		// The class's own draw for its top prospects, and the league's talent cycle (deep and thin eras) for a deeper top
		const shift = classTalentShift(classSeed(draftYear));
		const cycle = talentCycle(leagueSeed(), draftYear);
		const ranked = enteringDraft
			.filter((p) => genVarOf(p))
			.toSorted((a, b) => b.ratings[0].pot - a.ratings[0].pot);
		ranked
			.slice(0, Math.max(CLASS_TALENT.top, TALENT_CYCLE.top))
			.forEach((p, i) => {
				const r = p.ratings[0];
				const delta =
					(i < CLASS_TALENT.top ? shift : 0) +
					(i < TALENT_CYCLE.top ? cycle : 0);
				shiftToRawOvr(r, ovrRaw(r as any) + delta);
				changed.add(p);
			});
		for (const p of changed) {
			await player.develop(p, 0);
		}
		changed.clear();
		for (const p of separateNearDuplicates(enteringDraft)) {
			changed.add(p);
		}
		for (const p of steerArchetypeMix(enteringDraft)) {
			changed.add(p);
		}
		for (const p of changed) {
			await player.develop(p, 0);
		}
		// Stronger, label-aware steering with the archetype engine itself (read-only, true base ratings: never the sub-ratings, which are
		// assigned below from the bases, so turning them on or off doesn't change who is steered): crowded labels in the drafted part of
		// the class are thinned with bounded, ovr-neutral nudges
		if (featureOn("archetypes") && labelSteerOptions.enabled) {
			// (the built-in reference league's norms: a class is steered the same whatever league it is generated in)
			const norms = DEFAULT_NORMS;
			const { changed: steered } = steerArchetypeLabels(enteringDraft, (p) => {
				const { sub: _sub, ...row } = p.ratings.at(-1) as any;
				return fuzzedArchetypeLabel(row, 0, norms, {
					ovr: row.ovr,
					pot: row.pot,
				});
			});
			for (const p of steered) {
				await player.develop(p, 0);
			}
		}
	}

	// If user has increased the number of rounds, ensure excess players are scrubs
	if (normalNumPlayers < baseNumPlayers || forceScrubs) {
		const worstPlayer = minBy(
			[...existingPlayers, ...enteringDraft],
			(p) => p.ratings[0].ovr,
		);
		assertDefined(worstPlayer);

		let numPlayersToNerf;
		if (forceScrubs) {
			numPlayersToNerf = enteringDraft.length;
		} else {
			// Any new players created beyond normalNumPlayers, make sure to nerf them
			const playersRemainingToHitNormalNumPlayers =
				normalNumPlayers - existingPlayers.length;
			if (playersRemainingToHitNormalNumPlayers <= 0) {
				numPlayersToNerf = enteringDraft.length;
			} else {
				numPlayersToNerf =
					enteringDraft.length - playersRemainingToHitNormalNumPlayers;
			}
		}

		shuffle(enteringDraft);
		for (let i = 0; i < numPlayersToNerf; i++) {
			const p = enteringDraft[i];
			assertDefined(p);
			const ovrDiff = p.ratings[0].ovr - worstPlayer.ratings[0].ovr;
			if (ovrDiff > 0) {
				player.bonus(p, -ovrDiff / 2);
				await player.develop(p, 0);
			}
		}
	}

	// No college for players 18 or younger
	for (const p of enteringDraft) {
		const ageAtDraft = p.draft.year - p.born.year;
		if (ageAtDraft <= 18) {
			p.college = "";
		}
	}

	/*console.log(draftYear, enteringDraft.length);
	const grouped = Object.groupBy(enteringDraft, p => p.ratings[0].pos);
	const table = orderBy(Object.entries(grouped), 0).map(([pos, players]) => ({
		pos,
		count: players.length,
	}));
	console.table(table);*/

	// Sub-ratings: each prospect's shape, now that his age at the draft and his origin are known (with the class caps)
	assignClassSubs(enteringDraft);

	// A class made from scratch gets a shape later (the Draft Class Shapes setting, see classShape.ts). Not a class that is being topped off (imported) or filled with scrubs
	if (existingPlayers.length === 0 && !forceScrubs) {
		markNewClass(enteringDraft);
	}

	return enteringDraft;
};

export default genPlayersWithoutSaving;
