// Linked college league (docs/college-mode.md): a college league and a pro league made headless in the same database environment. The
// college league plays a season through its Departures phase, then the pro league, linked to it, gets its draft class from it when its
// season is over, and drafts them.
import "fake-indexeddb/auto";
import { assert, describe, test } from "vitest";
import {
	LEAGUE_DATABASE_VERSION,
	PHASE,
	PLAYER,
} from "../../../common/constants.ts";
import { defaultGameAttributes } from "../../../common/defaultGameAttributes.ts";
import { makeSeededRandom } from "../../../common/random.ts";
import { getCollegeLeagueTeams } from "../../../common/college/teams.ts";
import { getCollegeSettings } from "../../../common/college/settings.ts";
import { last } from "../../../common/utils.ts";
import { isPreDraftStatsRow } from "../../../common/preDraft.ts";
import { draft, game, league, phase } from "../index.ts";
import { DEFAULT_LEVEL } from "../../../common/budgetLevels.ts";
import genPlayersWithoutSaving from "./genPlayersWithoutSaving.ts";
import valueCombineOvrPot from "../player/valueCombineOvrPot.ts";
import * as views from "../../views/index.ts";
import { idb } from "../../db/index.ts";
import { getDefaultSettings } from "../../views/newLeague.ts";
import { g, helpers } from "../../util/index.ts";
import {
	autoImportLinkedCollegeClass,
	getLinkableCollegeLeagues,
	importLinkedCollegeClass,
	setLinkedCollege,
} from "./linkedCollege.ts";

const fromFile = {
	gameAttributes: undefined,
	hasRookieContracts: true,
	maxGid: undefined,
	startingSeason: undefined,
	teams: undefined,
	version: LEAGUE_DATABASE_VERSION,
};

const playPhase = async (p: number) => {
	let days = 0;
	while (g.get("phase") === p) {
		await game.play(1, {});
		days += 1;
		assert.isBelow(days, 120);
	}
};

describe("linked college league", () => {
	test(
		"college departures become the pro draft class",
		{ timeout: 30 * 60 * 1000 },
		async () => {
			Math.random = makeSeededRandom(5);

			// The college league (lid 0): one season, through the Departures phase
			const { teams, confs, divs } = getCollegeLeagueTeams("power");
			await league.createStream(
				{},
				{
					confs,
					divs,
					fromFile,
					getLeagueOptions: undefined,
					keptKeys: new Set(),
					lid: 0,
					name: "My college league",
					setLeagueCreationStatus: () => {},
					settings: {
						...getDefaultSettings(),
						...getCollegeSettings("power"),
						collegeQuickSim: true,
					} as any,
					shuffleRosters: false,
					startingSeasonFromInput: "2025",
					teamsFromInput: teams.map((t) => ({ ...t, popRank: 1 })) as any,
					tid: 0,
				},
			);
			await league.loadGameAttributes();
			assert.strictEqual(g.get("leagueType"), "college");
			await phase.newPhase(PHASE.REGULAR_SEASON, {});
			await playPhase(PHASE.REGULAR_SEASON);
			await playPhase(PHASE.AFTER_TRADE_DEADLINE);
			await playPhase(PHASE.PLAYOFFS);
			await phase.newPhase(PHASE.DRAFT, {});
			const departed = (
				await idb.cache.players.indexGetAll("playersByTid", PLAYER.RETIRED)
			).filter(
				(p) =>
					p.collegeExit?.season === 2025 &&
					(p.collegeExit.type === "pro" || p.collegeExit.type === "graduated"),
			);
			assert.isAbove(departed.length, 100, "departed college players");
			const collegeByPid = new Map(departed.map((p) => [p.pid, p]));
			const firstPick = departed.find((p) => p.collegeExit!.pick === 1)!;
			assert.isDefined(firstPick, "the off-screen draft's first pick");
			const schools = new Set(teams.map((t) => t.region));
			await idb.cache.flush();

			// The pro league (lid 1): a short season, linked to the college league
			await league.createStream(
				{},
				{
					confs: last(defaultGameAttributes.confs).value,
					divs: last(defaultGameAttributes.divs).value,
					fromFile,
					getLeagueOptions: undefined,
					keptKeys: new Set(),
					lid: 1,
					name: "My pro league",
					setLeagueCreationStatus: () => {},
					settings: {
						...getDefaultSettings(),
						numGames: 4,
						numGamesPlayoffSeries: [1],
					} as any,
					shuffleRosters: false,
					startingSeasonFromInput: "2025",
					teamsFromInput: helpers.addPopRank(helpers.getTeamsDefault()),
					tid: 0,
				},
			);
			await league.loadGameAttributes();
			assert.strictEqual(g.get("leagueType"), "pro");
			assert.isUndefined(g.get("linkedCollege"));

			const linkable = await getLinkableCollegeLeagues();
			assert.deepEqual(
				linkable.map((l) => [l.lid, l.name, l.season, l.phase]),
				[[0, "My college league", 2025, PHASE.DRAFT]],
			);
			await setLinkedCollege({ lid: 0 });
			assert.deepEqual(g.get("linkedCollege"), {
				lid: 0,
				auto: true,
				imports: [],
			});

			// The season: the class is imported automatically when it is over
			await phase.newPhase(PHASE.REGULAR_SEASON, {});
			while (g.get("phase") <= PHASE.PLAYOFFS) {
				await game.play(1, {});
			}
			assert.strictEqual(g.get("phase"), PHASE.DRAFT_LOTTERY);
			const classSize = Math.round((2 * g.get("numActiveTeams") * 7) / 6);
			assert.deepEqual(g.get("linkedCollege")!.imports, [
				{ collegeSeason: 2025, draftYear: 2025, num: classSize },
			]);
			const prospects = (
				await idb.cache.players.indexGetAll("playersByTid", PLAYER.UNDRAFTED)
			).filter((p) => p.draft.year === 2025);
			const linked = prospects.filter((p) => p.linkedCollege);
			assert.lengthOf(linked, classSize, "prospects from the college league");
			assert.lengthOf(prospects, classSize, "no generated prospects left");
			let withAwards = 0;
			for (const p of linked) {
				const college = collegeByPid.get(p.linkedCollege!.pid);
				assert.isDefined(college, "a departed college player");
				assert.strictEqual(p.firstName, college!.firstName);
				assert.strictEqual(p.lastName, college!.lastName);
				assert.strictEqual(p.born.year, college!.born.year, "same age");
				assert.strictEqual(p.hgt, college!.hgt);
				// His school, and his college seasons as pre-draft rows
				assert.isTrue(schools.has(p.college), p.college);
				const rows = p.stats.filter((row) => isPreDraftStatsRow(row, 2025));
				assert.isAtLeast(rows.length, 1, "college stats");
				assert.strictEqual(rows.length, p.stats.length, "no pro rows");
				for (const row of rows) {
					assert.isTrue(schools.has((row as any).teamName));
				}
				const pts = rows.reduce((sum, row) => sum + (row.pts ?? 0), 0);
				const collegePts = college!.stats
					.filter((row) => !row.playoffs)
					.reduce((sum, row) => sum + (row.pts ?? 0), 0);
				assert.strictEqual(pts, collegePts, "college points kept");
				if (p.awards.length > 0) {
					withAwards += 1;
				}
				// Ratings kept, ovr/pot computed on this league's scale
				const r = last(p.ratings);
				assert.strictEqual(r.season, 2025);
				// Every rating but height scaled by the same factor (the pro scale)
				const cr = last(college!.ratings) as any;
				assert.strictEqual((r as any).hgt, cr.hgt);
				if (cr.ins >= 30 && cr.oiq >= 30) {
					assert.closeTo(
						(r as any).ins / cr.ins,
						(r as any).oiq / cr.oiq,
						0.05,
					);
				}
				assert.isAbove(r.pot, 0);
				assert.isNumber(p.value);
			}
			assert.isAbove(withAwards, 0, "college honors kept");
			// The college league's own awards (award settings, no type) come as named pre-draft honors
			const honorTypes = linked.flatMap((p) => p.awards.map((a) => a.type));
			assert.isTrue(
				honorTypes.every((type) => type?.startsWith("College: ")),
				JSON.stringify(honorTypes),
			);
			assert.isTrue(
				honorTypes.some(
					(type) =>
						type!.includes("All-Conference") || type!.includes("All-American"),
				),
				JSON.stringify(honorTypes),
			);
			// Rank for rank, the class compares with a generated one on potential and on the age-adjusted value the draft AI uses
			// (it averages about 1.5 years older: the off-screen college draft takes mostly seniors)
			{
				const ref = (await genPlayersWithoutSaving(
					2025,
					DEFAULT_LEVEL,
					[],
				)) as any[];
				const stats = (ps: any[]) => {
					const rows = ps
						.map((p) => {
							const r = last(p.ratings) as any;
							const age = 2025 - p.born.year;
							return {
								age,
								ovr: r.ovr,
								pot: r.pot,
								value: valueCombineOvrPot(r.ovr, r.pot, age),
							};
						})
						.sort((a, b) => b.value - a.value)
						.slice(0, 60);
					const mean = (f: (x: (typeof rows)[number]) => number) =>
						rows.reduce((sum, x) => sum + f(x), 0) / rows.length;
					return {
						age: mean((x) => x.age),
						ovr: mean((x) => x.ovr),
						pot: mean((x) => x.pot),
						value: mean((x) => x.value),
					};
				};
				const a = stats(linked);
				const b = stats(ref);
				// (Before value matching: pot 46 vs 56, value 41 vs 49 for the top 60)
				assert.isAbove(a.age, b.age + 1, "an older class");
				assert.closeTo(a.value, b.value, 3, JSON.stringify({ a, b }));
				assert.closeTo(a.pot, b.pot, 4, JSON.stringify({ a, b }));
			}
			// On the pro scale: a top prospect is not already a star, as a generated class
			const ovrs = linked.map((p) => last(p.ratings).ovr).sort((a, b) => b - a);
			assert.isAtMost(ovrs[0]!, 62, "best prospect ovr");
			assert.isAtLeast(ovrs[0]!, 40, "best prospect ovr");
			assert.isBelow(ovrs.at(-1)!, ovrs[0]!);
			assert.isAtLeast(
				ovrs.at(-1)!,
				10,
				"worst prospect ovr (a generated class goes down to about 20)",
			);
			assert.isDefined(
				linked.find((p) => p.linkedCollege!.pid === firstPick.pid),
				"the best prospect is in the class",
			);

			// Draft Scouting shows their school
			const view: any = await (views as any).draftScouting.load({
				inputs: {},
				updateEvents: new Set(["firstRun"]),
				prevInputs: {},
				prevOutput: {},
				conditions: {},
			});
			assert.strictEqual(view.linkedCollege.name, "My college league");
			assert.isTrue(view.canLink);
			assert.isTrue(
				view.seasons[0].players.every((p: any) => schools.has(p.linkedSchool)),
			);

			// Not twice for the same draft
			assert.deepEqual(await importLinkedCollegeClass({ onlyNew: true }), {
				error: "Already imported.",
			});

			// The draft: they are drafted into the pro league
			await phase.newPhase(PHASE.DRAFT, {});
			await draft.runPicks({ type: "untilEnd" }, {});
			const drafted = (await idb.cache.players.getAll()).filter(
				(p) => p.linkedCollege && p.tid >= 0,
			);
			assert.strictEqual(drafted.length, 2 * g.get("numActiveTeams"));
			for (const p of drafted) {
				assert.strictEqual(p.draft.year, 2025);
				assert.isAbove(p.draft.pick, 0);
			}

			// The same class again for the next draft (the college league has not moved on): nobody is imported twice
			const again = await importLinkedCollegeClass({});
			assert.include(again.error ?? "", "already in this league");
			assert.strictEqual(
				(await idb.cache.players.getAll()).filter((p) => p.linkedCollege)
					.length,
				linked.length,
			);

			// The college league deleted: the import says so (and the automatic one doesn't throw)
			await idb.meta.delete("leagues", 0);
			assert.deepEqual(await importLinkedCollegeClass({ onlyNew: true }), {
				error:
					"The linked college league can't be found. It may have been deleted.",
			});
			await autoImportLinkedCollegeClass();
			assert.deepEqual(await getLinkableCollegeLeagues(), []);
		},
	);
});
