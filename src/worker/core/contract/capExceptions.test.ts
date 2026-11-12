// Salary cap exceptions (League Extras: Salary Cap Exceptions): legality of each exception, once per league year tracking, the user's signing flow, AI usage, the demand market, the repeater tax and the stretch provision, and that everything is unchanged with the setting off.
import { assert, beforeEach, describe, test } from "vitest";
import { PHASE, PLAYER } from "../../../common/constants.ts";
import { DEFAULT_LEVEL } from "../../../common/budgetLevels.ts";
import {
	getContractExp,
	getCurrentContract,
} from "../../../common/contracts.ts";
import {
	CAP_EXCEPTIONS,
	REPEATER_TAX_FACTOR,
} from "../../../common/capExceptions.ts";
import type { Contract, Phase, Player, Team } from "../../../common/types.ts";
import { mockIDBLeague, resetCache, resetG } from "../../../test/helpers.ts";
import { idb } from "../../db/index.ts";
import { g, helpers } from "../../util/index.ts";
import { formatEventText } from "../../util/formatEventText.ts";
import { contractNegotiation, finances, player, team } from "../index.ts";
import autoSign from "../freeAgents/autoSign.ts";
import { contractAmountForYears } from "../contractNegotiation/contractAmountForYears.ts";
import { generateContractOptions } from "../contractNegotiation/generateContractOptions.ts";
import { getDemandMarket } from "../freeAgents/decreaseDemands.ts";
import {
	applyStretchProvision,
	capExceptionsEnabled,
	getAiCapExceptionCapacity,
	getAvailableCapExceptions,
	getCapExceptionAmount,
	getCapExceptionsSummary,
	getLeagueYear,
	getSigningAdvice,
	getSigningCapInfo,
	getStretchedAmounts,
	isRepeaterTaxTeam,
	makeAiCapExceptionPicker,
	recordCapExceptionSigning,
} from "./capExceptions.ts";

const NUM_TEAMS = 3;
const USER_TID = 0;

const set = (key: string, value: unknown) =>
	(g as any).setWithoutSavingToDB(key, value);

// Every team has 13 players, with the payrolls given as multiples of the salary cap. 4 free agents.
const setup = async ({
	phase = PHASE.FREE_AGENCY,
	payrolls = [1.05, 1.05, 1.05],
	enabled = true,
}: {
	phase?: Phase;
	payrolls?: number[];
	enabled?: boolean;
} = {}) => {
	resetG();
	idb.league = mockIDBLeague();
	set("phase", phase);
	set("userTid", USER_TID);
	set("userTids", [USER_TID]);
	set("numTeams", NUM_TEAMS);
	set("numActiveTeams", NUM_TEAMS);
	set("featureCapExceptions", enabled);
	// So mood never gets in the way
	set("playersRefuseToNegotiate", false);
	const teams = helpers
		.getTeamsDefault()
		.slice(0, NUM_TEAMS)
		.map((t) => team.generate(t));
	await resetCache({ teams });

	const players: Player[] = [];
	for (let tid = 0; tid < NUM_TEAMS; tid++) {
		for (let i = 0; i < 13; i++) {
			players.push(
				player.generate(tid, 27, 2015, true, DEFAULT_LEVEL) as Player,
			);
		}
	}
	for (let i = 0; i < 4; i++) {
		players.push(
			player.generate(
				PLAYER.FREE_AGENT,
				27,
				2015,
				true,
				DEFAULT_LEVEL,
			) as Player,
		);
	}
	for (const [i, p] of players.entries()) {
		p.pid = i;
		await player.develop(p, 0);
		await player.updateValues(p);
	}
	await resetCache({ players: players as any, teams });

	const salaryCap = g.get("salaryCap");
	for (let tid = 0; tid < NUM_TEAMS; tid++) {
		const target = Math.round(payrolls[tid]! * salaryCap);
		const roster = await idb.cache.players.indexGetAll("playersByTid", tid);
		for (const [i, p] of roster.entries()) {
			const contract = getCurrentContract(p)!;
			const each = Math.floor(target / roster.length);
			const amount = i === 0 ? target - each * (roster.length - 1) : each;
			contract.amounts = contract.amounts.map(() => amount);
			// Expires after the first season a new contract would cover, so it counts in every phase
			while (getContractExp(contract) < g.get("season") + 2) {
				contract.amounts.push(amount);
			}
			await idb.cache.players.put(p);
		}
	}

	const freeAgents = await idb.cache.players.indexGetAll(
		"playersByTid",
		PLAYER.FREE_AGENT,
	);
	for (const p of freeAgents) {
		player.addToFreeAgents(p, {});
		await idb.cache.players.put(p);
	}
	return freeAgents;
};

const getTeam = async (tid: number) => (await idb.cache.teams.get(tid)) as Team;

// Sign a free agent with the user's team for an amount and number of years, returning accept's result (a string is an error)
const userSign = async (
	p: Player,
	amount: number,
	years: number,
	dryRun: boolean = false,
) => {
	p.contractDemand = { amount, exp: getLeagueYear() + years - 1 };
	await idb.cache.players.put(p);
	const negotiation = await contractNegotiation.create(p.pid, false);
	if (typeof negotiation === "string") {
		throw new Error(negotiation);
	}
	return contractNegotiation.accept({
		negotiation,
		amount,
		exp: getLeagueYear() + years - 1,
		dryRun,
	});
};

describe("salary cap exceptions", () => {
	describe("amounts and availability", () => {
		beforeEach(async () => {
			await setup();
		});

		test("amounts scale with the salary cap, in NBA-like proportions", () => {
			const cap = g.get("salaryCap");
			for (const type of helpers.keys(CAP_EXCEPTIONS)) {
				const amount = getCapExceptionAmount(type);
				assert.closeTo(
					amount / cap,
					CAP_EXCEPTIONS[type].capFraction,
					0.001,
					type,
				);
			}
			assert.isAbove(
				getCapExceptionAmount("nonTaxpayerMle"),
				getCapExceptionAmount("room"),
			);
			assert.isAbove(
				getCapExceptionAmount("room"),
				getCapExceptionAmount("taxpayerMle"),
			);
			assert.isAbove(
				getCapExceptionAmount("taxpayerMle"),
				getCapExceptionAmount("biAnnual"),
			);

			const before = getCapExceptionAmount("nonTaxpayerMle");
			set("salaryCap", 2 * cap);
			assert.closeTo(getCapExceptionAmount("nonTaxpayerMle") / before, 2, 0.01);
		});

		test("only with the setting on and a soft cap", () => {
			assert.isTrue(capExceptionsEnabled());
			const t: Pick<Team, "capExceptions" | "strategy"> = {
				strategy: "contending",
			};
			const payroll = g.get("salaryCap");
			assert.isAbove(getAvailableCapExceptions(t, payroll).length, 0);

			for (const salaryCapType of ["hard", "none"] as const) {
				set("salaryCapType", salaryCapType);
				assert.isFalse(capExceptionsEnabled());
				assert.deepEqual(getAvailableCapExceptions(t, payroll), []);
				assert.isUndefined(getSigningCapInfo(t, payroll, 5000, 2));
				assert.isUndefined(
					makeAiCapExceptionPicker({ t, roster: [], payroll, gm: undefined }),
				);
				assert.strictEqual(getAiCapExceptionCapacity(t, payroll, undefined), 0);
			}

			set("salaryCapType", "soft");
			set("featureCapExceptions", false);
			assert.isFalse(capExceptionsEnabled());
			assert.deepEqual(getAvailableCapExceptions(t, payroll), []);
			assert.isUndefined(getSigningCapInfo(t, payroll, 5000, 2));
			assert.isUndefined(
				makeAiCapExceptionPicker({ t, roster: [], payroll, gm: undefined }),
			);
		});

		test("a signing that fits under the cap uses cap space, not an exception", () => {
			const info = getSigningCapInfo({}, g.get("salaryCap") - 5000, 5000, 5);
			assert.strictEqual(info?.type, "capSpace");
		});

		test("the smallest exception that covers the contract is used", () => {
			const payroll = g.get("salaryCap");
			const biAnnual = getCapExceptionAmount("biAnnual");
			const mle = getCapExceptionAmount("nonTaxpayerMle");

			const small = getSigningCapInfo({}, payroll, biAnnual, 2);
			assert.strictEqual(
				small?.type === "exception" ? small.exception.type : undefined,
				"biAnnual",
			);

			// Too long for the bi-annual exception (2 years)
			const long = getSigningCapInfo({}, payroll, biAnnual, 3);
			assert.strictEqual(
				long?.type === "exception" ? long.exception.type : undefined,
				"nonTaxpayerMle",
			);

			const big = getSigningCapInfo({}, payroll, mle, 4);
			assert.strictEqual(
				big?.type === "exception" ? big.exception.type : undefined,
				"nonTaxpayerMle",
			);

			// More than the mid-level exception, or longer than it allows
			const tooBig = getSigningCapInfo({}, payroll, mle + 100, 1);
			assert.strictEqual(tooBig?.type, "none");
			assert.include(
				tooBig?.type === "none" ? tooBig.reason : "",
				"only allows up to",
			);
			const tooLong = getSigningCapInfo({}, payroll, mle, 5);
			assert.strictEqual(tooLong?.type, "none");
			assert.include(
				tooLong?.type === "none" ? tooLong.reason : "",
				"up to 4 years",
			);
		});

		test("max contract lengths follow the league's limits", () => {
			set("maxContractLength", 3);
			const available = getAvailableCapExceptions({}, g.get("salaryCap"));
			const byType = Object.fromEntries(
				available.map((exception) => [exception.type, exception.maxYears]),
			);
			assert.deepEqual(byType, {
				nonTaxpayerMle: 3,
				taxpayerMle: 2,
				biAnnual: 2,
			});
		});

		test("teams near the luxury tax only have the taxpayer mid-level exception, teams far over it have nothing", () => {
			const tax = g.get("luxuryPayroll");
			const types = (payroll: number) =>
				getAvailableCapExceptions({}, payroll).map(
					(exception) => exception.type,
				);

			// Over the cap but well under the tax: mid-level (either size) and bi-annual
			assert.sameMembers(types(g.get("salaryCap")), [
				"nonTaxpayerMle",
				"taxpayerMle",
				"biAnnual",
			]);

			// At the tax line, the full mid-level exception would go over the first apron, so it's cut down to what fits
			const atTax = getAvailableCapExceptions({}, tax);
			const mle = atTax.find(
				(exception) => exception.type === "nonTaxpayerMle",
			);
			assert.isDefined(mle);
			assert.isBelow(mle!.amount, mle!.fullAmount);
			assert.isAtMost(tax + mle!.amount, 1.045 * tax);

			// Over the first apron: only the taxpayer mid-level exception
			assert.deepEqual(types(Math.round(1.05 * tax)), ["taxpayerMle"]);
			const info = getSigningCapInfo(
				{},
				Math.round(1.05 * tax),
				getCapExceptionAmount("taxpayerMle"),
				2,
			);
			assert.strictEqual(
				info?.type === "exception" ? info.exception.type : undefined,
				"taxpayerMle",
			);
			assert.strictEqual(
				getSigningCapInfo(
					{},
					Math.round(1.05 * tax),
					getCapExceptionAmount("taxpayerMle"),
					3,
				)?.type,
				"none",
			);

			// Over the second apron: nothing
			assert.deepEqual(types(Math.round(1.11 * tax)), []);
		});
	});

	describe("once per league year", () => {
		beforeEach(async () => {
			await setup();
		});

		test("each exception can be used once, and they come back next league year", async () => {
			const payroll = g.get("salaryCap");
			const leagueYear = getLeagueYear();
			assert.strictEqual(leagueYear, g.get("season") + 1);

			await recordCapExceptionSigning(1, {
				pid: 100,
				amount: 9000,
				exception: "nonTaxpayerMle",
				payroll,
			});
			let t = await getTeam(1);
			assert.deepEqual(t.capExceptions?.uses, [
				{ season: leagueYear, type: "nonTaxpayerMle", pid: 100, amount: 9000 },
			]);
			// Neither mid-level exception is left, the bi-annual one is
			assert.deepEqual(
				getAvailableCapExceptions(t, payroll).map((e) => e.type),
				["biAnnual"],
			);

			await recordCapExceptionSigning(1, {
				pid: 101,
				amount: 4000,
				exception: "biAnnual",
				payroll,
			});
			t = await getTeam(1);
			assert.deepEqual(getAvailableCapExceptions(t, payroll), []);
			assert.strictEqual(getSigningCapInfo(t, payroll, 3000, 1)?.type, "none");

			// Still the same league year in the next preseason and regular season
			set("season", g.get("season") + 1);
			set("phase", PHASE.REGULAR_SEASON);
			assert.strictEqual(getLeagueYear(), leagueYear);
			assert.deepEqual(getAvailableCapExceptions(t, payroll), []);

			// Next free agency: the mid-level exception is back, the bi-annual one is not (used last year)
			set("phase", PHASE.FREE_AGENCY);
			assert.strictEqual(getLeagueYear(), leagueYear + 1);
			assert.sameMembers(
				getAvailableCapExceptions(t, payroll).map((e) => e.type),
				["nonTaxpayerMle", "taxpayerMle"],
			);

			// And the year after that, the bi-annual exception is back too
			set("season", g.get("season") + 1);
			assert.sameMembers(
				getAvailableCapExceptions(t, payroll).map((e) => e.type),
				["nonTaxpayerMle", "taxpayerMle", "biAnnual"],
			);

			// Other teams are not affected
			assert.isUndefined((await getTeam(2)).capExceptions);
		});

		test("the taxpayer mid-level exception uses up the mid-level and bi-annual exceptions", async () => {
			const payroll = g.get("salaryCap");
			await recordCapExceptionSigning(1, {
				pid: 100,
				amount: 5000,
				exception: "taxpayerMle",
				payroll,
			});
			assert.deepEqual(
				getAvailableCapExceptions(await getTeam(1), payroll),
				[],
			);
		});

		test("a team that used cap space only has the room exception, once", async () => {
			const cap = g.get("salaryCap");
			// Lots of cap space, used on a free agent
			await recordCapExceptionSigning(1, {
				pid: 100,
				amount: 20000,
				exception: undefined,
				payroll: cap - 30000,
			});
			let t = await getTeam(1);
			assert.strictEqual(t.capExceptions?.capSpaceSeason, getLeagueYear());
			assert.deepEqual(
				getAvailableCapExceptions(t, cap).map((e) => e.type),
				["room"],
			);
			const info = getSigningCapInfo(t, cap, getCapExceptionAmount("room"), 3);
			assert.strictEqual(
				info?.type === "exception" ? info.exception.type : undefined,
				"room",
			);

			await recordCapExceptionSigning(1, {
				pid: 101,
				amount: 5000,
				exception: "room",
				payroll: cap,
			});
			t = await getTeam(1);
			assert.deepEqual(getAvailableCapExceptions(t, cap), []);

			// Next league year it's a normal over the cap team again
			set("season", g.get("season") + 1);
			assert.sameMembers(
				getAvailableCapExceptions(t, cap).map((e) => e.type),
				["nonTaxpayerMle", "taxpayerMle", "biAnnual"],
			);
		});

		test("filling a little cap space or signing a minimum contract doesn't cost the other exceptions", async () => {
			const cap = g.get("salaryCap");
			await recordCapExceptionSigning(1, {
				pid: 100,
				amount: 3000,
				exception: undefined,
				payroll: cap - 4000,
			});
			await recordCapExceptionSigning(1, {
				pid: 101,
				amount: g.get("minContract"),
				exception: undefined,
				payroll: cap - 50000,
			});
			assert.isUndefined((await getTeam(1)).capExceptions);
		});
	});

	describe("user signings", () => {
		test("an over the cap team signs a mid-tier free agent with the mid-level exception, once", async () => {
			const [p, p2, p3] = await setup({ phase: PHASE.FREE_AGENCY });
			const amount = 9000;
			assert.isAbove(amount, getCapExceptionAmount("biAnnual"));
			const payrollBefore = await team.getPayroll(USER_TID);
			assert.isAbove(payrollBefore, g.get("salaryCap"));

			const result = await userSign(p!, amount, 3);
			assert.strictEqual(typeof result, "function");
			assert.strictEqual(p!.tid, USER_TID);
			assert.strictEqual(getCurrentContract(p!)?.exception, "nonTaxpayerMle");
			assert.strictEqual(
				await team.getPayroll(USER_TID),
				payrollBefore + amount,
			);

			const t = await getTeam(USER_TID);
			assert.deepEqual(t.capExceptions?.uses, [
				{
					season: getLeagueYear(),
					type: "nonTaxpayerMle",
					pid: p!.pid,
					amount,
				},
			]);

			// The transaction says so
			const events = await idb.cache.events.getAll();
			const event = events.find(
				(event) => event.type === "freeAgent" && event.pids?.[0] === p!.pid,
			);
			assert.strictEqual((event as any)?.exception, "nonTaxpayerMle");
			const text = await formatEventText(event as any);
			assert.include(text, "using the mid-level exception");

			// The page shows what's left
			const summary = await getCapExceptionsSummary(
				USER_TID,
				await team.getPayroll(USER_TID),
			);
			assert.deepEqual(
				summary?.available.map((exception) => exception.type),
				["biAnnual"],
			);
			assert.strictEqual(summary?.used[0]?.type, "nonTaxpayerMle");

			// A second mid-level signing is refused, a bi-annual one is fine, and then nothing is left
			const second = await userSign(p2!, amount, 2);
			assert.include(String(second), "cannot go over the salary cap");
			const third = await userSign(p2!, 4000, 2);
			assert.strictEqual(typeof third, "function");
			assert.strictEqual(getCurrentContract(p2!)?.exception, "biAnnual");
			const fourth = await userSign(p3!, 2000, 1);
			assert.include(String(fourth), "already used your salary cap exceptions");

			// A minimum contract still always works
			const fifth = await userSign(p3!, g.get("minContract"), 1);
			assert.strictEqual(typeof fifth, "function");
			assert.isUndefined(getCurrentContract(p3!)?.exception);
		});

		test("undoing the signing gives the exception back", async () => {
			const [p] = await setup({ phase: PHASE.REGULAR_SEASON });
			const result = await userSign(p!, 9000, 2);
			if (typeof result !== "function") {
				throw new Error(String(result));
			}
			assert.strictEqual(
				(await getTeam(USER_TID)).capExceptions?.uses.length,
				1,
			);
			assert.isTrue(await result());
			assert.isUndefined((await getTeam(USER_TID)).capExceptions);
			assert.strictEqual(p!.tid, PLAYER.FREE_AGENT);
		});

		test("the contract can't be longer than the exception allows", async () => {
			const [p] = await setup();
			const tooLong = await userSign(p!, 9000, 5, true);
			assert.include(String(tooLong), "up to 4 years");
			assert.isUndefined(await userSign(p!, 9000, 4, true));
		});

		test("Sign button: asking for more years than the exception allows offers the longest it allows, at his price for it", async () => {
			await setup();
			const payroll = g.get("salaryCap") + 1000;
			const mle = getCapExceptionAmount("nonTaxpayerMle");
			const exp5 = getLeagueYear() + 4;
			const ovr = 55;
			const priceFor = (amount: number) => (years: number) =>
				Math.round(
					contractAmountForYears({
						amount: amount / 1000,
						askedYears: 5,
						years,
						ovr,
					}) * 1000,
				);

			// Cheap enough that 4 years at a higher price still fits the mid-level: offer 4 years
			const amount = Math.round(mle * 0.8);
			const advice = getSigningAdvice({}, payroll, {
				amount,
				exp: exp5,
				amountForYears: priceFor(amount),
			});
			assert.strictEqual(advice?.type, "shorter");
			if (advice?.type === "shorter") {
				assert.strictEqual(advice.maxYears, 4);
				assert.strictEqual(advice.askedYears, 5);
				assert.strictEqual(advice.exp, exp5 - 1);
				assert.strictEqual(advice.exception, "nonTaxpayerMle");
				// He asks more per year for a shorter deal (1.15x at ovr 55)
				assert.strictEqual(advice.amount, priceFor(amount)(4));
				assert.isAbove(advice.amount, amount);
				// And the shorter deal really goes through
				assert.strictEqual(
					getSigningCapInfo({}, payroll, advice.amount, 4)?.type,
					"exception",
				);
			}

			// At the full mid-level, 4 years costs more than it covers: the button is disabled with the reason
			const tooLong = getSigningAdvice({}, payroll, {
				amount: mle,
				exp: exp5,
				amountForYears: priceFor(mle),
			});
			assert.strictEqual(tooLong?.type, "tooLong");
			assert.include(
				tooLong?.type === "tooLong" ? tooLong.reason : "",
				"only allows up to 4",
			);

			// Nothing to say when the length fits, the amount fits under the cap, the amount is the minimum, or no exception covers it
			const ok = { amountForYears: priceFor(amount) };
			assert.isUndefined(
				getSigningAdvice({}, payroll, { ...ok, amount, exp: exp5 - 1 }),
			);
			assert.isUndefined(
				getSigningAdvice({}, g.get("salaryCap") - amount - 10, {
					...ok,
					amount,
					exp: exp5,
				}),
			);
			assert.isUndefined(
				getSigningAdvice({}, payroll, {
					...ok,
					amount: g.get("minContract"),
					exp: exp5,
				}),
			);
			assert.isUndefined(
				getSigningAdvice({}, payroll, { ...ok, amount: mle * 2, exp: exp5 }),
			);
			set("featureCapExceptions", false);
			assert.isUndefined(
				getSigningAdvice({}, payroll, { ...ok, amount, exp: exp5 }),
			);
		});

		test("negotiation: rows longer than the exception allows say so", async () => {
			const [p] = await setup();
			const amount = 6000;
			p!.contractDemand = { amount, exp: getLeagueYear() + 4 };
			await idb.cache.players.put(p!);
			const negotiation = await contractNegotiation.create(p!.pid, false);
			if (typeof negotiation === "string") {
				throw new Error(negotiation);
			}
			const rows = await generateContractOptions(
				negotiation,
				{ amount: amount / 1000, exp: getLeagueYear() + 4 },
				50,
			);
			const byYears = Object.fromEntries(rows.map((row) => [row.years, row]));
			assert.isDefined(byYears[5]?.disabledReason);
			assert.deepEqual(byYears[5]?.exceptionTooLong, {
				exception: "nonTaxpayerMle",
				maxYears: 4,
			});
			assert.isUndefined(byYears[4]?.disabledReason);
			assert.strictEqual(byYears[4]?.exception, "nonTaxpayerMle");
			assert.isUndefined(byYears[4]?.exceptionTooLong);
		});

		test("a dry run uses nothing", async () => {
			const [p] = await setup();
			assert.isUndefined(await userSign(p!, 9000, 2, true));
			assert.isUndefined((await getTeam(USER_TID)).capExceptions);
			assert.strictEqual(p!.tid, PLAYER.FREE_AGENT);
		});

		test("with the setting off, the old rule and message apply exactly", async () => {
			const [p] = await setup({ enabled: false });
			const result = await userSign(p!, 9000, 2);
			assert.strictEqual(
				result,
				"You cannot go over the salary cap to sign free agents to contracts higher than the minimum salary.",
			);
			assert.strictEqual(p!.tid, PLAYER.FREE_AGENT);
			assert.isUndefined(
				await getCapExceptionsSummary(
					USER_TID,
					await team.getPayroll(USER_TID),
				),
			);

			// Under the cap nothing is recorded either
			const freeAgents = await setup({
				enabled: false,
				payrolls: [0.5, 1.05, 1.05],
			});
			const ok = await userSign(freeAgents[0]!, 30000, 2);
			assert.strictEqual(typeof ok, "function");
			assert.isUndefined((await getTeam(USER_TID)).capExceptions);
			const event = (await idb.cache.events.getAll()).find(
				(event) => event.type === "freeAgent",
			);
			assert.isFalse(Object.hasOwn(event as any, "exception"));
			assert.isFalse(
				Object.hasOwn(getCurrentContract(freeAgents[0]!) as any, "exception"),
			);
		});

		test("with a hard cap the setting does nothing", async () => {
			const [p] = await setup();
			set("salaryCapType", "hard");
			const result = await userSign(p!, 9000, 2);
			assert.strictEqual(
				result,
				"You cannot go over the salary cap to sign players to contracts higher than the minimum salary.",
			);
		});

		test("using cap space leaves only the room exception", async () => {
			const freeAgents = await setup({ payrolls: [0.8, 1.05, 1.05] });
			const capSpace = g.get("salaryCap") - (await team.getPayroll(USER_TID));
			const result = await userSign(freeAgents[0]!, capSpace, 2);
			assert.strictEqual(typeof result, "function");
			assert.isUndefined(getCurrentContract(freeAgents[0]!)?.exception);

			const mle = await userSign(freeAgents[1]!, 9000, 2, true);
			assert.include(String(mle), "room exception");
			const room = await userSign(
				freeAgents[1]!,
				getCapExceptionAmount("room"),
				3,
			);
			assert.strictEqual(typeof room, "function");
			assert.strictEqual(getCurrentContract(freeAgents[1]!)?.exception, "room");
		});
	});

	describe("AI teams", () => {
		// Free agents good enough for any rotation, asking for a mid-level salary
		const makeWanted = async (freeAgents: Player[], amount: number) => {
			for (const p of freeAgents) {
				p.value = 90;
				p.contractDemand = { amount, exp: getLeagueYear() + 4 };
				await idb.cache.players.put(p);
			}
		};

		const autoSignManyTimes = async (num: number) => {
			for (let i = 0; i < num; i++) {
				await autoSign();
			}
		};

		test("over the cap AI teams sign free agents with their exceptions, once each, with shortened contracts", async () => {
			const freeAgents = await setup({ payrolls: [1.05, 1.02, 1.02] });
			await makeWanted(freeAgents, 9000);
			const payrollBefore = await team.getPayroll(1);
			await autoSignManyTimes(100);

			for (const tid of [1, 2]) {
				const t = await getTeam(tid);
				assert.deepEqual(
					t.capExceptions?.uses.map((use) => use.type),
					["nonTaxpayerMle"],
					`team ${tid}`,
				);
				const signed = (
					await idb.cache.players.indexGetAll("playersByTid", tid)
				).filter((p) => getCurrentContract(p)?.exception);
				assert.strictEqual(signed.length, 1);
				const contract = getCurrentContract(signed[0]!)!;
				assert.strictEqual(contract.exception, "nonTaxpayerMle");
				assert.strictEqual(contract.amounts[0], 9000);
				// Asked for 5 years, the mid-level exception allows 4
				assert.strictEqual(contract.amounts.length, 4);
			}
			assert.strictEqual(await team.getPayroll(1), payrollBefore + 9000);

			// The user's team is not touched, and the other two free agents are still there
			assert.isUndefined((await getTeam(USER_TID)).capExceptions);
			assert.strictEqual(
				(await idb.cache.players.indexGetAll("playersByTid", PLAYER.FREE_AGENT))
					.length,
				2,
			);
		});

		test("with the setting off, over the cap AI teams sign nobody above the minimum", async () => {
			const freeAgents = await setup({
				payrolls: [1.05, 1.02, 1.02],
				enabled: false,
			});
			await makeWanted(freeAgents, 9000);
			await autoSignManyTimes(100);
			assert.strictEqual(
				(await idb.cache.players.indexGetAll("playersByTid", PLAYER.FREE_AGENT))
					.length,
				4,
			);
			for (const tid of [1, 2]) {
				assert.isUndefined((await getTeam(tid)).capExceptions);
			}
		});

		test("AI teams don't go into the luxury tax unless they're contending and the GM doesn't mind", async () => {
			await setup();
			const tax = g.get("luxuryPayroll");
			const payroll = tax - 2000;
			const roster = Array.from({ length: 13 }, (_, i) => ({ value: 40 + i }));
			const star = {
				value: 100,
				born: { year: g.get("season") - 27, loc: "" },
			};
			const contract = { amount: 5000, exp: getLeagueYear() + 4 };

			const pick = (
				strategy: Team["strategy"],
				avoidTaxRankShift: number | undefined,
				p = star,
			) =>
				makeAiCapExceptionPicker({
					t: { strategy },
					roster,
					payroll,
					gm:
						avoidTaxRankShift === undefined ? undefined : { avoidTaxRankShift },
				})?.(p, contract);

			assert.isUndefined(pick("rebuilding", 0));
			assert.isUndefined(pick("contending", -1));
			const picked = pick("contending", 0);
			assert.isDefined(picked);
			// Shortened to the exception's length
			assert.isAtMost(
				picked!.exp,
				getLeagueYear() + picked!.exception.maxYears - 1,
			);
			assert.isDefined(pick("contending", undefined));
			assert.isDefined(pick("contending", 1));

			// Only for a player who'd be in the rotation
			const benchPlayer = { ...star, value: 41 };
			assert.isUndefined(pick("contending", 1, benchPlayer));

			// Under the tax, a small signing that stays under it is fine for anyone
			const small = { amount: 1900, exp: getLeagueYear() };
			for (const strategy of ["rebuilding", "contending"] as const) {
				assert.isDefined(
					makeAiCapExceptionPicker({
						t: { strategy },
						roster,
						payroll,
						gm: { avoidTaxRankShift: -1 },
					})?.(star, small),
				);
			}

			// The demand market capacity follows the same rule
			assert.isAtMost(
				getAiCapExceptionCapacity(
					{ strategy: "rebuilding" },
					payroll,
					undefined,
				),
				2000,
			);
			assert.isAbove(
				getAiCapExceptionCapacity(
					{ strategy: "contending" },
					payroll,
					undefined,
				),
				2000,
			);
			assert.isAtMost(
				getAiCapExceptionCapacity({ strategy: "contending" }, payroll, {
					avoidTaxRankShift: -1,
				}),
				2000,
			);
		});

		test("rebuilding teams only use exceptions on young players, and nobody uses one on an end of the bench player", async () => {
			await setup();
			const payroll = g.get("salaryCap");
			const roster = Array.from({ length: 13 }, (_, i) => ({ value: 40 + i }));
			const contract = { amount: 8000, exp: getLeagueYear() + 1 };
			const season = g.get("season");
			const pick = (strategy: Team["strategy"], value: number, age: number) =>
				makeAiCapExceptionPicker({
					t: { strategy },
					roster,
					payroll,
					gm: undefined,
				})?.({ value, born: { year: season - age, loc: "" } }, contract);

			assert.isDefined(pick("rebuilding", 60, 24));
			assert.isUndefined(pick("rebuilding", 60, 31));
			assert.isDefined(pick("contending", 60, 31));
			assert.isUndefined(pick("contending", 41, 25));
		});

		test("the demand market counts exceptions like cap space", async () => {
			const freeAgents = await setup({ payrolls: [1.05, 1.02, 1.02] });
			await makeWanted(freeAgents, 9000);
			const mle = getCapExceptionAmount("nonTaxpayerMle");

			const market = await getDemandMarket(freeAgents);
			const markets = freeAgents
				.map((p) => market.getMarket(p))
				.sort((a, b) => b - a);
			// Two AI teams, each with a mid-level exception
			assert.deepEqual(markets, [mle, mle, 0, 0]);
			assert.strictEqual(
				freeAgents.filter((p) => !market.unwanted(p)).length,
				2,
			);

			set("featureCapExceptions", false);
			const marketOff = await getDemandMarket(freeAgents);
			assert.deepEqual(
				freeAgents.map((p) => marketOff.getMarket(p)),
				[0, 0, 0, 0],
			);
			assert.isTrue(freeAgents.every((p) => marketOff.unwanted(p)));
		});
	});

	describe("repeater luxury tax", () => {
		const setupTaxHistory = async (taxedSeasons: number[]) => {
			await setup({ phase: PHASE.REGULAR_SEASON });
			idb.league = mockIDBLeague();
			const season = g.get("season");
			const teamSeasons = [];
			for (let s = season - 5; s <= season; s++) {
				const row = team.genSeasonRow({ tid: 1 } as any);
				row.season = s;
				row.expenses.luxuryTax = taxedSeasons.includes(s) ? 5000 : 0;
				teamSeasons.push(row);
			}
			for (const row of teamSeasons) {
				await idb.cache.teamSeasons.add(row);
			}
			return season;
		};

		test("off by default, also with the main setting on", async () => {
			const season = await setupTaxHistory([]);
			await setupTaxHistory([season - 1, season - 2, season - 3, season - 4]);
			assert.isFalse(await isRepeaterTaxTeam(1));
		});

		test("3 of the previous 4 seasons over the tax makes a repeater", async () => {
			let season = await setupTaxHistory([]);
			season = await setupTaxHistory([season - 1, season - 2, season - 4]);
			set("capExceptionsRepeaterTax", true);
			assert.isTrue(await isRepeaterTaxTeam(1));
			assert.isFalse(await isRepeaterTaxTeam(2));

			// Only 2 of the previous 4 (the current season and 5 seasons ago don't count)
			season = await setupTaxHistory([]);
			await setupTaxHistory([season, season - 1, season - 2, season - 5]);
			set("capExceptionsRepeaterTax", true);
			assert.isFalse(await isRepeaterTaxTeam(1));

			// A sub-setting: off when the main setting is off
			season = await setupTaxHistory([]);
			await setupTaxHistory([season - 1, season - 2, season - 3]);
			set("capExceptionsRepeaterTax", true);
			assert.isTrue(await isRepeaterTaxTeam(1));
			set("featureCapExceptions", false);
			assert.isFalse(await isRepeaterTaxTeam(1));
		});

		test("the repeater rate is 5/3 of the normal rate", async () => {
			await setup();
			const payroll = g.get("luxuryPayroll") + 10000;
			const normal = finances.getLuxuryTaxAmount(payroll);
			assert.strictEqual(normal, g.get("luxuryTax") * 10000);
			assert.closeTo(
				finances.getLuxuryTaxAmount(payroll, true),
				REPEATER_TAX_FACTOR * normal,
				1e-6,
			);
			assert.strictEqual(
				finances.getLuxuryTaxAmount(g.get("luxuryPayroll"), true),
				0,
			);
		});

		test("repeaters are charged the higher rate at the end of the season", async () => {
			const season = await setupTaxHistory([]);
			await setupTaxHistory([season - 1, season - 2, season - 3]);
			set("capExceptionsRepeaterTax", true);
			// Team 1 over the tax line
			const roster = await idb.cache.players.indexGetAll("playersByTid", 1);
			const contract = getCurrentContract(roster[0]!)!;
			contract.amounts = contract.amounts.map((amount) => amount + 40000);
			await idb.cache.players.put(roster[0]!);
			const payroll = await team.getPayroll(1);
			assert.isAbove(payroll, g.get("luxuryPayroll"));

			await finances.assessPayrollMinLuxury();
			const teamSeason = await idb.cache.teamSeasons.indexGet(
				"teamSeasonsByTidSeason",
				[1, season],
			);
			assert.closeTo(
				teamSeason!.expenses.luxuryTax,
				REPEATER_TAX_FACTOR *
					g.get("luxuryTax") *
					(payroll - g.get("luxuryPayroll")),
				1e-6,
			);
		});
	});

	describe("stretch provision", () => {
		const makeContract = (start: number, amounts: number[]): Contract => ({
			type: "freeAgent",
			start,
			amounts,
			payments: [],
		});

		test("in the offseason, everything left is spread over 2n+1 seasons", async () => {
			await setup({ phase: PHASE.FREE_AGENCY });
			const start = getLeagueYear();
			const stretched = getStretchedAmounts(
				makeContract(start - 1, [9000, 10000, 11000]),
			);
			assert.deepEqual(
				stretched?.amounts,
				[9000, 4200, 4200, 4200, 4200, 4200],
			);
			assert.strictEqual(stretched?.numSeasons, 5);
			assert.strictEqual(stretched?.total, 21000);
			assert.strictEqual(stretched?.exp, start + 4);
		});

		test("during the regular season, this season is paid as usual and later seasons are stretched", async () => {
			await setup({ phase: PHASE.REGULAR_SEASON });
			const season = g.get("season");
			const stretched = getStretchedAmounts(
				makeContract(season, [9000, 6000, 6000]),
			);
			assert.deepEqual(
				stretched?.amounts,
				[9000, 2400, 2400, 2400, 2400, 2400],
			);

			// Nothing after this season: nothing to stretch
			assert.isUndefined(getStretchedAmounts(makeContract(season, [9000])));
		});

		test("releasing a player with the stretch provision spreads only the guaranteed part, and drops an undecided team option", async () => {
			await setup({ phase: PHASE.REGULAR_SEASON });
			set("capExceptionsStretch", true);
			set("contractOptions", true);
			const season = g.get("season");
			const roster = await idb.cache.players.indexGetAll("playersByTid", 1);
			const p = roster[0]!;
			p.contracts = [
				{
					...makeContract(season, [10000, 10000, 10000, 10000]),
					// Half of seasons 2 and 3 guaranteed, then a team option
					guaranteed: [10000, 5000, 5000, 5000],
					option: { type: "team", season: season + 3 },
				},
			];
			await idb.cache.players.put(p);
			const payrollBefore = await team.getPayroll(1);
			const payrollNextBefore = await team.getPayroll(1, season + 1);
			await player.release(p, false, true);

			const contract = p.contracts.at(-1)!;
			assert.isTrue(contract.stretched);
			assert.strictEqual(contract.endedEarly?.reason, "released");
			// This season in full, then 2 x 5000 over 5 seasons
			assert.deepEqual(contract.amounts, [10000, 2000, 2000, 2000, 2000, 2000]);
			assert.isUndefined(contract.guaranteed);
			assert.strictEqual(contract.option?.decision, "declined");
			// Still counts against the cap this season, and for 5 more seasons after
			assert.strictEqual(await team.getPayroll(1), payrollBefore);
			assert.strictEqual(
				await team.getPayroll(1, season + 1),
				payrollNextBefore - 10000 + 2000,
			);
			assert.strictEqual(getContractExp(contract), season + 5);
			assert.deepEqual(p.owedByTids, [1]);
		});

		test("without the sub-setting (or without asking for it) a release is unchanged", async () => {
			for (const [settingOn, stretch] of [
				[false, true],
				[true, false],
			] as const) {
				await setup({ phase: PHASE.REGULAR_SEASON });
				set("capExceptionsStretch", settingOn);
				const season = g.get("season");
				const p = (await idb.cache.players.indexGetAll("playersByTid", 1))[0]!;
				p.contracts = [makeContract(season, [10000, 10000, 10000])];
				await player.release(p, false, stretch);
				const contract = p.contracts.at(-1)!;
				assert.deepEqual(contract.amounts, [10000, 10000, 10000]);
				assert.isUndefined(contract.stretched);
			}
		});

		test("a player option that's still owed counts as exercised", () => {
			const contract: Contract = {
				...makeContract(2030, [5000, 5000]),
				option: { type: "player", season: 2031 },
			};
			set("season", 2030);
			set("phase", PHASE.REGULAR_SEASON);
			assert.isTrue(applyStretchProvision(contract));
			assert.deepEqual(contract.amounts, [5000, 1667, 1667, 1667]);
			assert.strictEqual(contract.option?.decision, "exercised");
		});
	});
});
