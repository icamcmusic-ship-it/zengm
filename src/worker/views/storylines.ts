import { defineView } from "../util/defineView.ts";
import { getStoryState } from "../util/storylinesData.ts";
import { validateTeam } from "../util/processInputs.ts";
import { kindSlug, KIND_NAMES } from "../../common/storylines/index.ts";
import type { RouteParams } from "../../ui/router/types.ts";
import { overlapsSeason, type Story } from "../../common/storylines/index.ts";

// Without a filter only the biggest stories are sent, so a long league does not move megabytes to the page
const CAP = 1200;

const TYPES = ["all", "team", "player", "kind", "thread"] as const;
type Type = (typeof TYPES)[number];

const processInputs = (params: RouteParams<"storylines">) => {
	const type: Type = TYPES.includes(params.type as Type)
		? (params.type as Type)
		: "all";
	let tid: number | undefined;
	let pid: number | undefined;
	if (type === "team") {
		const t = validateTeam(params.id);
		tid = typeof t === "number" ? t : undefined;
	} else if (type === "player" && params.id !== undefined) {
		const int = Number.parseInt(params.id);
		pid = Number.isNaN(int) ? undefined : int;
	}
	const season =
		params.season !== undefined && /^\d+$/.test(params.season)
			? Number.parseInt(params.season)
			: undefined;
	return { type, tid, pid, id: params.id, season };
};

export default defineView({
	id: "storylines",
	processInputs,
	load: async ({ inputs, updateEvents }) => {
		if (__SPORT !== "basketball") {
			return { errorMessage: "Storylines are only available for basketball." };
		}
		const { X, stories, threads } = await getStoryState(updateEvents);

		const threadOf = new Map<string, { key: string; n: number }>();
		for (const t of threads) {
			for (const c of t.chapters) {
				threadOf.set(c.id, { key: t.key, n: t.chapters.length });
			}
		}

		const latest = X.seasons.at(-1) ?? X.L.season;
		const teams: Record<
			number,
			{
				abbrev: string;
				name: string;
				colors: [string, string, string];
				imgURL?: string;
			}
		> = {};
		for (const ts of X.L.teamSeasons) {
			const cur = teams[ts.tid];
			if (!cur || ts.season >= (X.teamAny(ts.tid, latest)?.season ?? 0)) {
				teams[ts.tid] = {
					abbrev: ts.abbrev,
					name: `${ts.region} ${ts.name}`,
					colors: ts.colors,
					imgURL: ts.imgURL,
				};
			}
		}

		let list: Story[] = stories;
		let filter: { type: Type; id: string; label: string } | undefined;
		let thread: (typeof threads)[number] | undefined;
		if (inputs.type === "team" && inputs.tid !== undefined) {
			const tid = inputs.tid;
			list = stories.filter((s) => s.tids.includes(tid));
			filter = {
				type: "team",
				id: `${tid}`,
				label: teams[tid]?.name ?? "this team",
			};
		} else if (inputs.type === "player" && inputs.pid !== undefined) {
			const pid = inputs.pid;
			list = stories.filter((s) => s.pids.includes(pid));
			filter = {
				type: "player",
				id: `${pid}`,
				label: X.players.get(pid)?.name ?? "this player",
			};
		} else if (inputs.type === "kind") {
			const kind = KIND_NAMES.find((k) => kindSlug(k) === inputs.id);
			if (kind) {
				list = stories.filter((s) => s.kind === kind);
				filter = { type: "kind", id: inputs.id!, label: kind };
			}
		} else if (inputs.type === "thread") {
			thread = threads.find((t) => t.key === inputs.id);
			if (thread) {
				const ids = new Set(thread.chapters.map((c) => c.id));
				list = stories.filter((s) => ids.has(s.id));
				filter = { type: "thread", id: thread.key, label: thread.title };
			}
		}
		// The season filter runs on the finished stories, so detection and its caching are untouched. A story matches if the season falls inside the seasons it covers.
		const season =
			filter?.type === "thread" ? undefined : (inputs.season ?? undefined);
		if (season !== undefined) {
			list = list.filter((s) => overlapsSeason(s, season));
		}
		const matching = list.length;
		list = list.slice(0, CAP);

		return {
			stories: list.map((s) => ({
				...s,
				thread: threadOf.get(s.id),
			})),
			totalStories: matching,
			season,
			kinds: KIND_NAMES,
			kindSlugs: Object.fromEntries(KIND_NAMES.map((k) => [k, kindSlug(k)])),
			teams,
			filter,
			thread,
			// Light thread list for the Threads tab
			threads: threads.slice(0, 3000).map((t) => ({
				key: t.key,
				kind: t.kind,
				title: t.title,
				chapters: t.chapters.length,
				seasons: t.seasons.length,
				from: t.from,
				to: t.to,
				tids: t.tids,
			})),
			seasons: X.seasons,
		};
	},
});
