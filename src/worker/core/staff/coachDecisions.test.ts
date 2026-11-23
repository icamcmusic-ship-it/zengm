import { assert, describe, test } from "vitest";
import {
	coachMind,
	decisionRatingsFor,
	delegationFor,
	deriveDecisionTraits,
	perceiveTeam,
	planCoachDecisions,
	readTeam,
	restNightChance,
	updateForm,
	FORM,
	type CoachDelegation,
	type DecisionContext,
	type DecisionPlayer,
} from "../../../common/coachDecisions.ts";
import { coachOvr } from "../../../common/staff.ts";
import type { CoachProfile } from "../../../common/types.staff.ts";
import {
	foulTroubleSitUntil,
	planMinutes,
	RIDE_THRESHOLD,
} from "../GameSim.basketball/rotationPlanner.ts";

const ALL: CoachDelegation = {
	starters: true,
	rotation: true,
	minutes: true,
	matchups: true,
};

const profile = (over: Partial<CoachProfile> = {}): CoachProfile => ({
	off: "motion",
	def: "switch",
	crash: 0,
	fouls: 0,
	closing: 0,
	timeouts: 0,
	youth: 0,
	rest: 0,
	philosophy: 0,
	personality: 0,
	background: "guard",
	mgmt: 50,
	adapt: 50,
	loyalty: 0,
	foulRide: 0,
	injuryNext: 0.5,
	...over,
});

const mind = (over: Partial<CoachProfile> = {}, prp = 50, plm = 50) =>
	coachMind({ dev: 50, off: 50, def: 50, mot: 50, prp, plm }, profile(over), {
		loyalty: 0,
		foulRide: 0,
		injuryNext: 0,
	});

let nextId = 0;
const player = (over: Partial<DecisionPlayer>): DecisionPlayer => ({
	id: nextId++,
	name: `Player ${"ABCDEFGHIJKLMNOPQRSTUVWXYZ"[nextId % 26]}`,
	pos: "SF",
	age: 27,
	value: 50,
	injured: false,
	hgt: 50,
	spd: 50,
	usage: 0.5,
	three: 0.5,
	post: 0.5,
	perimD: 0.5,
	interiorD: 0.5,
	...over,
});

// A 10-man roster: 2 guards, 2 wings, a center as the top five, then the bench
const roster = (over: Partial<DecisionPlayer>[] = []) => {
	const base: Partial<DecisionPlayer>[] = [
		{ pos: "PG", value: 70, hgt: 35, spd: 75 },
		{ pos: "SG", value: 66, hgt: 42, spd: 70 },
		{ pos: "SF", value: 63, hgt: 52, spd: 62 },
		{ pos: "PF", value: 60, hgt: 60, spd: 55 },
		{ pos: "C", value: 58, hgt: 70, spd: 45 },
		{ pos: "G", value: 56, hgt: 40, spd: 70 },
		{ pos: "F", value: 54, hgt: 56, spd: 58 },
		{ pos: "C", value: 52, hgt: 72, spd: 40 },
		{ pos: "GF", value: 50, hgt: 48, spd: 66 },
		{ pos: "PF", value: 46, hgt: 62, spd: 50 },
	];
	return base.map((b, i) => player({ ...b, ...over[i] }));
};

const ctx = (over: Partial<DecisionContext> = {}): DecisionContext => ({
	mind: mind(),
	numPlayersOnCourt: 5,
	playoffs: false,
	rebuilding: false,
	marquee: false,
	rivalry: false,
	delegate: ALL,
	...over,
});

describe("coach decisions: starters", () => {
	test("a plain coach starts his best valid five", () => {
		const players = roster();
		const plan = planCoachDecisions(players, ctx());
		assert.deepEqual(
			new Set(plan.starters),
			new Set(players.slice(0, 5).map((p) => p.id)),
		);
	});

	test("a development coach starts a young player over a slightly better veteran, a win-now coach doesn't", () => {
		const players = roster([
			{},
			{},
			{},
			{ age: 31, value: 58.5 },
			{},
			{},
			{ age: 21, value: 57 },
		]);
		const youth = planCoachDecisions(
			players,
			ctx({ mind: mind({ philosophy: 0.9 }) }),
		);
		assert.include(youth.starters, players[6]!.id);
		assert.isTrue(youth.diag.styleStarter);
		// ... with a minutes floor, since he's not in the top 5 of the order
		assert.isAtLeast(youth.floors.get(players[6]!.id) ?? 0, 18);

		const vets = planCoachDecisions(
			players,
			ctx({ mind: mind({ philosophy: -0.9 }) }),
		);
		assert.include(vets.starters, players[3]!.id);
		assert.notInclude(vets.starters, players[6]!.id);
	});

	test("a promised starter starts", () => {
		const players = roster([{}, {}, {}, {}, {}, {}, { promise: "starter" }]);
		const plan = planCoachDecisions(players, ctx());
		assert.include(plan.starters, players[6]!.id);
		assert.isAbove(plan.diag.promiseHonored, 0);
		assert.isTrue(plan.notes.some((n) => n.includes("promised")));
	});

	test("starters left to the user stay his (no style picks)", () => {
		const players = roster([{}, {}, {}, { age: 31 }, {}, {}, { age: 21 }]);
		const plan = planCoachDecisions(
			players,
			ctx({
				mind: mind({ philosophy: 0.9 }),
				delegate: { ...ALL, starters: false, matchups: false },
			}),
		);
		assert.notInclude(plan.starters, players[6]!.id);
	});

	test("keep the bench unit together: a deep reserve starts for an injured starter", () => {
		const players = roster([
			{},
			{},
			{ injured: true },
			{},
			{},
			{},
			{},
			{},
			{ value: 51 },
		]);
		const next = planCoachDecisions(
			players,
			ctx({ mind: mind({ injuryNext: 0.8 }) }),
		);
		const bench = planCoachDecisions(
			players,
			ctx({ mind: mind({ injuryNext: -0.8 }) }),
		);
		// The next man (the 6th) starts for the promoting coach; the other keeps a bench player in his role
		assert.notDeepEqual(new Set(next.starters), new Set(bench.starters));
		assert.isTrue(bench.diag.injuryBench);
	});
});

describe("coach decisions: matchups", () => {
	const big = (): ReturnType<typeof readTeam> => ({
		size: 70,
		speed: 50,
		perimD: 0.5,
		interiorD: 0.5,
		pace: 100,
	});

	test("a big opponent: a bench big starts", () => {
		const players = roster([{}, {}, {}, {}, {}, {}, {}, { value: 60 }]);
		const plan = planCoachDecisions(players, ctx({ opp: big() }));
		assert.strictEqual(plan.swap?.kind, "big");
		assert.include(plan.starters, plan.swap!.in);
		assert.notInclude(plan.starters, plan.swap!.out);
		assert.isTrue(
			plan.notes.some((n) => n.includes("their frontcourt is big")),
		);
		// No ratings in the note
		assert.isFalse(plan.notes.some((n) => /\d/.test(n)));
	});

	test("matchups left to the user: no swap", () => {
		const players = roster();
		const plan = planCoachDecisions(
			players,
			ctx({ opp: big(), delegate: { ...ALL, matchups: false } }),
		);
		assert.isUndefined(plan.swap);
	});

	test("a stopper goes on their best scorer, and gets more minutes", () => {
		const players = roster([{}, {}, {}, {}, {}, { perimD: 0.9 }]);
		const opp = {
			...big(),
			size: 50,
			star: { id: 999, name: "Star", big: false, usage: 0.9 },
		};
		const plan = planCoachDecisions(players, ctx({ opp }));
		assert.deepEqual(plan.stopper, {
			defender: players[5]!.id,
			target: 999,
		});
		assert.isAbove(plan.minutesMult.get(players[5]!.id) ?? 1, 1);
	});

	test("better game prep reads the opponent more accurately", () => {
		const truth = readTeam(roster(), 100, 5);
		let errPoor = 0;
		let errGood = 0;
		for (let i = 0; i < 200; i++) {
			errPoor += Math.abs(perceiveTeam(truth, 30, `k${i}`).size - truth.size);
			errGood += Math.abs(perceiveTeam(truth, 75, `k${i}`).size - truth.size);
		}
		assert.isBelow(errGood, errPoor * 0.4);
	});
});

describe("coach decisions: minutes and form", () => {
	test("rebuilding development coach: more minutes for young players", () => {
		const players = roster([{ age: 22 }, {}, {}, {}, { age: 33 }]);
		const plan = planCoachDecisions(
			players,
			ctx({ rebuilding: true, mind: mind({ philosophy: 0.8 }) }),
		);
		assert.isAbove(plan.minutesMult.get(players[0]!.id) ?? 1, 1.1);
		assert.isBelow(plan.minutesMult.get(players[4]!.id) ?? 1, 1);
	});

	test("rest nights: only older stars, more with a load-management coach", () => {
		assert.strictEqual(
			restNightChance({ age: 28, rank: 0, rest: 1, pm: 50 }),
			0,
		);
		assert.strictEqual(
			restNightChance({ age: 34, rank: 7, rest: 1, pm: 50 }),
			0,
		);
		assert.isAbove(
			restNightChance({ age: 34, rank: 1, rest: 1, pm: 50 }),
			restNightChance({ age: 34, rank: 1, rest: -0.5, pm: 50 }),
		);
		assert.isAbove(
			restNightChance({ age: 35, rank: 1, rest: 0, pm: 50 }),
			restNightChance({ age: 31, rank: 1, rest: 0, pm: 50 }),
		);
	});

	test("form: roles move only past the hysteresis, more with a responsive coach", () => {
		let f: ReturnType<typeof updateForm>["form"] | undefined;
		for (let i = 0; i < 20; i++) {
			f = updateForm(
				f,
				{ season: 2025, min: 30, gameScore: 10, pm: 0, started: true },
				0.1,
			).form;
		}
		assert.strictEqual(f!.rb, 0);
		// A hot stretch
		let changed = 0;
		for (let i = 0; i < 8; i++) {
			const r = updateForm(
				f,
				{ season: 2025, min: 30, gameScore: 25, pm: 12, started: true },
				0.12,
			);
			f = r.form;
			changed += Number(r.rbChanged);
		}
		assert.isAbove(f!.rb, 0.04);
		assert.isAtMost(f!.rb, FORM.maxRole);
		// Changed a few times, not every game
		assert.isBelow(changed, 5);
	});

	test("the rotation order follows earned roles", () => {
		const players = roster([{}, {}, {}, {}, {}, {}, {}, { rb: 0.12 }]);
		const plan = planCoachDecisions(players, ctx());
		assert.closeTo(plan.keyMult.get(players[7]!.id)!, 1.12, 1e-9);
		const left = planCoachDecisions(players, {
			...ctx(),
			delegate: { ...ALL, rotation: false },
		});
		assert.isUndefined(left.keyMult.get(players[7]!.id));
	});

	test("a loyal coach dampens a slumping veteran starter's lost role", () => {
		const players = roster([{ age: 32, rb: -0.1, lastStarter: true }]);
		const loyal = planCoachDecisions(
			players,
			ctx({ mind: mind({ loyalty: 1 }) }),
		);
		const hard = planCoachDecisions(
			players,
			ctx({ mind: mind({ loyalty: -1 }) }),
		);
		assert.isAbove(
			loyal.keyMult.get(players[0]!.id)!,
			hard.keyMult.get(players[0]!.id)!,
		);
	});

	test("planMinutes: a coach's floor and order", () => {
		const players = [70, 65, 62, 60, 58, 55, 52, 50, 48, 45, 42, 40].map(
			(valueNoPot) => ({ valueNoPot, injured: false, ptModifier: 1 }),
		);
		const base = planMinutes(players, {
			playoffs: false,
			backToBack: false,
			numPlayersOnCourt: 5,
			allStarGame: false,
		});
		const withCoach = planMinutes(
			players.map((p, i) =>
				i === 9 ? { ...p, coachFloor: 20, coachKeyMult: 1.2 } : p,
			),
			{
				playoffs: false,
				backToBack: false,
				numPlayersOnCourt: 5,
				allStarGame: false,
			},
		);
		assert.isBelow(base[9]!, 5);
		assert.isAtLeast(withCoach[9]!, 19.9);
		const sum = withCoach.reduce((a, b) => a + b, 0);
		assert.closeTo(sum, 240, 0.1);
	});
});

describe("coach decisions: foul trouble and ratings", () => {
	const at = (ride: number | undefined, pf: number, period: number) =>
		foulTroubleSitUntil({
			pf,
			period,
			numPeriods: 4,
			foulsNeededToFoulOut: 6,
			quarterSeconds: 720,
			ride,
		});

	test("riding foul trouble vs going by the book", () => {
		// 2 fouls in the 1st quarter: standard sits to 6:00 of the 2nd, a rider doesn't sit him, by the book to halftime
		assert.strictEqual(at(undefined, 2, 1), 720 + 360);
		assert.isUndefined(at(RIDE_THRESHOLD, 2, 1));
		assert.strictEqual(at(-RIDE_THRESHOLD, 2, 1), 1440);
		// 2 in the 2nd quarter: by the book sits him to halftime too
		assert.isUndefined(at(undefined, 2, 2));
		assert.strictEqual(at(-1, 2, 2), 1440);
		// 5 fouls: a rider brings him back earlier
		assert.isBelow(at(1, 5, 3)!, at(undefined, 5, 3)!);
	});

	test("game prep and player management: deterministic, sensible, counted in a head coach's ovr", () => {
		const c = {
			ratings: { dev: 45, off: 60, def: 55, mot: 58 },
			role: "head" as const,
			firstName: "A",
			lastName: "B",
			born: { year: 1970 },
		};
		const a = decisionRatingsFor(c);
		const b = decisionRatingsFor(c);
		assert.deepEqual(a, b);
		assert.isAbove(a.prp, 20);
		assert.isBelow(a.prp, 85);
		const withNew = coachOvr({ ...c.ratings, prp: 90, plm: 90 }, "head");
		const withLow = coachOvr({ ...c.ratings, prp: 20, plm: 20 }, "head");
		assert.isAbove(withNew, withLow);
		// Without them, the old formula
		assert.strictEqual(
			coachOvr(c.ratings, "head"),
			Math.round(0.3 * 60 + 0.3 * 55 + 0.25 * 58 + 0.15 * 45),
		);
		const traits = deriveDecisionTraits({ ...c, profile: profile() });
		assert.deepEqual(
			traits,
			deriveDecisionTraits({ ...c, profile: profile() }),
		);
	});

	test("delegation follows keepRosterSorted until set", () => {
		assert.deepEqual(delegationFor({ keepRosterSorted: true }), ALL);
		assert.isFalse(delegationFor({ keepRosterSorted: false }).minutes);
		assert.isTrue(
			delegationFor({
				keepRosterSorted: false,
				coachDelegation: { ...ALL, starters: false },
			}).rotation,
		);
	});
});
