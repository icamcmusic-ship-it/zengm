// College mode: AP Top 25 (weekly), NET ranking and Selection (docs/college-mode.md)
import { idb } from "../db/index.ts";
import { g } from "../util/index.ts";
import { defineView } from "../util/defineView.ts";
import type { RouteParams } from "../../ui/router/types.ts";
import type {
	CollegeNetRow,
	CollegeSelection,
} from "../../common/college/types.ts";
import type { NcaaPoll } from "../../common/collegeStats/ncaaPolls.ts";
import * as college from "../core/college/index.ts";
import { team } from "../core/index.ts";

const notCollege = {
	errorMessage: "This page is only available in college leagues.",
};

export const getCollegeTeamNames = async (season: number) => {
	const teamSeasons = await team.getFormattedAll({
		attrs: ["tid"],
		seasonAttrs: ["won", "lost", "cid", "abbrev", "region"],
		season,
		addDummySeason: true,
	});
	const confs = g.get("confs", season);
	return Object.fromEntries(
		(teamSeasons as any[]).map((t) => [
			t.tid,
			{
				tid: t.tid as number,
				abbrev: t.seasonAttrs.abbrev as string,
				region: t.seasonAttrs.region as string,
				won: t.seasonAttrs.won as number,
				lost: t.seasonAttrs.lost as number,
				conf:
					confs.find((c) => c.cid === t.seasonAttrs.cid)?.name ?? "",
			},
		]),
	) as Record<
		number,
		{
			tid: number;
			abbrev: string;
			region: string;
			won: number;
			lost: number;
			conf: string;
		}
	>;
};

export default defineView({
	id: "collegePolls",
	processInputs: (params: RouteParams<"collegePolls">) => {
		const season =
			params.season !== undefined ? Number.parseInt(params.season) : undefined;
		return {
			season:
				season === undefined || Number.isNaN(season) ? g.get("season") : season,
		};
	},
	load: async ({ inputs, updateEvents, prevInputs }) => {
		if (!college.isCollege()) {
			return notCollege;
		}
		if (
			!updateEvents.has("firstRun") &&
			!updateEvents.has("gameSim") &&
			!updateEvents.has("newPhase") &&
			inputs.season === prevInputs?.season
		) {
			return;
		}
		const season = inputs.season;
		let polls: NcaaPoll[] = [];
		let selection: CollegeSelection | undefined;
		let net: CollegeNetRow[] = [];
		const state = college.getCollegeState();
		if (state && state.season === season) {
			polls = state.polls;
			selection = state.selection;
			const teams = (await idb.cache.teams.getAll()).filter((t) => !t.disabled);
			net =
				selection?.net ??
				(state.results.length > 0
					? college.getNetRows(
							state,
							teams.map((t) => t.tid),
						)
					: []);
		} else {
			const archive = await college.getCollegeArchive(season);
			polls = archive?.polls ?? [];
			selection = archive?.selection;
			net = selection?.net ?? [];
		}

		const seasons = [];
		for (let s = g.get("startingSeason"); s <= g.get("season"); s++) {
			seasons.push(s);
		}

		return {
			season,
			seasons,
			polls,
			selection,
			net: net.slice(0, 100),
			teams: await getCollegeTeamNames(season),
			userTid: g.get("userTid"),
		};
	},
});
