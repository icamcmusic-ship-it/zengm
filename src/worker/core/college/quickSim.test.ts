// College mode quick sim (quickSim.ts): calibration bounds against the full game sim, and box scores that add up. The targets are the full
// sim's numbers on a full-size college league (docs/college-mode.md, Quick sim): stronger team's win rate by strength gap, points per
// team, the spread of margins and the home edge.
import { assert, beforeAll, describe, test } from "vitest";
import { makeSeededRandom } from "../../../common/random.ts";
import { g } from "../../util/index.ts";
import { resetG } from "../../../test/helpers.ts";
import {
	QS,
	quickSimGame,
	type QuickPlayer,
	type QuickTeam,
} from "./quickSim.ts";

const COMPOSITES = [
	"usage",
	"passing",
	"turnovers",
	"shootingAtRim",
	"shootingLowPost",
	"shootingMidRange",
	"shootingThreePointer",
	"shootingFT",
	"rebounding",
	"stealing",
	"blocking",
	"fouling",
	"drawingFouls",
	"endurance",
] as const;

let nextPid = 0;
const makeTeam = (id: number, strength: number): QuickTeam => {
	const player: QuickPlayer[] = [];
	for (let i = 0; i < 13; i++) {
		const c: Record<string, number> = {};
		for (const key of COMPOSITES) {
			c[key] = 0.25 + 0.3 * Math.random();
		}
		player.push({
			id: nextPid,
			pid: nextPid++,
			name: `P ${i}`,
			pos: "G",
			age: 20,
			jerseyNumber: "1",
			skills: [],
			injury: { type: "Healthy", gamesRemaining: 0, playingThrough: false },
			injured: false,
			ptModifier: 1,
			ovr: 50 - 2 * i,
			c: c as QuickPlayer["c"],
			stat: {},
		});
	}
	return {
		id,
		cid: 0,
		did: 0,
		won: 0,
		lost: 0,
		ovr: 50,
		strength,
		player,
		stat: {},
		rotation: player,
	};
};

// Fresh stat objects for each game
const resetStats = (t: QuickTeam) => {
	for (const p of t.player) {
		p.stat = Object.fromEntries(
			[
				"gp",
				"gs",
				"min",
				"fg",
				"fga",
				"fgAtRim",
				"fgaAtRim",
				"fgLowPost",
				"fgaLowPost",
				"fgMidRange",
				"fgaMidRange",
				"tp",
				"tpa",
				"ft",
				"fta",
				"pm",
				"orb",
				"drb",
				"ast",
				"tov",
				"stl",
				"blk",
				"ba",
				"pf",
				"pts",
			].map((key) => [key, 0]),
		);
		p.injured = false;
		p.newInjury = undefined;
	}
	t.stat = Object.fromEntries(
		[
			"min",
			"fg",
			"fga",
			"fgAtRim",
			"fgaAtRim",
			"fgLowPost",
			"fgaLowPost",
			"fgMidRange",
			"fgaMidRange",
			"tp",
			"tpa",
			"ft",
			"fta",
			"orb",
			"drb",
			"ast",
			"tov",
			"stl",
			"blk",
			"ba",
			"pf",
			"pts",
		].map((key) => [key, 0]),
	);
};

const play = (home: QuickTeam, away: QuickTeam, neutralSite: boolean) => {
	resetStats(home);
	resetStats(away);
	return quickSimGame({ gid: 0, day: 1, home, away, neutralSite });
};

describe("college quick sim", () => {
	beforeAll(() => {
		resetG();
		Object.assign(g, {
			numPeriods: 2,
			quarterLength: 20,
			overtimeLength: 5,
			foulsNeededToFoulOut: 5,
			pace: 88,
			homeCourtAdvantage: 1,
		});
		Math.random = makeSeededRandom(5);
	});

	// Full sim (full level, one season): win rate of the stronger team by strength gap, both sites pooled
	test("win probability by strength gap", { timeout: 120_000 }, () => {
		const N = 3000;
		for (const { gap, lo, hi } of [
			{ gap: 1, lo: 0.47, hi: 0.57 },
			{ gap: 3.5, lo: 0.55, hi: 0.65 },
			{ gap: 7.5, lo: 0.66, hi: 0.76 },
			{ gap: 12.5, lo: 0.79, hi: 0.88 },
			{ gap: 25, lo: 0.95, hi: 1 },
		]) {
			let wins = 0;
			for (let i = 0; i < N; i++) {
				const strong = makeTeam(1, -40 + gap / 2);
				const weak = makeTeam(2, -40 - gap / 2);
				const strongHome = i % 2 === 0;
				const result = strongHome
					? play(strong, weak, i % 4 === 0)
					: play(weak, strong, i % 4 === 1);
				const s = strongHome ? 0 : 1;
				if (result.team[s].stat.pts > result.team[1 - s].stat.pts) {
					wins += 1;
				}
			}
			const p = wins / N;
			assert.isAtLeast(p, lo, `gap ${gap}`);
			assert.isAtMost(p, hi, `gap ${gap}`);
		}
	});

	test(
		"points, margins, home edge and box scores",
		{ timeout: 120_000 },
		() => {
			const N = 3000;
			const pts: number[] = [];
			const margins: number[] = [];
			let homeMargin = 0;
			let neutralMargin = 0;
			let overtimes = 0;
			for (let i = 0; i < N; i++) {
				const home = makeTeam(1, -40);
				const away = makeTeam(2, -40);
				const neutral = i % 2 === 1;
				const result = play(home, away, neutral);
				const [h, a] = result.team;
				pts.push(h.stat.pts, a.stat.pts);
				margins.push(h.stat.pts - a.stat.pts);
				if (neutral) {
					neutralMargin += h.stat.pts - a.stat.pts;
				} else {
					homeMargin += h.stat.pts - a.stat.pts;
				}
				if (result.overtimes > 0) {
					overtimes += 1;
				}
				assert.notStrictEqual(h.stat.pts, a.stat.pts, "no ties");
				const gameMinutes = 40 + 5 * result.overtimes;
				for (const t of result.team) {
					let ptsSum = 0;
					let minSum = 0;
					for (const p of t.player) {
						const s = p.stat;
						ptsSum += s.pts;
						minSum += s.min;
						assert.isAtMost(s.fg, s.fga);
						assert.isAtMost(s.tp, s.tpa);
						assert.isAtMost(s.tp, s.fg);
						assert.isAtMost(s.ft, s.fta);
						assert.isAtMost(s.min, gameMinutes + 1e-6);
						assert.isAtMost(s.pf, 5);
						assert.strictEqual(
							s.fgaAtRim + s.fgaLowPost + s.fgaMidRange,
							s.fga - s.tpa,
						);
						assert.strictEqual(
							s.fgAtRim + s.fgLowPost + s.fgMidRange,
							s.fg - s.tp,
						);
						assert.strictEqual(s.pts, 2 * (s.fg - s.tp) + 3 * s.tp + s.ft);
					}
					assert.strictEqual(ptsSum, t.stat.pts);
					assert.closeTo(minSum, 5 * gameMinutes, 0.01);
					assert.strictEqual(
						(t.stat.ptsQtrs as number[]).reduce((x, y) => x + y, 0),
						t.stat.pts,
					);
					assert.lengthOf(t.stat.ptsQtrs, 2 + result.overtimes);
				}
			}
			const mean = pts.reduce((x, y) => x + y, 0) / pts.length;
			// Full sim: 66.7 points per team at this strength
			assert.closeTo(mean, QS.totalBase / 2 + QS.totalPerStrength * -40, 1.5);
			assert.closeTo(mean, 66.6, 2);
			const mMean = margins.reduce((x, y) => x + y, 0) / N;
			const sd = Math.sqrt(
				margins.reduce((x, y) => x + (y - mMean) ** 2, 0) / N,
			);
			// Full sim: residual sd 12.9
			assert.isAtLeast(sd, 11.5);
			assert.isAtMost(sd, 14.5);
			// Full sim: 2.2 points of home court
			const edge = homeMargin / (N / 2) - neutralMargin / (N / 2);
			assert.isAtLeast(edge, 1);
			assert.isAtMost(edge, 3.5);
			// Full sim: 3.5% of games go to overtime
			assert.isAtLeast(overtimes / N, 0.01);
			assert.isAtMost(overtimes / N, 0.06);
		},
	);
});
