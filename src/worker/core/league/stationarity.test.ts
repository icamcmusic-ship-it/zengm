// Stationarity: a headless league advanced many seasons (few games per season, so it is cheap) with inflation on. After every season:
// no NaN in player ratings, contracts, team payrolls or the money settings; the league's rating levels (mean ovr of rostered players,
// share of 60+ ovr players) stay within bands; and salaries stay on the salary cap's scale (contracts within min/max contract, payrolls
// around the cap, the money settings moving together with inflation).
//
// The CI run is short (STATIONARITY_SEASONS, default 10). The long run is opt in:
//
//   RUN_STATIONARITY=1 [STATIONARITY_SEASONS=100] npx vitest --run --project basketball src/worker/core/league/stationarity.test.ts
import "fake-indexeddb/auto";
import { assert, test } from "vitest";
import { LEAGUE_DATABASE_VERSION, PHASE } from "../../../common/constants.ts";
import { makeSeededRandom } from "../../../common/random.ts";

import {
	getCurrentContract,
	getNearestContractAmount,
} from "../../../common/contracts.ts";
import { draft, freeAgents, game, league, phase, season } from "../index.ts";
import { idb } from "../../db/index.ts";
import { getDefaultSettings } from "../../views/newLeague.ts";
import { g, helpers } from "../../util/index.ts";

const env = (globalThis as any).process.env;
const LONG = !!env.RUN_STATIONARITY;
const SEASONS = Number(env.STATIONARITY_SEASONS ?? (LONG ? 100 : 10));

const MONEY_KEYS = [
	"salaryCap",
	"minPayroll",
	"luxuryPayroll",
	"minContract",
	"maxContract",
] as const;

const finite = (x: unknown, what: string) => {
	assert.isTrue(
		typeof x === "number" && Number.isFinite(x),
		`${what} is ${String(x)} (season ${g.get("season")})`,
	);
};

const mean = (xs: number[]) => xs.reduce((a, b) => a + b, 0) / xs.length;

const runSeason = async () => {
	await phase.newPhase(PHASE.REGULAR_SEASON, {});
	let guard = 0;
	while (
		g.get("phase") === PHASE.REGULAR_SEASON ||
		g.get("phase") === PHASE.AFTER_TRADE_DEADLINE ||
		g.get("phase") === PHASE.PLAYOFFS
	) {
		const numDays =
			g.get("phase") === PHASE.PLAYOFFS
				? 100
				: await season.getDaysLeftSchedule();
		await game.play(numDays, {});
		if (++guard > 50) {
			throw new Error("stuck in season");
		}
	}
	await phase.newPhase(PHASE.DRAFT, {});
	await draft.runPicks({ type: "untilEnd" }, {});
	await phase.newPhase(PHASE.RESIGN_PLAYERS, {});
	await phase.newPhase(PHASE.FREE_AGENCY, {});
	guard = 0;
	while (g.get("phase") === PHASE.FREE_AGENCY) {
		await freeAgents.play(30, {});
		if (++guard > 10) {
			throw new Error("stuck in free agency");
		}
	}
};

const check = async (ratios0: Record<string, number>) => {
	const s = g.get("season");
	const salaryCap = g.get("salaryCap");
	for (const key of MONEY_KEYS) {
		finite(g.get(key), key);
		// The money settings move together (inflation scales them all; rounding to $10k aside)
		const ratio = g.get(key) / salaryCap;
		assert.approximately(
			ratio,
			ratios0[key]!,
			0.02 * ratios0[key]! + 0.002,
			key,
		);
	}

	const players = await idb.cache.players.indexGetAll("playersByTid", [
		0,
		Infinity,
	]);
	assert.isAbove(players.length, 0);
	const ovrs: number[] = [];
	const amounts = new Map<number, number>();
	for (const p of players) {
		const contract = getCurrentContract(p);
		assert.isDefined(contract, `pid ${p.pid} has no contract`);
		const amount = getNearestContractAmount(contract!, s);
		amounts.set(p.pid, amount);
		const r = p.ratings.at(-1)!;
		for (const [k, v] of Object.entries(r)) {
			if (typeof v === "number") {
				finite(v, `pid ${p.pid} rating ${k}`);
			}
		}
		finite(p.value, `pid ${p.pid} value`);
		finite(amount, `pid ${p.pid} contract`);
		// Contracts on the cap's scale (rookie scale and minimums included). Slack below: a contract signed a few seasons ago is on that
		// season's (lower) scale
		assert.isAtLeast(
			amount,
			0.7 * g.get("minContract"),
			`pid ${p.pid} contract below min`,
		);
		assert.isAtMost(
			amount,
			1.05 * g.get("maxContract"),
			`pid ${p.pid} contract above max`,
		);
		ovrs.push(r.ovr);
	}

	// Ratings distribution of rostered players stays in a band (measured over seeds: mean ovr ~50-54, ~15-32% at 60+ in this
	// small headless league; one season can swing several points either way)
	const ovrMean = mean(ovrs);
	const share60 = ovrs.filter((x) => x >= 60).length / ovrs.length;
	assert.isTrue(
		ovrMean > 40 && ovrMean < 56,
		`mean ovr ${ovrMean.toFixed(1)} (season ${s})`,
	);
	assert.isTrue(
		share60 > 0.01 && share60 < 0.36,
		`60+ share ${share60.toFixed(3)} (season ${s})`,
	);

	// Payrolls around the cap
	const payrolls: number[] = [];
	for (const t of await idb.cache.teams.getAll()) {
		if (t.disabled) {
			continue;
		}
		const sum = players
			.filter((p) => p.tid === t.tid)
			.reduce((acc, p) => acc + amounts.get(p.pid)!, 0);
		finite(sum, `tid ${t.tid} payroll`);
		payrolls.push(sum / salaryCap);
	}
	const payrollMean = mean(payrolls);
	assert.isTrue(
		payrollMean > 0.6 && payrollMean < 1.6,
		`mean payroll / cap ${payrollMean.toFixed(2)} (season ${s})`,
	);

	return { s, ovrMean, share60, payrollMean, salaryCap };
};

test(
	`league stays stationary over ${SEASONS} seasons`,
	{ timeout: (LONG ? 6 * 60 : 10) * 60 * 1000 },
	async () => {
		Math.random = makeSeededRandom(23);
		await league.createStream(
			{},
			{
				// A small league (8 teams, one conference and division) keeps a season cheap
				confs: [{ cid: 0, name: "League" }],
				divs: [{ did: 0, cid: 0, name: "Division" }],
				fromFile: {
					gameAttributes: undefined,
					hasRookieContracts: true,
					maxGid: undefined,
					startingSeason: undefined,
					teams: undefined,
					version: LEAGUE_DATABASE_VERSION,
				},
				getLeagueOptions: undefined,
				keptKeys: new Set(),
				lid: 0,
				name: "stationarity",
				setLeagueCreationStatus: () => {},
				settings: {
					...getDefaultSettings(),
					spectator: true,
					numGames: 4,
					numGamesPlayoffSeries: [1],
					inflationAvg: 3,
					inflationMax: 6,
					inflationMin: 0,
					inflationStd: 1.5,
				} as any,
				shuffleRosters: false,
				startingSeasonFromInput: "2025",
				teamsFromInput: helpers.addPopRank(
					helpers
						.getTeamsDefault()
						.slice(0, 8)
						.map((t) => ({ ...t, cid: 0, did: 0 })),
				),
				tid: 0,
			},
		);
		await league.loadGameAttributes();

		const ratios0 = Object.fromEntries(
			MONEY_KEYS.map((key) => [key, g.get(key) / g.get("salaryCap")]),
		);
		const cap0 = g.get("salaryCap");
		const rows = [];
		for (let i = 0; i < SEASONS; i++) {
			const t0 = performance.now();
			await runSeason();
			if (env.STATIONARITY_TIMING) {
				(globalThis as any).process.stderr.write(
					`season ${i}: ${Math.round(performance.now() - t0)} ms\n`,
				);
			}
			rows.push(await check(ratios0));
		}
		if (LONG) {
			console.log(JSON.stringify(rows));
		}
		// Inflation did run (the cap moved), and everything above held on the new scale
		assert.notStrictEqual(g.get("salaryCap"), cap0);
	},
);
