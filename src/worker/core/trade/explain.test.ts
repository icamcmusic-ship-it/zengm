import { assert, beforeAll, describe, test } from "vitest";
import { resetG } from "../../../test/helpers.ts";
import { buildTradeExplanation, explainAsset } from "./explain.ts";
import type { AssetValueDetail } from "../team/ValueChangeCalculator.ts";

const player = (
	pid: number,
	extra: Partial<AssetValueDetail> = {},
): AssetValueDetail => ({
	type: "player",
	pid,
	age: 27,
	baseValue: 1,
	strategyFactor: 1,
	injuryPenalty: 0,
	contractValue: 0.01,
	contractsFactor: 0.5,
	adjustedValue: 1,
	tradeValue: 1,
	...extra,
});

const pick = (
	dpid: number,
	extra: Partial<AssetValueDetail> = {},
): AssetValueDetail => ({
	type: "pick",
	dpid,
	age: 19,
	draftPick: 4.3,
	draftYear: 2026,
	baseValue: 0.8,
	strategyFactor: 1,
	injuryPenalty: 0,
	contractValue: 0,
	contractsFactor: 0.5,
	adjustedValue: 0.8,
	tradeValue: 0.8,
	...extra,
});

const keys = (terms: { key: string }[]) => terms.map((t) => t.key);

describe("trade explanation terms", () => {
	beforeAll(() => {
		resetG();
	});

	test("player value and age/strategy for a rebuilding team", () => {
		const asset = explainAsset(
			player(1, { age: 21, baseValue: 0.6, strategyFactor: 1.0375 }),
			"receive",
			"rebuilding",
			"Young Guy",
			1,
		);
		assert.deepEqual(keys(asset.terms), ["value", "strategy"]);
		assert.include(asset.terms[0]!.text, "quality starter");
		assert.include(asset.terms[1]!.text, "young players");
		assert.strictEqual(asset.terms[1]!.effect, "good");
	});

	test("contending team discounts picks, and giving up a pick it discounts is good for it", () => {
		const asset = explainAsset(
			pick(5, { strategyFactor: 0.825 }),
			"give",
			"contending",
			"2026 1st",
			1,
		);
		assert.deepEqual(keys(asset.terms), ["pick", "strategy"]);
		assert.include(asset.terms[0]!.text, "pick #4");
		assert.strictEqual(asset.terms[1]!.effect, "good");
	});

	test("overpaid contract is bad to receive and good to give", () => {
		const receive = explainAsset(
			player(1, { contractValue: -0.2, contractsFactor: 2 }),
			"receive",
			"rebuilding",
			"Bad Contract",
			1,
		);
		const contract = receive.terms.find((t) => t.key === "contract")!;
		assert.strictEqual(contract.effect, "bad");
		assert.include(contract.text, "Overpaid");
		assert.include(contract.text, "Rebuilding");

		const give = explainAsset(
			player(1, { contractValue: -0.2 }),
			"give",
			"contending",
			"Bad Contract",
			1,
		);
		assert.strictEqual(
			give.terms.find((t) => t.key === "contract")!.effect,
			"good",
		);
	});

	test("injury term", () => {
		const asset = explainAsset(
			player(1, { injuryPenalty: 0.5 }),
			"receive",
			"contending",
			"Hurt Guy",
			1,
		);
		assert.include(keys(asset.terms), "injury");
	});

	test("team terms: fit, salary/cap, warning, and summary", () => {
		const explanation = buildTradeExplanation({
			tid: 1,
			teamName: "Test Team",
			strategy: "contending",
			dv: -3,
			add: [player(1, { tradeValue: 1 })],
			remove: [player(2, { tradeValue: 2 }), pick(3, { tradeValue: 2 })],
			names: { p1: "A", p2: "B", dp3: "C" },
			ovrBefore: 60,
			ovrAfter: 55,
			payrollBefore: 100000,
			payrollAfter: 130000,
			salaryCap: 120000,
			salaryCapType: "soft",
			warning: "Over the cap",
		});

		assert.strictEqual(explanation.accepts, false);
		assert.strictEqual(explanation.valueRatio, 25);
		assert.include(explanation.summary, "25%");
		assert.deepEqual(keys(explanation.team), [
			"strategy",
			"fit",
			"salary",
			"salary",
		]);
		const fit = explanation.team[1]!;
		assert.strictEqual(fit.effect, "bad");
		assert.include(fit.text, "60 → 55");
		assert.include(explanation.team[2]!.text, "over the cap");
		assert.strictEqual(explanation.assets.length, 3);
		assert.deepEqual(
			explanation.assets.map((a) => [a.direction, a.name, a.share]),
			[
				["receive", "A", 100],
				["give", "B", 50],
				["give", "C", 50],
			],
		);
	});

	test("accepting team", () => {
		const explanation = buildTradeExplanation({
			tid: 1,
			teamName: "Test Team",
			strategy: "rebuilding",
			dv: 2,
			add: [pick(1)],
			remove: [],
			names: {},
			salaryCap: 120000,
			salaryCapType: "none",
		});
		assert.strictEqual(explanation.accepts, true);
		assert.strictEqual(explanation.summary, "They like this deal.");
	});
});
