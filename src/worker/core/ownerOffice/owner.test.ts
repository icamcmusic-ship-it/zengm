import { assert, beforeEach, describe, test } from "vitest";
import { DEFAULT_LEVEL } from "../../../common/budgetLevels.ts";
import { PHASE } from "../../../common/constants.ts";
import {
	ADJUSTMENT_MAX,
	ADJUSTMENT_MIN,
	firingLine,
	genOwnerProfile,
	jobOutlook,
	makeRequest,
	maxRequests,
	patienceGraceBonus,
	sumAdjustments,
	type OwnerTraits,
} from "../../../common/ownerProfile.ts";
import { mockIDBLeague, resetCache, resetG } from "../../../test/helpers.ts";
import { idb } from "../../db/index.ts";
import { g, helpers } from "../../util/index.ts";
import { player, team } from "../index.ts";
import updateOwnerMood from "../season/updateOwnerMood.ts";
import ownerView from "../../views/owner.ts";
import {
	getFiringRule,
	getOwnerProfile,
	onTradeDeadline,
	onUserGame,
	overrideMandate,
	requestsActive,
} from "./owner.ts";

const traits = (x: Partial<OwnerTraits>): OwnerTraits => ({
	patience: 0.5,
	meddling: 0.5,
	starLoyalty: 0.5,
	taxAppetite: 0.5,
	...x,
});

describe("owner profile formulas", () => {
	test("profiles are seeded by team and first season", () => {
		const a = genOwnerProfile(3, 2020);
		assert.deepEqual(genOwnerProfile(3, 2020), a);
		assert.notDeepEqual(genOwnerProfile(3, 2021), a);
		for (const value of Object.values(a.traits)) {
			assert.isAtLeast(value, 0);
			assert.isAtMost(value, 1);
		}
		assert.strictEqual(a.since, 2020);
		assert.isAbove(a.name.length, 3);
	});

	test("patience sets the firing line and grace", () => {
		assert.strictEqual(firingLine(traits({})), -1);
		assert.strictEqual(firingLine(traits({ patience: 0 })), -0.75);
		assert.strictEqual(firingLine(traits({ patience: 1 })), -1.25);
		assert.strictEqual(patienceGraceBonus(traits({ patience: 0.69 })), 0);
		assert.strictEqual(patienceGraceBonus(traits({ patience: 0.7 })), 1);
		assert.strictEqual(maxRequests(traits({ meddling: 0 })), 1);
		assert.strictEqual(maxRequests(traits({ meddling: 1 })), 3);
	});

	test("stakes scale with patience, mandates don't", () => {
		const rest = { id: 0, issuedGp: 20, due: "seasonEnd" as const };
		const impatient = makeRequest(
			"makePlayoffs",
			traits({ patience: 0 }),
			rest,
		);
		const patient = makeRequest("makePlayoffs", traits({ patience: 1 }), rest);
		assert.isAbove(impatient.penalty, patient.penalty);
		assert.strictEqual(
			makeRequest("ticketFreeze", traits({ patience: 0 }), rest).penalty,
			makeRequest("ticketFreeze", traits({ patience: 1 }), rest).penalty,
		);
	});

	test("adjustments are bounded", () => {
		const sums = sumAdjustments([
			{ text: "a", component: "wins", delta: -0.4 },
			{ text: "b", component: "playoffs", delta: -0.4 },
			{ text: "c", component: "money", delta: 0.5 },
		]);
		assert.closeTo(sums.wins + sums.playoffs, ADJUSTMENT_MIN, 1e-9);
		assert.closeTo(sums.money, ADJUSTMENT_MAX, 1e-9);
	});

	test("job outlook", () => {
		const call = (projectedTotal: number) =>
			jobOutlook({ projectedTotal, line: -1, canFire: true });
		assert.strictEqual(call(-1), "fired");
		assert.strictEqual(call(-0.8), "hot");
		assert.strictEqual(call(-0.2), "warm");
		assert.strictEqual(call(0.5), "safe");
		assert.strictEqual(
			jobOutlook({ projectedTotal: -3, line: -1, canFire: false }),
			"grace",
		);
	});
});

const setup = async () => {
	resetG();
	g.setWithoutSavingToDB("featureOwnerOffice", true);
	g.setWithoutSavingToDB("budget", true);
	g.setWithoutSavingToDB("phase", PHASE.REGULAR_SEASON);
	g.setWithoutSavingToDB("numGames", 82);
	g.setWithoutSavingToDB("userTid", 0);
	g.setWithoutSavingToDB("userTids", [0]);
	g.setWithoutSavingToDB("gracePeriodEnd", g.get("season"));
	g.setWithoutSavingToDB("startingSeason", g.get("season") - 5);
	const teamsDefault = helpers.getTeamsDefault().slice(0, 4);
	g.setWithoutSavingToDB("numTeams", 4);
	g.setWithoutSavingToDB("numActiveTeams", 4);
	const teams = teamsDefault.map((t, i) =>
		team.generate({ ...t, popRank: i + 1 }),
	);
	const season = g.get("season");
	const players = [];
	for (let tid = 0; tid < 2; tid++) {
		for (let i = 0; i < 10; i++) {
			const p = player.generate(
				tid,
				i < 2 ? 21 : 29,
				season - (i < 2 ? 2 : 10),
				true,
				DEFAULT_LEVEL,
			);
			p.value = 50 + i;
			players.push(p);
		}
	}
	await resetCache({
		players,
		teams,
		teamSeasons: teams.map((t) => team.genSeasonRow(t)),
	});
};

const getTs = async (tid: number) =>
	(await idb.cache.teamSeasons.indexGet("teamSeasonsByTidSeason", [
		tid,
		g.get("season"),
	]))!;

const userTeam = async () => (await idb.cache.teams.get(0))!;

const franchisePid = async () =>
	(await idb.cache.players.indexGetAll("playersByTid", 0)).toSorted(
		(a, b) => b.value - a.value,
	)[0]!.pid;

const playGames = async (gp: number) => {
	const ts = await getTs(0);
	const t = await userTeam();
	ts.won = Math.floor(gp / 2);
	ts.lost = gp - ts.won;
	await onUserGame(t, ts);
	await idb.cache.teamSeasons.put(ts);
	return ts;
};

describe("owner requests", () => {
	beforeEach(async () => {
		await setup();
	});

	test("existing teams get a derived profile; requests only for a judged user team", async () => {
		const t = await userTeam();
		assert.isUndefined(t.ownerOffice?.owner);
		const profile = getOwnerProfile(t);
		assert.deepEqual(profile, genOwnerProfile(0, g.get("startingSeason")));
		assert.isTrue(requestsActive(t));

		g.setWithoutSavingToDB("userTids", [0, 1]);
		assert.isFalse(requestsActive(t));
		g.setWithoutSavingToDB("userTids", [0]);
		g.setWithoutSavingToDB("gracePeriodEnd", g.get("season") + 1);
		assert.isFalse(requestsActive(t));
		g.setWithoutSavingToDB("gracePeriodEnd", g.get("season"));
		g.setWithoutSavingToDB("godMode", true);
		assert.isFalse(requestsActive(t));
		g.setWithoutSavingToDB("godMode", false);
		// Honeymoon: a new owner's first season
		t.ownerOffice = {
			completed: [],
			facilitiesBonus: 0,
			owner: genOwnerProfile(0, g.get("season")),
		};
		assert.isFalse(requestsActive(t));
		g.setWithoutSavingToDB("featureOwnerOffice", false);
		assert.isFalse(requestsActive(t));
	});

	test("checkpoints are seeded and bounded by meddling", async () => {
		const t = await userTeam();
		t.ownerOffice = {
			completed: [],
			facilitiesBonus: 0,
			owner: { ...genOwnerProfile(0, 2000), traits: traits({ meddling: 1 }) },
		};
		await playGames(10);
		assert.deepEqual((await getTs(0)).ownerSeason!.requests, []);
		await playGames(21);
		await playGames(41);
		const first = structuredClone((await getTs(0)).ownerSeason!);
		assert.deepEqual(first.checkpoints, [0, 1]);
		assert.isAtMost(first.requests.length, 3);
		assert.isAtLeast(first.requests.length, 1);
		assert.strictEqual(first.franchisePid, await franchisePid());

		// Same season, same team, same state: the same requests
		(await getTs(0)).ownerSeason = undefined;
		await playGames(21);
		await playGames(41);
		assert.deepEqual((await getTs(0)).ownerSeason!.requests, first.requests);

		// A hands-off owner asks for at most one thing a season
		(await getTs(0)).ownerSeason = undefined;
		t.ownerOffice.owner!.traits.meddling = 0;
		await playGames(21);
		await playGames(41);
		assert.isAtMost((await getTs(0)).ownerSeason!.requests.length, 1);
	});

	test("trading the franchise player: a broken promise, or a loyalty penalty", async () => {
		const t = await userTeam();
		t.ownerOffice = {
			completed: [],
			facilitiesBonus: 0,
			owner: { ...genOwnerProfile(0, 2000), traits: traits({ meddling: 0 }) },
		};
		const ts = await playGames(5);
		const pid = await franchisePid();
		const p = (await idb.cache.players.get(pid))!;

		// No request out: the star loyalty reaction
		p.tid = 1;
		await idb.cache.players.put(p);
		await playGames(6);
		const adj = (await getTs(0)).ownerSeason!.adjustments;
		assert.strictEqual(adj.length, 1);
		assert.closeTo(adj[0]!.delta, -0.1, 1e-9);
		// Only once
		await playGames(7);
		assert.strictEqual((await getTs(0)).ownerSeason!.adjustments.length, 1);

		// With a "keep him" request out, the request's stake instead
		p.tid = 0;
		await idb.cache.players.put(p);
		ts.ownerSeason = {
			franchisePid: pid,
			checkpoints: [0, 1],
			requests: [
				makeRequest("keepStar", traits({}), {
					id: 0,
					issuedGp: 20,
					due: "seasonEnd",
					pid,
					playerName: "X",
				}),
			],
			adjustments: [],
		};
		await idb.cache.teamSeasons.put(ts);
		p.tid = 1;
		await idb.cache.players.put(p);
		await playGames(30);
		const state = (await getTs(0)).ownerSeason!;
		assert.strictEqual(state.requests[0]!.status, "missed");
		assert.strictEqual(state.adjustments.length, 1);
		assert.closeTo(
			state.adjustments[0]!.delta,
			-state.requests[0]!.penalty,
			1e-9,
		);
	});

	test("mandates can be overridden for their cost; payroll comes due at the deadline", async () => {
		const ts = await playGames(5);
		ts.ownerSeason = {
			checkpoints: [0, 1],
			requests: [
				makeRequest("ticketFreeze", traits({}), {
					id: 0,
					issuedGp: 20,
					due: "seasonEnd",
					target: 30,
				}),
				makeRequest("cutPayroll", traits({}), {
					id: 1,
					issuedGp: 20,
					due: "tradeDeadline",
					target: 1,
				}),
				makeRequest("makePlayoffs", traits({}), {
					id: 2,
					issuedGp: 41,
					due: "seasonEnd",
				}),
			],
			adjustments: [],
		};
		await idb.cache.teamSeasons.put(ts);
		assert.isString(await overrideMandate(1));
		assert.isUndefined(await overrideMandate(0));
		assert.isString(await overrideMandate(0));
		let state = (await getTs(0)).ownerSeason!;
		assert.strictEqual(state.requests[0]!.status, "overridden");
		assert.closeTo(state.adjustments[0]!.delta, -0.04, 1e-9);

		g.setWithoutSavingToDB("phase", PHASE.AFTER_TRADE_DEADLINE);
		await onTradeDeadline();
		state = (await getTs(0)).ownerSeason!;
		assert.strictEqual(state.requests[1]!.status, "missed");
		assert.strictEqual(state.requests[2]!.status, "open");

		// The evaluation settles the rest and includes the adjustments, with the firing line stored
		g.setWithoutSavingToDB("phase", PHASE.PLAYOFFS);
		const final = await getTs(0);
		final.won = 41;
		final.lost = 41;
		final.playoffRoundsWon = -1;
		final.ownerMood = { wins: 0, playoffs: 0, money: 0 };
		await updateOwnerMood();
		const evaluated = await getTs(0);
		assert.strictEqual(evaluated.ownerSeason!.requests[2]!.status, "missed");
		const evaluation = evaluated.ownerEvaluation!;
		assert.strictEqual(evaluation.adjustments!.length, 3);
		const rule = await getFiringRule();
		assert.strictEqual(evaluation.firingLine, rule.line);
		// Playoffs: the base -0.2 plus the ultimatum's penalty
		assert.closeTo(
			evaluation.deltas.playoffs,
			-0.2 - evaluated.ownerSeason!.requests[2]!.penalty,
			1e-9,
		);
	});

	test("no requests or firing changes with the Owner's Office off", async () => {
		g.setWithoutSavingToDB("featureOwnerOffice", false);
		const t = await userTeam();
		const ts = await getTs(0);
		ts.won = 21;
		await onUserGame(t, ts);
		assert.isUndefined(ts.ownerSeason);
		assert.deepEqual(await getFiringRule(), { line: -1, graceBonus: 0 });
	});

	test("Owner page: profile, traits and a projection", async () => {
		idb.league = mockIDBLeague();
		await playGames(41);
		const data = (await ownerView.load({
			inputs: {},
			updateEvents: new Set(["firstRun"]),
			prevInputs: undefined,
			prevOutput: {},
			conditions: {},
		} as any)) as any;
		assert.isString(data.name);
		assert.strictEqual(data.traits.length, 4);
		assert.include(
			["grace", "safe", "warm", "hot", "fired"],
			data.projection.outlook,
		);
		assert.isNumber(data.projection.projectedTotal);

		g.setWithoutSavingToDB("featureOwnerOffice", false);
		const off = (await ownerView.load({
			inputs: {},
			updateEvents: new Set(["firstRun"]),
			prevInputs: undefined,
			prevOutput: {},
			conditions: {},
		} as any)) as any;
		assert.isString(off.errorMessage);
	});
});
