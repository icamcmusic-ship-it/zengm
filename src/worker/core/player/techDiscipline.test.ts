import { assert, beforeEach, test } from "vitest";
import { g } from "../../util/index.ts";
import {
	FLAGRANT_SUSPENSION_FIRST,
	TECH_SUSPENSION_FIRST,
	isSuspended,
	recordDiscipline,
	scaleFine,
	serveSuspensionGame,
	suspensionGames,
	techFine,
} from "./techDiscipline.ts";
import { TECH_SUSPENSION_AT } from "../../../common/pbpFlavor/plays.ts";

beforeEach(() => {
	g.setWithoutSavingToDB("season", 2030);
	g.setWithoutSavingToDB("salaryCap", 140588);
	g.setWithoutSavingToDB("userTids", [0]);
});

// A free agent (tid < 0): recordDiscipline does its bookkeeping without writing news
const freeAgent = () => ({ pid: 1, tid: -1 }) as any;

test("the play-by-play's suspension threshold is the league's", () => {
	assert.strictEqual(TECH_SUSPENSION_AT, TECH_SUSPENSION_FIRST);
});

test("suspension thresholds: the 16th technical, then every 2nd; 6 flagrant points, then every 2", () => {
	assert.strictEqual(suspensionGames(14, 15, 16, 2), 0);
	assert.strictEqual(suspensionGames(15, 16, 16, 2), 1);
	assert.strictEqual(suspensionGames(16, 17, 16, 2), 0);
	assert.strictEqual(suspensionGames(17, 18, 16, 2), 1);
	// two thresholds crossed in one game
	assert.strictEqual(suspensionGames(15, 18, 16, 2), 2);
	assert.strictEqual(suspensionGames(0, 5, FLAGRANT_SUSPENSION_FIRST, 2), 0);
	assert.strictEqual(suspensionGames(5, 6, FLAGRANT_SUSPENSION_FIRST, 2), 1);
	assert.strictEqual(suspensionGames(5, 8, FLAGRANT_SUSPENSION_FIRST, 2), 2);
});

test("fines follow the NBA schedule, scaled to the salary cap", () => {
	assert.strictEqual(techFine(1), 2000);
	assert.strictEqual(techFine(6), 3000);
	assert.strictEqual(techFine(16), 5000);
	assert.strictEqual(scaleFine(2000, 140588), 2000);
	assert.strictEqual(scaleFine(2000, 281176), 4000);
	assert.isAtLeast(scaleFine(2000, 1), 100);
});

test("technicals and flagrant points add up over the season into suspensions, served game by game", async () => {
	const p = freeAgent();
	assert.isFalse(await recordDiscipline(p, { tf: 0, fp: 0, flagrant2: 0 }));
	assert.isUndefined(p.discipline);
	for (let i = 0; i < 15; i++) {
		await recordDiscipline(p, { tf: 1, fp: 0, flagrant2: 0 });
	}
	assert.strictEqual(p.discipline.tf, 15);
	assert.isFalse(isSuspended(p));
	assert.strictEqual(p.discipline.fines, 5 * 2000 + 5 * 3000 + 5 * 4000);
	await recordDiscipline(p, { tf: 1, fp: 2, flagrant2: 1 });
	assert.strictEqual(p.discipline.suspension, 1);
	assert.strictEqual(
		p.discipline.fines,
		5 * 2000 + 5 * 3000 + 5 * 4000 + 5000 + 35000,
	);
	assert.isTrue(isSuspended(p));
	assert.isTrue(serveSuspensionGame(p));
	assert.isFalse(isSuspended(p));
	assert.isFalse(serveSuspensionGame(p));
	assert.strictEqual(p.discipline.served, 1);
	await recordDiscipline(p, { tf: 0, fp: 4, flagrant2: 0 });
	assert.strictEqual(p.discipline.fp, 6);
	assert.strictEqual(p.discipline.suspension, 1);

	// A new season starts from zero, and an old suspension doesn't carry over
	g.setWithoutSavingToDB("season", 2031);
	assert.isFalse(isSuspended(p));
	await recordDiscipline(p, { tf: 1, fp: 0, flagrant2: 0 });
	assert.deepEqual(
		{ tf: p.discipline.tf, fp: p.discipline.fp, season: p.discipline.season },
		{ tf: 1, fp: 0, season: 2031 },
	);
});
