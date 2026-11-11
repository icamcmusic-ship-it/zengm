import { afterAll, assert, test } from "vitest";
import GameSim from "./index.ts";
import loadTeams from "../game/loadTeams.ts";
import { g } from "../../util/index.ts";
import { resetG } from "../../../test/helpers.ts";
import { genTeams, withSeededRandom } from "./simLiveGameForTests.ts";
import {
	assignMatchups,
	driveMismatch,
	mismatchScale,
	postMismatch,
	type MatchupPlayer,
} from "./matchupDefense.ts";
import { NEUTRAL_COACH_SIM } from "../../../common/coachSystems.ts";
import { range } from "../../../common/utils.ts";

/*
 * Matchup Defense (the matchupDefense setting, matchupDefense.ts). Off: nothing changes (the fixed-seed box scores of
 * outcomeInvariance.test.ts). On: league averages about the same, defenders matched by threat and fit, weak defenders attacked, mismatches
 * lead to post-ups and drives, switching and drop coverage. The calibration tables are in docs/native-features.md
 * (spacingMatchup.script.test.ts).
 */

afterAll(() => {
	resetG();
});

const SEEDS = range(10).map((i) => 900 + i * 61);

type Shot = {
	shooter: any;
	defender: any;
	type: string;
	probMake: number;
	passer: any;
	o: number;
	defenders: unknown[];
};

const sim = async (
	settings: Record<string, boolean>,
	{
		seeds = SEEDS,
		games = 1,
		edit,
	}: {
		seeds?: number[];
		games?: number;
		edit?: (teams: Record<number, any>) => void;
	} = {},
) => {
	const shots: Shot[] = [];
	const proto = GameSim.prototype as any;
	const orig = proto.getShotInfo;
	proto.getShotInfo = function (args: any) {
		const out = orig.call(this, args);
		if (!args.putBack && !args.tipInFromOutOfBounds) {
			shots.push({
				shooter: args.p,
				defender: this.matchupDefense ? this.defenderOf(args.p) : undefined,
				type: out.type,
				probMake: out.blocked ? 0 : out.probMake,
				passer: out.passer,
				o: this.o,
				defenders: [...this.playersOnCourt[this.d]],
			});
		}
		return out;
	};
	const results: any[] = [];
	const first: any[] = [];
	try {
		for (const seed of seeds) {
			await withSeededRandom(seed, async () => {
				await genTeams();
				for (const [key, value] of Object.entries(settings)) {
					g.setWithoutSavingToDB(key as any, value);
				}
				for (const i of range(games)) {
					const teams = await loadTeams([0, 1], {});
					edit?.(teams);
					first.push(teams[0]!.player[0]);
					const gameSim = new GameSim({
						gid: seed + i,
						teams: [teams[0]!, teams[1]!],
						baseInjuryRate: 0,
						doPlayByPlay: false,
						homeCourtFactor: 1,
						allStarGame: false,
						neutralSite: false,
					});
					results.push(gameSim.run());
				}
			});
		}
	} finally {
		proto.getShotInfo = orig;
	}
	return { results, shots, first };
};

const mk = (
	usage: number,
	perim: number,
	int: number,
	hgt: number,
	spd = 50,
	versatility?: number,
): MatchupPlayer => ({
	compositeRating: {
		usage,
		defensePerimeter: perim,
		defenseInterior: int,
	},
	simHgt: hgt,
	simSpd: spd,
	traitEffects:
		versatility === undefined
			? undefined
			: { switchDefenseContribution: versatility },
});

test("matchupDefense: greedy assignment by threat and fit", () => {
	// Offense: a star guard, a wing, a role guard, a big, a stretch big
	const offense = [
		mk(0.8, 0.5, 0.4, 35),
		mk(0.5, 0.5, 0.5, 50),
		mk(0.3, 0.5, 0.4, 38),
		mk(0.5, 0.4, 0.6, 72),
		mk(0.4, 0.4, 0.6, 66),
	];
	// Defense: a stopper guard, a weak guard, a wing, a rim protector, a big
	const defense = [
		mk(0.5, 0.75, 0.4, 36),
		mk(0.5, 0.35, 0.3, 37),
		mk(0.5, 0.6, 0.5, 52),
		mk(0.5, 0.35, 0.8, 75),
		mk(0.5, 0.4, 0.65, 68),
	];
	const guards = assignMatchups(offense, defense, false);
	assert.deepEqual([...guards].sort(), [0, 1, 2, 3, 4]);
	// The stopper takes the star, the rim protector the big, the weak guard is hidden on the role player
	assert.strictEqual(guards[0], 0);
	assert.strictEqual(guards[3], 3);
	assert.strictEqual(guards[2], 1);
});

test("matchupDefense: mismatches, relieved by switching versatile teams", () => {
	const big = mk(0.5, 0.4, 0.7, 75, 40);
	const guard = mk(0.5, 0.6, 0.3, 35, 75);
	assert.isAbove(postMismatch(big, guard), 0.3);
	assert.strictEqual(postMismatch(guard, big), 0);
	assert.isAbove(driveMismatch(guard, big), 0.2);
	assert.strictEqual(driveMismatch(big, guard), 0);
	const plain = mismatchScale(guard, false, 0);
	assert.strictEqual(plain, 1);
	assert.isBelow(mismatchScale(guard, true, 1), mismatchScale(guard, true, -1));
	assert.isBelow(mismatchScale(guard, true, 0), plain);
	assert.isBelow(
		mismatchScale(mk(0.5, 0.6, 0.3, 35, 75, 1.5), false, 0),
		plain,
	);
	assert.isAbove(
		mismatchScale(mk(0.5, 0.6, 0.3, 35, 75, -1.5), false, 0),
		plain,
	);
});

const average = (xs: number[]) => xs.reduce((a, b) => a + b, 0) / xs.length;

test("matchupDefense off: no matchup data, on: league averages about the same", async () => {
	const off = await sim({ matchupDefense: false }, { games: 3 });
	assert.isUndefined(off.first[0].simSpd);
	assert.isUndefined(off.shots[0]!.defender);
	const on = await sim({ matchupDefense: true }, { games: 3 });
	assert.isNumber(on.first[0].simSpd);
	assert.isDefined(on.shots[0]!.defender);
	const fgp = (results: any[]) => {
		let fg = 0;
		let fga = 0;
		let pts = 0;
		for (const r of results) {
			for (const t of r.team) {
				fg += t.stat.fg;
				fga += t.stat.fga;
				pts += t.stat.pts;
			}
		}
		return { fgp: fg / fga, pts: pts / (2 * results.length) };
	};
	const a = fgp(off.results);
	const b = fgp(on.results);
	assert.closeTo(b.fgp, a.fgp, 0.02);
	assert.closeTo(b.pts, a.pts, 6);
	assert.closeTo(
		average(on.shots.map((s) => s.probMake)),
		average(off.shots.map((s) => s.probMake)),
		0.015,
	);
});

// The defending team's (team 1) starter with the best perimeter defense, made a poor defender (or not)
const weaken = (weak: boolean, marked: Set<unknown>) => (teams: any) => {
	const starters = teams[1].player.slice(0, 5);
	const p = starters.reduce((a: any, b: any) =>
		a.compositeRating.defensePerimeter > b.compositeRating.defensePerimeter
			? a
			: b,
	);
	marked.add(p);
	if (weak) {
		for (const key of ["defense", "defensePerimeter", "defenseInterior"]) {
			p.compositeRating[key] -= 0.25;
		}
	}
};

// How much easier a shot is when he guards the shooter than when one of his teammates on the floor does (the same shooter and type of shot)
const edgeAgainst = (allShots: Shot[], marked: Set<unknown>) => {
	const shots = allShots.filter((s) => s.defenders.some((q) => marked.has(q)));
	const others = new Map<string, number[]>();
	for (const s of shots) {
		if (s.defender && !marked.has(s.defender)) {
			const key = `${s.shooter.id} ${s.type}`;
			const list = others.get(key) ?? [];
			list.push(s.probMake);
			others.set(key, list);
		}
	}
	const diffs: number[] = [];
	for (const s of shots) {
		const list = others.get(`${s.shooter.id} ${s.type}`);
		if (s.defender && marked.has(s.defender) && list) {
			diffs.push(s.probMake - average(list));
		}
	}
	return { edge: average(diffs), n: diffs.length };
};

test("matchupDefense: the man a weak defender guards scores more efficiently", async () => {
	const result: Record<string, { edge: number; n: number }> = {};
	for (const weak of [false, true]) {
		const marked = new Set<unknown>();
		const { shots } = await sim(
			{ matchupDefense: true },
			{ games: 3, edit: weaken(weak, marked) },
		);
		result[weak ? "weak" : "normal"] = edgeAgainst(shots, marked);
	}
	if ((globalThis as any).process.env.SM_PRINT) {
		console.log("make probability edge of shots against him", result);
	}
	assert.isAbove(result.weak!.edge, 0.007);
	assert.isAbove(result.weak!.edge, result.normal!.edge + 0.01);
});

test("matchupDefense: mismatches lead to post-ups, drop coverage gives up pull-ups", async () => {
	const { shots } = await sim({ matchupDefense: true }, { games: 3 });
	const post = (xs: Shot[]) =>
		xs.filter((s) => s.type === "lowPost").length / xs.length;
	const mismatched = shots.filter(
		(s) => s.defender && s.shooter.simHgt - s.defender.simHgt > 15,
	);
	const matched = shots.filter(
		(s) =>
			s.defender &&
			s.shooter.simHgt > 60 &&
			Math.abs(s.shooter.simHgt - s.defender.simHgt) < 5,
	);
	assert.isAbove(mismatched.length, 50);
	assert.isAbove(post(mismatched), post(matched));

	// Both teams in drop coverage, or both switching: unassisted mid-range jumpers
	const withDef = (def: "drop" | "switch") => (teams: any) => {
		for (const t of [0, 1]) {
			teams[t].coachSim = { ...NEUTRAL_COACH_SIM, off: "motion", def };
		}
	};
	const pullUps = async (def: "drop" | "switch") => {
		const { shots } = await sim(
			{ matchupDefense: true },
			{ games: 3, edit: withDef(def) },
		);
		const mid = shots.filter((s) => s.type === "midRange" && !s.passer);
		return {
			rate: mid.length / shots.length,
			make: average(mid.map((s) => s.probMake)),
		};
	};
	const drop = await pullUps("drop");
	const sw = await pullUps("switch");
	assert.isAbove(drop.rate, sw.rate);
	assert.isAbove(drop.make, sw.make);
});
