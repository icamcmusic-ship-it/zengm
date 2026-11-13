// No Visible Player Ratings challenge: the paper never quotes a rating. Every edition, league and team papers, many seasons:
// no rating words and no rating numbers anywhere in the text (headlines, decks, tables, boxes)
import { assert, describe, test } from "vitest";
import { makeFixture } from "./fixture.ts";
import { buildPaper, paperText } from "./index.ts";
import type { EditionId } from "./types.ts";

const EDITIONS: EditionId[] = ["preseason", "midseason", "playoffs", "final"];
// "rated 72", "rating of 72", "72 potential", "72 ovr", "overall rating", "61→66", "72/80", "(64.3 rating", "Roster rating"
// ("first overall pick" is fine)
const RATING_WORDS =
	/\b(rated|ratings?|potential|ovr)\b|\boverall rating|\b\d{2,} overall\b/i;
const RATING_NUMBERS = /\d+\s*(→|->)\s*\d+|\b\d{2}\/\d{2}\b/;

const leaks = (text: string) => {
	const out: string[] = [];
	for (const line of text.split("\n")) {
		if (RATING_WORDS.test(line) || RATING_NUMBERS.test(line)) {
			out.push(line);
		}
	}
	return out;
};

describe("newspaper under the No Visible Player Ratings challenge", () => {
	for (const edition of EDITIONS) {
		test(`${edition}: no ratings in the text`, () => {
			for (let season = 2018; season < 2034; season++) {
				const facts = { ...makeFixture(edition, season), noRatings: true };
				for (const tid of [undefined, 0, 3, 11]) {
					const text = paperText(buildPaper(facts, tid));
					const bad = leaks(text);
					assert.deepEqual(bad, [], `${edition} ${season} team ${tid}`);
				}
			}
		});
	}

	test("the same fixtures quote ratings when the challenge is off (the check above can fail)", () => {
		let found = 0;
		for (const edition of EDITIONS) {
			for (let season = 2018; season < 2034; season++) {
				found += leaks(
					paperText(buildPaper(makeFixture(edition, season))),
				).length;
			}
		}
		assert.isAbove(found, 20);
	});
});
