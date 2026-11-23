import { assert, test } from "vitest";
import { FlavorSession, type FlavorHost } from "./session.ts";
import { RATING_KEYS } from "./types.ts";

/*
 * Breakout nights: a reserve (his first time on the court was a substitution) who catches fire gets the bench hot hand lines ("feeling it
 * off the bench", "they keep going to the hot hand"); a starter keeps the usual ones. Text only.
 */

const ratings = () =>
	Object.fromEntries(RATING_KEYS.map((k) => [k, 60])) as Record<string, number>;

const players = [0, 1, 2, 3].map((pid) => ({
	pid,
	name: `Player ${String.fromCharCode(65 + pid)}`,
	pos: "G",
	t: (pid % 2) as 0 | 1,
	ratings: ratings(),
}));

const play = (gid: number, shooter: number, sub: boolean) => {
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
		players,
	});
	const score: [number, number] = [0, 0];
	const onCourt: [number[], number[]] = [[0], [1]];
	const host: FlavorHost = {
		stat: () => ({ pts: 9, ast: 0, trb: 1, stl: 0, blk: 0, tov: 0, pf: 1 }),
		score: () => [score[0], score[1]],
		onCourt: (t) => onCourt[t],
	};
	const events: any[] = [];
	if (sub) {
		// Player C comes off the bench for Player A
		events.push({ type: "sub", t: 0, pids: [2], pidsOff: [0], clock: 700 });
	}
	for (let i = 0; i < 4; i++) {
		const clock = 650 - i * 40;
		events.push(
			{ type: "fgaMidRange", t: 0, pid: shooter, clock, poss: 12 },
			{ type: "fgMidRange", t: 0, pid: shooter, clock, pts: 2 },
		);
	}
	const notes: string[] = [];
	for (const [i, e] of events.entries()) {
		const { pts, ...ev } = e;
		if (ev.type === "sub") {
			onCourt[0] = [2];
		}
		if (pts) {
			score[ev.t as 0 | 1] += pts;
		}
		const r = session.describe(ev, host, events.slice(i + 1));
		if (r && r !== "silent" && r.note) {
			notes.push(r.note);
		}
	}
	return notes.join(" ");
};

test("a reserve who catches fire gets the bench lines, a starter the usual ones", () => {
	const BENCH =
		/off the bench|Instant offense|bench is giving|keep going to the hot hand|keep feeding|Ride the hot hand|running through/;
	let bench = 0;
	for (let gid = 1; gid <= 40; gid++) {
		if (BENCH.test(play(gid, 2, true))) {
			bench += 1;
		}
		assert.notMatch(play(gid, 0, false), BENCH);
	}
	assert.isAbove(bench, 20);
});
