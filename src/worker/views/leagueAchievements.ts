import { defineView, keepType } from "../util/defineView.ts";
import { g } from "../util/index.ts";
import { getWrappedStatus, isBulkSimming } from "../util/wrappedData.ts";
import {
	getLeagueAchievements,
	getLeagueAchievementsLog,
	scheduleLeagueAchievementsCheck,
} from "../util/leagueAchievements.ts";
import {
	bestText,
	closestNext,
	DEF_BY_ID,
	DEFS,
	makeLookup,
	NEED_TEXT,
	nextTier,
	RARITIES,
	RECORDS_WARMUP_SEASONS,
	teamView,
	TOPICS,
	whoOf,
	type Rarity,
	type Who,
} from "../../common/leagueAchievements/index.ts";
import type { RouteParams } from "../../ui/router/types.ts";

const TABS = ["all", "closest", "franchise", "recent"] as const;
export type LeagueAchievementsTab = (typeof TABS)[number];

const processInputs = (params: RouteParams<"leagueAchievements">) => {
	const tab: LeagueAchievementsTab = TABS.includes(
		params.tab as LeagueAchievementsTab,
	)
		? (params.tab as LeagueAchievementsTab)
		: "all";
	return { tab, id: params.id };
};

export type LeagueAchievementItem = {
	id: string;
	topic: string;
	metric: string;
	rarity: Rarity;
	name: string;
	desc: string;
	state: "unlocked" | "locked" | "unavailable";
	// Times it happened (unlocked only)
	count: number;
	progress: number;
	// The data it needs, when the league doesn't have it
	need?: string;
	// Unavailable only until the league has more history
	warmup?: boolean;
	first?: Who;
	// The league's best so far, as text (locked only; missing means nothing qualifying recorded yet)
	best?: string;
	bestWho?: Who;
	// The next locked tier of the same metric (unlocked only)
	next?: {
		id: string;
		name: string;
		rarity: Rarity;
		progress: number;
		best?: string;
	};
};

const emptyByRarity = () =>
	Object.fromEntries(RARITIES.map((r) => [r, 0])) as Record<Rarity, number>;

export default defineView({
	id: "leagueAchievements",
	processInputs,
	keepPrevOutput: { loading: keepType<boolean>() },
	load: async ({ inputs, updateEvents, prevInputs, prevOutput }) => {
		if (__SPORT !== "basketball") {
			return {
				errorMessage: "League achievements are only available for basketball.",
			};
		}
		// While games are being simmed, leave the page as it is. It updates when the sim stops.
		if (
			prevInputs !== undefined &&
			!updateEvents.has("firstRun") &&
			prevOutput.loading !== true &&
			JSON.stringify(prevInputs) === JSON.stringify(inputs) &&
			isBulkSimming()
		) {
			return;
		}
		const st = getWrappedStatus(updateEvents.has("firstRun"));
		if (st.status === "loading") {
			return { loading: true as const, progress: st.progress };
		}
		if (st.status === "error") {
			return {
				errorMessage: `Could not read the league history: ${st.message}`,
			};
		}

		const { data, run } = await getLeagueAchievements();
		// Anything new is announced (and the first visit of an existing league remembers what is already unlocked)
		scheduleLeagueAchievementsCheck(0);
		const { results, summary } = run;
		const look = makeLookup(data);

		const items: LeagueAchievementItem[] = DEFS.map((d) => {
			const r = results.get(d.id)!;
			const item: LeagueAchievementItem = {
				id: d.id,
				topic: d.topic,
				metric: d.metric,
				rarity: d.rarity,
				name: d.name,
				desc: d.desc,
				state: r.state,
				count: r.state === "unlocked" ? (r.count ?? 1) : 0,
				progress: r.progress ?? 0,
			};
			if (r.state === "unavailable") {
				item.warmup = r.warmup;
				item.need = r.warmup
					? `${RECORDS_WARMUP_SEASONS} completed seasons of league history`
					: NEED_TEXT[d.need];
			} else if (r.state === "unlocked") {
				item.first = whoOf(look, d, r.first);
				const nx = nextTier(results, d);
				if (nx) {
					item.next = {
						id: nx.d.id,
						name: nx.d.name,
						rarity: nx.d.rarity,
						progress: nx.progress,
						best: bestText(nx.d, nx.best),
					};
				}
			} else {
				item.best = bestText(d, r.best);
				item.bestWho = whoOf(look, d, r.best);
			}
			return item;
		});

		const closest = closestNext(results, { n: 60 }).map((x) => x.d.id);

		// Every franchise with at least one season, current name, with its unlock counts
		const franchises = data.teams
			.filter((t) => t.seasons.some((s) => s.season >= run.own))
			.map((t) => {
				const view = teamView(results, data, t.tid);
				const byRarity = emptyByRarity();
				for (const r of RARITIES) {
					byRarity[r] = view.byRarity[r] ?? 0;
				}
				return {
					tid: t.tid,
					abbrev: t.abbrev,
					name: `${t.region} ${t.name}`,
					total: view.total,
					byRarity,
				};
			})
			.sort((a, b) => b.total - a.total || a.tid - b.tid);

		let franchise:
			| {
					tid: number;
					abbrev: string;
					name: string;
					items: { id: string; n: number; first?: Who }[];
			  }
			| undefined;
		if (inputs.tab === "franchise") {
			const userTid = g.get("userTid");
			const pick =
				franchises.find(
					(f) => f.abbrev === inputs.id || String(f.tid) === inputs.id,
				) ??
				franchises.find((f) => f.tid === userTid) ??
				franchises[0];
			if (pick) {
				const view = teamView(results, data, pick.tid);
				franchise = {
					tid: pick.tid,
					abbrev: pick.abbrev,
					name: pick.name,
					items: view.items.map((x) => ({
						id: x.d.id,
						n: x.n,
						first: whoOf(look, x.d, x.first),
					})),
				};
			}
		}

		const log = await getLeagueAchievementsLog();
		const recent = log
			.slice()
			.reverse()
			.filter((e) => DEF_BY_ID.has(e.id))
			.slice(0, 150)
			.map((e) => ({
				id: e.id,
				season: e.season,
				phase: e.phase,
				who: e.who,
				quiet: e.quiet ?? false,
			}));

		const byRarity = Object.fromEntries(
			RARITIES.map((r) => [r, summary.byRarity[r]!]),
		) as Record<
			Rarity,
			{ total: number; unlocked: number; unavailable: number }
		>;

		return {
			loading: false as const,
			tab: inputs.tab,
			id: inputs.id,
			own: run.own,
			season: g.get("season"),
			userTid: g.get("userTid"),
			summary: {
				total: summary.total,
				unlocked: summary.unlocked,
				unavailable: summary.unavailable,
				possible: summary.possible,
				byRarity,
			},
			topics: TOPICS,
			items,
			closest,
			franchises,
			franchise,
			recent,
		};
	},
});
