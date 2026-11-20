// Coach of the Year and Executive of the Year (League Extra coachExecAwards): plays a short season in a headless league, then checks
// the awards' scoring and storage, the user's team, old-league data and every page that shows them.
import "fake-indexeddb/auto";
import { assert, beforeAll, describe, test } from "vitest";
import {
	COACH_OF_THE_YEAR,
	COY_KEY,
	DEFAULT_EOY_FORMULA,
	EOY_KEY,
	EXEC_OF_THE_YEAR,
} from "../../common/coachExecAwards.ts";
import { LEAGUE_DATABASE_VERSION, PHASE } from "../../common/constants.ts";
import { defaultGameAttributes } from "../../common/defaultGameAttributes.ts";
import { makeSeededRandom } from "../../common/random.ts";
import { last } from "../../common/utils.ts";
import {
	saveCoachExecAwardFormulas,
	getCoachExecAwardSettings,
} from "../api/awardSettings.ts";
import {
	awardCoachOfTheYear,
	awardExecOfTheYear,
	getCoachExecFormula,
	getCoyCandidates,
	getEoyCandidates,
	getExecAwards,
	getExecAwardsForSeason,
	getTeamAwardContexts,
} from "../core/awards/coachExecAwards.ts";
import { game, league, phase } from "../core/index.ts";
import { idb } from "../db/index.ts";
import { g, helpers } from "../util/index.ts";
import { getDefaultSettings } from "./newLeague.ts";
import * as views from "./index.ts";

const load = async (id: string, params: Record<string, string>) => {
	const view = (views as any)[id];
	assert.isDefined(view, id);
	const inputs = view.processInputs ? view.processInputs(params, {}) : {};
	return await view.load({
		inputs,
		updateEvents: new Set(["firstRun"]),
		prevInputs: inputs,
		prevOutput: {},
		conditions: {},
	});
};

// Fails the test if anything draws from the main random stream
const noRandom = async <T>(f: () => Promise<T>) => {
	const orig = Math.random;
	Math.random = () => {
		throw new Error("Math.random called");
	};
	try {
		return await f();
	} finally {
		Math.random = orig;
	}
};

const clearExecAwards = async (season: number) => {
	for (const t of await idb.cache.teams.getAll()) {
		for (const gm of [...(t.gm ? [t.gm] : []), ...(t.formerGms ?? [])]) {
			gm.awards = gm.awards?.filter((a) => a.season !== season);
		}
		await idb.cache.teams.put(t);
	}
	for (const ts of await idb.cache.teamSeasons.getAll()) {
		if (ts.season === season && ts.execOfTheYear) {
			delete ts.execOfTheYear;
			await idb.cache.teamSeasons.put(ts);
		}
	}
};

describe("Coach & Executive of the Year", { timeout: 5 * 60 * 1000 }, () => {
	let season: number;

	beforeAll(
		async () => {
			Math.random = makeSeededRandom(11);
			await league.createStream(
				{},
				{
					confs: last(defaultGameAttributes.confs).value,
					divs: last(defaultGameAttributes.divs).value,
					fromFile: {
						gameAttributes: undefined,
						hasRookieContracts: true,
						maxGid: undefined,
						startingSeason: undefined,
						teams: undefined,
						version: LEAGUE_DATABASE_VERSION,
					},
					getLeagueOptions: undefined,
					keptKeys: new Set(),
					lid: 0,
					name: "coachExecAwards",
					setLeagueCreationStatus: () => {},
					settings: {
						...getDefaultSettings(),
						numGames: 6,
						numGamesPlayoffSeries: [1, 1],
					} as any,
					shuffleRosters: false,
					startingSeasonFromInput: "2025",
					teamsFromInput: helpers.addPopRank(helpers.getTeamsDefault()),
					tid: 0,
				},
			);
			await league.loadGameAttributes();
			season = g.get("season");
			await phase.newPhase(PHASE.REGULAR_SEASON, {});
			await game.play(3, {});
		},
		10 * 60 * 1000,
	);

	test("during the season: Award Races shows both races with every candidate scored", async () => {
		assert.isTrue(g.get("coachingStaff"));
		const output = await load("awardRaces", { season: String(season) });
		const kinds = output.coachExecRaces.map((race: any) => race.kind);
		assert.deepStrictEqual(kinds, ["coy", "eoy"]);
		for (const race of output.coachExecRaces) {
			assert.isAbove(race.candidates.length, 0, race.kind);
			assert.isUndefined(race.winnerId, race.kind);
			for (const c of race.candidates) {
				assert.isTrue(Number.isFinite(c.score), `${race.kind} ${c.name}`);
			}
			// Best first
			for (let i = 1; i < race.candidates.length; i++) {
				assert.isAtLeast(
					race.candidates[i - 1].score,
					race.candidates[i].score,
				);
			}
		}
		const eoy = output.coachExecRaces[1];
		// The user's front office is a candidate, as "You"
		const user = eoy.candidates.find((c: any) => c.user);
		if (user) {
			assert.strictEqual(user.name, "You");
			assert.strictEqual(user.tid, g.get("userTid"));
		}
	});

	test("team variables: win% against preseason and roster projections, payroll and injuries", async () => {
		const contexts = await getTeamAwardContexts(season);
		assert.strictEqual(contexts.size, g.get("numActiveTeams"));
		const expMean =
			[...contexts.values()].reduce((sum, ctx) => sum + ctx.expWinp, 0) /
			contexts.size;
		// Projections are against the league average
		assert.closeTo(expMean, 0.5, 0.05);
		for (const ctx of contexts.values()) {
			assert.isAtLeast(ctx.winp, 0);
			assert.isAtMost(ctx.winp, 1);
			assert.strictEqual(ctx.prevWinp, 0.5); // No previous season
			assert.isAtLeast(ctx.payrollEff, -1);
			assert.isAtMost(ctx.payrollEff, 2);
			assert.isAtLeast(ctx.injuryRate, 0);
			assert.isTrue(Number.isFinite(ctx.mov));
			assert.isTrue(Number.isFinite(ctx.movesWS));
		}
	});

	test("the awards are given after the playoffs, deterministic, and stored once", async () => {
		while (g.get("phase") <= PHASE.PLAYOFFS) {
			await game.play(1, {});
		}
		assert.strictEqual(g.get("phase"), PHASE.DRAFT_LOTTERY);
		assert.strictEqual(g.get("season"), season);

		// Coach of the Year: on the coach, the top candidate
		const coaches = await idb.cache.coaches.getAll();
		const coyWinners = coaches.filter((c) =>
			c.awards.some((a) => a.season === season && a.type === COACH_OF_THE_YEAR),
		);
		assert.strictEqual(coyWinners.length, 1);
		const coy = await noRandom(() => getCoyCandidates(season));
		assert.strictEqual(coy.candidates[0]!.cid, coyWinners[0]!.cid);

		// Executive of the Year: on the AI GM, or on the team season for the user
		const execs = await getExecAwardsForSeason(season);
		assert.strictEqual(execs.length, 1);
		const eoy = await noRandom(() => getEoyCandidates(season));
		assert.strictEqual(eoy.candidates[0]!.tid, execs[0]!.tid);
		const t = await idb.cache.teams.get(execs[0]!.tid);
		if (execs[0]!.user) {
			const ts = await idb.cache.teamSeasons.indexGet(
				"teamSeasonsBySeasonTid",
				[season, execs[0]!.tid],
			);
			assert.isDefined(ts?.execOfTheYear);
		} else {
			const gms = [...(t?.gm ? [t.gm] : []), ...(t?.formerGms ?? [])];
			assert.isTrue(
				gms.some((gm) =>
					gm.awards?.some(
						(a) => a.season === season && a.type === EXEC_OF_THE_YEAR,
					),
				),
			);
		}

		// News
		const events = await idb.merged.events.getAll({ season });
		assert.isTrue(
			events.some(
				(e) => e.type === "award" && e.text?.includes(EXEC_OF_THE_YEAR),
			),
		);
		assert.isTrue(
			events.some(
				(e) => e.type === "award" && e.text?.includes(COACH_OF_THE_YEAR),
			),
		);

		// Given again: nothing changes, and no random numbers are used
		await noRandom(async () => {
			await awardCoachOfTheYear();
			await awardExecOfTheYear();
		});
		assert.strictEqual((await getExecAwardsForSeason(season)).length, 1);
		assert.strictEqual(
			(await idb.cache.coaches.getAll()).filter((c) =>
				c.awards.some(
					(a) => a.season === season && a.type === COACH_OF_THE_YEAR,
				),
			).length,
			1,
		);

		// Same scores every time
		const again = await getEoyCandidates(season);
		assert.deepStrictEqual(
			again.candidates.map((c) => [c.tid, c.score]),
			eoy.candidates.map((c) => [c.tid, c.score]),
		);
	});

	test("Award Races, Award History, History, Coaches and Front Offices show the winners", async () => {
		const coyWinner = (await idb.cache.coaches.getAll()).find((c) =>
			c.awards.some((a) => a.season === season && a.type === COACH_OF_THE_YEAR),
		)!;
		const exec = (await getExecAwardsForSeason(season))[0]!;

		const races = await load("awardRaces", { season: String(season) });
		assert.strictEqual(races.coachExecRaces[0].winnerId, coyWinner.cid);
		assert.strictEqual(races.coachExecRaces[1].winnerId, exec.tid);

		const coyHistory = await load("awardHistory", { award: COY_KEY });
		assert.strictEqual(coyHistory.award, COY_KEY);
		assert.strictEqual(coyHistory.awardName, COACH_OF_THE_YEAR);
		assert.strictEqual(coyHistory.coachExecRows.length, 1);
		assert.strictEqual(coyHistory.coachExecRows[0].cid, coyWinner.cid);
		assert.strictEqual(coyHistory.coachExecRows[0].season, season);
		assert.isString(coyHistory.coachExecRows[0].record);
		const keys = coyHistory.awardOptions.map((option: any) => option.key);
		assert.include(keys, COY_KEY);
		assert.include(keys, EOY_KEY);
		assert.include(keys, "MVP");

		const eoyHistory = await load("awardHistory", { award: EOY_KEY });
		assert.strictEqual(eoyHistory.coachExecRows.length, 1);
		assert.strictEqual(eoyHistory.coachExecRows[0].tid, exec.tid);
		assert.strictEqual(eoyHistory.coachExecRows[0].name, exec.name);

		// Player awards are unchanged
		const mvp = await load("awardHistory", { award: "MVP" });
		assert.isUndefined(mvp.coachExecRows);
		assert.isAbove(mvp.rows.length, 0);

		const history = await load("history", { season: String(season) });
		assert.strictEqual(history.coachExecAwards.coy.cid, coyWinner.cid);
		assert.strictEqual(history.coachExecAwards.eoy.tid, exec.tid);
		assert.isTrue(history.coachExecAwards.showCoy);
		assert.isTrue(history.coachExecAwards.showEoy);

		const coaches = await load("coaches", { season: String(season) });
		assert.isTrue(
			coaches.coy.some(
				(a: any) => a.season === season && a.cid === coyWinner.cid,
			),
		);

		if (!exec.user) {
			const frontOffices = await load("frontOffices", {});
			const gms = [
				...frontOffices.rows.map((row: any) => row.gm),
				...frontOffices.market,
			].filter(Boolean);
			assert.isTrue(
				gms.some(
					(gm: any) => gm.gmid === exec.gmid && gm.execAwards.includes(season),
				),
			);
		}
	});

	test("the user's front office: You, stored on the team season, on GM History", async () => {
		const userTid = g.get("userTid");
		await clearExecAwards(season);

		// Make the user's team the best by the formula
		await saveCoachExecAwardFormulas({ eoy: "winp" });
		const ts = (await idb.cache.teamSeasons.indexGet("teamSeasonsBySeasonTid", [
			season,
			userTid,
		]))!;
		const saved = { won: ts.won, lost: ts.lost };
		ts.won = 100;
		ts.lost = 0;
		await idb.cache.teamSeasons.put(ts);

		const best = await awardExecOfTheYear();
		assert.strictEqual(best?.tid, userTid);
		assert.isTrue(best?.user);
		assert.strictEqual(best?.name, "You");
		assert.deepStrictEqual(ts.execOfTheYear, { name: "You", user: true });
		// Not on any GM
		for (const t of await idb.cache.teams.getAll()) {
			assert.isFalse(
				!!t.gm?.awards?.some((a) => a.season === season),
				t.abbrev,
			);
		}

		const gmHistory = await load("gmHistory", {});
		assert.deepStrictEqual(
			gmHistory.execAwards.map((a: any) => a.season),
			[season],
		);
		const all = await getExecAwards();
		assert.isTrue(all.some((a) => a.season === season && a.user));
		const history = await load("history", { season: String(season) });
		assert.isTrue(history.coachExecAwards.eoy.user);

		ts.won = saved.won;
		ts.lost = saved.lost;
		await idb.cache.teamSeasons.put(ts);
		await saveCoachExecAwardFormulas({});
	});

	test("who ran each season: multi team mode counts, spectator and auto play seasons don't", async () => {
		const userTid = g.get("userTid");
		const otherTid = userTid === 1 ? 2 : 1;
		const getTs = async (tid: number) =>
			(await idb.cache.teamSeasons.indexGet("teamSeasonsBySeasonTid", [
				season,
				tid,
			]))!;
		const userTs = await getTs(userTid);
		const otherTs = await getTs(otherTid);
		// Recorded when the regular season started
		assert.strictEqual(userTs.userControl, "user");
		assert.isUndefined(otherTs.userControl);

		const userFlags = async () =>
			new Map(
				(await getEoyCandidates(season)).candidates.map((c) => [c.tid, c.user]),
			);

		// Multi team mode: both teams this season
		otherTs.userControl = "user";
		await idb.cache.teamSeasons.put(otherTs);
		let gmHistory = await load("gmHistory", {});
		assert.deepStrictEqual(
			gmHistory.teamHistories.map((h: any) => h.history[0].tid).sort(),
			[userTid, otherTid].sort(),
		);
		let flags = await userFlags();
		assert.isTrue(flags.get(userTid));
		assert.isTrue(flags.get(otherTid));

		// Auto play all season: not the user's season
		userTs.userControl = "auto";
		delete otherTs.userControl;
		await idb.cache.teamSeasons.put(userTs);
		await idb.cache.teamSeasons.put(otherTs);
		gmHistory = await load("gmHistory", {});
		assert.strictEqual(gmHistory.teamHistories.length, 0);
		flags = await userFlags();
		assert.isFalse(flags.get(userTid));
		assert.isFalse(flags.get(otherTid));

		userTs.userControl = "user";
		await idb.cache.teamSeasons.put(userTs);
	});

	test("Award Settings: formulas are editable, validated and previewed", async () => {
		const info = await getCoachExecAwardSettings({ season });
		assert.isTrue(info.available.coy);
		assert.isTrue(info.available.eoy);
		assert.strictEqual(info.formulas.eoy, DEFAULT_EOY_FORMULA);
		assert.include(info.variables.coy, "expWinp");
		assert.include(info.variables.eoy, "movesWS");
		assert.isString(info.variableDocs.payrollEff);

		// Invalid: an error, and the preview keeps the saved formula
		const bad = await getCoachExecAwardSettings({
			season,
			formulas: { coy: "winp + nope" },
		});
		assert.include(bad.errors.coy, "nope");
		// A variable of the other award isn't valid
		const wrong = await getCoachExecAwardSettings({
			season,
			formulas: { coy: "movesWS" },
		});
		assert.isDefined(wrong.errors.coy);

		// Preview with a custom formula: ordered by it
		const preview = await getCoachExecAwardSettings({
			season,
			formulas: { eoy: "payrollEff" },
		});
		const eoyRace = preview.races.find((race) => race.kind === "eoy")!;
		for (let i = 1; i < eoyRace.candidates.length; i++) {
			assert.isAtLeast(
				eoyRace.candidates[i - 1]!.vars.payrollEff,
				eoyRace.candidates[i]!.vars.payrollEff,
			);
		}

		let threw = false;
		try {
			await saveCoachExecAwardFormulas({ coy: "1 +" });
		} catch {
			threw = true;
		}
		assert.isTrue(threw);

		await saveCoachExecAwardFormulas({ coy: "mov", eoy: DEFAULT_EOY_FORMULA });
		// The default is saved as undefined
		assert.deepStrictEqual(g.get("coachExecAwardFormulas"), { coy: "mov" });
		assert.strictEqual(getCoachExecFormula("coy"), "mov");
		const byMov = await getCoyCandidates(season);
		for (let i = 1; i < byMov.candidates.length; i++) {
			assert.isAtLeast(
				byMov.candidates[i - 1]!.vars.mov,
				byMov.candidates[i]!.vars.mov,
			);
		}
		await saveCoachExecAwardFormulas({});
		assert.isUndefined(g.get("coachExecAwardFormulas"));
	});

	test("old leagues: no formulas setting, bad saved formula, old Coach of the Year awards and GMs without awards", async () => {
		// Missing or invalid saved formula: the default
		g.setWithoutSavingToDB("coachExecAwardFormulas", undefined);
		assert.strictEqual(getCoachExecFormula("eoy"), DEFAULT_EOY_FORMULA);
		g.setWithoutSavingToDB("coachExecAwardFormulas", { eoy: "((" });
		assert.strictEqual(getCoachExecFormula("eoy"), DEFAULT_EOY_FORMULA);
		g.setWithoutSavingToDB("coachExecAwardFormulas", undefined);

		// A Coach of the Year from before (stored on the coach the old way, no season row): still listed
		const coach = (await idb.cache.coaches.getAll()).find(
			(c) => c.tid >= 0 && c.role === "head",
		)!;
		coach.awards.push({ season: season - 3, type: COACH_OF_THE_YEAR });
		await idb.cache.coaches.put(coach);

		// GMs from before the feature have no awards field
		for (const t of await idb.cache.teams.getAll()) {
			if (t.gm && !t.gm.awards?.length) {
				delete t.gm.awards;
				await idb.cache.teams.put(t);
			}
		}

		const coyHistory = await load("awardHistory", { award: COY_KEY });
		assert.isTrue(
			coyHistory.coachExecRows.some(
				(row: any) => row.season === season - 3 && row.cid === coach.cid,
			),
		);
		const coaches = await load("coaches", { season: String(season) });
		assert.isTrue(coaches.coy.some((a: any) => a.season === season - 3));
		const eoyHistory = await load("awardHistory", { award: EOY_KEY });
		assert.isAbove(eoyHistory.coachExecRows.length, 0);
		const frontOffices = await load("frontOffices", {});
		assert.isUndefined(frontOffices.errorMessage);

		coach.awards = coach.awards.filter((a) => a.season !== season - 3);
		await idb.cache.coaches.put(coach);
	});
});
