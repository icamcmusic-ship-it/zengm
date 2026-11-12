// College mode: the user's recruiting board (docs/college-mode.md)
import { PHASE } from "../../common/constants.ts";
import { COLLEGE_SCHOLARSHIPS } from "../../common/college/constants.ts";
import type { PlayerRecruit } from "../../common/college/types.ts";
import { last } from "../../common/utils.ts";
import { idb } from "../db/index.ts";
import { g } from "../util/index.ts";
import { defineView } from "../util/defineView.ts";
import { player } from "../core/index.ts";
import * as college from "../core/college/index.ts";

export default defineView({
	id: "collegeRecruiting",
	load: async ({ updateEvents }) => {
		if (!college.isCollege()) {
			return {
				errorMessage: "This page is only available in college leagues.",
			};
		}
		if (
			!updateEvents.has("firstRun") &&
			!updateEvents.has("playerMovement") &&
			!updateEvents.has("newPhase") &&
			!updateEvents.has("gameAttributes")
		) {
			return;
		}
		const userTid = g.get("userTid");
		const phase = g.get("phase");
		const { board, userOpenings, userPrestige } =
			await college.getRecruitingBoard();

		const recruits = board.map(({ p, interest }) => {
			const ratings = last(p.ratings);
			const recruit = (p as any).recruit as PlayerRecruit;
			return {
				pid: p.pid,
				name: `${p.firstName} ${p.lastName}`,
				pos: ratings.pos,
				hgt: p.hgt,
				stars: recruit.stars,
				rank: recruit.rank,
				posRank: recruit.posRank,
				state: recruit.state,
				ovr: player.fuzzRating(ratings.ovr, ratings.fuzz),
				pot: player.fuzzRating(ratings.pot, ratings.fuzz),
				skills: ratings.skills,
				interest: college.interestLabel(interest),
				userTarget: recruit.userTarget,
			};
		});

		// This year's signing class of the user's school (after signing day)
		const roster = await idb.cache.players.indexGetAll("playersByTid", userTid);
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

		const t = await idb.cache.teams.get(userTid);
		return {
			recruits,
			signed,
			userOpenings,
			userPrestige: Math.round(userPrestige),
			scholarships: COLLEGE_SCHOLARSHIPS,
			autoRecruit: g.get("collegeAutoRecruit"),
			signingDayPassed: phase >= PHASE.FREE_AGENCY || phase < 0,
			canEdit: phase <= PHASE.RESIGN_PLAYERS && phase >= 0,
			season: g.get("season"),
			region: t?.region ?? "",
		};
	},
});
