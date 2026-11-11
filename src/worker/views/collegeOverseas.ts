import { PHASE, PLAYER } from "../../common/constants.ts";
import { idb } from "../db/index.ts";
import { g } from "../util/index.ts";
import { featureOffError } from "../util/nativeFeatures.ts";
import { defineView } from "../util/defineView.ts";
import { player } from "../core/index.ts";
import { getCollegeSeason } from "../core/draft/collegeSeason.ts";
import {
	COLLEGE_AWARD_PREFIX,
	getPreDraftAwards,
	getPreDraftStats,
} from "../../common/preDraft.ts";
import {
	getPreDraftLabel,
	isOverseasLeague,
} from "../../common/collegeStats/overseas.ts";
import { NCAA_REGIONS } from "../../common/collegeStats/ncaa.ts";
import {
	getPollHistory,
	getWeeksAtNo1,
} from "../../common/collegeStats/ncaaPolls.ts";
import { last } from "../../common/utils.ts";
import type { Player } from "../../common/types.ts";
import type { RouteParams } from "../../ui/router/types.ts";

export const COLLEGE_OVERSEAS_TABS = [
	"standings",
	"ap",
	"conference",
	"selection",
	"ncaa",
	"nit",
	"overseas",
] as const;
export type CollegeOverseasTab = (typeof COLLEGE_OVERSEAS_TABS)[number];

// Tournament honors worth showing next to a name on the page
const TOURNEY_HONOR =
	/Tournament MVP|Most Outstanding Player|All-American|Player of the Year$/;

const prospectInfo = (p: Player, draftYear: number) => {
	const ratings = last(p.ratings);
	const fuzz = p.tid === PLAYER.UNDRAFTED ? ratings.fuzz : 0;
	const drafted = p.tid !== PLAYER.UNDRAFTED && p.draft.round > 0;
	const honors = getPreDraftAwards(p)
		.filter((a) => a.season === draftYear && a.type)
		.map((a) => a.type!.replace(COLLEGE_AWARD_PREFIX, ""));
	return {
		pid: p.pid,
		name: `${p.firstName} ${p.lastName}`,
		pos: ratings.pos,
		age: draftYear - p.born.year,
		ovr: player.fuzzRating(ratings.ovr, fuzz),
		pot: player.fuzzRating(ratings.pot, fuzz),
		draft: drafted
			? {
					round: p.draft.round,
					pick: p.draft.pick,
					abbrev: g.get("teamInfoCache")[p.draft.tid]?.abbrev ?? "",
				}
			: undefined,
		honors: honors.filter((type) => TOURNEY_HONOR.test(type)),
	};
};
export type CollegeProspectInfo = ReturnType<typeof prospectInfo>;

/**
 * College/Overseas page (Draft Scouting tab): the college season of a draft class's draft year (its storyline, standings, the weekly AP poll, conference tournaments, the NET and the selection bubble, March Madness, the NIT), rebuilt from the class (see core/draft/collegeSeason.ts), and the class's prospects playing overseas.
 */
export default defineView({
	id: "collegeOverseas",
	processInputs: (params: RouteParams<"collegeOverseas">) => {
		const season =
			params.season !== undefined ? Number.parseInt(params.season) : undefined;
		const tab = COLLEGE_OVERSEAS_TABS.includes(params.tab as any)
			? (params.tab as CollegeOverseasTab)
			: "ncaa";
		return {
			season: season === undefined || Number.isNaN(season) ? undefined : season,
			tab,
		};
	},
	load: async ({ inputs, updateEvents, prevInputs }) => {
		const featureOff = featureOffError("collegeSeason");
		if (featureOff) {
			return featureOff;
		}
		if (
			!updateEvents.has("firstRun") &&
			!updateEvents.has("playerMovement") &&
			!updateEvents.has("newPhase") &&
			inputs.season === prevInputs?.season &&
			inputs.tab === prevInputs?.tab
		) {
			return;
		}

		const firstSeason =
			g.get("season") + (g.get("phase") >= PHASE.RESIGN_PLAYERS ? 1 : 0);
		const prospects = await idb.cache.players.indexGetAll(
			"playersByTid",
			PLAYER.UNDRAFTED,
		);
		// Upcoming classes, and the last few drafts
		const seasons = [
			...new Set([
				...prospects.map((p) => p.draft.year),
				...[3, 2, 1].map((i) => firstSeason - i),
			]),
		]
			.filter((year) => year >= g.get("startingSeason") - 1)
			.sort((a, b) => a - b);
		const season = inputs.season ?? firstSeason;

		const classPlayers = await idb.merged.players.getAll({
			draftYear: season,
		});
		const built = await getCollegeSeason(season);

		// Overseas (and G League) prospects of the class: their draft year season
		const overseas = classPlayers
			.flatMap((p) => {
				const row = getPreDraftStats(p)
					.filter((r) => r.season === season)
					.at(-1) as any;
				if (
					!row ||
					!row.teamName ||
					getPreDraftLabel(row.teamName) === "College"
				) {
					return [];
				}
				const gp = row.gp || 0;
				const per = (key: string) => (gp > 0 ? row[key] / gp : 0);
				const pct = (made: string, att: string) =>
					row[att] > 0 ? row[made] / row[att] : undefined;
				return [
					{
						...prospectInfo(p, season),
						league: row.teamName as string,
						overseas: isOverseasLeague(row.teamName),
						gp,
						min: per("min"),
						pts: per("pts"),
						trb: per("orb") + per("drb"),
						ast: per("ast"),
						fgp: pct("fg", "fga"),
						tpp: pct("tp", "tpa"),
						allHonors: getPreDraftAwards(p)
							.filter((a) => a.season === season && a.type)
							.map((a) => a.type!.replace(COLLEGE_AWARD_PREFIX, "")),
					},
				];
			})
			.sort((a, b) => b.pts - a.pts);

		if (!built) {
			return {
				season,
				seasons,
				tab: inputs.tab,
				hasSeason: false as const,
				overseas,
				numProspects: classPlayers.length,
			};
		}

		const { season: ncaa, players } = built;
		const prospectsBySchool: Record<string, CollegeProspectInfo[]> = {};
		for (const p of players.sort((a, b) => b.value - a.value)) {
			const school = p.collegeSeason!.school;
			(prospectsBySchool[school] ??= []).push(prospectInfo(p, season));
		}

		// The tournament's best players among prospects
		const honorWinners: { type: string; pid: number; name: string }[] = [];
		for (const p of players) {
			for (const award of getPreDraftAwards(p)) {
				const type = award.type?.replace(COLLEGE_AWARD_PREFIX, "");
				if (
					award.season === season &&
					type &&
					/Tournament MVP|Most Outstanding Player|All-Final Four|NIT All-Tournament|Consensus First Team All-American|Consensus Second Team All-American/.test(
						type,
					)
				) {
					honorWinners.push({
						type,
						pid: p.pid,
						name: `${p.firstName} ${p.lastName}`,
					});
				}
			}
		}

		return {
			season,
			seasons,
			tab: inputs.tab,
			hasSeason: true as const,
			overseas,
			numProspects: classPlayers.length,
			teams: ncaa.teams.map((t, i) => ({
				school: t.school,
				conf: t.conf,
				w: t.w,
				l: t.l,
				confW: t.confW,
				confL: t.confL,
				confRank: t.confRank,
				srs: t.srs,
				apRank: t.apRank,
				ncaaSeed: t.ncaaSeed,
				region: t.region,
				ncaa: t.ncaa,
				confTourney: t.confTourney,
				bid: t.bid,
				nit: t.nit,
				nitSeed: t.nitSeed,
				net: ncaa.net[i]!,
			})),
			conferences: ncaa.conferences,
			ap: ncaa.ap,
			polls: ncaa.polls,
			weeksAtNo1: getWeeksAtNo1(ncaa.polls),
			pollHistory: getPollHistory(ncaa.polls),
			selection: ncaa.selection,
			tournament: ncaa.tournament,
			nit: ncaa.nit,
			storyline: {
				shape: ncaa.storyline.shape,
				headline: ncaa.storyline.headline,
				summary: ncaa.storyline.summary,
			},
			ppg: ncaa.ppg,
			regions: [...NCAA_REGIONS],
			prospectsBySchool,
			honorWinners,
			userTid: g.get("userTid"),
		};
	},
});
