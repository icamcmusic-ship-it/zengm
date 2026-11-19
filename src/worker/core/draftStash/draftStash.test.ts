// Draft-and-stash in a mock league: stashing a pick (off the roster and the payroll), his seasons abroad (pre-draft rows,
// never pro), development, bringing him over (contract and buyout), rights lapsing, the AI rules and trading his rights.
import { afterAll, assert, beforeEach, describe, test } from "vitest";
import { PHASE, PLAYER } from "../../../common/constants.ts";
import { DEFAULT_LEVEL } from "../../../common/budgetLevels.ts";
import { getPreDraftStats, getProStats } from "../../../common/preDraft.ts";
import { Rng } from "../../../common/collegeStats/rng.ts";
import type { Player, TeamSeason } from "../../../common/types.ts";
import { mockIDBLeague, resetCache, resetG } from "../../../test/helpers.ts";
import { idb } from "../../db/index.ts";
import { g } from "../../util/index.ts";
import { player, team, trade } from "../index.ts";
import { addContract, createContract } from "../contract/index.ts";
import { makeBlankPreDraftStatsRow } from "../player/normalizePreDraft.ts";
import {
	addStashSeasons,
	aiStashAfterDraft,
	bringOverPlayer,
	developStashed,
	getBringOverTerms,
	getStashedPlayers,
	getStashInfo,
	getTeamStashView,
	stashFreeAgencyStart,
	stashPlayer,
} from "./index.ts";

const realRandom = Math.random;
afterAll(() => {
	Math.random = realRandom;
	// @ts-expect-error
	idb.league = undefined;
});

const DRAFT_YEAR = 2025;

const teamSeason = (tid: number, season: number) =>
	({
		tid,
		season,
		cash: 10000,
		expenses: {
			luxuryTax: 0,
			minTax: 0,
			salary: 0,
			coaching: 0,
			health: 0,
			facilities: 0,
			scouting: 0,
		},
		numPlayersTradedAway: 0,
	}) as unknown as TeamSeason;

const setOvr = (p: Player, ovr: number) => {
	p.ratings.at(-1)!.ovr = ovr;
	p.ratings.at(-1)!.pot = Math.max(ovr, p.ratings.at(-1)!.pot);
};

let nextPid = 0;
const rosterPlayer = (tid: number, ovr: number) => {
	const p = player.generate(
		tid,
		26,
		DRAFT_YEAR - 5,
		true,
		DEFAULT_LEVEL,
	) as Player;
	p.pid = nextPid++;
	setOvr(p, ovr);
	return p;
};

// A pick drafted this season whose last season before the draft was abroad, signed to his rookie deal at the draft
const draftedPick = ({
	tid,
	round,
	pick,
	ovr,
	league = "EuroLeague",
	draftYear = DRAFT_YEAR,
	age = 20,
}: {
	tid: number;
	round: number;
	pick: number;
	ovr: number;
	league?: string;
	draftYear?: number;
	age?: number;
}) => {
	const p = player.generate(
		tid,
		age,
		draftYear,
		false,
		DEFAULT_LEVEL,
	) as Player;
	p.pid = nextPid++;
	p.born.year = draftYear - age;
	setOvr(p, ovr);
	p.draft = {
		...p.draft,
		round,
		pick,
		tid,
		originalTid: tid,
		year: draftYear,
	};
	p.college = "";
	const row: any = makeBlankPreDraftStatsRow(draftYear);
	row.gp = 30;
	row.teamName = league;
	p.stats = [row];
	delete p.contractDemand;
	p.contracts = [];
	addContract(
		p,
		createContract({
			contract: { amount: 1500, exp: draftYear + 2, rookie: true },
			type: "rookie",
			start: draftYear + 1,
		}),
	);
	return p;
};

const initG = () => {
	resetG();
	g.setWithoutSavingToDB("featureDraftStash", true);
	g.setWithoutSavingToDB("season", DRAFT_YEAR);
	g.setWithoutSavingToDB("phase", PHASE.AFTER_DRAFT);
	g.setWithoutSavingToDB("numTeams", 3);
	g.setWithoutSavingToDB("numActiveTeams", 3);
	g.setWithoutSavingToDB("userTid", 0);
	g.setWithoutSavingToDB("userTids", [0]);
};

const setup = async (players: Player[], seasons: number[]) => {
	const teamSeasons = [];
	for (const season of seasons) {
		for (const tid of [0, 1, 2]) {
			teamSeasons.push(teamSeason(tid, season));
		}
	}
	await resetCache({ players, teamSeasons });
	idb.league = mockIDBLeague();
};

const getP = async (pid: number) => (await idb.cache.players.get(pid))!;

describe("draft-and-stash", () => {
	beforeEach(() => {
		const rng = new Rng("draftStash.test");
		Math.random = () => rng.random();
		nextPid = 0;
		initG();
	});

	test("stash, seasons abroad, development, bring over", async () => {
		const roster = Array.from({ length: 12 }, () => rosterPlayer(0, 50));
		const pick = draftedPick({ tid: 0, round: 2, pick: 2, ovr: 40 });
		await setup([...roster, pick], [DRAFT_YEAR, DRAFT_YEAR + 1]);

		const payrollBefore = await team.getPayroll(0, DRAFT_YEAR + 1);
		assert.strictEqual(
			(await getStashInfo(await getP(pick.pid)))?.type,
			"canStash",
		);

		// Not before the draft is over... and only in the offseason
		g.setWithoutSavingToDB("phase", PHASE.PRESEASON);
		assert.isString(await stashPlayer(await getP(pick.pid)));
		g.setWithoutSavingToDB("phase", PHASE.AFTER_DRAFT);

		assert.isUndefined(
			await stashPlayer(await getP(pick.pid), { silent: true }),
		);
		let p = await getP(pick.pid);
		assert.strictEqual(p.tid, PLAYER.STASHED);
		assert.deepEqual(p.stash, {
			tid: 0,
			season: DRAFT_YEAR,
			league: "EuroLeague",
		});
		// The unpaid rookie deal is undone: no roster spot, no salary
		assert.strictEqual(p.contracts.length, 0);
		assert.strictEqual(
			(await idb.cache.players.indexGetAll("playersByTid", 0)).length,
			12,
		);
		assert.strictEqual(
			await team.getPayroll(0, DRAFT_YEAR + 1),
			payrollBefore - 1500,
		);
		assert.deepEqual(
			(await getStashedPlayers(0)).map((p2) => p2.pid),
			[pick.pid],
		);
		assert.deepEqual(await getStashedPlayers(1), []);
		const events = await idb.cache.events.getAll();
		assert.isTrue(
			events.some((e) => e.type === "draftStash" && e.pids?.includes(pick.pid)),
		);
		// Can't stash twice
		assert.isString(await stashPlayer(p));

		// The roster page lists him for the user's team
		const view = await getTeamStashView(0);
		assert.strictEqual(view?.stashed.length, 1);
		assert.strictEqual(view?.stashed[0]!.seasonsAbroad, 0);

		// No season abroad for the season he was drafted in
		g.setWithoutSavingToDB("phase", PHASE.PLAYOFFS);
		await addStashSeasons();
		assert.strictEqual((await getP(pick.pid)).stats.length, 1);

		// Next season: he develops in the preseason and plays it abroad
		g.setWithoutSavingToDB("season", DRAFT_YEAR + 1);
		g.setWithoutSavingToDB("phase", PHASE.PRESEASON);
		const numRatings = p.ratings.length;
		const developed = await developStashed(undefined);
		assert.deepEqual(
			developed.map((p2) => p2.pid),
			[pick.pid],
		);
		p = await getP(pick.pid);
		assert.strictEqual(p.ratings.length, numRatings + 1);
		assert.strictEqual(p.ratings.at(-1)!.season, DRAFT_YEAR + 1);

		g.setWithoutSavingToDB("phase", PHASE.PLAYOFFS);
		await addStashSeasons();
		await addStashSeasons();
		p = await getP(pick.pid);
		const abroad = p.stats.filter((row) => row.stash);
		assert.strictEqual(abroad.length, 1);
		assert.strictEqual(abroad[0]!.season, DRAFT_YEAR + 1);
		assert.strictEqual(abroad[0]!.teamName, "EuroLeague");
		assert.strictEqual(abroad[0]!.tid, PLAYER.DOES_NOT_EXIST);
		assert.isAbove(abroad[0]!.gp!, 0);
		// Shown with his pre-draft/overseas stats, never as pro stats
		assert.strictEqual(getProStats(p).length, 0);
		assert.deepEqual(
			getPreDraftStats(p).map((row) => row.season),
			[DRAFT_YEAR, DRAFT_YEAR + 1],
		);
		// Same league, same season: the same line
		const line = { ...abroad[0]! };
		p.stats = p.stats.filter((row) => !row.stash);
		await idb.cache.players.put(p);
		await addStashSeasons();
		p = await getP(pick.pid);
		assert.deepEqual(
			p.stats.find((row) => row.stash),
			line,
		);

		// Not during the season
		assert.isString(await bringOverPlayer(p));

		// Bring him over in the next offseason: rookie scale (a year after the draft), and a buyout
		g.setWithoutSavingToDB("phase", PHASE.RESIGN_PLAYERS);
		const terms = getBringOverTerms(p);
		assert.isTrue(terms.contract.rookie);
		assert.strictEqual(terms.contract.exp, DRAFT_YEAR + 1 + 2);
		assert.isAbove(terms.buyout, 0);
		const cashBefore = (await idb.cache.teamSeasons.indexGet(
			"teamSeasonsBySeasonTid",
			[DRAFT_YEAR + 1, 0],
		))!.cash;
		assert.isUndefined(await bringOverPlayer(p, { silent: true }));
		p = await getP(pick.pid);
		assert.strictEqual(p.tid, 0);
		assert.isUndefined(p.stash);
		const contract = p.contracts.at(-1)!;
		assert.strictEqual(contract.type, "rookie");
		assert.strictEqual(contract.start, DRAFT_YEAR + 2);
		const ts = (await idb.cache.teamSeasons.indexGet("teamSeasonsBySeasonTid", [
			DRAFT_YEAR + 1,
			0,
		]))!;
		assert.strictEqual(ts.expenses.salary, terms.buyout);
		assert.strictEqual(ts.cash, cashBefore - terms.buyout);
		assert.deepEqual(await getStashedPlayers(), []);
		// His overseas season stays on his record as overseas
		assert.strictEqual(getProStats(p).length, 0);
		assert.strictEqual(getPreDraftStats(p).length, 2);
	});

	test("a college pick can't be stashed", async () => {
		const pick = draftedPick({
			tid: 0,
			round: 2,
			pick: 5,
			ovr: 40,
			league: "Duke",
		});
		await setup([pick], [DRAFT_YEAR]);
		assert.isString(await stashPlayer(await getP(pick.pid)));
		assert.isUndefined(await getStashInfo(await getP(pick.pid)));
	});

	test("rights lapse at the start of free agency, and he becomes a free agent", async () => {
		const old = draftedPick({ tid: 0, round: 2, pick: 1, ovr: 40, age: 21 });
		await setup([old], [DRAFT_YEAR]);
		assert.isUndefined(
			await stashPlayer(await getP(old.pid), { silent: true }),
		);

		// Three seasons later: still his
		g.setWithoutSavingToDB("season", DRAFT_YEAR + 3);
		g.setWithoutSavingToDB("phase", PHASE.FREE_AGENCY);
		await stashFreeAgencyStart();
		assert.strictEqual((await getP(old.pid)).tid, PLAYER.STASHED);

		// Four seasons after the draft: lapsed
		g.setWithoutSavingToDB("season", DRAFT_YEAR + 4);
		await stashFreeAgencyStart();
		const p = await getP(old.pid);
		assert.strictEqual(p.tid, PLAYER.FREE_AGENT);
		assert.isUndefined(p.stash);
		assert.isDefined(p.contractDemand);
		const events = await idb.cache.events.getAll();
		assert.isTrue(
			events.some((e) => e.type === "draftStash" && e.text?.includes("lapsed")),
		);
	});

	test("AI teams stash picks who aren't ready and bring them over when they are", async () => {
		const roster = Array.from({ length: 13 }, () => rosterPlayer(1, 50));
		// A late pick far from the rotation: stashed. A lottery pick: never. A late pick who is ready: kept
		const raw = draftedPick({ tid: 1, round: 2, pick: 10, ovr: 38 });
		const lottery = draftedPick({ tid: 1, round: 1, pick: 2, ovr: 38 });
		const ready = draftedPick({ tid: 1, round: 2, pick: 11, ovr: 49 });
		// The user's own pick is never touched by the AI
		const user = draftedPick({ tid: 0, round: 2, pick: 12, ovr: 30 });
		await setup(
			[...roster, raw, lottery, ready, user],
			[DRAFT_YEAR, DRAFT_YEAR + 1],
		);

		await aiStashAfterDraft();
		assert.strictEqual((await getP(raw.pid)).tid, PLAYER.STASHED);
		assert.strictEqual((await getP(lottery.pid)).tid, 1);
		assert.strictEqual((await getP(ready.pid)).tid, 1);
		assert.strictEqual((await getP(user.pid)).tid, 0);

		// He develops into a rotation player abroad: brought over at the start of free agency
		g.setWithoutSavingToDB("season", DRAFT_YEAR + 1);
		g.setWithoutSavingToDB("phase", PHASE.FREE_AGENCY);
		const p = await getP(raw.pid);
		setOvr(p, 52);
		await idb.cache.players.put(p);
		// (a roster with room)
		for (const p2 of (
			await idb.cache.players.indexGetAll("playersByTid", 1)
		).slice(0, 3)) {
			p2.tid = PLAYER.FREE_AGENT;
			await idb.cache.players.put(p2);
		}
		await stashFreeAgencyStart();
		assert.strictEqual((await getP(raw.pid)).tid, 1);
	});

	test("rights are traded like a player, and the trade can be undone", async () => {
		const roster0 = Array.from({ length: 10 }, () => rosterPlayer(0, 50));
		const roster1 = Array.from({ length: 10 }, () => rosterPlayer(1, 50));
		const pick = draftedPick({ tid: 1, round: 2, pick: 3, ovr: 42 });
		await setup([...roster0, ...roster1, pick], [DRAFT_YEAR]);
		assert.isUndefined(
			await stashPlayer(await getP(pick.pid), { silent: true }),
		);

		// The trade screen keeps him (he belongs to team 1)
		const teams = await trade.updatePlayers([
			{ tid: 0, pids: [], dpids: [], pidsExcluded: [], dpidsExcluded: [] },
			{
				tid: 1,
				pids: [pick.pid],
				dpids: [],
				pidsExcluded: [],
				dpidsExcluded: [],
			},
		]);
		assert.deepEqual(teams[1].pids, [pick.pid]);
		// ...but not as a player of team 0
		const wrong = await trade.updatePlayers([
			{
				tid: 0,
				pids: [pick.pid],
				dpids: [],
				pidsExcluded: [],
				dpidsExcluded: [],
			},
			{ tid: 1, pids: [], dpids: [], pidsExcluded: [], dpidsExcluded: [] },
		]);
		assert.deepEqual(wrong[0].pids, []);

		const s = await trade.summary(teams);
		assert.deepEqual(
			s.teams[1].trade.map((p2) => p2.pid),
			[pick.pid],
		);
		// No salary moves
		assert.strictEqual(s.teams[1].total, 0);

		const undo = await trade.processTrade(teams, undefined);
		let p = await getP(pick.pid);
		assert.strictEqual(p.tid, PLAYER.STASHED);
		assert.strictEqual(p.stash?.tid, 0);
		assert.deepEqual(
			(await getStashedPlayers(0)).map((p2) => p2.pid),
			[pick.pid],
		);
		assert.strictEqual(p.transactions?.at(-1)?.tid, 0);

		assert.isTrue(await undo());
		p = await getP(pick.pid);
		assert.strictEqual(p.tid, PLAYER.STASHED);
		assert.strictEqual(p.stash?.tid, 1);
	});
});
