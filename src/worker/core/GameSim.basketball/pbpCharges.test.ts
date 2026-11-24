import { afterEach, assert, test } from "vitest";
import { local } from "../../../ui/util/local.ts";
import processLiveGameEvents from "../../../ui/util/processLiveGameEvents.basketball.tsx";
import {
	makeLiveBoxScore,
	nodeToText,
	simulateGame as simulateGameWith,
} from "./simLiveGameForTests.ts";

/*
 * Charges (the sim's offFoul events) in the play-by-play: the line shows the foul count including this foul and the possession indicator
 * flips, with the flavor text on and off. An ordinary turnover (tov event, no personal foul) is never worded as a charge or offensive foul.
 * And the live processor's state is per box score, so two games processed in turn read the same as each processed alone.
 */

const SEEDS = [1, 2, 3, 4, 5, 6, 7, 8];

afterEach(() => {
	local.setState({ featurePbpFlavor: true } as any);
});

// A game with Game Sim Fixes on (the charges come from there)
const simulateGame = (seed: number) =>
	simulateGameWith(seed, { simFixes: true });

const FOUL_WORDS =
	/charge|offensive foul|illegal screen|moving screen|push-off|shoves off/i;

// Every worded line with the event behind it
const play = (events: any[], box: any) => {
	const out: { ev: any; text: string; possession: any }[] = [];
	let overtimes = 0;
	let quarters: string[] = [];
	while (events.length > 0) {
		const o = processLiveGameEvents({
			events,
			boxScore: box,
			overtimes,
			quarters,
		});
		overtimes = o.overtimes;
		quarters = o.quarters;
		if (o.text !== undefined && o.event) {
			out.push({
				ev: o.event,
				text: nodeToText(o.text).split("\n")[0]!,
				possession: box.possession,
			});
		}
	}
	return out;
};

const pfOf = (box: any, pid: number) => {
	for (const t of box.teams) {
		for (const p of t.players) {
			if (p.pid === pid) {
				return p.pf as number;
			}
		}
	}
	throw new Error(`no player ${pid}`);
};

for (const flavor of [true, false]) {
	test(`charges show the foul count with this foul and flip possession (${flavor ? "flavor" : "stock"} text)`, async () => {
		local.setState({ featurePbpFlavor: flavor } as any);
		let charges = 0;
		let tovs = 0;
		for (const seed of SEEDS) {
			const { result, events } = await simulateGame(seed);

			// the sim records the foul before it logs the charge
			for (let i = 0; i < events.length; i++) {
				const e = events[i];
				if (e.type !== "offFoul") {
					continue;
				}
				let j = i - 1;
				let found = false;
				while (j >= 0 && events[j].type === "stat") {
					if (events[j].s === "pf" && events[j].pid === e.pid) {
						found = true;
					}
					j -= 1;
				}
				assert.isTrue(found, `seed ${seed}: pf stat before offFoul`);
			}

			const box: any = makeLiveBoxScore(result, seed);
			const queue = events.slice();
			let overtimes = 0;
			let quarters: string[] = [];
			while (queue.length > 0) {
				const o = processLiveGameEvents({
					events: queue,
					boxScore: box,
					overtimes,
					quarters,
				});
				overtimes = o.overtimes;
				quarters = o.quarters;
				const ev: any = o.event;
				if (o.text === undefined || !ev) {
					continue;
				}
				const text = nodeToText(o.text).split("\n")[0]!;
				const where = `seed ${seed}: "${text}"`;
				if (ev.type === "offFoul") {
					charges += 1;
					const pf = pfOf(box, ev.pid);
					assert.isAtLeast(pf, 1, where);
					assert.match(
						text,
						flavor
							? new RegExp(String.raw`\bP${pf}\b`)
							: new RegExp(String.raw`\(${pf} PF\)`),
						where,
					);
					assert.strictEqual(box.possession, ev.t === 0 ? 1 : 0, where);
					if (flavor) {
						assert.match(text, /charge|offensive foul/i, where);
					}
				} else if (ev.type === "tov") {
					tovs += 1;
					assert.notMatch(text, FOUL_WORDS, where);
				}
			}
		}
		assert.isAbove(charges, 0, "no charges in these games");
		assert.isAbove(tovs, 0);
	});
}

test("the live processor's state is per box score", async () => {
	local.setState({ featurePbpFlavor: true } as any);
	const a = await simulateGame(3);
	const b = await simulateGame(4);
	const aloneA = play(a.events.slice(), makeLiveBoxScore(a.result, 3));
	const aloneB = play(b.events.slice(), makeLiveBoxScore(b.result, 4));

	// one event batch of each in turn, as a stored game's play-by-play built while a live game runs would
	const boxA: any = makeLiveBoxScore(a.result, 3);
	const boxB: any = makeLiveBoxScore(b.result, 4);
	const qA = a.events.slice();
	const qB = b.events.slice();
	const textsA: string[] = [];
	const textsB: string[] = [];
	const step = (q: any[], box: any, texts: string[]) => {
		const o = processLiveGameEvents({
			events: q,
			boxScore: box,
			overtimes: 0,
			quarters: [],
		});
		if (o.text !== undefined && o.event) {
			texts.push(nodeToText(o.text).split("\n")[0]!);
		}
	};
	while (qA.length > 0 || qB.length > 0) {
		if (qA.length > 0) {
			step(qA, boxA, textsA);
		}
		if (qB.length > 0) {
			step(qB, boxB, textsB);
		}
	}
	assert.deepStrictEqual(
		textsA,
		aloneA.map((l) => l.text),
	);
	assert.deepStrictEqual(
		textsB,
		aloneB.map((l) => l.text),
	);
});

test("a substitution or stat for a player missing from the box score doesn't stop the feed", async () => {
	local.setState({ featurePbpFlavor: false } as any);
	const { result, events } = await simulateGame(5);
	const box: any = makeLiveBoxScore(result, 5);
	// drop a bench player from the box score
	const sub = events.find((e) => e.type === "sub");
	assert.ok(sub);
	const pid = sub.pids[0];
	for (const t of box.teams) {
		t.players = t.players.filter((p: any) => p.pid !== pid);
	}
	assert.doesNotThrow(() => play(events.slice(), box));
});
