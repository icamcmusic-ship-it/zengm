import { assert, describe, expect, test } from "vitest";
import {
	factsForDisplay,
	generateNickname,
	nicknameForDisplay,
	inductionSpeech,
	plaqueText,
	type CareerFacts,
} from "./hofStory.ts";

const facts: CareerFacts = {
	pid: 42,
	firstName: "Marcus",
	lastName: "Hale",
	teams: [
		{ tid: 0, name: "Boston Celtics", seasons: 11, first: 2001, last: 2011 },
		{ tid: 3, name: "Denver Nuggets", seasons: 3, first: 2012, last: 2014 },
	],
	titles: [{ season: 2008, team: "Boston Celtics" }],
	mvps: 2,
	finalsMvps: 1,
	allStars: 9,
	dpoys: 0,
	roy: true,
	draft: { year: 2000, round: 1, pick: 3, team: "Boston Celtics" },
	college: "Duke",
	hometown: "Gary, IN",
	hgt: 79,
	archetype: "Shot Creator",
	rival: { name: "Detroit Pistons", times: 3 },
	coach: { name: "Bill Stone", team: "Boston Celtics" },
	teammate: { name: "Ray Lane", seasons: 6 },
	bestGame: {
		season: 2006,
		pts: 54,
		trb: 8,
		ast: 6,
		opp: "Pistons",
		playoffs: true,
		won: true,
	},
	career: { gp: 1000, pts: 25000, trb: 6000, ast: 4000, seasons: 14 },
	perGame: { pts: 25, trb: 6, ast: 4, stl: 1.2, blk: 0.4, tpm: 2.5 },
	prime: { season: 2006, team: "Boston Celtics" },
};

describe("hofStory", () => {
	test("speech uses career facts and is stable", () => {
		const s = inductionSpeech(facts);
		const text = s.join(" ");
		expect(text).toContain("Detroit Pistons");
		expect(text).toContain("Bill Stone");
		expect(text).toContain("Ray Lane");
		expect(text).toMatch(/2000/);
		expect(inductionSpeech(facts)).toEqual(s);
		expect(text).not.toMatch(/\bovr\b|rating/i);
	});

	test("plaque matches the pictured season", () => {
		const t = plaqueText({ ...facts, nickname: "Buckets" });
		expect(t).toContain('Marcus "Buckets" Hale');
		expect(t).toContain("Pictured in 2006, with the Boston Celtics");
		expect(t).toContain("2-time MVP");
	});

	test("nicknames", () => {
		expect(generateNickname(facts)).toBeTypeOf("string");
		expect(generateNickname(facts)).toBe(generateNickname(facts));
		// A short, plain career gets none
		expect(
			generateNickname({
				...facts,
				hometown: undefined,
				hgt: 78,
				mvps: 0,
				titles: [],
				career: { ...facts.career, gp: 30 },
				perGame: undefined,
			}),
		).toBeUndefined();
	});

	describe("Show Player Nicknames off", () => {
		// Broken punctuation a dropped nickname could leave behind
		const broken = /""|“”|\s{2}|\s[!,.?]|a\.k\.a|\bnickname\b|\bundefined\b/i;

		test("nicknameForDisplay", () => {
			expect(nicknameForDisplay("Buckets", true)).toBe("Buckets");
			expect(nicknameForDisplay("Buckets", false)).toBeUndefined();
			expect(nicknameForDisplay("", true)).toBeUndefined();
			expect(nicknameForDisplay("  ", true)).toBeUndefined();
			expect(nicknameForDisplay(undefined, true)).toBeUndefined();
		});

		test("factsForDisplay keeps the stored nickname when on, drops it when off", () => {
			const withNick = { ...facts, nickname: "Buckets" };
			expect(factsForDisplay(withNick, true)).toBe(withNick);
			const off = factsForDisplay(withNick, false);
			expect(off.nickname).toBeUndefined();
			expect("nickname" in off).toBe(false);
			// The input is not changed
			expect(withNick.nickname).toBe("Buckets");
		});

		// Many players, so every speech closing and plaque variant is covered
		const variants = Array.from({ length: 60 }, (_, i) => ({
			...facts,
			pid: i,
			nickname: generateNickname({ ...facts, pid: i }) ?? "The Machine",
		}));

		test("plaque reads naturally with the real name", () => {
			for (const f of variants) {
				const on = plaqueText(factsForDisplay(f, true));
				expect(on).toContain(`"${f.nickname}"`);
				const t = plaqueText(factsForDisplay(f, false));
				expect(t).not.toContain(f.nickname);
				expect(t).not.toContain('"');
				expect(t).toMatch(/^Marcus Hale\. 14 seasons/);
				expect(t).not.toMatch(broken);
			}
		});

		test("speech has no nickname and no broken punctuation", () => {
			let sawNickOn = false;
			for (const f of variants) {
				const on = inductionSpeech(factsForDisplay(f, true)).join(" ");
				if (on.includes(`"${f.nickname}"`)) {
					sawNickOn = true;
				}
				const speech = inductionSpeech(factsForDisplay(f, false));
				for (const para of speech) {
					expect(para).not.toContain(f.nickname);
					expect(para).not.toMatch(broken);
					expect(para).toBe(para.trim());
					expect(para.length).toBeGreaterThan(0);
				}
				expect(speech.join(" ")).not.toMatch(/letting me be/);
			}
			expect(sawNickOn).toBe(true);
		});
	});
});

test("Hall of Fame words are on in basketball", async () => {
	const { hofWordsOn } = await import("../worker/util/hofStory.ts");
	assert.isTrue(hofWordsOn());
});
