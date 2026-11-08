import { idb } from "../db/index.ts";
import { changeLog } from "../db/changeLog.ts";
import { g, helpers, lock, local, logEvent, toUI } from "./index.ts";
import { featureOn, featureOption } from "./nativeFeatures.ts";
import { getWrapped, memoize, yieldToWorker } from "./wrappedData.ts";
import {
	applyNativeRules,
	completedSeasons,
	computeAchievements,
	DEF_BY_ID,
	makeLookup,
	newUnlocks,
	RARITY_CLASS,
	RARITY_LABEL,
	toAData,
	whoOf,
	whoText,
	type AchievementDef,
	type AData,
	type AExtras,
	type EngineRun,
	type Rarity,
} from "../../common/leagueAchievements/index.ts";
import {
	loadState,
	saveState,
	type SavedState,
	type UnlockLogEntry,
} from "./leagueAchievementsStore.ts";
import { PHASE } from "../../common/constants.ts";

// League achievements (basketball only): the League Explorer's catalogue and engine (src/common/leagueAchievements) run on the league's own data. The data is the Wrapped/Storylines snapshot (incremental and cached, see wrappedData.ts) plus a few small stores, and the result is kept with the snapshot, so it is only recomputed when the league changed.
//
// Unlocks are noticed after games and phase changes: scheduleLeagueAchievementsCheck is called there, waits until things are quiet (no games being simmed, no auto play), runs the engine once and announces tiers that weren't unlocked before (see leagueAchievementsStore.ts for what is remembered).

export type Computed = { data: AData; run: EngineRun };

const readExtras = async (): Promise<AExtras> => {
	const [events, awards, allStars, lottery, h2h, feats, teams] =
		await Promise.all([
			idb.merged.events.getAll(undefined, {
				filter: (e) => e.type === "trade" || e.type === "freeAgent",
			}),
			idb.merged.awards.getAll(),
			idb.merged.allStars.getAll(),
			idb.merged.draftLotteryResults.getAll(),
			idb.merged.headToHeads.getAll(),
			idb.merged.playerFeats.getAll(),
			idb.cache.teams.getAll(),
		]);
	return {
		phase: g.get("phase"),
		numGames: g.get("numGames"),
		seriesWinsNeeded: g
			.get("numGamesPlayoffSeries", "current")
			.map((n) => Math.ceil(n / 2)),
		events,
		awards,
		allStars,
		lottery,
		h2h,
		feats,
		teams: teams.map((t) => ({
			tid: t.tid,
			retiredJerseyNumbers: (t.retiredJerseyNumbers ?? []).map((j) => ({
				number: j.number,
				seasonRetired: j.seasonRetired,
				pid: j.pid,
			})),
		})),
	};
};

// Drains the engine, letting the worker handle other messages every few dozen milliseconds
const drive = async <T>(it: Generator<unknown, T>): Promise<T> => {
	let last = performance.now();
	for (;;) {
		const r = it.next();
		if (r.done) {
			return r.value;
		}
		if (performance.now() - last > 40) {
			await yieldToWorker();
			last = performance.now();
		}
	}
};

// The engine's result for the league as it is now. Events (trades, signings) aren't in the signature: they come with player writes, which change the snapshot.
export const getLeagueAchievements = async (): Promise<Computed> => {
	const built = await getWrapped();
	const sig = [
		changeLog.store("awards"),
		changeLog.store("allStars"),
		changeLog.store("draftLotteryResults"),
		changeLog.store("headToHeads"),
		changeLog.store("playerFeats"),
		changeLog.store("teams"),
		g.get("phase"),
	].join(",");
	return memoize(built, `leagueAchievements|${sig}`, async () => {
		const extras = await readExtras();
		const data = toAData(built.L, extras);
		const run = applyNativeRules(await drive(computeAchievements(data)), data);
		return { data, run };
	});
};

const RARITY_SCORE: Record<Rarity, number> = {
	common: 0,
	rare: 10,
	legendary: 20,
	impossible: 30,
};

// Show at most this many separate toasts at once; the rest are summed up in one
const MAX_TOASTS = 3;

const pageUrl = (d?: AchievementDef) =>
	helpers.leagueUrl(
		d ? ["league_achievements", "all", d.id] : ["league_achievements"],
	);

const escapeHtml = (s: string) =>
	s.replace(
		/["&<>]/g,
		(c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]!,
	);

const announce = async (
	list: { d: AchievementDef; entry: UnlockLogEntry }[],
) => {
	let shown = 0;
	const toasts = featureOption<boolean>("featureAchievementToasts");
	for (const { d, entry } of list) {
		const who = entry.who ? ` ${escapeHtml(entry.who)}.` : "";
		const text = `Achievement unlocked: <a href="${pageUrl(d)}">${escapeHtml(d.name)}</a> <span class="badge ${RARITY_CLASS[d.rarity]}">${RARITY_LABEL[d.rarity]}</span> ${escapeHtml(d.desc)}${who}`;
		const toast = shown < MAX_TOASTS || list.length === MAX_TOASTS + 1;
		if (toast) {
			shown += 1;
		}
		await logEvent({
			type: "achievement",
			text,
			pids: entry.pid !== undefined ? [entry.pid] : [],
			tids: entry.tid !== undefined ? [entry.tid] : [],
			score: RARITY_SCORE[d.rarity],
			showNotification: toast && toasts,
			saveToDb: true,
		});
	}
	const rest = list.length - shown;
	if (rest > 0) {
		const counts = new Map<Rarity, number>();
		for (const { d } of list.slice(shown)) {
			counts.set(d.rarity, (counts.get(d.rarity) ?? 0) + 1);
		}
		const parts = (["impossible", "legendary", "rare", "common"] as const)
			.filter((r) => counts.has(r))
			.map((r) => `${counts.get(r)} ${RARITY_LABEL[r].toLowerCase()}`);
		await logEvent({
			type: "achievement",
			text: `${rest} more achievement${rest === 1 ? "" : "s"} unlocked (${parts.join(", ")}). <a href="${helpers.leagueUrl(["league_achievements", "recent"])}">See them all.</a>`,
			saveToDb: false,
			showNotification: toasts,
		});
	}
};

// A league that hasn't played its first regular season yet: everything it unlocks from here on is news
const isFresh = () =>
	g.get("season") === g.get("startingSeason") &&
	g.get("phase") <= PHASE.REGULAR_SEASON;

// Compare the current results with what was announced before, announce the difference and remember it. Returns the new unlocks.
export const checkLeagueAchievements = async (): Promise<AchievementDef[]> => {
	if (!featureOn("leagueAchievements")) {
		return [];
	}
	const lid = g.get("lid");
	const startingSeason = g.get("startingSeason");
	const { data, run } = await getLeagueAchievements();
	if (g.get("lid") !== lid) {
		return [];
	}
	const season = g.get("season");
	const phase = g.get("phase");
	const look = makeLookup(data);

	let state: SavedState | undefined = await loadState(lid, startingSeason);
	// The first check of an existing league: what is already unlocked isn't news. It is remembered quietly, and the most recent few go in the log so the dashboard has something to show.
	let quiet = false;
	if (!state) {
		state = { v: 1, startingSeason, seen: {}, log: [] };
		quiet = !isFresh();
	}
	const seen = state.seen;
	const fresh = newUnlocks(run.results, {
		has: (id) => seen[id] !== undefined,
	});
	if (fresh.length === 0 && !quiet) {
		return [];
	}
	const entries = fresh.map((d) => {
		const r = run.results.get(d.id)!;
		const w = whoOf(look, d, r.first);
		const entry: UnlockLogEntry = {
			id: d.id,
			season,
			phase,
			who: whoText(w) || undefined,
			pid: w?.pid,
			tid: w?.tid,
			at: r.first?.at,
		};
		seen[d.id] = [season, phase];
		return { d, entry };
	});
	if (quiet) {
		const recent = entries
			.slice()
			.sort((a, b) => (a.entry.at ?? 0) - (b.entry.at ?? 0))
			.slice(-12);
		for (const { entry } of recent) {
			entry.quiet = true;
			state.log.push(entry);
		}
	} else {
		// Oldest first in the log, so the newest end up last; announced rarest first
		const ordered = entries
			.slice()
			.sort((a, b) => (a.entry.at ?? 0) - (b.entry.at ?? 0));
		state.log.push(...ordered.map((x) => x.entry));
	}
	await saveState(lid, state);
	if (!quiet) {
		await announce(entries);
		void toUI("realtimeUpdate", [["leagueAchievements"]]);
	}
	return quiet ? [] : fresh;
};

let timer: ReturnType<typeof setTimeout> | undefined;
let running = false;
let again = false;

const busy = () =>
	lock.get("gameSim") ||
	lock.get("newPhase") ||
	local.autoPlayUntil !== undefined;

// Ask for a check soon. Called after games and phase changes; cheap, and safe to call often: checks are debounced, never overlap, and wait while games are being simmed in bulk.
export const scheduleLeagueAchievementsCheck = (delay = 1500) => {
	// League extras: no background checks while the feature is off
	if (!featureOn("leagueAchievements")) {
		return;
	}
	clearTimeout(timer);
	timer = setTimeout(async () => {
		timer = undefined;
		let lid: number;
		try {
			lid = g.get("lid");
		} catch {
			return;
		}
		if (lid === undefined || busy()) {
			// Try again once the sim is over
			scheduleLeagueAchievementsCheck(3000);
			return;
		}
		if (running) {
			again = true;
			return;
		}
		running = true;
		try {
			await checkLeagueAchievements();
		} catch (error) {
			console.error("League achievements check failed", error);
		} finally {
			running = false;
			if (again) {
				again = false;
				scheduleLeagueAchievementsCheck();
			}
		}
	}, delay);
	(timer as { unref?: () => void }).unref?.();
};

// For the dashboard card: the newest announcements, without running the engine
export const getRecentLeagueAchievements = async (n = 5) => {
	if (__SPORT !== "basketball") {
		return [];
	}
	const state = await loadState(g.get("lid"), g.get("startingSeason"));
	if (!state) {
		return [];
	}
	return state.log
		.slice(-n)
		.reverse()
		.flatMap((e) => {
			const d = DEF_BY_ID.get(e.id);
			if (!d) {
				return [];
			}
			return [
				{
					id: d.id,
					name: d.name,
					desc: d.desc,
					rarity: d.rarity,
					who: e.who,
					season: e.season,
					quiet: e.quiet ?? false,
				},
			];
		});
};

export const getLeagueAchievementsLog = async () => {
	const state = await loadState(g.get("lid"), g.get("startingSeason"));
	return state?.log ?? [];
};

// For tools/leagueAchievementsCalibration (from the console: bbgm.leagueAchievementsTally()): every tier's state, count and first season in this league, to measure how often tiers happen in simulated leagues
export const leagueAchievementsTally = async () => {
	const { data, run } = await getLeagueAchievements();
	const tiers: Record<
		string,
		{ s: "u" | "l" | "x"; n: number; first: number | null }
	> = {};
	for (const [id, r] of run.results) {
		tiers[id] = {
			s: r.state === "unlocked" ? "u" : r.state === "locked" ? "l" : "x",
			n: r.count,
			first: r.first?.season ?? null,
		};
	}
	return {
		own: run.own,
		season: g.get("season"),
		phase: g.get("phase"),
		completed: completedSeasons(data, run.own),
		tiers,
	};
};
