import { featureOffError } from "../util/nativeFeatures.ts";
import { idb } from "../db/index.ts";
import { changeLog } from "../db/changeLog.ts";
import { g } from "../util/index.ts";
import { defineView } from "../util/defineView.ts";
import { validateTeam } from "../util/processInputs.ts";
import { bySport } from "../../common/sportFunctions.ts";
import { getValueStatsRow } from "../core/player/checkJerseyNumberRetirement.ts";
import { getProAwards, getProStats } from "../../common/preDraft.ts";
import {
	buildJerseyNumbers,
	type JNPlayer,
	type JerseyNumbersByTeam,
} from "../../common/leagueHistory/jerseyNumbers.ts";
import type { RouteParams } from "../../ui/router/types.ts";

const processInputs = (params: RouteParams<"jerseyNumbersTeams">) => {
	return { tid: validateTeam(params.team) };
};

// Reading every player is slow in a long league, so the result is kept until a player or team is written to
let cache:
	| {
			key: string;
			result: JerseyNumbersByTeam;
			names: Map<number, string>;
	  }
	| undefined;

const cacheKey = () =>
	[
		g.get("lid"),
		changeLog.epoch,
		changeLog.store("players"),
		changeLog.store("teams"),
	].join("|");

const bars = bySport({
	baseball: { defaultBar: 30, minBar: 15, maxBar: 80 },
	basketball: { defaultBar: 40, minBar: 20, maxBar: 100 },
	football: { defaultBar: 50, minBar: 25, maxBar: 120 },
	hockey: { defaultBar: 40, minBar: 20, maxBar: 100 },
});

const compute = async () => {
	const key = cacheKey();
	if (cache?.key === key) {
		return cache;
	}
	const players: JNPlayer[] = [];
	const names = new Map<number, string>();
	await idb.merged.players.forEach(undefined, (p) => {
		const rows = getProStats(p).filter((r) => !r.playoffs);
		const name = `${p.firstName} ${p.lastName}`.trim();
		names.set(p.pid, name);
		if (rows.length === 0) {
			return;
		}
		players.push({
			pid: p.pid,
			name,
			hof: !!p.hof,
			tid: p.tid,
			allStarSeasons: getProAwards(p)
				.filter((a) => a.type === "All-Star")
				.map((a) => a.season),
			rows: rows.map((r) => ({
				season: r.season,
				tid: r.tid,
				number: r.jerseyNumber,
				gp: r.gp ?? 0,
				value: getValueStatsRow(r),
			})),
		});
	});
	const teams = await idb.cache.teams.getAll();
	const result = buildJerseyNumbers(
		players,
		teams.map((t) => ({ tid: t.tid, retired: t.retiredJerseyNumbers ?? [] })),
		bars,
	);
	cache = { key, result, names };
	return cache;
};

export default defineView({
	id: "jerseyNumbersTeams",
	processInputs,
	load: async ({ inputs, updateEvents, prevInputs }) => {
		const featureOff = featureOffError("frivolities");
		if (featureOff) {
			return featureOff;
		}
		if (
			prevInputs !== undefined &&
			JSON.stringify(prevInputs) === JSON.stringify(inputs) &&
			!updateEvents.has("firstRun") &&
			!updateEvents.has("retiredJerseys") &&
			!updateEvents.has("newPhase")
		) {
			return;
		}
		const { result, names } = await compute();
		const teams = (await idb.cache.teams.getAll()).map((t) => ({
			tid: t.tid,
			abbrev: t.abbrev,
			region: t.region,
			name: t.name,
			disabled: !!t.disabled,
		}));
		const tid = inputs.tid;
		const name = (pid: number | null) =>
			pid === null ? "" : (names.get(pid) ?? "");

		return {
			tid,
			teams,
			valueStat: bySport({
				baseball: "WAR",
				basketball: "WS",
				football: "AV",
				hockey: "PS",
			}),
			numbers: (result.byTeam.get(tid) ?? []).map((x) => ({
				...x,
				top: x.top.map((s) => ({ ...s, name: name(s.pid) })),
			})),
			retired: result.retired.map((r) => ({
				...r,
				name: r.pid !== null ? name(r.pid) || r.name : r.name,
			})),
			candidates: result.candidates
				.slice(0, 100)
				.map((c) => ({ ...c, name: name(c.pid) })),
			numCandidates: result.candidates.length,
			bar: result.bar,
			knownRows: result.knownRows,
			unknownRows: result.unknownRows,
			season: g.get("season"),
		};
	},
});
