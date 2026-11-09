import { assert, test } from "vitest";
import {
	FlavorSession,
	playersFromInitEvent,
	type FlavorHost,
	type FlavorResult,
	type FlavorStat,
} from "../../../common/pbpFlavor/index.ts";
import { SHOT_KINDS } from "../../../common/pbpFlavor/calls.ts";
import { ACTION_KINDS } from "../../../common/pbpFlavor/actions.ts";
import {
	decodePlayByPlay,
	encodePlayByPlay,
	storedInitEvent,
} from "../../../common/pbpFlavor/store.ts";
import { playsFromPbp } from "../../../common/bestPlays/topPlays.ts";
import { simulateGame } from "./simLiveGameForTests.ts";

/*
 * The play types the flavor layer derives from the sim's events (the kind of each shot, and-ones, fast breaks, second chances, buzzer
 * beaters, shot-clock beaters, heat checks, daggers), its determinism, its variety, and that a stored game reads the same.
 */

type Out = { i: number; type: string; r: FlavorResult };

// Every event through one session, keeping the box score the way the live view and the top plays do
const describeAll = (
	gid: number,
	initEvent: unknown,
	events: readonly any[],
) => {
	const session = new FlavorSession({
		gid,
		numPeriods: 4,
		quarterLength: 12,
		female: false,
		noArticle: false,
		teams: [
			{ name: "Celtics", abbrev: "BOS" },
			{ name: "Mavericks", abbrev: "DAL" },
		],
		players: playersFromInitEvent(initEvent),
	});
	const score: [number, number] = [0, 0];
	const stats = new Map<number, FlavorStat>();
	const onCourt: [Set<number>, Set<number>] = [new Set(), new Set()];
	const host: FlavorHost = {
		stat: (pid) => stats.get(pid),
		score: () => [score[0], score[1]],
		onCourt: (t) => [...onCourt[t]],
	};
	const out: Out[] = [];
	for (let i = 0; i < events.length; i++) {
		const e = events[i];
		if (e.type === "init") {
			continue;
		}
		if (e.type === "stat") {
			if (e.s === "pts") {
				score[e.t as 0 | 1] += e.amt;
			}
			if (e.pid !== undefined) {
				let s = stats.get(e.pid);
				if (!s) {
					s = {
						pts: 0,
						ast: 0,
						trb: 0,
						stl: 0,
						blk: 0,
						tov: 0,
						pf: 0,
						fg: 0,
						fga: 0,
						tp: 0,
						tpa: 0,
						ft: 0,
						fta: 0,
					};
					stats.set(e.pid, s);
				}
				const k = e.s === "orb" || e.s === "drb" ? "trb" : e.s;
				if (k in s) {
					(s as any)[k] += e.amt;
				}
				if (e.s === "gs") {
					onCourt[e.t as 0 | 1].add(e.pid);
				}
			}
			continue;
		}
		const r = session.describe(e, host, events.slice(i + 1));
		if (e.type === "sub") {
			for (const pid of e.pidsOff) {
				onCourt[e.t as 0 | 1].delete(pid);
			}
			for (const pid of e.pids) {
				onCourt[e.t as 0 | 1].add(pid);
			}
		}
		if (r && r !== "silent") {
			out.push({ i, type: e.type, r });
		}
	}
	return out;
};

const SEEDS = Array.from({ length: 30 }, (_, i) => i + 1);
let cache:
	| { seed: number; events: any[]; out: Out[]; result: any }[]
	| undefined;
const games = async () => {
	if (!cache) {
		cache = [];
		for (const seed of SEEDS) {
			const { events, result } = await simulateGame(seed);
			cache.push({
				seed,
				events,
				result,
				out: describeAll(seed, events[0], events),
			});
		}
	}
	return cache;
};

const MADE_FG =
	/^(fgAtRim|fgLowPost|fgMidRange|tp|fgPutBack|fgTipIn)(AndOne)?$/;
const THREE_KINDS = new Set([
	"three",
	"logo-three",
	"deep-three",
	"corner-three",
	"step-back-three",
	"pull-up-three",
	"catch-and-shoot-three",
	"heave",
]);
const TAGS = new Set([
	"and-one",
	"transition",
	"second-chance",
	"buzzer",
	"shot-clock",
	"heat-check",
	"clutch",
	"dagger",
	"assisted",
	"blocked",
]);

test("every shot gets a kind that matches what the sim logged, and its tags", async () => {
	const kinds = new Map<string, number>();
	const tags = new Map<string, number>();
	for (const g of await games()) {
		for (const { type, r, i } of g.out) {
			const ev = g.events[i];
			for (const t of r.tags ?? []) {
				assert.isTrue(TAGS.has(t), `tag ${t}`);
				tags.set(t, (tags.get(t) ?? 0) + 1);
			}
			if (!MADE_FG.test(type)) {
				continue;
			}
			const shot = r.shot!;
			assert.include(SHOT_KINDS, shot, `${type}: ${r.text}`);
			kinds.set(shot, (kinds.get(shot) ?? 0) + 1);
			const three = type.startsWith("tp");
			// (a deep two logged as a three-point-line fake is a two)
			if (three) {
				assert.isTrue(
					THREE_KINDS.has(shot) || shot === "deep-two",
					`${type} as ${shot}: ${r.text}`,
				);
			} else {
				assert.isFalse(THREE_KINDS.has(shot), `${type} as ${shot}: ${r.text}`);
			}
			if (type.startsWith("fgLowPost")) {
				assert.include(
					[
						"hook",
						"post-move",
						"fadeaway",
						"layup",
						"alley-oop",
						"deep-two",
						// (a shot right after his own offensive rebound reads as a putback)
						"putback",
						"putback-dunk",
						"tip-in",
					],
					shot,
					r.text,
				);
			}
			if (type.startsWith("fgPutBack")) {
				assert.include(["putback", "putback-dunk", "tip-in"], shot, r.text);
			}
			assert.strictEqual(
				(r.tags ?? []).includes("and-one"),
				type.endsWith("AndOne"),
				r.text,
			);
			assert.strictEqual(
				(r.tags ?? []).includes("assisted"),
				ev.pidAst !== undefined,
				r.text,
			);
		}
	}
	// the kinds a season of games is made of all show up in 30 games
	for (const k of [
		"layup",
		"dunk",
		"floater",
		"hook",
		"post-move",
		"fadeaway",
		"pull-up",
		"jumper",
		"corner-three",
		"step-back-three",
		"pull-up-three",
		"catch-and-shoot-three",
		"three",
	]) {
		assert.isAbove(
			kinds.get(k) ?? 0,
			0,
			`no ${k} in 30 games ${JSON.stringify([...kinds])}`,
		);
	}
	for (const t of [
		"and-one",
		"transition",
		"second-chance",
		"shot-clock",
		"heat-check",
		"clutch",
		"assisted",
		"blocked",
	]) {
		assert.isAbove(tags.get(t) ?? 0, 0, `no ${t} tag in 30 games`);
	}
}, 120_000);

test("the same game reads the same, with the same play types; the events are left as they were", async () => {
	const { events } = await simulateGame(9);
	const before = structuredClone(events);
	const a = describeAll(9, events[0], events);
	const b = describeAll(9, events[0], events);
	assert.deepStrictEqual(a, b);
	assert.deepStrictEqual(events, before);
	// another game id words the same events differently
	const c = describeAll(10, events[0], events);
	assert.notDeepEqual(
		a.map((x) => x.r.text),
		c.map((x) => x.r.text),
	);
}, 120_000);

test("a shot phrase doesn't come back within a few shots", async () => {
	const key = (t: string) =>
		t
			.replaceAll(/\([^)]*\)/g, "")
			.replaceAll(/[A-Z][\w'.-]*( [A-Z][\w'.-]*)*/g, "N")
			.replaceAll(/\d+/g, "#");
	const N = 5;
	let shots = 0;
	let repeats = 0;
	const examples: string[] = [];
	for (const g of await games()) {
		const recent: string[] = [];
		for (const { type, r } of g.out) {
			if (!MADE_FG.test(type) && !/^(miss|blk)/.test(type)) {
				continue;
			}
			shots += 1;
			const k = key(r.text);
			if (recent.includes(k)) {
				repeats += 1;
				examples.push(r.text);
			}
			recent.push(k);
			if (recent.length > N) {
				recent.shift();
			}
		}
	}
	assert.isAbove(shots, 3000);
	assert.deepStrictEqual(examples, [], `${repeats} repeats in ${shots} shots`);
}, 120_000);

test("a stored game decodes and reads exactly as the live events do", async () => {
	for (const g of (await games()).slice(0, 5)) {
		const { players, events: decoded } = decodePlayByPlay(
			encodePlayByPlay(g.events),
		);
		const init = storedInitEvent(
			players,
			[0, 1].map((t) => ({
				players: g.result.team[t].player.map((p: any) => ({
					pid: p.id,
					name: p.name,
					pos: p.pos,
				})),
			})) as any,
		);
		const live = describeAll(g.seed, g.events[0], g.events).map((x) => x.r);
		const stored = describeAll(g.seed, init, decoded).map((x) => x.r);
		assert.deepStrictEqual(stored, live, `seed ${g.seed}`);
	}
}, 120_000);

test("top plays use the derived play types", async () => {
	const labels = new Set<string>();
	for (const g of await games()) {
		const gm = {
			gid: g.seed,
			season: 2025,
			teams: [0, 1].map((i) => ({
				name: ["Celtics", "Mavericks"][i]!,
				abbrev: ["BOS", "DAL"][i]!,
				pts: g.result.team[i].stat.pts,
				players: [],
			})) as any,
		};
		for (const p of playsFromPbp(gm, g.events[0], g.events)) {
			labels.add(p.label);
			for (const t of p.tags) {
				labels.add(t);
			}
		}
	}
	for (const l of ["Dunk", "Shot-clock beater", "And-one", "Block", "Steal"]) {
		assert.isTrue(labels.has(l), `no ${l} top play in 30 games`);
	}
}, 120_000);

test("the sets, moves, turnovers, steals and rebounds get their own kinds, and every line fills in", async () => {
	const BAD = /undefined|NaN|\bnull\b|\[object|\${|[{}]| {2}/;
	const actions = new Map<string, number>();
	let lines = 0;
	for (const g of await games()) {
		for (const { r } of g.out) {
			lines += 1;
			assert.notMatch(r.text, BAD, r.text);
			if (r.note) {
				assert.notMatch(r.note, BAD, r.note);
			}
			if (r.action) {
				assert.include(ACTION_KINDS, r.action, r.text);
				actions.set(r.action, (actions.get(r.action) ?? 0) + 1);
			}
		}
	}
	assert.isAbove(lines, 10_000);
	for (const a of [
		"pick-and-roll",
		"isolation",
		"post-up",
		"drive-and-kick",
		"off-ball-screen",
		"handoff",
		"euro-step",
		"spin-move",
		"crossover",
		"up-and-under",
		"charge-taken",
		"travel",
		"loose-ball",
		"deflection",
		"interception",
		"box-out",
		"leak-out",
	]) {
		assert.isAbove(actions.get(a) ?? 0, 0, `no ${a} in 30 games`);
	}
}, 120_000);

test("the new kinds of plays reach the top plays", async () => {
	const kinds = new Set<string>();
	for (const g of await games()) {
		const gm = {
			gid: g.seed,
			season: 2025,
			teams: [0, 1].map((i) => ({
				name: ["Celtics", "Mavericks"][i]!,
				abbrev: ["BOS", "DAL"][i]!,
				pts: g.result.team[i].stat.pts,
				players: [],
			})) as any,
		};
		for (const p of playsFromPbp(gm, g.events[0], g.events)) {
			kinds.add(p.kind);
			if (p.kind === "charge") {
				// (the play belongs to the defender who drew the charge)
				const ev = g.events.find(
					(e: any) => e.type === "tov" && e.t !== p.t && p.clock !== undefined,
				);
				assert.isDefined(ev);
				assert.isDefined(p.pid);
			}
		}
	}
	for (const k of ["charge", "spinMove", "euroStep", "hustle"]) {
		assert.isTrue(kinds.has(k), `no ${k} top play in 30 games`);
	}
}, 120_000);
