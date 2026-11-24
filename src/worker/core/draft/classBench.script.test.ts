// Not a real test: a benchmark of generating new draft classes (draft.genPlayers: the prospects, the class steps and the
// label steering, college stats, the combine), each from its own fresh league (new league defaults) and seeded random
// numbers, and a hash of every stored prospect (for a before/after check that a speed change did not change any class).
// Skipped unless CLASS_BENCH is set:
//
//   CLASS_BENCH=1 [CLASS_BENCH_CLASSES=6] [CLASS_BENCH_PROF=file.cpuprofile] node_modules/.bin/vitest run --project basketball \
//     src/worker/core/draft/classBench.script.test.ts
//
// Prints "CLASS_BENCH {...}" (also appended to the file CLASS_BENCH_OUT): milliseconds per class (wall and CPU) and the hash.
// @ts-expect-error node types are not in the web tsconfig, but tests run in node
import { appendFileSync, writeFileSync } from "node:fs";
// @ts-expect-error
import { Session } from "node:inspector/promises";
import { describe, test } from "vitest";
import { DEFAULT_LEVEL } from "../../../common/budgetLevels.ts";
import { PHASE, PLAYER } from "../../../common/constants.ts";
import { nativeFeatureNewLeagueDefaults } from "../../../common/nativeFeatures.ts";
import { Rng } from "../../../common/ratingsBuilds/rng.ts";
import { mockIDBLeague, resetCache, resetG } from "../../../test/helpers.ts";
import { idb } from "../../db/index.ts";
import { g } from "../../util/index.ts";
import { draft } from "../index.ts";
import { resetArchetypeNorms } from "../player/archetype.ts";

const env = (globalThis as any).process.env;
const NUM_CLASSES = Number(env.CLASS_BENCH_CLASSES ?? 6);

const hashOf = (str: string) => {
	let h = 0;
	let h2 = 7;
	for (let i = 0; i < str.length; i++) {
		const c = str.charCodeAt(i);
		h = (Math.imul(h, 31) + c) | 0;
		h2 = (Math.imul(h2, 16777619) ^ c) | 0;
	}
	return `${(h >>> 0).toString(16)}${(h2 >>> 0).toString(16)}`;
};
const replacer = (_key: string, value: unknown) =>
	typeof value === "number" && !Number.isFinite(value) ? `#${value}` : value;

describe.skipIf(!env.CLASS_BENCH)("draft class benchmark", () => {
	test("classes", { timeout: 24 * 60 * 60 * 1000 }, async () => {
		const realRandom = Math.random;
		const realNow = Date.now;
		Date.now = () => 1_700_000_000_000;
		let session: any;
		if (env.CLASS_BENCH_PROF) {
			session = new Session();
			session.connect();
			await session.post("Profiler.enable");
			await session.post("Profiler.setSamplingInterval", { interval: 200 });
			await session.post("Profiler.start");
		}
		const cpuNow = () => {
			const u = (globalThis as any).process.cpuUsage();
			return (u.user + u.system) / 1000;
		};
		const wall: number[] = [];
		const cpu: number[] = [];
		const hashes: string[] = [];
		for (let i = 0; i < NUM_CLASSES; i++) {
			const rng = new Rng(`classBench|${i}`);
			Math.random = () => rng.random();
			resetG();
			Object.assign(g, nativeFeatureNewLeagueDefaults(), {
				lid: 0,
				phase: PHASE.DRAFT_LOTTERY,
				playerTraitsSeed: 12345,
			});
			idb.league = mockIDBLeague();
			await resetCache({});
			resetArchetypeNorms();
			const season = g.get("season");
			const t0 = performance.now();
			const c0 = cpuNow();
			await draft.genPlayers(season, DEFAULT_LEVEL);
			wall.push(Math.round(performance.now() - t0));
			cpu.push(Math.round(cpuNow() - c0));
			const players = (
				await idb.cache.players.indexGetAll("playersByTid", PLAYER.UNDRAFTED)
			).toSorted((a, b) => a.pid - b.pid);
			hashes.push(hashOf(JSON.stringify(players, replacer)));
		}
		Math.random = realRandom;
		Date.now = realNow;
		if (session) {
			const { profile } = await session.post("Profiler.stop");
			writeFileSync(env.CLASS_BENCH_PROF, JSON.stringify(profile));
		}
		const sum = (xs: number[]) => xs.reduce((a, b) => a + b, 0);
		const line = `CLASS_BENCH ${JSON.stringify({ classes: NUM_CLASSES, wall: sum(wall), cpu: sum(cpu), wallPer: wall, cpuPer: cpu, hash: hashOf(hashes.join()), hashes })}`;
		console.log(line);
		if (env.CLASS_BENCH_OUT) {
			appendFileSync(env.CLASS_BENCH_OUT, `${line}\n`);
		}
	});
});
