import { describe, expect, test } from "vitest";
import {
	seedsComparable,
	seriesEndNote,
	seriesRecap,
	type RecapGame,
} from "./index.ts";

const line = (pid: number, pts: number) => ({
	pid,
	name: `P${pid}`,
	min: 30,
	pts,
	trb: 5,
	ast: 3,
	stl: 1,
	blk: 0,
	tov: 2,
	fg: Math.round(pts / 2.5),
	fga: Math.round(pts / 2),
	ft: 2,
	fta: 3,
});

// homeTid 0 (seed 1) vs awayTid 1 (seed 8); w: winner tid of each game
const game = (gid: number, w: number, margin: number, qDown = 0): RecapGame => {
	const winPts = 100 + margin;
	const t0pts = w === 0 ? winPts : 100;
	const t1pts = w === 1 ? winPts : 100;
	const q = (pts: number, lead: number) => [25 + lead, 25, 25, pts - 75 - lead];
	return {
		gid,
		overtimes: margin === 1 ? 1 : 0,
		clutchPlays: gid === 7 ? ["<a>P10</a> hit the game-winner"] : undefined,
		teams: [
			{
				tid: 0,
				pts: t0pts,
				ptsQtrs: q(t0pts, w === 1 ? qDown : 0),
				players: [line(1, 20), line(2, 10)],
			},
			{
				tid: 1,
				pts: t1pts,
				ptsQtrs: q(t1pts, w === 0 ? qDown : 0),
				players: [line(10, 30), line(11, 12)],
			},
		],
	};
};

describe("series recap", () => {
	test("comeback from down 3-1, upset, MVP, turning points", () => {
		const games = [
			game(1, 0, 10),
			game(2, 0, 5),
			game(3, 1, 3),
			game(4, 0, 20),
			game(5, 1, 1, 10),
			game(6, 1, 4),
			game(7, 1, 2),
		];
		const r = seriesRecap(
			{
				season: 2030,
				round: 0,
				numRounds: 4,
				roundName: "First round",
				home: { tid: 0, seed: 1, won: 3 },
				away: { tid: 1, seed: 8, won: 4 },
				numToWin: 4,
				games,
			},
			(tid) => `T${tid}`,
		);
		expect(r.complete).toBe(true);
		expect(r.winner.tid).toBe(1);
		expect(r.upset).toBe(true);
		expect(r.distance).toBe(true);
		expect(r.comeback).toEqual([1, 3]);
		expect(r.headline).toBe("T1 rally from down 3-1 to beat the T0");
		expect(r.games.at(-1)).toMatchObject({ wWins: 4, lWins: 3 });
		expect(r.mvp?.pid).toBe(10);
		const kinds = r.turningPoints.map((t) => t.kind);
		expect(kinds).toContain("biggestWin");
		expect(kinds).toContain("comebackGame");
		expect(kinds).toContain("overtime");
		expect(kinds).toContain("closeout");
		expect(r.turningPoints.find((t) => t.kind === "clutch")!.text).toBe(
			"Game 7: P10 hit the game-winner",
		);
		expect(r.text[0]).toBe(
			"The No. 8 T1 beat the No. 1 T0 4-3 in the 2030 First round.",
		);
	});

	test("sweep and series in progress", () => {
		const base = {
			season: 2030,
			round: 3,
			numRounds: 4,
			roundName: "Finals",
			numToWin: 4,
		};
		const sweep = seriesRecap(
			{
				...base,
				home: { tid: 0, seed: 1, won: 4 },
				away: { tid: 1, seed: 2, won: 0 },
				games: [game(1, 0, 3), game(2, 0, 4), game(3, 0, 5), game(4, 0, 6)],
			},
			(tid) => `T${tid}`,
		);
		expect(sweep.sweep).toBe(true);
		expect(sweep.finals).toBe(true);
		expect(sweep.headline).toBe("T0 sweep the T1");
		const live = seriesRecap(
			{
				...base,
				home: { tid: 0, seed: 1, won: 1 },
				away: { tid: 1, seed: 2, won: 2 },
				games: [game(1, 0, 3), game(2, 1, 4), game(3, 1, 5)],
			},
			(tid) => `T${tid}`,
		);
		expect(live.complete).toBe(false);
		expect(live.headline).toBe("T1 lead the T0 2-1");
		expect(live.comeback).toBe(null);
	});

	test("news note", () => {
		expect(
			seriesEndNote({ seed: 2, won: 4 }, { seed: 3, won: 3 }, [
				false,
				false,
				false,
				true,
				true,
				true,
				true,
			]),
		).toBe("They came back from down 3-0.");
		expect(
			seriesEndNote({ seed: 7, won: 4 }, { seed: 2, won: 1 }, [
				true,
				true,
				false,
				true,
				true,
			]),
		).toBe("An upset: the No. 7 seed knocked out No. 2.");
		expect(seriesEndNote({ seed: 1, won: 4 }, { seed: 8, won: 0 }, [])).toBe(
			"A sweep.",
		);
	});

	test("news note: unknown game order leaves the comeback out, keeps what the bracket proves", () => {
		// Down 3-1 and came back, but a box score is missing: no comeback claimed, no false sweep or upset either
		expect(seriesEndNote({ seed: 2, won: 4 }, { seed: 3, won: 3 }, null)).toBe(
			"",
		);
		expect(seriesEndNote({ seed: 7, won: 4 }, { seed: 2, won: 3 }, null)).toBe(
			"An upset: the No. 7 seed knocked out No. 2.",
		);
		expect(seriesEndNote({ seed: 1, won: 4 }, { seed: 8, won: 0 }, null)).toBe(
			"A sweep.",
		);
	});
});

describe("seedsComparable", () => {
	test("by conference: only within a conference", () => {
		expect(seedsComparable({ cid: 0 }, { cid: 0 }, 2)).toBe(true);
		// Finals between conference champions
		expect(seedsComparable({ cid: 0 }, { cid: 1 }, 2)).toBe(false);
	});

	test("not by conference: one seeding, whatever the conferences", () => {
		expect(seedsComparable({ cid: 0 }, { cid: 1 }, false)).toBe(true);
		expect(seedsComparable({ cid: 3 }, { cid: 3 }, false)).toBe(true);
	});

	test("college national tournament: national seed lines, athletic conference cids", () => {
		// The bracket is stored with byConf false, and the teams' cids are their (different) athletic conferences
		expect(seedsComparable({ cid: 4 }, { cid: 17 }, false)).toBe(true);
	});

	test("news note and recap page agree", () => {
		const home = { tid: 0, cid: 0, seed: 1, won: 1 };
		const away = { tid: 1, cid: 1, seed: 5, won: 4 };
		for (const byConf of [false, 2] as const) {
			const comparable = seedsComparable(home, away, byConf);
			const recap = seriesRecap(
				{
					season: 2025,
					round: 1,
					numRounds: 4,
					roundName: "Second Round",
					home,
					away,
					numToWin: 4,
					seedsComparable: comparable,
					games: [],
				},
				(tid) => `T${tid}`,
			);
			const note = seriesEndNote(away, home, [], comparable);
			expect(recap.upset).toBe(byConf === false);
			expect(note.startsWith("An upset")).toBe(byConf === false);
		}
	});
});
