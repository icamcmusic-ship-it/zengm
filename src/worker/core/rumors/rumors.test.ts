// Rumors against a real simulated league: one season with every League extra on and the rumor mill on. Checks that rumors are
// reproducible, resolve correctly, don't leak anything the user couldn't see, and can't change the sim: they never draw from
// Math.random and never write anything but their own game attribute. (A whole season played with the mill on and off is compared in
// src/test/ratingInflation/rumors.script.test.ts, RUMOR_FP mode: two simulations in one process aren't identical even with the
// mill off, because of module caches.)
import { afterAll, assert, beforeAll, describe, test } from "vitest";
import { PHASE, PLAYER } from "../../../common/constants.ts";
import {
	getContractExp,
	getCurrentContract,
} from "../../../common/contracts.ts";
import {
	BUZZ_WINDOW_TICKS,
	buzzCap,
	emptyRumorState,
} from "../../../common/rumors/logic.ts";
import { renderRumorText } from "../../../common/rumors/text.ts";
import {
	RUMOR_TYPES,
	type Rumor,
	type RumorState,
} from "../../../common/rumors/types.ts";
import { resetG } from "../../../test/helpers.ts";
import {
	ALL_ON,
	createLeague,
	mulberry32,
	simFingerprint,
} from "../../../test/ratingInflation/harness.ts";
import { idb } from "../../db/index.ts";
import { STORES } from "../../db/Cache.ts";
import { g, helpers, local } from "../../util/index.ts";
import { startAutoPlay } from "../league/autoPlay.ts";
import { afterDay, atPhase } from "./index.ts";

// Tests share one worker (isolate: false), so put back what the simulation replaced
const { cache, league } = idb;
const realRandom = Math.random;
afterAll(() => {
	Math.random = realRandom;
	idb.cache = cache;
	idb.league = league;
	local.autoPlayUntil = undefined;
	resetG();
});

const fingerprint = simFingerprint;

const SEED = 11;
const RUMOR_SEED = 77;

const simulate = async (rumorsOn: boolean) => {
	if ((globalThis as any).IDBRequest === undefined) {
		// @ts-expect-error (no types for the side-effect entry point)
		await import("fake-indexeddb/auto");
	}
	Math.random = mulberry32(SEED);
	await createLeague({
		...ALL_ON,
		featureRumors: rumorsOn,
		rumors: rumorsOn ? emptyRumorState(RUMOR_SEED) : undefined,
	});
	const season = g.get("season");
	// Through the trade deadline, the playoffs, the draft and free agency, into the next regular season
	await startAutoPlay(season, PHASE.DRAFT_LOTTERY, {});
	await startAutoPlay(season + 1, PHASE.REGULAR_SEASON, {});
	local.autoPlayUntil = undefined;
	return {
		fingerprint: await fingerprint(),
		nextRandom: [Math.random(), Math.random(), Math.random()],
		rumors: g.get("rumors") as RumorState | undefined,
	};
};

const teamName = (tid: number) => `Team${tid}`;

// A few rumor days from the league as it is, without simulating anything
const rumorDays = async (seed: number, days: number) => {
	g.setWithoutSavingToDB("rumors", emptyRumorState(seed));
	for (let i = 0; i < days; i++) {
		await (i % 10 === 0 ? atPhase() : afterDay());
	}
	return g.get("rumors")!;
};

describe("Rumors in a simulated league", () => {
	let on: Awaited<ReturnType<typeof simulate>>;
	let items: Rumor[];

	beforeAll(async () => {
		on = await simulate(true);
		items = on.rumors!.items;
	}, 900_000);

	test("the mill only reads: no random numbers drawn, no writes but its own game attribute", async () => {
		const before = await fingerprint();
		const gBefore = JSON.stringify({ ...g, rumors: undefined });
		const writes: string[] = [];
		const restore: (() => void)[] = [];
		for (const store of STORES) {
			const api = (idb.cache as any)[store];
			for (const method of ["put", "add", "delete", "clear"]) {
				const original = api?.[method];
				if (typeof original !== "function") {
					continue;
				}
				api[method] = (...args: any[]) => {
					if (!(store === "gameAttributes" && args[0]?.key === "rumors")) {
						writes.push(`${store}.${method}`);
					}
					return original.apply(api, args);
				};
				restore.push(() => {
					api[method] = original;
				});
			}
		}
		const count = { n: 0 };
		const seeded = mulberry32(5);
		Math.random = () => {
			count.n += 1;
			return seeded();
		};
		try {
			await rumorDays(42, 60);
			// Where a helper draws random numbers itself (free agents with no salary cap), it gets the mill's stream
			g.setWithoutSavingToDB("salaryCapType", "none");
			await rumorDays(43, 30);
			g.setWithoutSavingToDB("salaryCapType", "soft");
		} finally {
			for (const fn of restore) {
				fn();
			}
		}
		assert.strictEqual(count.n, 0);
		assert.deepStrictEqual(writes, []);
		assert.deepStrictEqual(await fingerprint(), before);
		assert.strictEqual(JSON.stringify({ ...g, rumors: undefined }), gBefore);
		assert.isAbove(g.get("rumors")!.items.length, 5);
	}, 120_000);

	test("rumors appear all year, of many types, and resolve both ways", () => {
		assert.isAbove(items.length, 40);
		assert.isBelow(items.length, 250);
		const types = new Set(items.map((r) => r.type));
		assert.isAtLeast(types.size, 6, [...types].join());
		const phases = new Set(items.map((r) => r.phase));
		for (const phase of [
			PHASE.REGULAR_SEASON,
			PHASE.PLAYOFFS,
			PHASE.DRAFT_LOTTERY,
			PHASE.FREE_AGENCY,
		]) {
			assert(phases.has(phase), `phase ${phase}`);
		}
		const confirmed = items.filter((r) => r.status === "confirmed");
		const busted = items.filter((r) => r.status === "busted");
		assert.isAbove(confirmed.length, 5);
		assert.isAbove(busted.length, 5);
		// A meaningful share comes true, but far from all
		const rate = confirmed.length / (confirmed.length + busted.length);
		assert.isAbove(rate, 0.12);
		assert.isBelow(rate, 0.7);
		// Stronger claims come true more often than long shots
		const share = (rows: Rumor[]) =>
			rows.filter((r) => r.status === "confirmed").length /
			Math.max(1, rows.length);
		const resolved = [...confirmed, ...busted];
		assert.isAbove(
			share(resolved.filter((r) => r.confidence >= 0.35)),
			share(resolved.filter((r) => r.confidence < 0.15)),
		);

		for (const r of items) {
			assert.isAtLeast(r.confidence, 0.01);
			assert.isAtMost(r.confidence, 0.97);
			if (r.status === "open") {
				assert.strictEqual(r.outcome, undefined);
			} else {
				assert.isString(r.outcome);
				assert.notStrictEqual(r.resolved, undefined);
			}
		}

		// The track record counts exactly the resolved rumors
		let tallied = 0;
		for (const row of Object.values(on.rumors!.stats)) {
			for (const tally of Object.values(row)) {
				tallied += tally[0] + tally[1];
			}
		}
		assert.strictEqual(tallied, resolved.length);
	});

	test("scouting buzz: in the feed, rate-limited, never in the track record", async () => {
		const buzz = on.rumors!.buzz ?? [];
		assert.isAbove(buzz.length, 3);
		// Rate limit: never more than the cap in any window of rumor days
		for (const b of buzz) {
			const recent = buzz.filter(
				(x) => x.tick <= b.tick && x.tick > b.tick - BUZZ_WINDOW_TICKS,
			);
			assert.isAtMost(recent.length, buzzCap(b.phase));
		}
		// A player at most once per window (a third of the season, the draft), no numbers in the text, about a real player
		const keys = buzz.map((b) => `${b.season}|${b.window}|${b.pid}`);
		assert.strictEqual(new Set(keys).size, keys.length);
		for (const b of buzz) {
			const text = renderRumorText(b.text, teamName);
			assert.notMatch(text, /\d/, text);
			assert.include(b.text, `{p:${b.pid}:`);
		}
		// Separate from the rumors: their own ids, and the tally only counts rumors (checked above)
		assert(on.rumors!.items.every((r) => !("bid" in r)));

		// Off without Scouting Reports
		g.setWithoutSavingToDB("featureScoutingReports" as any, false);
		try {
			const state = await rumorDays(55, 30);
			assert.strictEqual(state.buzz?.length ?? 0, 0);
		} finally {
			g.setWithoutSavingToDB("featureScoutingReports" as any, true);
		}
		// With it on, the same rumors as with it off: the buzz has its own random stream
		const withBuzz = helpers.deepCopy(await rumorDays(56, 30));
		g.setWithoutSavingToDB("featureScoutingReports" as any, false);
		try {
			const without = await rumorDays(56, 30);
			assert.deepStrictEqual(withBuzz.items, without.items);
		} finally {
			g.setWithoutSavingToDB("featureScoutingReports" as any, true);
		}
	}, 120_000);

	test("rumors don't leak ratings, traits or prospects", () => {
		const allowed = new Set([
			"rid",
			"type",
			"kind",
			"season",
			"phase",
			"tick",
			"tids",
			"pids",
			"fromTid",
			"dpid",
			"cid",
			"gmid",
			"group",
			"exp",
			"text",
			"confidence",
			"raw",
			"status",
			"until",
			"untilTick",
			"outcome",
			"resolved",
			"user",
		]);
		for (const r of items) {
			for (const key of Object.keys(r)) {
				assert(allowed.has(key), key);
			}
			const text = renderRumorText(r.text, teamName);
			// No numbers at all, except the draft year of a pick: nothing like an ovr or an age can slip in
			assert.notMatch(
				text.replaceAll(/Team\d+/g, "").replaceAll(/\b20\d\d\b/g, ""),
				/\d/,
				text,
			);
			assert.notMatch(text, /\b(ovr|pot|rating|trait)/i, text);
			if (r.type === "draft") {
				// What the team needs, never which prospect
				assert.deepStrictEqual(r.pids, []);
				assert.notInclude(r.text, "{p:");
			}
		}
	});

	test("the same seed gives the same rumors, another seed different ones", async () => {
		const a = helpers.deepCopy(await rumorDays(123, 40));
		const b = helpers.deepCopy(await rumorDays(123, 40));
		const c = helpers.deepCopy(await rumorDays(124, 40));
		assert.isAbove(a.items.length, 10);
		assert.deepStrictEqual(a, b);
		assert.notDeepEqual(
			a.items.map((r) => r.text),
			c.items.map((r) => r.text),
		);
	}, 120_000);

	test("rumors about the user's team are fair", async () => {
		// The user runs team 0 now
		g.setWithoutSavingToDB("spectator", false);
		const userTid = g.get("userTid");
		const state = await rumorDays(9, 150);
		g.setWithoutSavingToDB("spectator", true);

		const mine = state.items.filter(
			(r) => r.tids.includes(userTid) || r.fromTid === userTid,
		);
		for (const r of mine) {
			// Never what the user's own front office "plans": only other teams' interest in his players and how his players feel
			assert.include(["interest", "unhappy"], r.type, r.text);
			assert.strictEqual(r.user, true);
			if (r.type === "interest") {
				assert.notStrictEqual(r.tids[0], userTid);
				assert.strictEqual(r.fromTid, userTid);
			}
		}
		assert.isAbove(
			state.items.filter((r) => r.kind === "user").length,
			0,
			"AI interest in the user's players",
		);
	}, 120_000);

	test("outcomes: a rumor is confirmed when it comes true and busted when its time runs out", async () => {
		const season = g.get("season");
		const phase = g.get("phase");
		const base = {
			season,
			phase,
			tick: 0,
			text: "x",
			confidence: 0.4,
			status: "open" as const,
			until: { season: season + 1, phase: PHASE.REGULAR_SEASON },
		};
		const roster = async (tid: number) =>
			(await idb.cache.players.indexGetAll("playersByTid", tid)).toSorted(
				(a, b) => b.value - a.value,
			);
		const [a, b, c, d] = await roster(5);
		const freeAgents = (
			await idb.cache.players.indexGetAll("playersByTid", PLAYER.FREE_AGENT)
		).slice(0, 2);
		const coach = (await idb.cache.coaches.indexGetAll("coachesByTid", 7)).find(
			(row) => row.role === "head",
		)!;
		const dp = (
			await idb.cache.draftPicks.indexGetAll("draftPicksByTid", 8)
		)[0]!;
		const gmTeam = (await idb.cache.teams.getAll()).find(
			(t) => t.gm && t.tid > 0,
		)!;
		const expB = getContractExp(getCurrentContract(b!)!);

		const state = emptyRumorState(1);
		const add = (r: Partial<Rumor> & Pick<Rumor, "type">) => {
			state.items.push({
				...base,
				tids: [5],
				pids: [],
				...r,
				rid: state.nextRid,
			});
			state.nextRid += 1;
			return state.nextRid - 1;
		};
		const traded = add({ type: "shopping", pids: [a!.pid], fromTid: 5 });
		const kept = add({
			type: "shopping",
			pids: [c!.pid],
			fromTid: 5,
			until: { season, phase },
		});
		const waiting = add({ type: "shopping", pids: [d!.pid], fromTid: 5 });
		const wrongTeam = add({
			type: "interest",
			tids: [9, 5],
			pids: [a!.pid],
			fromTid: 5,
		});
		const rightTeam = add({
			type: "interest",
			tids: [6, 5],
			pids: [a!.pid],
			fromTid: 5,
		});
		const extended = add({
			type: "extension",
			pids: [b!.pid],
			fromTid: 5,
			exp: expB - 1,
		});
		const asked = add({ type: "unhappy", pids: [d!.pid], fromTid: 5 });
		const signed = add({
			type: "freeAgent",
			tids: [3, 4],
			pids: [freeAgents[0]!.pid],
			fromTid: -1,
		});
		const signedElsewhere = add({
			type: "freeAgent",
			tids: [3],
			pids: [freeAgents[1]!.pid],
			fromTid: -1,
		});
		const fired = add({ type: "coach", tids: [7], cid: coach.cid });
		const pickTraded = add({ type: "pick", tids: [8], dpid: dp.dpid });
		const gmOut = add({
			type: "gm",
			tids: [gmTeam.tid],
			gmid: gmTeam.gm!.gmid,
		});
		const gmStays = add({
			type: "gm",
			tids: [gmTeam.tid],
			gmid: gmTeam.gm!.gmid,
			until: { season, phase },
		});
		// Stop new rumors from being made, so only these resolve
		g.setWithoutSavingToDB("rumors", state);

		a!.tid = 6;
		a!.transactions = [
			...(a!.transactions ?? []),
			{ season, phase, tid: 6, type: "trade", fromTid: 5 },
		];
		await idb.cache.players.put(a!);
		d!.tradeRequest = { season, phase, tid: 5 };
		await idb.cache.players.put(d!);
		freeAgents[0]!.tid = 4;
		freeAgents[1]!.tid = 10;
		await idb.cache.players.put(freeAgents[0]!);
		await idb.cache.players.put(freeAgents[1]!);
		coach.tid = -1;
		await idb.cache.coaches.put(coach);
		dp.tid = 12;
		await idb.cache.draftPicks.put(dp);

		await afterDay();
		let after = g.get("rumors")!;
		const get = (rid: number) => after.items.find((r) => r.rid === rid)!;
		assert.strictEqual(get(traded).status, "confirmed");
		assert.include(get(traded).outcome, "{t:6}");
		assert.deepStrictEqual(get(traded).resolved, { season, phase });
		assert.strictEqual(get(kept).status, "busted");
		assert.strictEqual(get(waiting).status, "open");
		assert.strictEqual(get(wrongTeam).status, "busted");
		assert.strictEqual(get(rightTeam).status, "confirmed");
		assert.strictEqual(get(extended).status, "confirmed");
		assert.strictEqual(get(asked).status, "confirmed");
		assert.strictEqual(get(signed).status, "confirmed");
		assert.strictEqual(get(signedElsewhere).status, "busted");
		assert.include(get(signedElsewhere).outcome, "{t:10}");
		assert.strictEqual(get(fired).status, "confirmed");
		assert.strictEqual(get(pickTraded).status, "confirmed");
		assert.strictEqual(get(gmOut).status, "open");
		assert.strictEqual(get(gmStays).status, "busted");

		// Tallied once, in the season the rumor was made
		const tally = after.stats[season]!;
		assert.deepStrictEqual(tally.shopping!.slice(0, 2), [1, 1]);
		assert.deepStrictEqual(tally.interest!.slice(0, 2), [1, 1]);
		assert.deepStrictEqual(tally.freeAgent!.slice(0, 2), [1, 1]);
		assert.closeTo(tally.shopping![2], 0.8, 1e-9);

		gmTeam.gm = undefined;
		await idb.cache.teams.put(gmTeam);
		await afterDay();
		after = g.get("rumors")!;
		assert.strictEqual(get(gmOut).status, "confirmed");
		// Nothing is counted twice
		assert.deepStrictEqual(after.stats[season]!.shopping!.slice(0, 2), [1, 1]);
		assert.deepStrictEqual(after.stats[season]!.gm!.slice(0, 2), [1, 1]);
	});

	test("off: nothing is stored, so old leagues are untouched", async () => {
		g.setWithoutSavingToDB("featureRumors" as any, false);
		g.setWithoutSavingToDB("rumors", undefined);
		await afterDay();
		await atPhase();
		assert.strictEqual(g.get("rumors"), undefined);
		assert(RUMOR_TYPES.length > 0);
	});
});
