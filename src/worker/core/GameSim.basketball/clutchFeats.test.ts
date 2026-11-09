import { assert, beforeAll, test } from "vitest";
import GameSim from "./index.ts";
import { player, team } from "../index.ts";
import loadTeams from "../game/loadTeams.ts";
import { g, helpers } from "../../util/index.ts";
import { resetCache, resetG } from "../../../test/helpers.ts";
import { DEFAULT_LEVEL } from "../../../common/budgetLevels.ts";
import { range } from "../../../common/utils.ts";
import { makeSeededRandom } from "../../../common/random.ts";
import getWinner from "../../../common/getWinner.ts";
import {
	clutchFlavorText,
	type ClutchMeta,
} from "../../../common/pbpFlavor/clutch.ts";

/*
 * Clutch plays (game-winners, game-tying shots, game-saving defensive plays) carry a metadata record from the sim itself, so the flavor
 * text works with play-by-play logging off, reads the same every time, and uses no random numbers.
 */

const withSeededRandom = async <T>(seed: number, fn: () => Promise<T> | T) => {
	const original = Math.random;
	Math.random = makeSeededRandom(seed);
	try {
		return await fn();
	} finally {
		Math.random = original;
	}
};

const NUM_GAMES = 600;

type Result = ReturnType<GameSim["run"]>;
const results: { off: Result; seed: number }[] = [];

const simGame = (seed: number, doPlayByPlay: boolean) =>
	withSeededRandom(seed, async () => {
		const teams = await loadTeams([0, 1], {});
		return new GameSim({
			gid: seed,
			teams: [teams[0]!, teams[1]!],
			baseInjuryRate: g.get("injuryRate"),
			doPlayByPlay,
			homeCourtFactor: 1,
			allStarGame: false,
			neutralSite: false,
		}).run();
	});

beforeAll(async () => {
	await withSeededRandom(77, async () => {
		resetG();
		g.setWithoutSavingToDB("season", 2013);
		const teamsDefault = helpers.getTeamsDefault().slice(0, 2);
		await resetCache({
			players: [
				...range(13).map(() =>
					player.generate(0, 25, 2010, true, DEFAULT_LEVEL),
				),
				...range(13).map(() =>
					player.generate(1, 25, 2010, true, DEFAULT_LEVEL),
				),
			],
			teams: teamsDefault.map(team.generate),
			teamSeasons: teamsDefault.map((t) => team.genSeasonRow(t)),
			teamStats: teamsDefault.map((t) => team.genStatsRow(t.tid)),
		});
	});
	for (const seed of range(NUM_GAMES).map((i) => 5000 + i)) {
		results.push({ seed, off: await simGame(seed, false) });
	}
}, 300_000);

const link = (p: { pid: number; name: string }) => `[${p.name}]`;

test("clutch plays carry flavor metadata with play-by-play off, and the text is deterministic", () => {
	let n = 0;
	for (const { seed, off } of results) {
		for (const [i, c] of off.clutchPlays.entries()) {
			assert.isDefined(c.meta, c.text);
			const a = clutchFlavorText(c.meta!, seed, i, link);
			const b = clutchFlavorText(c.meta!, seed, i, link);
			assert.strictEqual(a, b);
			assert.include(a, `[${c.meta!.player.name}]`);
			n += 1;
		}
	}
	assert.isAbove(n, 10);
});

test("logging play-by-play gives the same clutch plays and metadata", async () => {
	for (const { seed, off } of results
		.filter((r) => r.off.clutchPlays.length > 0)
		.slice(0, 8)) {
		const on = await simGame(seed, true);
		assert.deepStrictEqual(on.clutchPlays, off.clutchPlays);
	}
});

test("the wording varies between games", () => {
	const meta: ClutchMeta = {
		kind: "winner",
		player: { pid: 1, name: "A" },
		shot: "threePointer",
		time: 2.1,
		elam: false,
		ast: { pid: 2, name: "B" },
	};
	const texts = new Set(
		range(40).map((gid) => clutchFlavorText(meta, gid, 0, link)),
	);
	assert.isAbove(texts.size, 5);
	assert.include(clutchFlavorText(meta, 3, 0, link), "[B]");
});

test("game-saving defensive plays are detected, meet the criteria, and happen at sensible rates", () => {
	const counts = { winner: 0, tying: 0, forceOT: 0, defense: 0, shootout: 0 };
	const defPlays = { blk: 0, stl: 0, tov: 0 };
	for (const { off } of results) {
		for (const c of off.clutchPlays) {
			const meta = c.meta!;
			counts[meta.kind] += 1;
			if (meta.kind === "defense") {
				defPlays[meta.play] += 1;
				assert.isAtMost(meta.time, 10);
				assert.isAtLeast(meta.lead, 0);
				assert.isAtMost(meta.lead, 3);
				const winner = getWinner([off.team[0].stat, off.team[1].stat]);
				assert.strictEqual(off.team[winner as 0 | 1].id, c.tids[0]);
			}
		}
	}
	console.log(`clutch plays in ${NUM_GAMES} games`, counts, defPlays);
	if ((globalThis as any).process?.env?.["SHOW_CLUTCH"]) {
		for (const { seed, off } of results) {
			for (const [i, c] of off.clutchPlays.entries()) {
				console.log(clutchFlavorText(c.meta!, seed, i, link));
			}
		}
	}
	const perSeason = (x: number) => (x / NUM_GAMES) * 1230;
	// Per 1230-game season: a few dozen game-winners, and fewer defensive game-savers
	assert.isAbove(perSeason(counts.winner), 30);
	assert.isBelow(perSeason(counts.winner), 400);
	assert.isAbove(counts.defense, 0);
	assert.isBelow(perSeason(counts.defense), 200);
	assert.isBelow(counts.defense, counts.winner);
});
