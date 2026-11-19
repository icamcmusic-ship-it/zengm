// Pre-Draft Injuries & Combine Medicals: the medical grade at the combine (from injury history and durability, noise narrowed by the
// budget, stored with the combine), the AI's draft discount, the combine news and the rookie injury risk.
import { afterAll, assert, describe, test } from "vitest";
import { Rng } from "../../../common/collegeStats/rng.ts";
import { PHASE, PLAYER } from "../../../common/constants.ts";
import { DEFAULT_LEVEL } from "../../../common/budgetLevels.ts";
import {
	MEDICAL_DRAFT_PENALTY,
	generateMedical,
	medicalGradeOf,
	medicalNoiseSd,
	medicalReason,
	medicalRisk,
} from "../../../common/draftCombine.ts";
import { PRE_DRAFT_INJURY_TYPES } from "../../../common/collegeStats/injuries.ts";
import type { Player } from "../../../common/types.ts";
import { resetCache, resetG } from "../../../test/helpers.ts";
import { idb } from "../../db/index.ts";
import { g } from "../../util/index.ts";
import { defaultInjuries } from "../../util/defaultInjuries.ts";
import genPlayersWithoutSaving from "../draft/genPlayersWithoutSaving.ts";
import {
	PRE_DRAFT_INJURY_RISK,
	preDraftInjuryRisk,
} from "../player/injuryDepth.ts";
import {
	afterNewPhase,
	getClassCombine,
	getDraftCombineNudges,
	storedMedicalView,
} from "./index.ts";

const realRandom = Math.random;
afterAll(() => {
	Math.random = realRandom;
	// @ts-expect-error
	idb.league = undefined;
});

const ACL = {
	years: [
		{
			season: 2025,
			school: "X",
			level: "ncaa" as const,
			injury: {
				type: "Torn ACL",
				games: 0,
				major: true as const,
				ended: true as const,
			},
			status: "injury" as const,
		},
		{ season: 2026, school: "X", level: "ncaa" as const },
	],
};

const genClass = async () => {
	const rng = new Rng("medicals.test");
	Math.random = () => rng.random();
	resetG();
	await resetCache({});
	const players = (await genPlayersWithoutSaving(
		2026,
		DEFAULT_LEVEL,
		[],
	)) as Player[];
	Math.random = realRandom;
	for (const [i, p] of players.entries()) {
		p.pid = i;
		p.tid = PLAYER.UNDRAFTED;
		p.draft.year = 2026;
		delete p.preDraftCareer;
	}
	return players;
};

describe("combine medicals (pure)", () => {
	test("risk from history and durability, and the grades", () => {
		assert.strictEqual(medicalRisk({ season: 2026, injuries: [] }), 0);
		assert.strictEqual(medicalGradeOf(0), "clean");
		// One minor injury is still clean, a recent major one a concern, a reconstruction a red flag
		const minor = medicalRisk({
			season: 2026,
			injuries: [{ season: 2026, type: "Sprained Ankle", games: 4 }],
		});
		assert.strictEqual(medicalGradeOf(minor), "clean");
		const major = medicalRisk({
			season: 2026,
			injuries: [
				{ season: 2026, type: "Fractured Foot", games: 14, major: true },
			],
		});
		assert.strictEqual(medicalGradeOf(major), "minor");
		const acl = medicalRisk({
			season: 2026,
			injuries: [
				{ season: 2025, type: "Torn ACL", games: 0, major: true, ended: true },
			],
		});
		assert.strictEqual(medicalGradeOf(acl), "redFlag");
		// Low durability raises it, never to a red flag alone
		assert.isAbove(
			medicalRisk({ season: 2026, injuries: [], durability: 20 }),
			medicalRisk({ season: 2026, injuries: [], durability: 50 }),
		);
		assert.notStrictEqual(
			medicalGradeOf(
				medicalRisk({ season: 2026, injuries: [], durability: 0 }),
			),
			"redFlag",
		);
		assert.strictEqual(
			medicalReason([
				{ season: 2024, type: "Sprained Ankle", games: 3 },
				{ season: 2025, type: "Torn ACL", games: 0, major: true, ended: true },
			]),
			"Torn ACL (2025, season-ending), Sprained Ankle (2024, missed 3 games)",
		);
		assert.strictEqual(medicalReason([]), "No injuries before the draft");
	});

	test("deterministic per prospect, and a better budget reads the risk more accurately", () => {
		const a = generateMedical({
			pid: 5,
			season: 2026,
			risk: 1.5,
			noiseSd: 0.6,
		});
		const b = generateMedical({
			pid: 5,
			season: 2026,
			risk: 1.5,
			noiseSd: 0.6,
		});
		assert.deepStrictEqual(a, b);
		assert.isBelow(medicalNoiseSd(1, 1), medicalNoiseSd(0, 0));
		assert.isAbove(medicalNoiseSd(-1, -1), medicalNoiseSd(0, 0));
		const wrong = (sd: number) => {
			let n = 0;
			for (let pid = 0; pid < 2000; pid++) {
				for (const risk of [0.3, 1.7, 3.2]) {
					const m = generateMedical({ pid, season: 2026, risk, noiseSd: sd });
					if (m.grade !== medicalGradeOf(risk)) {
						n += 1;
					}
				}
			}
			return n;
		};
		assert.isBelow(
			wrong(medicalNoiseSd(1, 1)),
			0.7 * wrong(medicalNoiseSd(-1, -1)),
		);
	});

	test("the injury names are the game's", () => {
		const names = new Set(defaultInjuries.map((inj) => inj.name));
		for (const type of PRE_DRAFT_INJURY_TYPES) {
			assert(names.has(type), type);
		}
	});
});

describe("combine medicals (league)", () => {
	test("every invited prospect gets a grade, stored with his combine, without the game's random numbers", async () => {
		const players = await genClass();
		// The best prospect (by the combine's stock) had a torn ACL
		const top = (await getClassCombine(2026, players, true)).players[0]!;
		top.preDraftCareer = structuredClone(ACL);
		await resetCache({ players });
		g.setWithoutSavingToDB("featureLotteryNight", true);
		g.setWithoutSavingToDB("featurePreDraftMedicals", true);
		g.setWithoutSavingToDB("season", 2026);
		g.setWithoutSavingToDB("phase", PHASE.DRAFT_LOTTERY);
		Math.random = () => {
			throw new Error("Math.random used");
		};
		await afterNewPhase(PHASE.DRAFT_LOTTERY);
		Math.random = realRandom;
		const stored = (await idb.cache.players.getAll()).filter((p) => p.combine);
		assert.isAbove(stored.length, 0);
		for (const p of stored) {
			assert(p.combine!.medical, String(p.pid));
		}
		const topStored = await idb.cache.players.get(top.pid);
		assert.strictEqual(
			medicalGradeOf(topStored!.combine!.medical!.risk),
			"redFlag",
		);
		assert.strictEqual(
			storedMedicalView(topStored!)?.reason.slice(0, 8),
			"Torn ACL",
		);

		// A held combine reads the stored grade: a better budget later doesn't change it
		const before = (await getClassCombine(2026)).results.get(top.pid)!.medical;
		assert.deepStrictEqual(before, topStored!.combine!.medical);

		// AI teams mark the red flag down, on top of the combine nudge
		g.setWithoutSavingToDB("phase", PHASE.DRAFT);
		const classPlayers = await idb.cache.players.getAll();
		const on = await getDraftCombineNudges(classPlayers);
		g.setWithoutSavingToDB("featurePreDraftMedicals", false);
		const off = await getDraftCombineNudges(classPlayers);
		assert.closeTo(
			on.get(top.pid)! - off.get(top.pid)!,
			-MEDICAL_DRAFT_PENALTY.redFlag,
			1e-9,
		);
		assert.isUndefined(storedMedicalView(topStored!));
	});

	test("red flag news for a top prospect (as the user's staff reads it)", async () => {
		const players = await genClass();
		const c0 = await getClassCombine(2026, players, true);
		const top = c0.players[0]!;
		top.preDraftCareer = structuredClone(ACL);
		// A second torn ACL in the draft year: a red flag for any reasonable read
		top.preDraftCareer.years[1]!.injury = {
			type: "Torn ACL",
			games: 0,
			major: true,
			ended: true,
		};
		await resetCache({ players });
		g.setWithoutSavingToDB("featureLotteryNight", true);
		g.setWithoutSavingToDB("featurePreDraftMedicals", true);
		g.setWithoutSavingToDB("season", 2026);
		g.setWithoutSavingToDB("phase", PHASE.DRAFT_LOTTERY);
		await afterNewPhase(PHASE.DRAFT_LOTTERY);
		const events = (await idb.cache.events.getAll()).filter((e) =>
			e.text?.includes("Medical red"),
		);
		assert.strictEqual(events.length, 1);
		assert(events[0]!.pids?.includes(top.pid));
	});

	test("off: no medicals", async () => {
		const players = await genClass();
		await resetCache({ players });
		g.setWithoutSavingToDB("featureLotteryNight", true);
		g.setWithoutSavingToDB("featurePreDraftMedicals", false);
		g.setWithoutSavingToDB("season", 2026);
		g.setWithoutSavingToDB("phase", PHASE.DRAFT_LOTTERY);
		await afterNewPhase(PHASE.DRAFT_LOTTERY);
		const stored = (await idb.cache.players.getAll()).filter((p) => p.combine);
		assert.isAbove(stored.length, 0);
		for (const p of stored) {
			assert.isUndefined(p.combine!.medical);
		}
	});

	test("a major pre-draft injury: a little more injury risk in his first two pro seasons", () => {
		resetG();
		g.setWithoutSavingToDB("featurePreDraftMedicals", true);
		const p = {
			preDraftCareer: structuredClone(ACL),
			draft: { year: 2026 } as any,
		};
		assert.strictEqual(preDraftInjuryRisk(p, 2026), 1);
		assert.strictEqual(preDraftInjuryRisk(p, 2027), PRE_DRAFT_INJURY_RISK);
		assert.strictEqual(preDraftInjuryRisk(p, 2028), PRE_DRAFT_INJURY_RISK);
		assert.strictEqual(preDraftInjuryRisk(p, 2029), 1);
		assert.strictEqual(
			preDraftInjuryRisk(
				{
					preDraftCareer: {
						years: [{ season: 2026, school: "X", level: "ncaa" }],
					},
					draft: { year: 2026 } as any,
				},
				2027,
			),
			1,
		);
		g.setWithoutSavingToDB("featurePreDraftMedicals", false);
		assert.strictEqual(preDraftInjuryRisk(p, 2027), 1);
	});
});
