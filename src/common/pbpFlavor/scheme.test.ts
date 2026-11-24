import { assert, test } from "vitest";
import { FlavorSession } from "./session.ts";

/*
 * A team's defense in the text is its coach's actual defensive system (the coachSystems setting, sent in the game context after the
 * 9101 marker: offense and defense indexes, home team first), never a random pick, and no line says it changed during the game (the
 * sim never changes it).
 */
const RECORDS = [10, 5, 2, 3, 30, 0, 8, 7, -1, 12, 30, 0];

const session = (game: number[] | undefined, exhibition = false) =>
	new FlavorSession({
		gid: 11,
		numPeriods: 4,
		quarterLength: 12,
		female: false,
		noArticle: false,
		teams: [
			{ name: "Celtics", abbrev: "BOS" },
			{ name: "Mavericks", abbrev: "DAL" },
		],
		players: [],
		context: {
			...(game ? { game } : {}),
			...(exhibition ? { exhibition } : {}),
		},
	} as any);

test("each team's defense is its coach's system", () => {
	// home: motion offense, zone defense; away: motion, drop coverage (no words of its own: man-to-man)
	assert.deepStrictEqual(
		(session([...RECORDS, 9101, 0, 4, 0, 1]) as any).scheme,
		["zone", "man"],
	);
	assert.deepStrictEqual(
		(session([...RECORDS, 9101, 0, 5, 0, 0]) as any).scheme,
		["press", "switch"],
	);
});

test("without coaching systems (or in an exhibition), man-to-man for both, whatever the game", () => {
	for (let gid = 0; gid < 50; gid++) {
		assert.deepStrictEqual((session(undefined) as any).scheme, ["man", "man"]);
	}
	assert.deepStrictEqual(
		(session([...RECORDS, 9101, 0, 4, 0, 4], true) as any).scheme,
		["man", "man"],
	);
});

test("no period break says a team changed its defense", () => {
	const s = session([...RECORDS, 9101, 0, 4, 0, 5]);
	const host = {
		stat: () => undefined,
		score: () => [20, 18] as [number, number],
		onCourt: () => [],
	};
	for (let period = 2; period <= 4; period++) {
		const r: any = s.describe(
			{ type: "period", clock: 720, period } as any,
			host as any,
		);
		const words = `${r?.text ?? ""} ${r?.note ?? ""}`;
		assert.notMatch(
			words,
			/2-3 zone|go back to man|start switching|pick up full court/,
		);
	}
});
