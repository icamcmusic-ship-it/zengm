// Fast "population" model of a league for the rating inflation audit (docs/rating-inflation.md).
//
// Everything that changes ratings uses the real game code: league creation (random players), draft class generation
// (including the ratings regenerator and college stats hooks), player.develop with each team's coaching level, the
// coaching staff market (staff.runOffseason / onPreseason), retirement (player.shouldRetire), unretirements and the
// injury ratings loss rule. What is NOT simulated is the games themselves: injuries are drawn per player-season
// (calibrated to the full engine: ~1 injury per rostered player per season), team records come from roster strength,
// and rosters are kept as the 13 most valuable players, filled from free agency. Stats-side effects are measured
// separately with the full engine (harness.ts).

import { PHASE, PLAYER } from "../../common/constants.ts";
import { idb } from "../../worker/db/index.ts";
import { g, helpers } from "../../worker/util/index.ts";
import { draft, player, team } from "../../worker/core/index.ts";
import {
	getStaffLevel,
	onPreseason,
	runOffseason,
	staffDevScoreRefOptions,
	staffEnabled,
} from "../../worker/core/staff/index.ts";
import { rollUnretirement } from "../../worker/core/phase/unretire.ts";
import { getTraitInjuryRateMultiplier } from "../../worker/core/player/traits.ts";
import {
	NORMALIZATION,
	PRONE_RISK,
	isInjuryProne,
} from "../../worker/core/player/injuryDepth.ts";
import { featureOn } from "../../worker/util/nativeFeatures.ts";
import { DEFAULT_LEVEL, coachingEffect } from "../../common/budgetLevels.ts";
import { createLeague, summarize, mulberry32 } from "./harness.ts";
import type { SeasonSummary } from "./harness.ts";
import type { Player } from "../../common/types.ts";

const ROSTER = 13;

// Full-engine calibration (harness.ts, existing-league settings): ~410 injuries per season over ~400 rostered players
const INJURIES_PER_PLAYER_SEASON = 1.0;

const poisson = (lambda: number) => {
	const L = Math.exp(-lambda);
	let k = 0;
	let p = 1;
	do {
		k += 1;
		p *= Math.random();
	} while (p > L);
	return k - 1;
};

// Same rule as writePlayerStats.ts (basketball)
const maybeRatingsLoss = async (p: Player, gamesRemaining: number) => {
	const r = p.ratings.at(-1)!;
	if (gamesRemaining > 25 && Math.random() < gamesRemaining / 82 && !r.locked) {
		player.addRatingsRow(p, undefined, p.injuries.length - 1);
		const newRatings = p.ratings.at(-1)! as any;
		for (const key of ["spd", "endu", "jmp"]) {
			newRatings[key] = player.limitRating(
				newRatings[key] -
					helpers.bound(Math.floor(Math.random() * 20) + 1, 1, 20),
			);
		}
		await player.develop(p, 0);
		const prev = p.ratings.at(-2)!;
		if (newRatings.pot > prev.pot) {
			newRatings.pot = prev.pot;
		}
		p.injuries.at(-1)!.ovrDrop = prev.ovr - newRatings.ovr;
		// Keep a single row per season, like the game does at the next preseason
		p.ratings.splice(p.ratings.length - 2, 1);
	}
};

const simInjuries = async (players: Player[]) => {
	const season = g.get("season");
	const injuryDepth = !!g.get("injuryDepth");
	for (const p of players) {
		if (p.tid < 0) {
			continue;
		}
		let mult = 1;
		if (injuryDepth) {
			mult *= NORMALIZATION * (isInjuryProne(p) ? PRONE_RISK : 1);
		}
		if (g.get("playerTraits")) {
			mult *= getTraitInjuryRateMultiplier(p as any);
		}
		const n = poisson(INJURIES_PER_PLAYER_SEASON * mult);
		for (let i = 0; i < n; i++) {
			const inj = player.injury(DEFAULT_LEVEL);
			p.injuries.push({
				season,
				games: inj.gamesRemaining,
				type: inj.type,
			} as any);
			await maybeRatingsLoss(p, inj.gamesRemaining);
		}
	}
};

const teamStrength = (players: Player[], tid: number) =>
	players
		.filter((p) => p.tid === tid)
		.map((p) => p.ratings.at(-1)!.ovr)
		.sort((a, b) => b - a)
		.slice(0, 8)
		.reduce((a, b) => a + b, 0);

const writeRecords = async (players: Player[]) => {
	const season = g.get("season");
	const teams = (await idb.cache.teams.getAll()).filter((t) => !t.disabled);
	const strengths = teams.map((t) => teamStrength(players, t.tid));
	const m = strengths.reduce((a, b) => a + b, 0) / strengths.length;
	for (const [i, t] of teams.entries()) {
		const pct = helpers.bound(
			0.5 + (strengths[i]! - m) / 120 + (Math.random() - 0.5) * 0.15,
			0.1,
			0.9,
		);
		const ts = await idb.cache.teamSeasons.indexGet("teamSeasonsByTidSeason", [
			t.tid,
			season,
		]);
		if (ts) {
			ts.won = Math.round(82 * pct);
			ts.lost = 82 - ts.won;
			ts.playoffRoundsWon = pct > 0.55 ? Math.floor(Math.random() * 5) : -1;
			await idb.cache.teamSeasons.put(ts);
		}
	}
};

const fillRosters = async () => {
	const teams = (await idb.cache.teams.getAll()).filter((t) => !t.disabled);
	const all = await idb.cache.players.indexGetAll("playersByTid", [
		PLAYER.FREE_AGENT,
		Infinity,
	]);
	for (const t of teams) {
		const roster = all
			.filter((p) => p.tid === t.tid)
			.sort((a, b) => b.value - a.value);
		for (const p of roster.slice(ROSTER)) {
			p.tid = PLAYER.FREE_AGENT;
			await idb.cache.players.put(p);
		}
	}
	const fas = all
		.filter((p) => p.tid === PLAYER.FREE_AGENT)
		.sort((a, b) => b.value - a.value);
	for (const t of teams) {
		let n = all.filter((p) => p.tid === t.tid).length;
		while (n < ROSTER && fas.length > 0) {
			const p = fas.shift()!;
			p.tid = t.tid;
			await idb.cache.players.put(p);
			n += 1;
		}
	}
};

export const runPopModel = async ({
	config,
	settings,
	seed,
	seasons,
	onSeason,
	onRegularSeason,
}: {
	config: string;
	settings: Record<string, unknown>;
	seed: number;
	seasons: number;
	onSeason?: (s: SeasonSummary) => void;
	// Called with the league's players (free agents and rostered) at each regular season, before it is played
	onRegularSeason?: (players: Player[]) => Promise<void> | void;
}) => {
	const origRandom = Math.random;
	Math.random = mulberry32(seed);
	staffDevScoreRefOptions.fixed = config.endsWith("FixedRef");
	try {
		await createLeague(settings);
		g.setWithoutSavingToDB("phase", PHASE.REGULAR_SEASON);
		await fillRosters();

		// Coaching level history per team, for the 3 season average (finances.getLevelLastThree)
		const levelHistory = new Map<number, number[]>();
		const teamsInit = await idb.cache.teams.getAll();
		const recordLevels = async () => {
			for (const t of teamsInit) {
				const level = staffEnabled()
					? await getStaffLevel(t.tid)
					: t.budget.coaching;
				const h = levelHistory.get(t.tid) ?? [];
				h.push(level);
				levelHistory.set(t.tid, h.slice(-3));
			}
		};
		await recordLevels();

		const out: SeasonSummary[] = [];
		for (let i = 0; i < seasons; i++) {
			const season = g.get("season");
			let players = await idb.cache.players.indexGetAll("playersByTid", [
				PLAYER.FREE_AGENT,
				Infinity,
			]);

			await onRegularSeason?.(players);

			// Regular season
			await simInjuries(players);
			await writeRecords(players);

			const s = await summarize(config, seed);
			const levels = [...levelHistory.values()].map(
				(h) => h.reduce((a, b) => a + b, 0) / h.length,
			);
			s.coachingMean =
				Math.round((100 * levels.reduce((a, b) => a + b, 0)) / levels.length) /
				100;
			s.coachingEffectMean =
				Math.round(
					(1e4 * levels.reduce((a, b) => a + coachingEffect(b), 0)) /
						levels.length,
				) / 1e4;
			out.push(s);
			onSeason?.(s);

			// Offseason
			g.setWithoutSavingToDB("phase", PHASE.DRAFT_LOTTERY);
			await runOffseason();

			for (const p of players) {
				if (await player.shouldRetire(p)) {
					p.tid = PLAYER.RETIRED;
					p.retiredYear = season;
					await idb.cache.players.put(p);
				}
			}

			// Draft: the 2 rounds go to random teams, the rest of the class are free agents
			g.setWithoutSavingToDB("phase", PHASE.DRAFT);
			const prospects = (
				await idb.cache.players.indexGetAll("playersByTid", PLAYER.UNDRAFTED)
			)
				.filter((p) => p.draft.year === season)
				.sort((a, b) => b.value - a.value);
			const tids = teamsInit.map((t) => t.tid);
			for (const [j, p] of prospects.entries()) {
				if (j < 2 * tids.length) {
					p.tid = tids[Math.floor(Math.random() * tids.length)]!;
					p.draft.round = j < tids.length ? 1 : 2;
					p.draft.tid = p.tid;
				} else {
					p.tid = PLAYER.FREE_AGENT;
				}
				await idb.cache.players.put(p);
			}

			// Like newPhaseResignPlayers: the class 3 years out
			g.setWithoutSavingToDB("phase", PHASE.RESIGN_PLAYERS);
			await draft.genPlayers(season + 3, DEFAULT_LEVEL);

			g.setWithoutSavingToDB("phase", PHASE.FREE_AGENCY);
			if (featureOn("unretire")) {
				await rollUnretirement();
			}

			// New season
			g.setWithoutSavingToDB("season", season + 1);
			g.setWithoutSavingToDB("phase", PHASE.PRESEASON);
			for (const t of teamsInit) {
				const t2 = (await idb.cache.teams.get(t.tid))!;
				await idb.cache.teamSeasons.add(
					team.genSeasonRow(t2, undefined, season + 1),
				);
			}
			await onPreseason();
			await recordLevels();

			// Like newPhasePreseason: prospects don't develop until they're drafted
			players = await idb.cache.players.indexGetAll("playersByTid", [
				PLAYER.FREE_AGENT,
				Infinity,
			]);
			// Like newPhasePreseason: work ethic and aging curve (player traits)
			const traitDevelopment = player.getTraitDevelopment(
				players as any,
				season + 1,
			);
			for (const p of players) {
				const h = levelHistory.get(p.tid);
				const level = h
					? h.reduce((a, b) => a + b, 0) / h.length
					: DEFAULT_LEVEL;
				player.addRatingsRow(p, DEFAULT_LEVEL);
				await player.develop(
					p,
					1,
					false,
					level,
					false,
					undefined,
					traitDevelopment.get(p.pid),
				);
				player.developTraits(p as any, season + 1);
				await player.updateValues(p);
				await idb.cache.players.put(p);
			}
			g.setWithoutSavingToDB("phase", PHASE.REGULAR_SEASON);
			await fillRosters();

			// Memory: drop retired players' history
			for (const p of await idb.cache.players.indexGetAll(
				"playersByTid",
				PLAYER.RETIRED,
			)) {
				if (p.retiredYear < season - 15) {
					await idb.cache.players.delete(p.pid);
				}
			}
		}
		return out;
	} finally {
		staffDevScoreRefOptions.fixed = false;
		Math.random = origRandom;
	}
};
