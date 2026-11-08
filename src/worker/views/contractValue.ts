import { defineView } from "../util/defineView.ts";
import type { RouteParams } from "../../ui/router/types.ts";
import { g } from "../util/index.ts";
import { validateTeam } from "../util/processInputs.ts";
import { getContractValue } from "../util/valueData.ts";
import {
	albatross,
	bargains,
	contractYear,
	deadByTeam,
	teamEfficiency,
	valueDeals,
	valueSeasons,
	type Metric,
} from "../../common/valueGrades/contractValue.ts";

export const CONTRACT_VALUE_TABS = [
	"seasons",
	"deals",
	"dead",
	"teams",
	"bargains",
	"albatross",
	"cyear",
] as const;
export type ContractValueTab = (typeof CONTRACT_VALUE_TABS)[number];

const METRICS: Metric[] = ["surplus", "perM", "index"];

const processInputs = (params: RouteParams<"contractValue">) => {
	const tab: ContractValueTab = CONTRACT_VALUE_TABS.includes(
		params.tab as ContractValueTab,
	)
		? (params.tab as ContractValueTab)
		: "seasons";
	const team = validateTeam(params.team, ["all"]);
	let season: number | "all" = "all";
	if (params.season !== undefined && params.season !== "all") {
		const s = Number.parseInt(params.season);
		if (!Number.isNaN(s)) {
			season = s;
		}
	}
	return { tab, team, season };
};

const N = 50;

export default defineView({
	id: "contractValue",
	processInputs,
	load: async ({ inputs, updateEvents, prevInputs }) => {
		if (__SPORT !== "basketball") {
			return {
				errorMessage: "Contract value is only available for basketball.",
			};
		}
		if (
			!(
				updateEvents.has("firstRun") ||
				updateEvents.has("newPhase") ||
				updateEvents.has("playerMovement") ||
				inputs.tab !== prevInputs?.tab ||
				inputs.team !== prevInputs?.team ||
				inputs.season !== prevInputs?.season
			)
		) {
			return;
		}

		const cv = await getContractValue();
		const { tab, team, season } = inputs;
		const f = {
			season: season === "all" ? undefined : season,
			tid: team === "all" ? undefined : team,
		};

		const out = {
			tab,
			team,
			season,
			seasons: cv.seasons,
			lastDone: cv.lastDone,
			currentSeason: g.get("season"),
			unknownCount: cv.unknownCount,
			rate: season === "all" ? null : (cv.rate.get(season) ?? null),
			hasData: cv.rows.length > 0,
			bySeasonRows: undefined as
				| Record<Metric, ReturnType<typeof valueSeasons>>
				| undefined,
			byDeals: undefined as
				| Record<Metric, ReturnType<typeof valueDeals>>
				| undefined,
			deadTeams: undefined as ReturnType<typeof deadByTeam> | undefined,
			deadGroups: undefined as
				| {
						tid: number;
						season: number;
						total: number;
						owed: boolean;
						share: number | null;
						players: { pid: number; name: string; amount: number }[];
				  }[]
				| undefined,
			deadTotals: undefined as
				| { releases: number; paid: number; owed: number }
				| undefined,
			teams: undefined as ReturnType<typeof teamEfficiency> | undefined,
			teamYears: undefined as typeof cv.teamSeasons | undefined,
			bargains: undefined as ReturnType<typeof bargains> | undefined,
			albatross: undefined as ReturnType<typeof albatross> | undefined,
			albatrossTotal: 0,
			cyear: undefined as
				| (Omit<ReturnType<typeof contractYear>, "rows"> & {
						jumps: ReturnType<typeof contractYear>["rows"];
						slumps: ReturnType<typeof contractYear>["rows"];
				  })
				| undefined,
		};

		if (tab === "seasons") {
			out.bySeasonRows = Object.fromEntries(
				METRICS.map((m) => [m, valueSeasons(cv, m, f, N)]),
			) as Record<Metric, ReturnType<typeof valueSeasons>>;
		} else if (tab === "deals") {
			out.byDeals = Object.fromEntries(
				METRICS.map((m) => [m, valueDeals(cv, m, f, N)]),
			) as Record<Metric, ReturnType<typeof valueDeals>>;
		} else if (tab === "dead") {
			out.deadTeams = deadByTeam(cv).filter(
				(r) => f.tid === undefined || r.tid === f.tid,
			);
			const payroll = new Map(
				cv.teamSeasons.map((t) => [`${t.tid}|${t.season}`, t.payroll]),
			);
			const groups = new Map<
				string,
				NonNullable<typeof out.deadGroups>[number]
			>();
			let paid = 0;
			let owed = 0;
			const releases = new Set<string>();
			for (const d of cv.dead) {
				if (d.owed) {
					owed += d.amount;
				} else {
					paid += d.amount;
				}
				releases.add(`${d.pid}|${d.releasedIn}`);
				if (
					(f.tid !== undefined && d.tid !== f.tid) ||
					(f.season !== undefined && d.season !== f.season)
				) {
					continue;
				}
				const k = `${d.tid}|${d.season}`;
				let grp = groups.get(k);
				if (!grp) {
					grp = {
						tid: d.tid,
						season: d.season,
						total: 0,
						owed: d.owed,
						share: null,
						players: [],
					};
					groups.set(k, grp);
				}
				grp.total += d.amount;
				grp.players.push({ pid: d.pid, name: d.name, amount: d.amount });
			}
			for (const [k, grp] of groups) {
				const pay = payroll.get(k);
				grp.share =
					pay !== undefined && !grp.owed ? grp.total / (pay + grp.total) : null;
				grp.players.sort((a, b) => b.amount - a.amount);
			}
			out.deadGroups = [...groups.values()].sort(
				(a, b) => b.total - a.total || a.season - b.season,
			);
			out.deadTotals = { releases: releases.size, paid, owed };
		} else if (tab === "teams") {
			out.teams = teamEfficiency(cv, { season: f.season });
			if (f.tid !== undefined && f.season === undefined) {
				out.teamYears = cv.teamSeasons
					.filter((t) => t.tid === f.tid)
					.sort((a, b) => b.season - a.season);
			}
		} else if (tab === "bargains") {
			out.bargains = bargains(cv, f);
		} else if (tab === "albatross") {
			const all = albatross(cv, f);
			out.albatrossTotal = all.reduce((t, c) => t + c.cost, 0);
			out.albatross = all.slice(0, 200);
		} else if (tab === "cyear") {
			const { rows, ...rest } = contractYear(cv, f);
			out.cyear = {
				...rest,
				jumps: rows.slice(0, N),
				slumps: rows.toReversed().slice(0, N),
			};
		}

		return out;
	},
});
