import { afterEach, assert, beforeEach, test } from "vitest";
import { PHASE, PLAYER } from "../../common/constants.ts";
import type { Player, TeamSeason } from "../../common/types.ts";
import { mockIDBLeague, resetCache, resetG } from "../../test/helpers.ts";
import { team } from "../core/index.ts";
import { idb } from "../db/index.ts";
import { g } from "./index.ts";
import {
	HOF_STORY_VERSION,
	careerFacts,
	getHofStories,
	hofIndexOf,
} from "./hofStory.ts";

const statsRow = (season: number, tid: number, playoffs = false) => ({
	season,
	tid,
	playoffs,
	gp: 82,
	pts: 1500,
	orb: 100,
	drb: 300,
	ast: 400,
	stl: 0,
	blk: 0,
	tp: 0,
});

const makePlayer = (
	pid: number,
	lastName: string,
	stats: ReturnType<typeof statsRow>[],
) =>
	({
		pid,
		tid: PLAYER.RETIRED,
		hof: 1,
		firstName: "Player",
		lastName,
		stats,
		ratings: [],
		awards: [],
		draft: { year: 2000, round: 1, pick: 1, tid: 0, originalTid: 0 },
		retiredYear: 2015,
		born: { year: 1980, loc: "" },
		college: "",
		hgt: 78,
	}) as unknown as Player;

const teamSeason = (tid: number, season: number, name: string) => {
	const t = team.generate({
		tid,
		cid: 0,
		did: 0,
		region: "Region",
		name,
		abbrev: `AB${tid}`,
		pop: 1,
	});
	return { ...team.genSeasonRow(t), rid: tid * 1000 + season, season };
};

let league: unknown;

beforeEach(async () => {
	resetG();
	league = idb.league;
	idb.league = mockIDBLeague();
	g.setWithoutSavingToDB("lid", 1);
	g.setWithoutSavingToDB("phase", PHASE.REGULAR_SEASON);
	const teamSeasons: TeamSeason[] = [];
	for (const season of [2010, 2011, 2012, 2013, 2014, 2015, 2016]) {
		// Team 1 was the Old Name until it was renamed in 2014
		teamSeasons.push(
			teamSeason(0, season, "Home"),
			teamSeason(1, season, season < 2014 ? "Old Name" : "New"),
		);
	}
	await resetCache({ players: [], teamSeasons });
	for (const season of [2011, 2012]) {
		// Team 1 knocked team 0 out in 2011 and 2012
		await idb.cache.playoffSeries.put({
			season,
			currentRound: 0,
			series: [
				[
					{
						home: { tid: 1, won: 4, seed: 1 },
						away: { tid: 0, won: 1, seed: 2 },
					},
				],
			],
		} as any);
	}
});

afterEach(() => {
	idb.league = league as any;
});

test("rival is named as the team was when it knocked him out", async () => {
	const p = makePlayer(1, "A", [
		statsRow(2010, 0),
		statsRow(2011, 0),
		statsRow(2011, 0, true),
		statsRow(2012, 0),
		statsRow(2012, 0, true),
	]);
	const facts = await careerFacts(p, { full: true });
	assert.deepEqual(facts.rival, { name: "Region Old Name", times: 2 });
});

test("teammate line from the team-season index, ties to the earlier Hall of Famer", async () => {
	const p = makePlayer(1, "A", [
		statsRow(2010, 0),
		statsRow(2011, 0),
		statsRow(2012, 0),
	]);
	const b = makePlayer(2, "B", [statsRow(2010, 0), statsRow(2011, 0)]);
	const c = makePlayer(3, "C", [statsRow(2011, 0), statsRow(2012, 0)]);
	const d = makePlayer(4, "D", [statsRow(2012, 0), statsRow(2013, 0)]);
	const facts = await careerFacts(p, {
		full: true,
		hofIndex: hofIndexOf([b, c, d, p]),
	});
	assert.deepEqual(facts.teammate, { name: "Player B", seasons: 2 });
});

test("words are written once and stored on the player, and written again for an old version", async () => {
	const p = makePlayer(1, "A", [statsRow(2010, 0), statsRow(2011, 0)]);
	const b = makePlayer(2, "B", [statsRow(2010, 0), statsRow(2011, 0)]);
	await idb.cache.players.put(p);
	await idb.cache.players.put(b);

	const stories = await getHofStories([p], [p, b]);
	const story = stories.get(1)!;
	assert.strictEqual(story.v, HOF_STORY_VERSION);
	assert.isAbove(story.speech.length, 0);
	assert.include(story.speech.join(" "), "Player B");
	assert.deepEqual((await idb.cache.players.get(1))!.hofStory, story);

	// Stored: not rebuilt (and other Hall of Famers aren't even read)
	p.firstName = "Changed";
	const again = await getHofStories([p], () => {
		throw new Error("Should not read other Hall of Famers");
	});
	assert.strictEqual(again.get(1), story);

	// Older version: rebuilt
	p.hofStory = { ...story, v: HOF_STORY_VERSION - 1 };
	const rebuilt = (await getHofStories([p], [p, b])).get(1)!;
	assert.strictEqual(rebuilt.v, HOF_STORY_VERSION);
	assert.include(rebuilt.plaque, "Changed A");
});
