// Test support: simulates many games and measures how possessions play out (length, pace, when shots go up on the shot clock, how they
// end, second chances, shot-clock violations, end-of-period and late-game behavior), for the old and the realistic possession model. Used
// by possessionModel.test.ts (assertions) and, with POSS_METRICS=1, to print a before/after table for ~1000 games.
import GameSim from "./index.ts";
import loadTeams from "../game/loadTeams.ts";
import { g } from "../../util/index.ts";
import { genTeams, withSeededRandom } from "./simLiveGameForTests.ts";
import {
	SHOT_CLOCK_MAKE_NORM,
	shotClockMakeFactor,
} from "./possessionModel.ts";

type Seg = {
	off: 0 | 1;
	tBefore: number;
	tAfter: number;
	prev: string | undefined;
	outcome: string;
	period: number;
	dFga: number;
	dFta: number;
	dTov: number;
	dPts: number;
};

type Shot = {
	scLeft: number;
	scOff: boolean;
	afterOrb: boolean;
	sinceOrb: number;
	poss: number;
	t: number;
	period: number;
	startT: number;
	prev: string | undefined;
};

export type Metrics = ReturnType<typeof summarize>;

const STATS = ["fga", "fta", "tov", "pts"] as const;

let current: {
	segs: Seg[];
	shots: Shot[];
	intentionalFouls: number;
	segStartT: number;
} = { segs: [], shots: [], intentionalFouls: 0, segStartT: 0 };

let patched = false;
const patch = () => {
	if (patched) {
		return;
	}
	patched = true;
	const proto = GameSim.prototype as any;

	const simPossession = proto.simPossession;
	proto.simPossession = function (this: any) {
		const off = this.o === 1 ? 0 : 1;
		const before = STATS.map((s) => this.team[off].stat[s]);
		const tBefore = this.t;
		const prev = this.prevPossessionOutcome;
		current.segStartT = tBefore;
		simPossession.call(this);
		const after = STATS.map((s) => this.team[off].stat[s]);
		current.segs.push({
			off,
			tBefore,
			tAfter: this.t,
			prev,
			outcome: this.prevPossessionOutcome,
			period: this.team[0].stat.ptsQtrs.length,
			dFga: after[0] - before[0],
			dFta: after[1] - before[1],
			dTov: after[2] - before[2],
			dPts: after[3] - before[3],
		});
	};

	const getClockFactor = proto.getClockFactor;
	proto.getClockFactor = function (this: any) {
		const cf = getClockFactor.call(this);
		if (cf === "intentionalFoul") {
			current.intentionalFouls += 1;
		}
		return cf;
	};

	const getShotInfo = proto.getShotInfo;
	proto.getShotInfo = function (this: any, info: any) {
		const realPoss = this.realPoss;
		const scLeft = realPoss ? this.shotClock : 24 - this.possessionLength;
		current.shots.push({
			scLeft,
			scOff: this.t < scLeft,
			afterOrb: this.prevPossessionOutcome === "orb",
			sinceOrb: this.possessionLength,
			poss: this.possessionLength,
			t: this.t,
			period: this.team[0].stat.ptsQtrs.length,
			startT: current.segStartT,
			prev: this.prevPossessionOutcome,
		});
		return getShotInfo.call(this, info);
	};
};

const RETAINED = new Set([
	"orb",
	"nonShootingFoul",
	"timeout",
	"outOfBoundsDefense",
]);

const mean = (xs: number[]) =>
	xs.length === 0 ? Number.NaN : xs.reduce((a, b) => a + b, 0) / xs.length;
const pct = (xs: unknown[], f: (x: any) => boolean) =>
	xs.length === 0 ? Number.NaN : xs.filter(f).length / xs.length;

export const simGames = async ({
	realistic,
	numGames,
	gamesPerRoster = 25,
	seed = 1,
	pace,
	settings = {},
}: {
	realistic: boolean;
	numGames: number;
	gamesPerRoster?: number;
	seed?: number;
	pace?: number;
	// Other game attributes to set (League extras)
	settings?: Record<string, unknown>;
}) => {
	patch();
	const games: {
		segs: Seg[];
		shots: Shot[];
		intentionalFouls: number;
		team: any[];
		overtimes: number;
		violations: number;
		teamPace: [number, number];
	}[] = [];
	for (let r = 0; r * gamesPerRoster < numGames; r++) {
		await withSeededRandom(seed * 7919 + r * 104729, async () => {
			await genTeams();
			g.setWithoutSavingToDB("realisticPossessions", realistic);
			// No play-by-play of any kind: the sim's own state is all that is measured (see possessionModel.test.ts, which checks that logging
			// on or off gives identical games)
			g.setWithoutSavingToDB("storePlayByPlay", false);
			if (pace !== undefined) {
				g.setWithoutSavingToDB("pace", pace);
			}
			for (const [key, value] of Object.entries(settings)) {
				g.setWithoutSavingToDB(key as any, value as any);
			}
			for (let i = 0; i < gamesPerRoster && games.length < numGames; i++) {
				const teams = await loadTeams([0, 1], {});
				// Alternate home/away so neither roster always gets home court
				const pair: [any, any] =
					i % 2 === 0 ? [teams[0]!, teams[1]!] : [teams[1]!, teams[0]!];
				const teamPace: [number, number] = [pair[0].pace, pair[1].pace];
				current = { segs: [], shots: [], intentionalFouls: 0, segStartT: 0 };
				const sim = new GameSim({
					gid: r * 1000 + i,
					teams: pair,
					baseInjuryRate: 0,
					doPlayByPlay: false,
					homeCourtFactor: 1,
					allStarGame: false,
					neutralSite: false,
				});
				const result = sim.run();
				games.push({
					...current,
					team: result.team,
					overtimes: result.overtimes,
					violations:
						((sim as any).shotClockViolations?.[0] ?? 0) +
						((sim as any).shotClockViolations?.[1] ?? 0),
					teamPace,
				});
			}
		});
	}
	return games;
};

export const summarize = (games: Awaited<ReturnType<typeof simGames>>) => {
	// Box score averages, per team-game
	const box = {
		pts: [] as number[],
		fgp: [0, 0] as [number, number],
		tpaRate: [0, 0] as [number, number],
		ftr: [0, 0] as [number, number],
		tov: [0, 0] as [number, number],
		orb: [0, 0] as [number, number],
		poss: [] as number[],
		min: [] as number[],
		pace: [] as number[],
	};
	const possLengths: number[] = [];
	const transLengths: number[] = [];
	const halfCourtLengths: number[] = [];
	const possEnds: string[] = [];
	const scLeftAll: number[] = [];
	const makeFactors: number[] = [];
	const lateByPrev: Record<string, number> = {};
	const orbToShot: number[] = [];
	const lastShotClock: number[] = [];
	const twoForOneShotTimes: number[] = [];
	let secondChancePts = 0;
	let violations = 0;
	let intentionalFouls = 0;
	let numPossessions = 0;
	const paceByTeamRating: [number, number][] = [];

	for (const game of games) {
		const ts = game.team.map((t) => t.stat);
		for (const i of [0, 1] as const) {
			const s = ts[i];
			const o = ts[1 - i];
			box.pts.push(s.pts);
			box.fgp[0] += s.fg;
			box.fgp[1] += s.fga;
			box.tpaRate[0] += s.tpa;
			box.tpaRate[1] += s.fga;
			box.ftr[0] += s.fta;
			box.ftr[1] += s.fga;
			box.orb[0] += s.orb;
			box.orb[1] += s.orb + o.drb;
			const poss = (x: any, y: any) =>
				x.fga +
				0.4 * x.fta -
				1.07 * (x.orb / (x.orb + y.drb)) * (x.fga - x.fg) +
				x.tov;
			const p = 0.5 * (poss(s, o) + poss(o, s));
			box.tov[0] += s.tov;
			box.tov[1] += s.fga + 0.44 * s.fta + s.tov;
			box.poss.push(p);
			box.min.push(s.min);
			box.pace.push((p * 48 * 5) / s.min);
		}
		paceByTeamRating.push([
			(game.teamPace[0]! + game.teamPace[1]!) / 2,
			box.pace.at(-1)!,
		]);
		violations += game.violations;
		intentionalFouls += game.intentionalFouls;

		// Group segments into real possessions (same team keeps the ball)
		let open: Seg[] = [];
		const close = () => {
			if (open.length === 0) {
				return;
			}
			const dur = open.reduce((a, s) => a + (s.tBefore - s.tAfter), 0);
			const last = open.at(-1)!;
			const first = open[0]!;
			if (Number.isFinite(dur)) {
				numPossessions += 1;
				const fullPeriod = first.tBefore >= 30 && last.tAfter > 0;
				if (fullPeriod) {
					possLengths.push(dur);
					if (first.prev === "stl" || first.prev === "drb") {
						// as in the play-by-play: a quick shot after a steal or a defensive rebound is a transition possession
						if (open.length === 1 && dur <= 8) {
							transLengths.push(dur);
						}
					}
					if (
						open.length === 1 &&
						first.dFga + first.dFta > 0 &&
						!(first.prev === "stl" || first.prev === "drb") &&
						first.prev !== undefined
					) {
						halfCourtLengths.push(dur);
					}
				}
				const fta = open.some((s) => s.dFta > 0);
				const tov = last.dTov > 0;
				possEnds.push(
					tov
						? "tov"
						: fta
							? "ft"
							: last.dFga > 0
								? "fga"
								: last.outcome === "endOfPeriod"
									? "end"
									: "other",
				);
				for (const [k, seg] of open.entries()) {
					if (k > 0 && open[k - 1]!.outcome === "orb") {
						secondChancePts += seg.dPts;
					}
				}
			}
			open = [];
		};
		for (const seg of game.segs) {
			if (open.length > 0 && open[0]!.off !== seg.off) {
				close();
			}
			if (open.length > 0 && open[0]!.period !== seg.period) {
				close();
			}
			open.push(seg);
			if (!RETAINED.has(seg.outcome) || seg.tAfter <= 0) {
				close();
			}
		}
		close();

		for (const shot of game.shots) {
			if (!Number.isFinite(shot.t)) {
				continue;
			}
			if (!shot.scOff) {
				if (shot.scLeft <= 4) {
					const key = String(shot.prev);
					lateByPrev[key] = (lateByPrev[key] ?? 0) + 1;
				}
				scLeftAll.push(shot.scLeft);
				makeFactors.push(
					shotClockMakeFactor(shot.scLeft) * SHOT_CLOCK_MAKE_NORM,
				);
			}
			if (shot.afterOrb && shot.startT > 30) {
				orbToShot.push(shot.sinceOrb);
			}
		}
		// end of quarters 1-3: clock at the last field goal attempt, and 2-for-1s
		for (const period of [1, 2, 3]) {
			const shots = game.shots.filter((s) => s.period === period);
			const last = shots.at(-1);
			if (last) {
				lastShotClock.push(last.t);
			}
			const segs = game.segs.filter((s) => s.period === period);
			// the possession that starts with 34-50 seconds left: how long until its shot (a 2-for-1 shoots with ~29-35 s left)
			const k = segs.findIndex(
				(s) => s.tBefore <= 50 && s.tBefore >= 34 && s.prev !== "orb",
			);
			if (k >= 0) {
				const shot = shots.find((s) => s.startT === segs[k]!.tBefore);
				if (shot) {
					twoForOneShotTimes.push(shot.startT - shot.t);
				}
			}
		}
	}

	const sorted = scLeftAll.toSorted((a, b) => a - b);
	const bucket = (lo: number, hi: number) =>
		pct(scLeftAll, (x) => x > lo && x <= hi);
	const nTeamGames = games.length * 2;
	return {
		games: games.length,
		pts: mean(box.pts),
		fgp: box.fgp[0] / box.fgp[1],
		tpaRate: box.tpaRate[0] / box.tpaRate[1],
		ftr: box.ftr[0] / box.ftr[1],
		tovPct: box.tov[0] / box.tov[1],
		orbPct: box.orb[0] / box.orb[1],
		pace: mean(box.pace),
		paceSd: Math.sqrt(mean(box.pace.map((x) => (x - mean(box.pace)) ** 2))),
		min: mean(box.min),
		possPerTeamGame: numPossessions / nTeamGames,
		possLength: mean(possLengths),
		transLength: mean(transLengths),
		transShare: transLengths.length / possLengths.length,
		halfCourtLength: mean(halfCourtLengths),
		endTov: pct(possEnds, (x) => x === "tov"),
		endFga: pct(possEnds, (x) => x === "fga"),
		endFt: pct(possEnds, (x) => x === "ft"),
		endOther: pct(possEnds, (x) => x === "end" || x === "other"),
		// average of the shot-clock FG% factor before normalization (SHOT_CLOCK_MAKE_NORM should be about this)
		rawMakeFactor: mean(makeFactors),
		// what the possession started from, for shots with 4 or fewer seconds on the shot clock
		lateShotsByStart: Object.entries(lateByPrev)
			.sort((a, b) => b[1] - a[1])
			.map(([k, v]) => `${k}:${((100 * v) / scLeftAll.length).toFixed(1)}%`)
			.join(" "),
		scMedian: sorted[Math.floor(sorted.length / 2)]!,
		sc24_22: bucket(22, 24.01),
		sc22_18: bucket(18, 22),
		sc18_15: bucket(15, 18),
		sc15_7: bucket(7, 15),
		sc7_4: bucket(4, 7),
		sc4_0: bucket(-1, 4),
		orbToShot: mean(orbToShot),
		orbQuick: pct(orbToShot, (x) => x <= 3),
		secondChancePts: secondChancePts / nTeamGames,
		violationsPerTeamGame: violations / nTeamGames,
		lastShotClock: mean(lastShotClock),
		lastShotUnder3: pct(lastShotClock, (x) => x <= 3),
		twoForOneShotTime: mean(twoForOneShotTimes),
		intentionalFoulsPerGame: intentionalFouls / games.length,
		otRate: games.filter((x) => x.overtimes > 0).length / games.length,
		teamPaceRatingMean: mean(games.flatMap((x) => x.teamPace)),
		teamPaceRatingSd: Math.sqrt(
			mean(
				games
					.flatMap((x) => x.teamPace)
					.map((x) => (x - mean(games.flatMap((y) => y.teamPace))) ** 2),
			),
		),
		paceByTeamRating,
	};
};
