import { PHASE, PLAYER } from "../../common/constants.ts";
import { idb } from "../db/index.ts";
import { g } from "../util/index.ts";
import type { Player } from "../../common/types.ts";
import addFirstNameShort from "../util/addFirstNameShort.ts";
import { last } from "../../common/utils.ts";
import { defineView } from "../util/defineView.ts";
import { player } from "../core/index.ts";
import { getScoutReport, getScoutingStatus } from "../core/draft/scouting.ts";
import { archetypeFor, getLeagueNorms } from "../core/player/archetype.ts";
import { hasPreDraftStats } from "../../common/preDraft.ts";
import {
	getTraitViewContext,
	getTraitsForView,
	type TraitViewContext,
} from "../util/playerTraitsView.ts";
import { expandedRatingsOn } from "../core/player/expandedRatings.ts";
import { EXPANDED_RATINGS } from "../../common/expandedRatings.ts";
import { getClassShapeInfo } from "../core/draft/classShape.ts";
import { featureOn } from "../util/nativeFeatures.ts";

const getSeason = async (
	playersAll: Player[],
	season: number,
	traitContext: TraitViewContext,
) => {
	const playersAllFiltered = playersAll.filter((p) => p.draft.year === season);
	const players = await player.formatAll(playersAllFiltered, {
		attrs: ["pid", "firstName", "lastName", "age", "valueFuzz", "watch"],
		ratings: [
			"ovr",
			"pot",
			"skills",
			"badges",
			"fuzz",
			"pos",
			// Expanded ratings (setting on): wingspan (exact, a measurement) and the two defense ratings (with scouting fuzz)
			// and the second step ratings (with scouting fuzz)
			...(expandedRatingsOn() ? EXPANDED_RATINGS : []),
		],
		showNoStats: true,
		showRookies: true,
		fuzz: true,
	});
	players.sort((a, b) => b.valueFuzz - a.valueFuzz);

	const playersByPid = new Map(playersAllFiltered.map((p) => [p.pid, p]));
	const scoutingSystem = featureOn("scoutingSystem");
	// Derived from the prospects' ratings (live: their ratings can still be regenerated)
	const norms = __SPORT === "basketball" ? await getLeagueNorms() : undefined;
	const archetypeByPid = new Map(
		playersAllFiltered.map((p) => [
			p.pid,
			norms ? archetypeFor(p, norms)?.view : undefined,
		]),
	);

	// Set by "Regenerate ratings"
	const buildByPid = new Map(
		playersAllFiltered.map((p) => [p.pid, p.ratingsBuild?.name]),
	);

	// Player traits as far as the scouts can tell (estimates), if the setting is on
	const traitsByPid = new Map(
		playersAllFiltered.map((p) => [
			p.pid,
			getTraitsForView(p, traitContext)?.traits,
		]),
	);

	const players2 = addFirstNameShort(
		players.map((pa, i) => {
			const ratings = last(pa.ratings);

			return {
				pid: pa.pid,
				firstName: pa.firstName,
				lastName: pa.lastName,
				age: pa.age,
				watch: pa.watch,
				build: buildByPid.get(pa.pid),
				scoutReport: scoutingSystem
					? getScoutReport(playersByPid.get(pa.pid)!)
					: undefined,
				archetype: archetypeByPid.get(pa.pid)?.label,
				archetypeGroup: archetypeByPid.get(pa.pid)?.group,
				traits: traitsByPid.get(pa.pid),
				// From a linked college league: his school there
				linkedSchool: playersByPid.get(pa.pid)!.linkedCollege?.school,

				// Ratings - just take the only entry
				ovr: ratings.ovr,
				pot: ratings.pot,
				skills: ratings.skills,
				pos: ratings.pos,
				badges: ratings.badges,
				expanded:
					typeof ratings.wng === "number"
						? Object.fromEntries(
								EXPANDED_RATINGS.map((key) => [key, ratings[key]]),
							)
						: undefined,
				rank: i + 1,
			};
		}),
	);

	return {
		players: players2,
		season,
		// Draft Class Shapes setting
		shape:
			__SPORT === "basketball"
				? await getClassShapeInfo(playersAllFiltered, season)
				: undefined,

		// How many of these prospects have college stats, for the generate college stats button
		numWithCollegeStats: playersAllFiltered.filter((p) => hasPreDraftStats(p))
			.length,
	};
};

export default defineView({
	id: "draftScouting",
	load: async ({ updateEvents }) => {
		if (
			updateEvents.has("firstRun") ||
			updateEvents.has("playerMovement") ||
			// The linked college league card
			updateEvents.has("gameAttributes")
		) {
			const fantasyDraft = g.get("phase") === PHASE.FANTASY_DRAFT;

			// In fantasy draft, use temp tid
			const tid = fantasyDraft
				? PLAYER.UNDRAFTED_FANTASY_TEMP
				: PLAYER.UNDRAFTED;

			// Once a new draft class is generated, if the next season hasn't started, need to bump up year numbers
			const seasonOffset = g.get("phase") >= PHASE.RESIGN_PLAYERS ? 1 : 0;

			const firstSeason = g.get("season") + seasonOffset;

			const players = (
				await idb.cache.players.indexGetAll("playersByDraftYearRetiredYear", [
					[firstSeason],
					[Infinity, Infinity],
				])
			).filter((p) => p.tid === tid);

			let maxDraftYear = firstSeason + 2;
			for (const p of players) {
				if (p.draft.year > maxDraftYear) {
					maxDraftYear = p.draft.year;
				}
			}

			const traitContext = await getTraitViewContext();
			const seasons: Awaited<ReturnType<typeof getSeason>>[] = [];
			for (let season = firstSeason; season <= maxDraftYear; season++) {
				seasons.push(await getSeason(players, season, traitContext));
			}

			// Linked college league (pro leagues only): which one, and what was imported
			const linked = g.get("linkedCollege");
			let linkedCollege;
			if (linked) {
				const meta = await idb.meta.get("leagues", linked.lid);
				linkedCollege = {
					...linked,
					name: meta?.name ?? `League ${linked.lid} (deleted?)`,
				};
			}

			return {
				fantasyDraft,
				linkedCollege,
				canLink:
					__SPORT === "basketball" &&
					g.get("leagueType") !== "college" &&
					!fantasyDraft,
				seasons,
				scoutingStatus:
					featureOn("scoutingSystem") && !fantasyDraft
						? await getScoutingStatus()
						: undefined,
			};
		}
	},
});
