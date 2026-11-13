import { assert, test } from "vitest";
import {
	addAdv,
	addTeamAdv,
	ADV,
	ADV_LEN,
	advStat,
	LINEUPS_KEEP,
	LINEUPS_MAX,
	newAdv,
	playTypeProfile,
	ptIndex,
	PT_INDEX,
	PT_POSS,
	PT_PTS,
	pruneLineups,
	sumAdv,
} from "./advStats.ts";

test("player records add up element by element, older shorter layouts too", () => {
	const a = newAdv();
	a[ADV.dfga2] = 10;
	a[ADV.dfgm2] = 4;
	const b = newAdv().slice(0, ADV_LEN - 5);
	b[ADV.dfga2] = 10;
	b[ADV.dfgm2] = 6;
	addAdv(a, b);
	assert.strictEqual(advStat(a, "dfgp"), 50);
	assert.isUndefined(advStat(undefined, "dfgp"));
	assert.isUndefined(sumAdv([{}, {}]));
	assert.strictEqual(sumAdv([{ adv: a }, { adv: a }])![ADV.dfga2], 40);
});

test("play-type profile", () => {
	const a = newAdv();
	a[ptIndex(PT_INDEX.spot, PT_POSS)] = 30;
	a[ptIndex(PT_INDEX.spot, PT_PTS)] = 33;
	a[ptIndex(PT_INDEX.iso, PT_POSS)] = 10;
	a[ptIndex(PT_INDEX.iso, PT_PTS)] = 8;
	const profile = playTypeProfile(a)!;
	assert.strictEqual(profile.poss, 40);
	const spot = profile.types.find((t) => t.key === "spot")!;
	assert.strictEqual(spot.freq, 75);
	assert.closeTo(spot.ppp!, 1.1, 1e-9);
	assert.isUndefined(playTypeProfile(newAdv()));
});

test("lineups merge by their players and are pruned to the most used", () => {
	const season = { t: [1, 2], lu: [] as number[][] };
	addTeamAdv(
		season,
		{ t: [1, 1], lu: [[1, 2, 3, 4, 5, 600, 10, 8, 12, 12]] },
		5,
	);
	addTeamAdv(
		season,
		{
			t: [1, 1],
			lu: [
				[1, 2, 3, 4, 5, 60, 2, 1, 1, 1],
				[1, 2, 3, 4, 6, 30, 1, 0, 1, 1],
			],
		},
		5,
	);
	assert.deepStrictEqual(season.t, [3, 4]);
	assert.strictEqual(season.lu.length, 2);
	assert.deepStrictEqual(season.lu[0], [1, 2, 3, 4, 5, 660, 12, 9, 13, 13]);
	const many = Array.from({ length: LINEUPS_MAX + 1 }, (_, i) => [
		i,
		1000 + i,
		2000 + i,
		3000 + i,
		4000 + i,
		i,
		0,
		0,
		0,
		0,
	]);
	addTeamAdv(season, { t: [], lu: many }, 5);
	assert.strictEqual(season.lu.length, LINEUPS_KEEP);
	assert.strictEqual(season.lu[0]![5], 660);
	assert.strictEqual(pruneLineups(season.lu, 5, 3).length, 3);
});
