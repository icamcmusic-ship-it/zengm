// League timeline (League extras): champions, MVPs, newspaper front pages, top storylines, achievements, records, big
// trades and comebacks, season by season. Reads the other features' outputs through their worker functions and leaves
// out the ones that are turned off.
import { PHASE } from "../../common/constants.ts";
import { buildPaper } from "../../common/newspaper/index.ts";
import { plainText } from "../../common/storylines/kit.ts";
import {
	findScoringRecords,
	findTeamRecords,
	groupTimeline,
	pickMajorTrades,
	type TimelineItem,
} from "../../common/timeline.ts";
import { DEF_BY_ID } from "../../common/leagueAchievements/index.ts";
import type { RouteParams } from "../../ui/router/types.ts";
import { idb } from "../db/index.ts";
import { defineView, keepType } from "../util/defineView.ts";
import { g } from "../util/index.ts";
import { getLeagueAchievementsLog } from "../util/leagueAchievements.ts";
import { featureOffError, featureOn } from "../util/nativeFeatures.ts";
import { getStoryState } from "../util/storylinesData.ts";
import { getWrappedStatus } from "../util/wrappedData.ts";
import { getNewsFacts } from "./newspaper.ts";

// Seasons shown by default, and the most that get newspaper headlines (each one reads a season's results)
const DEFAULT_SEASONS = 10;
const MAX_HEADLINE_SEASONS = 25;

const parseSeason = (x: string | undefined) =>
	x !== undefined && /^\d+$/.test(x) ? Number.parseInt(x) : undefined;

const processInputs = (params: RouteParams<"timeline">) => {
	return {
		from: parseSeason(params.from),
		to: parseSeason(params.to),
	};
};

// Front page leads of finished seasons don't change, so they are kept per league
const headlineCache = new Map<string, { head: string } | null>();

const getHeadline = async (season: number, finished: boolean) => {
	const key = `${g.get("lid")}|${season}`;
	if (finished && headlineCache.has(key)) {
		return headlineCache.get(key) ?? undefined;
	}
	let out: { head: string } | undefined;
	try {
		const { facts } = await getNewsFacts(season);
		const paper = buildPaper(facts);
		const lead = paper.sections[0]?.articles[0];
		if (lead) {
			out = { head: lead.head };
		}
	} catch (error) {
		console.error(`Timeline: no newspaper for ${season}`, error);
	}
	if (finished) {
		headlineCache.set(key, out ?? null);
		if (headlineCache.size > 400) {
			headlineCache.delete(headlineCache.keys().next().value!);
		}
	}
	return out;
};

const teamUrlPart = (abbrev: string, tid: number) => `${abbrev}_${tid}`;

export default defineView({
	id: "timeline",
	processInputs,
	keepPrevOutput: { storylinesLoading: keepType<boolean>() },
	load: async ({ inputs, updateEvents, prevInputs, prevOutput }) => {
		const featureOff = featureOffError("timeline");
		if (featureOff) {
			return featureOff;
		}
		const inputsChanged = JSON.stringify(inputs) !== JSON.stringify(prevInputs);
		if (
			!inputsChanged &&
			!updateEvents.has("firstRun") &&
			!updateEvents.has("newPhase") &&
			!updateEvents.has("gameAttributes") &&
			!(updateEvents.has("wrappedReady") && prevOutput.storylinesLoading)
		) {
			return;
		}

		const currentSeason = g.get("season");
		const phase = g.get("phase");
		const startingSeason = g.get("startingSeason");
		const seasonOver = phase >= PHASE.PLAYOFFS + 1 || g.get("gameOver");
		const lastFinishedSeason = seasonOver ? currentSeason : currentSeason - 1;

		const teamSeasons = await idb.merged.teamSeasons.getAll();
		const firstSeason = Math.min(
			startingSeason,
			...teamSeasons.map((ts) => ts.season),
		);
		let to = inputs.to ?? currentSeason;
		to = Math.max(firstSeason, Math.min(currentSeason, to));
		let from = inputs.from ?? to - DEFAULT_SEASONS + 1;
		from = Math.max(firstSeason, Math.min(to, from));
		const inRange = (season: number) => season >= from && season <= to;

		const tsKey = (tid: number, season: number) => `${tid}|${season}`;
		const tsByKey = new Map(
			teamSeasons.map((ts) => [tsKey(ts.tid, ts.season), ts]),
		);
		const teamName = (tid: number, season: number) => {
			const ts = tsByKey.get(tsKey(tid, season));
			return ts ? `${ts.region} ${ts.name}` : "???";
		};
		const teamAbbrev = (tid: number, season: number) =>
			tsByKey.get(tsKey(tid, season))?.abbrev ?? "???";

		const items: TimelineItem[] = [];
		const disabled: string[] = [];

		// Champions, from the finals series
		const playoffSeries = await idb.merged.playoffSeries.getAll();
		for (const ps of playoffSeries) {
			if (!inRange(ps.season) || ps.season > lastFinishedSeason) {
				continue;
			}
			const finals = ps.series.at(-1)?.[0];
			if (!finals || !finals.away) {
				continue;
			}
			const [champ, runnerUp] =
				finals.home.won > finals.away.won
					? [finals.home, finals.away]
					: [finals.away, finals.home];
			items.push({
				kind: "champion",
				season: ps.season,
				order: 0,
				title: `${teamName(champ.tid, ps.season)} win the title`,
				detail: `Beat the ${teamName(runnerUp.tid, ps.season)} ${champ.won}-${runnerUp.won} in the finals`,
				url: ["playoffs", ps.season],
				tids: [champ.tid, runnerUp.tid],
				pids: [],
			});
		}

		// MVPs (and Finals MVPs)
		const awards = await idb.merged.awards.getAll();
		for (const a of awards) {
			if (!inRange(a.season)) {
				continue;
			}
			let order = 0;
			for (const award of a.awards) {
				if (award.numTeams !== undefined) {
					continue;
				}
				const isMvp = award.shortName === "MVP";
				const isFmvp = award.statRange === -1;
				if (!isMvp && !isFmvp) {
					continue;
				}
				const winner = award.winner[0];
				if (winner?.pid === undefined) {
					continue;
				}
				const name = (winner as { name?: string }).name ?? "A player";
				items.push({
					kind: "award",
					season: a.season,
					order: order++,
					title: `${name} (${teamAbbrev(winner.tid, a.season)}) wins ${award.name}`,
					url: ["player", winner.pid],
					tids: [winner.tid],
					pids: [winner.pid],
				});
			}
		}

		// Records: best and worst teams ever, single-game scoring highs
		const numGames = g.get("numGames");
		items.push(
			...findTeamRecords(
				teamSeasons.map((ts) => ({
					season: ts.season,
					tid: ts.tid,
					abbrev: ts.abbrev,
					name: `${ts.region} ${ts.name}`,
					won: ts.won,
					lost: ts.lost,
					tied: ts.tied,
					otl: ts.otl,
				})),
				{ lastFinishedSeason, minGp: Math.ceil(numGames * 0.75) },
			).filter((x) => inRange(x.season)),
		);
		if (__SPORT === "basketball") {
			const feats: Parameters<typeof findScoringRecords>[0] = [];
			await idb.merged.playerFeats.forEach(undefined, (f) => {
				const pts = (f.stats as { pts?: number }).pts;
				if (typeof pts === "number") {
					feats.push({
						season: f.season,
						pid: f.pid,
						tid: f.tid,
						name: f.name,
						pts,
						gid: f.gid,
						playoffs: f.playoffs,
					});
				}
			});
			items.push(
				...findScoringRecords(feats, teamAbbrev).filter((x) =>
					inRange(x.season),
				),
			);
		}

		// Big trades and comebacks, from the event log
		const trades = [];
		for (let season = from; season <= to; season++) {
			const events = await idb.merged.events.getAll({ season });
			for (const e of events) {
				if (e.type === "trade" && e.teams) {
					trades.push({ ...e, teams: e.teams, score: e.score });
				} else if (
					e.type === "freeAgent" &&
					e.text?.includes("come out of retirement")
				) {
					items.push({
						kind: "unretire",
						season,
						order: e.eid,
						title: plainText(e.text.replace(/<[^>]*>/g, "")),
						url: ["player", e.pids[0]],
						tids: [],
						pids: e.pids,
					});
				}
			}
		}
		for (const e of pickMajorTrades(trades, 3, 1)) {
			const names = (side: 0 | 1) =>
				e.teams[side].assets
					.map((asset) =>
						"pid" in asset
							? asset.name
							: `${asset.season} round ${asset.round} pick`,
					)
					.slice(0, 3)
					.join(", ") || "nothing";
			const [t0, t1] = e.tids;
			items.push({
				kind: "trade",
				season: e.season,
				order: -(e.score ?? 0),
				title: `${teamAbbrev(t0, e.season)} trade ${names(0)} to ${teamAbbrev(t1, e.season)} for ${names(1)}`,
				url: ["trade_summary", e.eid],
				tids: [t0, t1],
				pids: e.pids,
			});
		}

		// League achievements (from the saved log, so nothing is computed here)
		if (featureOn("leagueAchievements")) {
			const log = await getLeagueAchievementsLog();
			let order = 0;
			for (const entry of log) {
				if (entry.quiet || !inRange(entry.season)) {
					continue;
				}
				const d = DEF_BY_ID.get(entry.id);
				if (!d) {
					continue;
				}
				items.push({
					kind: "achievement",
					season: entry.season,
					order: order++,
					title: `Achievement unlocked: ${d.name}`,
					detail: entry.who ?? d.desc,
					url: ["league_achievements", "all", d.id],
					tids: entry.tid !== undefined ? [entry.tid] : [],
					pids: entry.pid !== undefined ? [entry.pid] : [],
				});
			}
		} else {
			disabled.push("League Achievements");
		}

		// Newspaper front page leads
		if (featureOn("newspaper")) {
			const minHeadlineSeason = Math.max(from, to - MAX_HEADLINE_SEASONS + 1);
			for (let season = to; season >= minHeadlineSeason; season--) {
				const h = await getHeadline(season, season <= lastFinishedSeason);
				if (h) {
					items.push({
						kind: "headline",
						season,
						order: 0,
						title: h.head,
						url: ["newspaper", "all", season],
						tids: [],
						pids: [],
					});
				}
			}
		} else {
			disabled.push("Newspaper");
		}

		// Top storylines (they need the league history snapshot, which may still be loading)
		let storylinesLoading = false;
		if (featureOn("storylines")) {
			const st = getWrappedStatus(updateEvents.has("firstRun"));
			if (st.status === "ready") {
				const { stories } = await getStoryState(st.built);
				const bySeason = new Map<number, typeof stories>();
				for (const s of stories) {
					if (!inRange(s.season)) {
						continue;
					}
					const list = bySeason.get(s.season) ?? [];
					list.push(s);
					bySeason.set(s.season, list);
				}
				for (const [season, list] of bySeason) {
					list.sort((a, b) => b.score - a.score);
					list.slice(0, 3).forEach((s, i) => {
						items.push({
							kind: "storyline",
							season,
							order: i,
							title: plainText(s.headline),
							detail: s.kind,
							url: ["storylines", "all", "all", season],
							tids: s.tids,
							pids: s.pids,
						});
					});
				}
			} else if (st.status === "loading") {
				storylinesLoading = true;
			}
		} else {
			disabled.push("Storylines");
		}

		const teams = [
			...new Map(
				teamSeasons
					.filter((ts) => ts.season === to)
					.map((ts) => [
						ts.tid,
						{
							tid: ts.tid,
							abbrev: ts.abbrev,
							name: `${ts.region} ${ts.name}`,
						},
					]),
			).values(),
		].sort((a, b) => a.abbrev.localeCompare(b.abbrev));

		const seasons: number[] = [];
		for (let season = currentSeason; season >= firstSeason; season--) {
			seasons.push(season);
		}

		return {
			from,
			to,
			seasons,
			timeline: groupTimeline(items),
			teams,
			userTid: g.get("userTid"),
			storylinesLoading,
			disabled,
			teamUrlPart: Object.fromEntries(
				teams.map((t) => [t.tid, teamUrlPart(t.abbrev, t.tid)]),
			) as Record<number, string>,
		};
	},
});
