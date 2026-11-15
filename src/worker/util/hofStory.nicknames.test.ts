// The "Show Player Nicknames" setting in the worker: careerFacts and hofWords leave the nickname out while it is off,
// without touching the stored one
import { afterEach, describe, expect, test } from "vitest";
import { resetG } from "../../test/helpers.ts";
import g from "./g.ts";
import { careerFacts, hofWords } from "./hofStory.ts";
import type { Player } from "../../common/types.ts";

const makePlayer = (nickname?: string) =>
	({
		pid: 7,
		firstName: "Marcus",
		lastName: "Hale",
		stats: [],
		ratings: [],
		awards: [],
		hgt: 79,
		born: { year: 1980, loc: "Gary, IN" },
		retiredYear: 2014,
		...(nickname !== undefined ? { nickname } : {}),
	}) as unknown as Player;

describe("Show Player Nicknames", () => {
	afterEach(() => {
		resetG();
	});

	test("on: a stored nickname is shown", async () => {
		resetG();
		g.setWithoutSavingToDB("showPlayerNicknames", true);
		const p = makePlayer("Buckets");
		const facts = await careerFacts(p);
		expect(facts.nickname).toBe("Buckets");
		expect(hofWords(facts).plaque).toContain('Marcus "Buckets" Hale');
	});

	test("off: no nickname in the facts, plaque or speech, stored one kept", async () => {
		resetG();
		g.setWithoutSavingToDB("showPlayerNicknames", false);
		const p = makePlayer("Buckets");
		const facts = await careerFacts(p);
		expect(facts.nickname).toBeUndefined();
		// Even facts carrying one (from elsewhere) are written without it
		const w = hofWords({ ...facts, nickname: "Buckets" });
		expect(w.plaque).toMatch(/^Marcus Hale\./);
		expect(`${w.plaque} ${w.speech.join(" ")}`).not.toContain("Buckets");
		expect(p.nickname).toBe("Buckets");

		// Back on: it returns
		g.setWithoutSavingToDB("showPlayerNicknames", true);
		expect((await careerFacts(p)).nickname).toBe("Buckets");
	});

	test("missing setting (existing league) counts as on", async () => {
		resetG();
		const p = makePlayer("Buckets");
		expect((await careerFacts(p)).nickname).toBe("Buckets");
	});
});
