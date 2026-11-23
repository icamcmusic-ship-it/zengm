// Hall of Fame > Ballot: a season's vote (League Extras "Hall of Fame Ballot"), the veterans committee and wing classes, the
// induction ceremony (the inductees' stored speeches) and the snubs (the best players who fell off the ballot)
import type { RouteParams } from "../../ui/router/types.ts";
import { HOF_DROP_PCT, HOF_INDUCT_PCT } from "../../common/hofBallot.ts";
import type { Awards, Player } from "../../common/types.ts";
import { idb } from "../db/index.ts";
import { defineView } from "../util/defineView.ts";
import { g } from "../util/index.ts";
import { featureOffError } from "../util/nativeFeatures.ts";
import { getHofStories, hofWordsOn } from "../util/hofStory.ts";
import { hofBallotWait } from "../core/hallOfFame/index.ts";

const SNUBS = 25;

const processInputs = (params: RouteParams<"hallOfFameBallot">) => {
	const season =
		params.season !== undefined ? Number.parseInt(params.season) : undefined;
	return {
		season: season !== undefined && !Number.isNaN(season) ? season : undefined,
	};
};

export default defineView({
	id: "hallOfFameBallot",
	processInputs,
	load: async ({ inputs, updateEvents, prevInputs }) => {
		const off = featureOffError("hofBallot");
		if (off) {
			return off;
		}
		if (
			!(
				updateEvents.has("firstRun") ||
				updateEvents.has("newPhase") ||
				updateEvents.has("playerMovement") ||
				inputs.season !== prevInputs?.season
			)
		) {
			return;
		}

		const all = (await idb.merged.awards.getAll()).filter(
			(a) => a.hof?.ballot || a.hof?.veterans || a.hof?.wing,
		);
		all.sort((a, b) => a.season - b.season);
		const seasons = all.map((a) => a.season);
		const season = inputs.season ?? seasons.at(-1);
		const record: Awards["hof"] = all.find((a) => a.season === season)?.hof;
		const teamInfoCache = g.get("teamInfoCache");
		const abbrev = (tid: number) =>
			tid >= 0 ? (teamInfoCache[tid]?.abbrev ?? "") : "";

		const ballot = (record?.ballot ?? []).map((row) => ({
			...row,
			abbrev: abbrev(row.tid),
		}));
		const veterans = (record?.veterans ?? []).map((row) => ({
			...row,
			abbrev: abbrev(row.tid),
		}));
		const wing = (record?.wing ?? []).map((row) => ({
			...row,
			abbrev: abbrev(row.tid),
		}));

		// Induction ceremony: the class's speeches, stored on them at induction
		const classPids = [
			...ballot
				.filter((row) => row.result === "inducted")
				.map((row) => row.pid),
			...veterans.map((row) => row.pid),
		];
		const ceremony: {
			pid: number;
			name: string;
			line: string;
			speech: string[];
		}[] = [];
		if (hofWordsOn() && classPids.length > 0) {
			const players = (
				await idb.merged.players.getAll({ pids: classPids })
			).filter((p) => p.hof);
			const stories = await getHofStories(players, () =>
				idb.merged.players.getAll({ hof: true }),
			);
			for (const pid of classPids) {
				const p = players.find((p2) => p2.pid === pid);
				const story = stories.get(pid);
				if (!p || !story) {
					continue;
				}
				const row = ballot.find((r) => r.pid === pid);
				ceremony.push({
					pid,
					name: `${p.firstName} ${p.lastName}`,
					line: row
						? `${row.year === 1 ? "First ballot" : `Year ${row.year} on the ballot`}, ${row.pct.toFixed(1)}%`
						: "Veterans committee",
					speech: story.speech,
				});
			}
		}

		// Snubs: the best players who fell off the ballot (or ran out of years) and are still not in
		const veteransPids = new Set<number>();
		const latest = new Map<
			number,
			NonNullable<NonNullable<Awards["hof"]>["ballot"]>[number] & {
				season: number;
				maxPct: number;
			}
		>();
		for (const a of all) {
			for (const row of a.hof?.veterans ?? []) {
				veteransPids.add(row.pid);
			}
			for (const row of a.hof?.ballot ?? []) {
				const prev = latest.get(row.pid);
				latest.set(row.pid, {
					...row,
					season: a.season,
					maxPct: Math.max(prev?.maxPct ?? 0, row.pct),
				});
			}
		}
		const snubCandidates = [...latest.values()]
			.filter(
				(row) =>
					(row.result === "dropped" || row.result === "expired") &&
					!veteransPids.has(row.pid),
			)
			.sort(
				(a, b) =>
					b.score / b.threshold - a.score / a.threshold || a.pid - b.pid,
			)
			.slice(0, SNUBS * 2);
		const snubPlayers = new Map<number, Player>();
		for (const p of await idb.merged.players.getAll({
			pids: snubCandidates.map((row) => row.pid),
		})) {
			snubPlayers.set(p.pid, p);
		}
		const snubs = snubCandidates
			.filter((row) => !snubPlayers.get(row.pid)?.hof)
			.slice(0, SNUBS)
			.map((row) => ({
				pid: row.pid,
				name: row.name,
				tid: row.tid,
				abbrev: abbrev(row.tid),
				retiredYear: row.retiredYear,
				years: row.year,
				lastSeason: row.season,
				maxPct: row.maxPct,
				lastPct: row.pct,
				result: row.result,
				score: row.score,
				threshold: row.threshold,
			}));

		return {
			ballot,
			ceremony,
			dropPct: HOF_DROP_PCT,
			inductPct: HOF_INDUCT_PCT,
			season,
			seasons,
			snubs,
			veterans,
			voters: record?.voters,
			wait: hofBallotWait(),
			wing,
		};
	},
});
