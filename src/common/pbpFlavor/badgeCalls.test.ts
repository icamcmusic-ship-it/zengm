import { assert, test } from "vitest";
import { StoryNotes } from "./story.ts";
import { decodePlayByPlay, encodePlayByPlay } from "./store.ts";
import type { FPlayer } from "./types.ts";

/*
 * 2K badge calls: the badges' tiers the user sees ride along with the ratings (loadTeams, PBP_BADGE_KEYS), and a call names one only when
 * the play is what it is about, now and then, once (or twice for blocks) a game.
 */
const player = (pid: number, t: 0 | 1, name: string): FPlayer =>
	({ pid, t, name, pos: pid === 3 ? "C" : "G", R: {} }) as any;
const PLAYERS = [
	player(1, 0, "Al Shooter"),
	player(2, 0, "Bo Plain"),
	player(3, 1, "Cy Center"),
	player(4, 1, "Di Guard"),
];

const notes = (ratings: Record<number, Record<string, number>>) =>
	new StoryNotes(
		7,
		PLAYERS.map((p) => ({ pid: p.pid, ratings: ratings[p.pid] })),
		{ female: false },
	);

const env = (idx: number, ev: any, res: any) => ({
	idx,
	ev,
	res,
	pl: (pid: number) => PLAYERS.find((p) => p.pid === pid)!,
	floor: (t: 0 | 1) => PLAYERS.filter((p) => p.t === t),
	stat: () => ({ pts: 10, ast: 0, tov: 0 }),
	the: (t: 0 | 1) => (t === 0 ? "the Celtics" : "the Mavericks"),
	score: [50, 50] as [number, number],
	period: 2,
	numPeriods: 4,
	clock: 300,
	pendingShooter: undefined,
	run: { t: undefined, S: 0 },
});

// The same play many times (spaced out, so the call has room), and the notes it got
const run = (
	s: StoryNotes,
	ev: any,
	res: () => any,
	n = 60,
): { notes: string[]; texts: string[] } => {
	const out: string[] = [];
	const texts: string[] = [];
	for (let i = 0; i < n; i++) {
		const r = res();
		s.check(env(100 + i * 10, ev, r) as any);
		out.push(r.note ?? "");
		texts.push(r.text);
	}
	return { notes: out.filter(Boolean), texts };
};

test("Limitless Range: only on a deep three, by a player who has the badge, with the line's own distance, once", () => {
	const deep = () => ({
		text: "Al Shooter pulls up from 30 feet and hits",
		shot: "deep-three",
		tags: [],
	});
	const s = notes({ 1: { btLim: 3 } });
	const withBadge = run(s, { type: "tp", t: 0, pid: 1 }, deep);
	const lim = withBadge.notes.filter((n) => /Limitless Range/.test(n));
	assert.strictEqual(lim.length, 1);
	assert.include(lim[0], "30 feet");

	// no badge, or not a deep three: never
	const s2 = notes({ 1: { btLim: 3 } });
	const notDeep = run(s2, { type: "tp", t: 0, pid: 1 }, () => ({
		text: "Al Shooter hits from the corner",
		shot: "corner-three",
		tags: ["assisted"],
	}));
	assert.isFalse(notDeep.notes.some((n) => /Limitless/.test(n)));
	const s3 = notes({});
	const noBadge = run(s3, { type: "tp", t: 0, pid: 1 }, deep);
	assert.isFalse(noBadge.notes.some((n) => /Limitless/.test(n)));
});

test("Rim Protector: from his second block at the rim, not on a block of a jumper, at most twice", () => {
	const s = notes({ 3: { btRim: 2 } });
	const rim = run(s, { type: "blkAtRim", t: 1, pid: 3 }, () => ({
		text: "Cy Center blocks it",
	}));
	const calls = rim.notes.filter((n) => /Rim Protector/.test(n));
	assert.isAtLeast(calls.length, 1);
	assert.isAtMost(calls.length, 2);
	assert.strictEqual(new Set(calls).size, calls.length, "no line twice");

	const s2 = notes({ 3: { btRim: 2 } });
	const jumpers = run(s2, { type: "blkMidRange", t: 1, pid: 3 }, () => ({
		text: "Cy Center blocks the jumper",
	}));
	assert.isFalse(jumpers.notes.some((n) => /Rim Protector/.test(n)));

	// a single block at the rim is not "again"
	const s3 = notes({ 3: { btRim: 2 } });
	const once = run(
		s3,
		{ type: "blkAtRim", t: 1, pid: 3 },
		() => ({ text: "x" }),
		1,
	);
	assert.lengthOf(once.notes, 0);
});

test("the badge tiers are stored with the play-by-play", () => {
	const events = [
		{
			type: "init",
			boxScore: [
				{ player: [{ id: 1, pbpRatings: { hgt: 50, btLim: 3 } }] },
				{ player: [{ id: 3, pbpRatings: { hgt: 70, btRim: 2, btDead: 1 } }] },
			],
		},
	];
	const { players } = decodePlayByPlay(encodePlayByPlay(events as any));
	assert.strictEqual(players[0]!.ratings!["btLim"], 3);
	assert.isUndefined(players[0]!.ratings!["btRim"]);
	assert.strictEqual(players[1]!.ratings!["btRim"], 2);
	assert.strictEqual(players[1]!.ratings!["btDead"], 1);
});
