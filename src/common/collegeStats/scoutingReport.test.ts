import { assert, describe, test } from "vitest";
import {
	getScoutingReport,
	type ReportRatings,
	type ScoutingReportInput,
} from "./scoutingReport.ts";

const ratings = (overrides: Partial<ReportRatings> = {}): ReportRatings => ({
	hgt: 46,
	stre: 43,
	spd: 50,
	jmp: 50,
	endu: 40,
	ins: 38,
	dnk: 48,
	ft: 45,
	fg: 44,
	tp: 42,
	oiq: 40,
	diq: 40,
	drb: 42,
	pss: 38,
	reb: 40,
	ovr: 45,
	pot: 58,
	...overrides,
});

const input = (
	overrides: Partial<ScoutingReportInput> = {},
): ScoutingReportInput => ({
	pid: 7,
	pos: "SF",
	age: 20,
	heightInches: 79,
	ratings: ratings(),
	production: {
		team: "Duke",
		classYear: "So.",
		gp: 34,
		min: 31.2,
		pts: 16.4,
		trb: 6.1,
		ast: 2.4,
		stl: 1.1,
		blk: 0.6,
		tov: 2.1,
		fgPct: 47.1,
		tpPct: 38.9,
		tpa: 5.2,
		ftPct: 78.4,
		fta: 4.1,
	},
	pick: 12,
	numPicks: 60,
	drafted: false,
	...overrides,
});

const text = (report: ReturnType<typeof getScoutingReport>) =>
	[
		report.summary,
		...report.strengths,
		...report.weaknesses,
		report.projection,
		report.basis,
	].join(" ");

describe("scouting report", () => {
	test("deterministic, with strengths, weaknesses and a projection", () => {
		const a = getScoutingReport(input());
		assert.deepStrictEqual(a, getScoutingReport(input()));
		assert.isAbove(a.strengths.length, 0);
		assert.isAbove(a.weaknesses.length, 0);
		assert.isAtMost(a.strengths.length, 3);
		assert.isAtMost(a.weaknesses.length, 3);
		assert.match(a.summary, /6'7"/);
		assert.match(a.summary, /sophomore at Duke/);
		assert.match(a.projection, /Our board has him in the lottery/);
		assert.notMatch(text(a), /undefined|NaN/);
	});

	test("says what the ratings it is given say", () => {
		const shooter = getScoutingReport(
			input({ ratings: ratings({ tp: 75, stre: 15 }) }),
		);
		assert.match(shooter.strengths.join(" "), /three/i);
		assert.match(shooter.strengths.join(" "), /38\.9% from three/);
		assert.match(shooter.weaknesses.join(" "), /strength|frame/i);

		const big = getScoutingReport(
			input({
				pos: "C",
				heightInches: 85,
				ratings: ratings({ hgt: 80, reb: 78, tp: 5, ft: 15, fg: 15 }),
			}),
		);
		assert.match(big.strengths.join(" "), /size|glass|rebound/i);
		assert.match(big.weaknesses.join(" "), /touch|free throw/i);

		const star = getScoutingReport(
			input({ ratings: ratings({ ovr: 60, pot: 78 }), pick: 1 }),
		);
		assert.match(star.projection, /franchise/);
		assert.match(star.projection, /top of the draft/);
		const fringe = getScoutingReport(
			input({ ratings: ratings({ ovr: 35, pot: 40 }), pick: undefined }),
		);
		assert.match(fringe.projection, /long/);
		assert.match(fringe.projection, /undrafted/);
	});

	test("is written from what the scouts see: the same fuzzed ratings give the same report", () => {
		// The report is a function of its input alone, and its input has no true ratings: two prospects the scouts grade the same get the same grades whatever they really are
		const seen = ratings({ tp: 60, diq: 25 });
		const a = getScoutingReport(input({ ratings: seen }));
		const b = getScoutingReport(input({ ratings: { ...seen } }));
		assert.deepStrictEqual(a, b);
		// A different look gives a different report
		const c = getScoutingReport(
			input({ ratings: ratings({ tp: 20, diq: 70 }) }),
		);
		assert.notDeepEqual(a.strengths, c.strengths);
	});

	test("ratings hidden: production only, no grades and no ceiling", () => {
		const report = getScoutingReport(input({ ratings: undefined }));
		assert.match(report.basis, /Ratings hidden/);
		assert.notMatch(report.projection, /upside|ceiling|ready|project/i);
		assert.match(report.projection, /Our board has him in the lottery/);
		assert.match(report.strengths.join(" "), /38\.9%/);
		// With hidden ratings, what the ratings are makes no difference
		assert.deepStrictEqual(
			report,
			getScoutingReport(input({ ratings: undefined, archetype: undefined })),
		);
	});

	test("never mentions player traits", () => {
		for (let pid = 0; pid < 200; pid++) {
			const r = ratings({
				tp: (pid * 13) % 90,
				diq: (pid * 29) % 90,
				oiq: (pid * 7) % 90,
				spd: (pid * 17) % 90,
				ovr: 30 + (pid % 35),
				pot: 35 + ((pid * 3) % 45),
			});
			const report = getScoutingReport(
				input({
					pid,
					ratings: r,
					story: ["bust", "injury", undefined][pid % 3],
					looks: pid % 4,
				}),
			);
			assert.notMatch(
				text(report),
				/work ethic|clutch|\bego\b|loyal|injury prone|durab|leader|character|coachab|trait/i,
			);
			assert.notMatch(text(report), /undefined|NaN/);
		}
	});

	test("a drafted player's report says where he went", () => {
		assert.match(
			getScoutingReport(input({ drafted: true, pick: 40 })).projection,
			/Went in the second round/,
		);
		assert.match(
			getScoutingReport(input({ drafted: true, pick: undefined })).projection,
			/Went undrafted/,
		);
	});
});
