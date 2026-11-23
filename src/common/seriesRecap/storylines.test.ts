import { assert, describe, test } from "vitest";
import { seriesStorylines, type PastMeeting } from "./storylines.ts";

const name = (tid: number) => ["Hawks", "Owls", "Bears"][tid]!;

const meeting = (
	season: number,
	winnerTid: number,
	loserTid: number,
	roundName = "conference finals",
): PastMeeting => ({
	season,
	round: 2,
	roundName,
	winnerTid,
	loserTid,
	winnerWon: 4,
	loserWon: 2,
});

describe("series storylines", () => {
	test("revenge for last season's elimination", () => {
		const lines = seriesStorylines({
			season: 2030,
			a: 0,
			b: 1,
			meetings: [meeting(2029, 1, 0)],
			name,
			minSeason: 2025,
		});
		assert.deepEqual(
			lines.map((x) => x.kind),
			["revenge"],
		);
		assert.include(lines[0]!.text, "the Hawks get another shot at the Owls");
		assert.include(lines[0]!.text, "conference finals (4-2)");
	});

	test("a rematch from a few seasons back, and a rivalry from several meetings", () => {
		const lines = seriesStorylines({
			season: 2030,
			a: 0,
			b: 1,
			meetings: [meeting(2027, 0, 1), meeting(2024, 1, 0), meeting(2022, 0, 1)],
			name,
			minSeason: 2015,
		});
		assert.deepEqual(
			lines.map((x) => x.kind),
			["rematch", "rivalry"],
		);
		assert.include(lines[1]!.text, "4th meeting");
		assert.include(lines[1]!.text, "the Hawks have won 2 of them");
	});

	test("other teams' series and future seasons don't count; a first meeting needs enough history", () => {
		const meetings = [meeting(2029, 2, 0), meeting(2031, 0, 1)];
		assert.deepEqual(
			seriesStorylines({
				season: 2030,
				a: 0,
				b: 1,
				meetings,
				name,
				minSeason: 2025,
			}),
			[],
		);
		const first = seriesStorylines({
			season: 2030,
			a: 0,
			b: 1,
			meetings,
			name,
			minSeason: 2010,
		});
		assert.deepEqual(
			first.map((x) => x.kind),
			["firstMeeting"],
		);
	});
});
