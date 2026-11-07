import { idb } from "../db/index.ts";
import { g } from "../util/index.ts";
import { defineView } from "../util/defineView.ts";
import type { RouteParams } from "../../ui/router/types.ts";
import { validateTeam } from "../util/processInputs.ts";
import { getWrappedIndex } from "../util/wrappedData.ts";
import { candidates } from "../../common/wrapped/build.ts";
import { polish } from "../../common/wrapped/util.ts";
import type { WrappedMode } from "../../common/wrapped/types.ts";

const MODES: WrappedMode[] = ["season", "team", "player", "all"];

const processInputs = (params: RouteParams<"wrapped">) => {
	const mode: WrappedMode = MODES.includes(params.type as WrappedMode)
		? (params.type as WrappedMode)
		: "season";
	const season =
		params.season !== undefined && /^\d+$/.test(params.season)
			? Number.parseInt(params.season)
			: undefined;
	let tid: number | undefined;
	let pid: number | undefined;
	if (mode === "team") {
		const t = validateTeam(params.id);
		tid = typeof t === "number" ? t : undefined;
	} else if (mode === "player" && params.id !== undefined) {
		const int = Number.parseInt(params.id);
		if (!Number.isNaN(int)) {
			pid = int;
		}
	}
	// /wrapped/choose is the page for picking a season, team, player or the all-time Wrapped
	return { mode, season, tid, pid, choose: params.type === "choose" };
};

export default defineView({
	id: "wrapped",
	processInputs,
	load: async ({ inputs, updateEvents }) => {
		if (__SPORT !== "basketball") {
			return { errorMessage: "Wrapped is only available for basketball." };
		}
		const X = await getWrappedIndex(updateEvents);
		const { mode } = inputs;

		// Default season: the latest finished one, or the current one if none has finished yet
		const decided = X.decidedSeasons();
		let season = inputs.season ?? decided.at(-1) ?? X.L.season;
		if (!X.seasons.includes(season) || X.lines(season).length === 0) {
			season = X.seasons.findLast((s) => X.lines(s).length > 0) ?? X.L.season;
		}

		let tid = inputs.tid;
		let pid = inputs.pid;
		if (mode === "team" && (tid === undefined || !X.team(tid, season))) {
			tid = X.team(X.L.userTid, season)
				? X.L.userTid
				: X.teamsIn(season)[0]?.tid;
		}
		if (mode === "player" && (pid === undefined || !X.line(pid, season))) {
			// The best player on the user's team that season
			const rows = X.lines(season).filter((l) => l.tid === X.L.userTid);
			pid = [...(rows.length > 0 ? rows : X.lines(season))].sort(
				(a, b) => b.ws - a.ws,
			)[0]?.pid;
		}
		if (
			(mode === "team" && tid === undefined) ||
			(mode === "player" && pid === undefined)
		) {
			return {
				errorMessage: "No data for that season yet. Play some games first!",
			};
		}

		const soFar = mode !== "all" && !X.decided(season);
		const cands = candidates({ X, mode, season, tid, pid, soFar });

		// Pictures for every player and team the slides mention
		const pids = [
			...new Set(cands.map((s) => s.pid).filter((x) => x !== undefined)),
		];
		const playersRaw = await idb.merged.players.getAll({ pids });
		const faces: Record<
			number,
			{ face: any; imgURL: string; tid: number; season: number }
		> = {};
		for (const p of playersRaw) {
			const slide = cands.find((s) => s.pid === p.pid);
			faces[p.pid] = {
				face: p.face,
				imgURL: p.imgURL,
				tid: slide?.tid ?? p.tid,
				season: slide?.season ?? season,
			};
		}
		const teams: Record<
			string,
			{
				abbrev: string;
				region: string;
				name: string;
				colors: [string, string, string];
				imgURL?: string;
			}
		> = {};
		for (const s of cands) {
			const t =
				s.tid !== undefined ? X.teamAny(s.tid, s.season ?? season) : undefined;
			if (t) {
				teams[`${t.tid}`] = {
					abbrev: t.abbrev,
					region: t.region,
					name: t.name,
					colors: t.colors,
					imgURL: t.imgURL,
				};
			}
		}

		// Choices for the pickers
		const teamOptions = X.teamsIn(season)
			.map((t) => ({
				tid: t.tid,
				label: `${t.region} ${t.name}`,
				abbrev: t.abbrev,
			}))
			.sort((a, b) => a.label.localeCompare(b.label));
		const playerOptions = [...X.lines(season)]
			.filter((l) => l.gp > 0)
			.sort((a, b) => b.ws - a.ws)
			.slice(0, 150)
			.map((l) => ({
				pid: l.pid,
				label: l.name,
				abbrev: X.teamAny(l.tid, season)?.abbrev ?? "",
			}));

		let title = `${season} Wrapped`;
		if (mode === "team") {
			title = `${X.teamName(tid!, season)} ${season} Wrapped`;
		} else if (mode === "player") {
			title = `${X.players.get(pid!)?.name ?? "Player"} ${season} Wrapped`;
		} else if (mode === "all") {
			title = "All-Time Wrapped";
		}

		return {
			mode,
			season,
			tid,
			pid,
			soFar,
			title: polish(title),
			seed: `${mode}|${season}|${tid ?? ""}|${pid ?? ""}`,
			cands,
			faces,
			teams,
			seasons: X.seasons.filter((s) => X.lines(s).length > 0).reverse(),
			teamOptions,
			playerOptions,
			userTid: g.get("userTid"),
			choose: inputs.choose,
		};
	},
});
