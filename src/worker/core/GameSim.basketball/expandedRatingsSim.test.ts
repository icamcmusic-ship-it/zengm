import { afterAll, assert, test } from "vitest";
import GameSim from "./index.ts";
import loadTeams from "../game/loadTeams.ts";
import { g } from "../../util/index.ts";
import { resetG } from "../../../test/helpers.ts";
import { withSeededRandom } from "./simLiveGameForTests.ts";
import {
	simExpandedGames,
	summarizeTotals,
	type Totals,
} from "./expandedRatingsMetrics.ts";
import { idb } from "../../db/index.ts";

/*
 * Expanded ratings (the expandedRatings setting) in the game sim: league averages stay about the same with the setting on, the new ratings
 * do what they should, play-by-play never changes a result, and with the setting off the new ratings are ignored.
 *
 * Calibration table (~6000 games, same rosters, same seeds): EXPANDED_METRICS=1 vitest --run --project basketball <this file>
 */

const env = (globalThis as any).process?.env ?? {};

afterAll(() => {
	resetG();
});

const print = (label: string, off: Totals, on: Totals) => {
	const a = summarizeTotals(off);
	const b = summarizeTotals(on);
	const lines = [`${label} (${off.teamGames / 2} games)`, "stat\toff\ton\tdiff"];
	for (const key of Object.keys(a) as (keyof typeof a)[]) {
		lines.push(
			`${key}\t${a[key].toFixed(2)}\t${b[key].toFixed(2)}\t${(b[key] - a[key]).toFixed(2)}`,
		);
	}
	(globalThis as any).process.stdout.write(lines.join("\n") + "\n");
};

test.skipIf(!env.EXPANDED_METRICS)(
	"calibration table",
	async () => {
		const numGames = Number(env.EXPANDED_GAMES ?? 6000);
		for (const realistic of [false, true]) {
			const off = await simExpandedGames({
				expanded: false,
				numGames,
				realistic,
			});
			const on = await simExpandedGames({
				expanded: true,
				numGames,
				realistic,
			});
			print(
				`same rosters, sim off vs on, realisticPossessions ${realistic}`,
				off,
				on,
			);
		}
		// Rosters generated with the setting off vs on (the whole new league experience)
		const off = await simExpandedGames({
			expanded: false,
			expandedGen: false,
			numGames,
		});
		const on = await simExpandedGames({ expanded: true, numGames });
		print("generated off + sim off vs generated on + sim on", off, on);
	},
	24 * 3600 * 1000,
);

test("league averages stay about the same with the setting on", async () => {
	const numGames = 300;
	const a = summarizeTotals(
		await simExpandedGames({ expanded: false, numGames, seed: 3 }),
	);
	const b = summarizeTotals(
		await simExpandedGames({ expanded: true, numGames, seed: 3 }),
	);
	assert.approximately(b.pts, a.pts, 2);
	assert.approximately(b["fg%"], a["fg%"], 1);
	assert.approximately(b.trb, a.trb, 1.5);
	assert.approximately(b.tov, a.tov, 0.8);
	assert.approximately(b.stl, a.stl, 0.6);
	assert.approximately(b.blk, a.blk, 0.6);
}, 300_000);

// Box score of one game, as a string
const boxOf = (result: any) =>
	JSON.stringify(
		result.team.map((t: any) => ({
			stat: t.stat,
			players: t.player.map((p: any) => [p.id, p.stat]),
		})),
	);

const simOne = async (
	seed: number,
	doPlayByPlay: boolean,
	expanded: boolean,
	strip: boolean,
) => {
	let box = "";
	await simExpandedGames({
		expanded,
		numGames: 1,
		gamesPerRoster: 1,
		seed,
		onGame: () => {},
	});
	// simExpandedGames left the league in the cache: play one more game with the requested options
	await withSeededRandom(seed, async () => {
		g.setWithoutSavingToDB("expandedRatings", expanded);
		if (strip) {
			for (const p of await idb.cache.players.getAll()) {
				for (const r of p.ratings as any[]) {
					delete r.wng;
					delete r.pdef;
					delete r.idef;
				}
			}
		}
		const teams = await loadTeams([0, 1], {});
		const sim = new GameSim({
			gid: seed,
			teams: [teams[0]!, teams[1]!],
			baseInjuryRate: g.get("injuryRate"),
			doPlayByPlay,
			homeCourtFactor: 1,
			allStarGame: false,
			neutralSite: false,
		});
		box = boxOf(sim.run());
	});
	return box;
};

test("play-by-play logging does not change a result with the setting on", async () => {
	for (const seed of [11, 12, 13]) {
		const off = await simOne(seed, false, true, false);
		const on = await simOne(seed, true, true, false);
		assert.strictEqual(on, off, `seed ${seed}`);
	}
}, 120_000);

test("with the setting off, stored expanded ratings are ignored", async () => {
	for (const seed of [21, 22]) {
		const withFields = await simOne(seed, false, false, false);
		const withoutFields = await simOne(seed, false, false, true);
		assert.strictEqual(withFields, withoutFields, `seed ${seed}`);
		// ... and with it on they matter
		const on = await simOne(seed, false, true, false);
		assert.notStrictEqual(on, withFields);
	}
}, 120_000);
