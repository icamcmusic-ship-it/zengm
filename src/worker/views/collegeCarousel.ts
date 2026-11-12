// College mode: the coaching carousel (head coach moves between schools, the user's job offers) and conference realignment of a season
// (docs/college-mode.md)
import { PHASE } from "../../common/constants.ts";
import { g } from "../util/index.ts";
import { idb } from "../db/index.ts";
import { defineView } from "../util/defineView.ts";
import type { RouteParams } from "../../ui/router/types.ts";
import * as college from "../core/college/index.ts";
import { getTeamPrestige } from "../core/college/players.ts";
import { getCollegeTeamNames } from "./collegePolls.ts";
import {
	canRespondToOffers,
	coachStock,
} from "../core/staff/collegeCarousel.ts";
import { getExpectedWinps } from "../core/college/expectations.ts";
import {
	coachReputation,
	hotSeatLabel,
	hotSeatNow,
	reputationLabel,
} from "../core/staff/systems.ts";
import { staffEnabled } from "../core/staff/index.ts";

export type CarouselRow = {
	cid: number;
	name: string;
	type: "hired" | "fired" | "left" | "retired";
	tid: number;
	// For a hire: the school he left for it this offseason
	fromTid?: number;
	// How he left it: hired away ("left") or fired there earlier in the offseason
	fromType?: "left" | "fired";
	phase: number;
};

export default defineView({
	id: "collegeCarousel",
	processInputs: (params: RouteParams<"collegeCarousel">) => {
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
			!updateEvents.has("newPhase") &&
			!updateEvents.has("staff") &&
			!updateEvents.has("playerMovement") &&
			!updateEvents.has("gameAttributes") &&
			inputs.season === prevInputs?.season
		) {
			return;
		}
		const season = inputs.season;
		const currentSeason = g.get("season");
		const userTid = g.get("userTid");
		const seasons = [];
		for (let s = g.get("startingSeason"); s <= currentSeason; s++) {
			seasons.push(s);
		}
		const staffOn = staffEnabled();
		const coaches = staffOn ? await idb.cache.coaches.getAll() : [];

		// Head coach moves of the season (the offseason after it: the carousel runs when the season is over)
		const rows: CarouselRow[] = [];
		for (const c of coaches) {
			const txs = c.transactions.filter(
				(tx) => tx.season === season && tx.role === "head",
			);
			for (const [i, tx] of txs.entries()) {
				if (tx.type === "reSigned") {
					continue;
				}
				// A coach who left one school and was hired by another in the same offseason is one move
				if (tx.type === "left" && txs[i + 1]?.type === "hired") {
					continue;
				}
				const prev = txs[i - 1];
				rows.push({
					cid: c.cid,
					name: `${c.firstName} ${c.lastName}`,
					type: tx.type,
					tid: tx.tid,
					fromTid:
						tx.type === "hired" &&
						prev &&
						(prev.type === "left" || prev.type === "fired") &&
						prev.tid !== tx.tid
							? prev.tid
							: undefined,
					fromType:
						tx.type === "hired" &&
						prev &&
						(prev.type === "left" || prev.type === "fired") &&
						prev.tid !== tx.tid
							? prev.type
							: undefined,
					phase: tx.phase,
				});
			}
		}
		const order = { hired: 0, fired: 1, left: 2, retired: 3 };
		rows.sort(
			(a, b) =>
				order[a.type] - order[b.type] ||
				Number(b.fromTid !== undefined) - Number(a.fromTid !== undefined) ||
				a.phase - b.phase,
		);

		// The user's coach and his job offers (current season)
		let you;
		let offers: {
			tid: number;
			prestige: number;
			years: number;
			won: number;
			lost: number;
		}[] = [];
		if (season === currentSeason && staffOn) {
			const c = coaches.find((c2) => c2.tid === userTid && c2.role === "head");
			if (c) {
				const rep = coachReputation(c);
				const expected = await getExpectedWinps();
				const heat = await hotSeatNow(c);
				const userTeam = await idb.cache.teams.get(userTid);
				you = {
					cid: c.cid,
					name: `${c.firstName} ${c.lastName}`,
					age: currentSeason - c.born.year,
					reputation: rep,
					reputationLabel: reputationLabel(rep),
					stock: Math.round(coachStock(c, expected)),
					hotSeat: hotSeatLabel(heat),
					prestige: userTeam
						? Math.round(getTeamPrestige(userTeam) * 10) / 10
						: undefined,
					seasons: c.stats.filter((r) => r.role === "head").length,
					schools: new Set(
						c.stats.filter((r) => r.role === "head").map((r) => r.tid),
					).size,
				};
			}
			offers = college.getCollegeState()?.coachOffers ?? [];
		}

		const teams = await getCollegeTeamNames(season);
		const realignment =
			(await college.getCollegeArchive(season))?.realignment ?? [];
		const confs = g.get("confs", "current");
		const confNames = Object.fromEntries(confs.map((c) => [c.cid, c.name]));
		const prestige: Record<number, number> = {};
		for (const t of await idb.cache.teams.getAll()) {
			prestige[t.tid] = Math.round(getTeamPrestige(t) * 10) / 10;
		}

		return {
			season,
			seasons,
			rows,
			you,
			offers,
			canRespond: canRespondToOffers() && season === currentSeason,
			offersOpen:
				season === currentSeason &&
				g.get("phase") >= PHASE.DRAFT_LOTTERY &&
				g.get("phase") < PHASE.DRAFT,
			teams,
			userTid,
			realignment,
			confNames,
			prestige,
			staffOn,
		};
	},
});
