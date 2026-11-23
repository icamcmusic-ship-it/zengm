// College Hall of Fame in a whole headless college league (spectator, quick sim): the first class is inducted COLLEGE_HOF_WAIT seasons
// after the first departures, and the Hall of Fame page, its Watch tab and the school's Team History show it.
import "fake-indexeddb/auto";
import { assert, describe, test } from "vitest";
import {
	COLLEGE_HOF_AWARD,
	COLLEGE_HOF_WAIT,
} from "../../../common/college/hallOfFame.ts";
import * as views from "../../views/index.ts";
import { idb } from "../../db/index.ts";
import { g } from "../../util/index.ts";
import {
	createCollegeTestLeague,
	playCollegeSeason,
} from "./collegeTestLeague.ts";

const loadView = async (id: string, params: Record<string, unknown> = {}) => {
	const view = (views as any)[id];
	const inputs = view.processInputs ? view.processInputs(params, {}) : {};
	const out = await view.load({
		inputs,
		updateEvents: new Set(["firstRun"]),
		prevInputs: inputs,
		prevOutput: {},
		conditions: {},
	});
	assert.isUndefined((out as any)?.errorMessage);
	return out as any;
};

describe("college hall of fame, headless league", () => {
	test(
		"inductees after the waiting period, on the pages",
		{ timeout: 30 * 60 * 1000 },
		async () => {
			await createCollegeTestLeague(7);
			const start = g.get("season");

			// The pages work before anyone is in
			const empty = await loadView("hallOfFame");
			assert.lengthOf(empty.college.players, 0);

			for (let i = 0; i <= COLLEGE_HOF_WAIT; i++) {
				await playCollegeSeason();
			}
			const firstClass = start + COLLEGE_HOF_WAIT;
			assert.strictEqual(g.get("season"), firstClass + 1);

			// Nobody could be inducted before the first departures had waited
			for (let season = start; season < firstClass; season++) {
				const record = (await idb.merged.awards.get(season))?.collegeHof;
				assert.strictEqual(record?.players.length ?? 0, 0);
			}
			const record = (await idb.merged.awards.get(firstClass))?.collegeHof;
			assert.isDefined(record);
			assert.isAtLeast(record!.players.length, 1);
			assert.isAtMost(record!.players.length, record!.classSize);
			for (const row of record!.players) {
				const p = (await idb.merged.players.get(row.pid))!;
				assert.strictEqual(p.collegeHof, firstClass);
				assert.isDefined(p.collegeExit);
				assert.isAtMost(p.collegeExit!.season, firstClass - COLLEGE_HOF_WAIT);
				assert.isTrue(p.awards.some((a) => a.type === COLLEGE_HOF_AWARD));
			}
			const news = await idb.merged.events.getAll({ season: firstClass });
			assert.isTrue(
				news.some(
					(e) =>
						e.type === "hallOfFame" &&
						e.text?.includes(`Class of ${firstClass}`),
				),
			);

			// Hall of Fame page: the inductees with their schools and years
			const page = await loadView("hallOfFame");
			assert.sameMembers(
				page.college.players.map((p: any) => p.pid),
				record!.players.map((row) => row.pid),
			);
			const first = page.college.players[0];
			assert.isAbove(first.schools.length, 0);
			assert.isDefined(first.firstSeason);
			assert.isString(first.line);

			// Watch tab: current players and players who left school
			const watch = await loadView("hallOfFameWatch");
			assert.isAbove(watch.college.active.length, 0);
			assert.isTrue(
				watch.college.retired.some((row: any) => row.status === "inducted"),
			);

			// Team History of his school: in its Ring of Honor
			const school = first.schools.at(-1);
			const history = await loadView("teamHistory", {
				team: `${school.abbrev}_${school.tid}`,
			});
			assert.isTrue(
				history.ringOfHonor.some(
					(row: any) =>
						row.kind === "player" &&
						row.id === first.pid &&
						row.hof &&
						row.inducted === firstClass,
				),
			);
		},
	);
});
