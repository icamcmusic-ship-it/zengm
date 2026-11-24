// archaudit: words a position rules out, rim protection that keeps his size with sub-ratings, and no skill name for a
// player with no skill
import { assert, test } from "vitest";
import { DEFAULT_NORMS } from "../index.ts";
import { SUB_DEFS } from "../../subRatings.ts";
import type { ArchetypeRatings } from "../types.ts";
import { classifyV2 } from "./engine.ts";
import { rimDValue } from "./gateScale.ts";
import {
	BIG_HANDLE_PCT,
	HANDLER_WORDS_RE,
	nounFitsPos,
	nounValue,
	POST_WORDS_RE,
	RIM_WORDS_RE,
	wordsFit,
} from "./nouns.ts";

const base = (v: number): ArchetypeRatings => ({
	hgt: v,
	stre: v,
	spd: v,
	jmp: v,
	endu: v,
	ins: v,
	dnk: v,
	ft: v,
	fg: v,
	tp: v,
	oiq: v,
	diq: v,
	drb: v,
	pss: v,
	reb: v,
});

test("position gates: rim words never on a guard, post words never on a PG/G, handler words on a center only with a handle", () => {
	for (const name of [
		"Rim-Protecting Guard",
		"Shot Blocker",
		"Shot-Erasing Glass Guard",
	]) {
		assert.isTrue(RIM_WORDS_RE.test(name), name);
		assert.isFalse(wordsFit(name, "PG"), name);
		assert.isFalse(wordsFit(name, "SG"), name);
		assert.isTrue(wordsFit(name, "C"), name);
	}
	assert.isTrue(POST_WORDS_RE.test("Post-Scoring Guard"));
	assert.isFalse(wordsFit("Post-Scoring Guard", "PG"));
	assert.isTrue(wordsFit("Post-Scoring Forward", "PF"));
	for (const name of [
		"Glass-Cleaning Playmaker",
		"Ball-Handling Five",
		"Floor General",
	]) {
		assert.isTrue(HANDLER_WORDS_RE.test(name), name);
		assert.isFalse(wordsFit(name, "C", {}, BIG_HANDLE_PCT - 0.1), name);
		assert.isTrue(wordsFit(name, "C", {}, BIG_HANDLE_PCT + 0.1), name);
		// (not checked without a handle standing: the regenerator's aim)
		assert.isTrue(wordsFit(name, "C"), name);
	}
	assert.isFalse(nounFitsPos("rimD", "G"));
	assert.isTrue(nounFitsPos("rimD", "PF"));
	assert.isFalse(nounFitsPos("post", "PG"));
	assert.isFalse(nounFitsPos("handle", "C", 0.2));
	assert.isTrue(nounFitsPos("pass", "C", 0.2));
});

test("rim protection keeps his size and leaping with the block sub-rating", () => {
	const small = { ...base(50), hgt: 20, jmp: 40, diq: 80 };
	const big = { ...base(50), hgt: 80, jmp: 60, diq: 80 };
	const sub = SUB_DEFS.map((d) => (d.key === "blk" ? 85 : 50));
	assert.isBelow(rimDValue({ ...small, sub }), rimDValue({ ...big, sub }) - 15);
	assert.strictEqual(
		nounValue("rimD", { ...small, sub }),
		rimDValue({ ...small, sub }),
	);
	// (without sub-ratings and expanded ratings: as before)
	assert.strictEqual(rimDValue(small), (80 + 20 + 40) / 3);
	// (the expanded interior-defense rating alone: as before)
	assert.strictEqual(rimDValue({ ...small, idef: 77 }), 77);
});

test("a player with no skill near the median is named by his position, not by a skill", () => {
	const r = base(15);
	const c = classifyV2(r, {
		norms: DEFAULT_NORMS,
		pos: "SG",
		ovr: 20,
		pot: 20,
		age: 27,
	});
	assert.strictEqual(c.label, "Guard");
	const c2 = classifyV2(base(15), {
		norms: DEFAULT_NORMS,
		pos: "C",
		ovr: 20,
		pot: 20,
		age: 27,
	});
	assert.strictEqual(c2.label, "Big");
});
