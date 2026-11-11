import { assert, test, vi } from "vitest";

// (whole simulated games: slow when the machine is busy)
vi.setConfig({ testTimeout: 120_000 });
import { makeCareer } from "../../../common/pbpFlavor/career.ts";
import { EXTRA_KEYS } from "../../../common/pbpFlavor/story.ts";
import { makeSeededRandom } from "../../../common/random.ts";
import { describeGame, simulateGame } from "./simLiveGameForTests.ts";

/*
 * Storylines in real simulated games (common/pbpFlavor/story.ts): the sim's events are made once, then worded with made-up standings,
 * expanded ratings, traits, former teams and debuts. Every call is checked against what it claims; the rest of the text is the same with or
 * without the data; a game without it makes no calls; the same game always reads the same; nothing is left unfilled.
 */

const games: Awaited<ReturnType<typeof simulateGame>>[] = [];
for (const seed of [51, 52, 53, 54, 55, 56, 57, 58, 59, 60]) {
	games.push(await simulateGame(seed));
}

const withStory = (game: (typeof games)[number]) => {
	const events = structuredClone(game.events);
	const random = makeSeededRandom(game.seed * 389);
	const int = (lo: number, hi: number) =>
		lo + Math.floor(random() * (hi - lo + 1));
	const streak = int(-6, 6);
	events[0].boxScore[0].pbpGame = [
		int(10, 40),
		int(10, 40),
		streak,
		int(1, 30),
		30,
		0,
		int(10, 40),
		int(10, 40),
		-streak,
		int(1, 30),
		30,
		0,
	];
	for (const team of events[0].boxScore) {
		for (const [i, p] of team.player.entries()) {
			const extra: Record<string, number> = {};
			for (const key of EXTRA_KEYS) {
				if (key !== "former") {
					extra[key] = int(40, 95);
				}
			}
			if (int(0, 6) === 0) {
				extra.former = 1;
			}
			p.pbpRatings = { ...p.pbpRatings, ...extra };
			// a rookie in his first game, now and then
			if (i >= 8 && int(0, 5) === 0) {
				p.pbpCareer = makeCareer({
					rookie: true,
					gp: 0,
					gpSeason: 0,
					td: 0,
					age: 20,
					high: {},
					seasonHigh: {},
					total: {},
				});
			}
		}
	}
	return events;
};

const BAD = /undefined|NaN|\${|\[object|null|\binfinity\b|\s{2,}|\s[,.]/;

test("storyline calls are true, and the rest of the text is unchanged", () => {
	const counts = new Map<string, number>();
	const samples: string[] = [];
	for (const game of games) {
		for (const playoffs of [false, true]) {
			const events = withStory(game);
			const ratingsOf = new Map<number, Record<string, number>>();
			for (const team of events[0].boxScore) {
				for (const p of team.player) {
					ratingsOf.set(p.id, p.pbpRatings);
				}
			}
			const plain = structuredClone(events);
			delete plain[0].boxScore[0].pbpGame;
			for (const team of plain[0].boxScore) {
				for (const p of team.player) {
					for (const key of EXTRA_KEYS) {
						delete p.pbpRatings[key];
					}
					delete p.pbpCareer;
				}
			}
			const a = describeGame(game.seed, events[0], events, { playoffs });
			const b = describeGame(game.seed, plain[0], plain, { playoffs });
			// the same game reads the same
			const again = describeGame(game.seed, events[0], events, { playoffs });
			assert.deepStrictEqual(
				again.out.map((x) => x.r),
				a.out.map((x) => x.r),
			);
			assert.strictEqual(b.session.storyCalls().length, 0);
			assert.strictEqual(a.out.length, b.out.length);
			for (const [i, x] of a.out.entries()) {
				const y = b.out[i]!;
				// (career calls are made from the career numbers, which the plain game doesn't have: only the story is compared here, so the
				// texts must match and the notes may only gain sentences)
				assert.strictEqual(x.r.text, y.r.text, `seed ${game.seed} #${i}`);
				const note = x.r.note ?? "";
				assert.notMatch(note, BAD, note);
			}
			for (const call of a.session.storyCalls()) {
				counts.set(call.kind, (counts.get(call.kind) ?? 0) + 1);
				const x = a.out.find((o) => o.idx === call.idx);
				assert.isDefined(x, call.kind);
				const r = call.pid === undefined ? undefined : ratingsOf.get(call.pid);
				const box = call.pid === undefined ? undefined : x!.box.get(call.pid);
				if (samples.length < 60 && x!.r.note) {
					samples.push(`[${call.kind}] ${x!.r.note}`);
				}
				switch (call.kind) {
					case "standing":
						assert.isFalse(playoffs);
						break;
					case "former":
					case "formerPays":
						assert.strictEqual(r?.former, 1);
						if (call.kind === "formerPays") {
							assert.isAtLeast(box!.pts, 20);
						}
						break;
					case "debut":
						assert.isFalse(playoffs);
						break;
					case "catchShoot":
						assert.isAtLeast(r!.csh!, 70);
						assert.include(x!.r.tags ?? [], "assisted");
						break;
					case "pullUp":
						assert.isAtLeast(r!.dsh!, 70);
						assert.notInclude(x!.r.tags ?? [], "assisted");
						break;
					case "oreb":
						assert.strictEqual(x!.type, "orb");
						assert.isAtLeast(r!.oreb!, 68);
						break;
					case "length":
						assert.isAtLeast(r!.wng!, 72);
						break;
					case "lockdown":
						assert.isAtLeast(r!.pdef!, 72);
						break;
					case "wall":
						assert.isAtLeast(r!.idef!, 72);
						break;
					case "switch":
						assert.isAtLeast(r!.defensiveVersatility!, 70);
						break;
					case "motor":
						assert.isAtLeast(r!.motor!, 75);
						assert.isAtLeast(x!.period, 4);
						break;
					case "secure":
						assert.isAtLeast(r!.bsc!, 65);
						assert.isAtLeast(box!.ast, 7);
						assert.strictEqual(box!.tov, 0);
						break;
					case "leader":
						assert.isAtLeast(r!.leadership!, 75);
						break;
					case "bigGame":
						assert.isTrue(playoffs);
						assert.isAtLeast(r!.bigGame!, 75);
						break;
					case "closer":
						assert.isAtLeast(r!.clutch!, 75);
						assert.isAtLeast(x!.period, 4);
						break;
					case "garbage":
					case "benchMob":
						assert.isAtLeast(x!.period, 4);
						break;
				}
			}
		}
	}
	console.log(
		`storyline calls over ${games.length * 2} games: ${[...counts].map(([k, n]) => `${k} ${n}`).join(", ")}\n${samples.join("\n")}`,
	);
	for (const kind of ["standing", "former", "catchShoot", "oreb", "lockdown"]) {
		assert.isAbove(counts.get(kind) ?? 0, 0, kind);
	}
});
