// Schedule editor CSV import: the checks across rows are the save's (common/validateEditedSchedule.ts), so they fail at import
import { assert, test } from "vitest";
import { validateAndParseScheduleCSV } from "./scheduleCsv.ts";

const teams = ["AAA", "BBB", "CCC", "DDD"].map((abbrev, tid) => ({
	tid,
	seasonAttrs: { abbrev },
})) as any[];

const rules = { allStarGameAllowed: true, tradeDeadlineAllowed: true };

const parse = (csv: string, r = rules, completed: any[] = []) =>
	validateAndParseScheduleCSV(csv, teams, 0, completed, r);

const errorOf = (fn: () => unknown) => {
	try {
		fn();
	} catch (error) {
		return (error as Error).message;
	}
	return undefined;
};

test("a valid schedule imports", () => {
	const out = parse(
		"Day,AAA,BBB,CCC,DDD\n1,BBB,,DDD,\n2,Trade Deadline,,,\n3,,AAA,,CCC\n",
	);
	assert.strictEqual(out.filter((g) => g.type === "game").length, 4);
	assert.strictEqual(out.filter((g) => g.type === "tradeDeadline").length, 1);
});

test("special-day rules across rows", () => {
	assert.match(
		errorOf(() =>
			parse("Day,AAA,BBB,CCC,DDD\n1,Trade Deadline,,,\n2,Trade Deadline,,,\n"),
		)!,
		/only be one trade deadline/,
	);
	assert.match(
		errorOf(() =>
			parse("Day,AAA,BBB,CCC,DDD\n1,All-Star Game,,,\n2,All-Star Game,,,\n"),
		)!,
		/only be one All-Star Game/,
	);
	// Two rows for the same day: the special day isn't alone on it
	assert.match(
		errorOf(() =>
			parse("Day,AAA,BBB,CCC,DDD\n1,All-Star Game,,,\n1,BBB,,,\n"),
		)!,
		/alone on its day/,
	);
	assert.match(
		errorOf(() =>
			parse("Day,AAA,BBB,CCC,DDD\n1,Trade Deadline,,,\n", {
				...rules,
				tradeDeadlineAllowed: false,
			}),
		)!,
		/already happened/,
	);
	assert.match(
		errorOf(() =>
			parse("Day,AAA,BBB,CCC,DDD\n1,All-Star Game,,,\n", {
				...rules,
				allStarGameAllowed: false,
			}),
		)!,
		/All-Star Game can't be added/,
	);
	// A team that already played that day
	assert.match(
		errorOf(() =>
			parse("Day,AAA,BBB,CCC,DDD\n1,,,AAA,\n", rules, [
				{ type: "completed", day: 1, homeTid: 0, awayTid: 1 },
			]),
		)!,
		/AAA plays more than once on day 1/,
	);
});
