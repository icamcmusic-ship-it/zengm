// College mode: recruiting (board, actions, commitments, signing day results). docs/college-mode.md
import { PHASE } from "../../common/constants.ts";
import { COLLEGE_SCHOLARSHIPS } from "../../common/college/constants.ts";
import type { PlayerRecruit } from "../../common/college/types.ts";
import { last } from "../../common/utils.ts";
import { idb } from "../db/index.ts";
import { g } from "../util/index.ts";
import { defineView } from "../util/defineView.ts";
import type { RouteParams } from "../../ui/router/types.ts";
import { player } from "../core/index.ts";
import * as college from "../core/college/index.ts";
import { canRecruit, getBoard } from "../core/college/recruiting.ts";
import { getCollegeTeamNames } from "./collegePolls.ts";

export default defineView({
	id: "collegeRecruiting",
	processInputs: (params: RouteParams<"collegeRecruiting">) => {
		const season =
			params.season !== undefined ? Number.parseInt(params.season) : undefined;
		return {
			season:
				season === undefined || Number.isNaN(season) ? g.get("season") : season,
		};
	},
	load: async ({ inputs, updateEvents, prevInputs }) => {
		if (!college.isCollege()) {
			return {
				errorMessage: "This page is only available in college leagues.",
			};
		}
		if (
			!updateEvents.has("firstRun") &&
			!updateEvents.has("playerMovement") &&
			!updateEvents.has("newPhase") &&
			!updateEvents.has("gameAttributes") &&
			!updateEvents.has("gameSim") &&
			inputs.season === prevInputs?.season
		) {
			return;
		}
		const userTid = g.get("userTid");
		const phase = g.get("phase");
		const season = inputs.season;
		const current = season === g.get("season");

		const board = current ? await getBoard("recruit") : undefined;
		const recruits = (board?.list ?? []).map(({ pr, info }) => {
			const recruit = pr.p.recruit as PlayerRecruit;
			return {
				...info,
				stars: recruit.stars,
				rank: recruit.rank,
				posRank: recruit.posRank,
				state: recruit.state,
			};
		});

		// This year's signing class of the user's school (after signing day)
		const roster = current
			? await idb.cache.players.indexGetAll("playersByTid", userTid)
			: [];
		const signed = roster
			.filter((p) => (p as any).classYear === 0)
			.map((p) => {
				const ratings = last(p.ratings);
				const recruit = (p as any).recruit as PlayerRecruit | undefined;
				return {
					pid: p.pid,
					name: `${p.firstName} ${p.lastName}`,
					pos: ratings.pos,
					stars: recruit?.stars ?? 2,
					rank: recruit?.rank,
					walkOn: !!recruit?.walkOn,
					ovr: player.fuzzRating(ratings.ovr, ratings.fuzz),
					pot: player.fuzzRating(ratings.pot, ratings.fuzz),
				};
			});

		const archive = await college.getCollegeArchive(season);
		const seasons = [];
		for (let s = g.get("startingSeason"); s <= g.get("season"); s++) {
			seasons.push(s);
		}

		const t = await idb.cache.teams.get(userTid);
		return {
			season,
			seasons,
			current,
			recruits,
			signed,
			state: board?.state,
			openSpots: board?.openSpots ?? 0,
			offers: board?.offers ?? 0,
			offerLimit: board?.offerLimit ?? 0,
			weeksLeft: board?.weeksLeft ?? 0,
			lateRecruiting: phase === PHASE.RESIGN_PLAYERS,
			userPrestige: Math.round(t ? college.getTeamPrestige(t as any) : 0),
			scholarships: COLLEGE_SCHOLARSHIPS,
			autoRecruit: g.get("collegeAutoRecruit"),
			signingDayPassed: phase >= PHASE.FREE_AGENCY || phase < 0,
			canEdit: current && canRecruit(),
			commits: archive?.commits ?? [],
			classRankings: archive?.classRankings ?? [],
			teams: await getCollegeTeamNames(season),
			userTid,
			region: t?.region ?? "",
		};
	},
});
