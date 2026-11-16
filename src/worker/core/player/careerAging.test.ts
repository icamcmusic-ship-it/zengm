import { assert, beforeEach, describe, test } from "vitest";
import { g } from "../../util/index.ts";
import { resetG } from "../../../test/helpers.ts";
import {
	athleticReliance,
	careerRetireFactors,
	getCareerAgingDevelopment,
	injuryAthleticLoss,
	mergeCareerAging,
	mileageExcess,
	reinventionStrength,
	specialtyOf,
	usefulVeteran,
} from "./careerAging.ts";

const row = (season: number, x: Record<string, number> = {}) => ({
	season,
	hgt: 50,
	stre: 50,
	spd: 50,
	jmp: 50,
	endu: 50,
	ins: 50,
	dnk: 50,
	ft: 50,
	fg: 50,
	tp: 50,
	oiq: 50,
	diq: 50,
	drb: 50,
	pss: 50,
	reb: 50,
	...x,
});

const flyer = row(2030, { spd: 80, jmp: 85, dnk: 80, tp: 30, ft: 45, pss: 40 });
const shooter = row(2030, {
	spd: 45,
	jmp: 40,
	dnk: 35,
	tp: 80,
	ft: 85,
	fg: 70,
});

describe("careerAging", () => {
	beforeEach(() => {
		resetG();
		g.setWithoutSavingToDB("careerAging" as any, true as any);
	});

	test("athletic reliance follows the shape", () => {
		assert.isAbove(athleticReliance(flyer), 0.5);
		assert.isBelow(athleticReliance(shooter), -0.5);
		assert.strictEqual(specialtyOf(shooter), "shooter");
	});

	test("mileage excess is bounded", () => {
		assert.strictEqual(mileageExcess(1e6, 30), 1.5);
		assert.strictEqual(mileageExcess(0, 30), -1);
		assert.closeTo(mileageExcess(1600 * 9, 30), 0, 1e-9);
	});

	test("injury loss is seeded, bounded and only for long or major injuries", () => {
		const args = {
			pid: 5,
			type: "Torn Achilles Tendon",
			games: 120,
			age: 31,
			season: 2030,
			n: 2,
			seed: 7,
		};
		const a = injuryAthleticLoss(args)!;
		const b = injuryAthleticLoss(args)!;
		assert.deepEqual(a, b);
		for (const v of Object.values(a.loss)) {
			assert.isAtLeast(v, 0);
			assert.isAtMost(v, 20);
		}
		assert.isUndefined(
			injuryAthleticLoss({ ...args, type: "Sprained Ankle", games: 5 }),
		);
		let never = 0;
		let total = 0;
		for (let pid = 0; pid < 2000; pid++) {
			const x = injuryAthleticLoss({ ...args, type: "Torn ACL", pid })!;
			never += x.neverSame ? 1 : 0;
			total += x.loss.spd!;
		}
		assert.isAbove(never, 60);
		assert.isBelow(never, 220);
		assert.isBelow(total / 2000, 12);
	});

	test("wear and tear and style are centered, reinvention is for faded veterans", () => {
		const stats = (min: number) =>
			[2022, 2023, 2024, 2025, 2026, 2027, 2028, 2029].map((season) => ({
				season,
				tid: 0,
				min,
			}));
		const players = [
			{
				pid: 1,
				born: { year: 2000 },
				ratings: [row(2026, { spd: 85, jmp: 90 }), flyer],
				stats: stats(3000),
			},
			{
				pid: 2,
				born: { year: 2000 },
				ratings: [shooter],
				stats: stats(500),
			},
		];
		const dev = getCareerAgingDevelopment(players, 2031);
		const d1 = dev.get(1)!.ratingDelta;
		const d2 = dev.get(2)!.ratingDelta;
		assert.isBelow(d1.spd!, d2.spd!);
		assert.closeTo(d1.stre! + d2.stre!, 0, 1e-9);
		assert.isAbove(reinventionStrength(players[0]!, 31), 0);
		assert.isDefined(dev.get(1)!.tilt);
		const merged = mergeCareerAging(
			{ baseChangeDelta: 1, dropScale: 1, ratingDelta: { tp: 1 } },
			{ ratingDelta: { tp: 0.5 } },
		)!;
		assert.strictEqual(merged.ratingDelta!.tp, 1.5);
		assert.strictEqual(merged.baseChangeDelta, 1);
	});

	test("off: nothing", () => {
		g.setWithoutSavingToDB("careerAging" as any, false as any);
		assert.strictEqual(
			getCareerAgingDevelopment(
				[{ pid: 1, born: { year: 2000 }, ratings: [flyer] }],
				2031,
			).size,
			0,
		);
	});

	test("retirement factors", () => {
		const base = {
			pid: 1,
			born: { year: 1995 },
			ratings: [flyer],
			tid: 0,
			contracts: [] as any[],
			awards: [] as { season: number; type: string }[],
			injury: { type: "Healthy", gamesRemaining: 0 },
			injuries: [],
		};
		const starter = careerRetireFactors({
			p: { ...base, stats: [{ season: 2030, tid: 0, min: 2200, pts: 900 }] },
			age: 36,
			season: 2030,
			ovr: 50,
		});
		const bench = careerRetireFactors({
			p: { ...base, tid: -1, stats: [{ season: 2030, tid: 0, min: 100 }] },
			age: 36,
			season: 2030,
			ovr: 50,
		});
		assert.isBelow(starter.mult, bench.mult);
		const champ = careerRetireFactors({
			p: {
				...base,
				awards: [{ season: 2030, type: "Won Championship" }],
				stats: [{ season: 2030, tid: 0, min: 2200, pts: 900 }],
			},
			age: 36,
			season: 2030,
			ovr: 60,
		});
		assert.isAbove(champ.add, 0);
		const old = careerRetireFactors({
			p: { ...base, stats: [] },
			age: 42,
			season: 2030,
			ovr: 50,
		});
		assert.isAtLeast(old.add, 0.5);
	});

	test("a veteran is useful when he'd be in his team's top 13, not for a rebuilding team", () => {
		const season = g.get("season");
		const vet = (age: number, value: number) => ({
			born: { year: season - age },
			value,
			injury: { gamesRemaining: 0 },
		});
		const roster = Array.from({ length: 14 }, (_, i) => 60 - i * 2); // 13th best is 36
		assert.isTrue(usefulVeteran(vet(35, 40), roster, "contending"));
		assert.isFalse(usefulVeteran(vet(35, 35), roster, "contending"));
		assert.isFalse(usefulVeteran(vet(32, 40), roster, "contending"));
		assert.isFalse(usefulVeteran(vet(38, 40), roster, "contending"));
		assert.isFalse(usefulVeteran(vet(35, 40), roster, "rebuilding"));
		assert.isTrue(usefulVeteran(vet(36, 50), roster.slice(0, 8), "contending"));
	});
});
