import { describe, expect, test } from "vitest";
import {
	firstProSeason,
	firstSeasonLabel,
	primeSeason,
	seasonTeam,
	type HistoryPlayer,
} from "./faceHistory.ts";

const row = (season: number, tid: number, gp = 50, playoffs = false) => ({
	season,
	tid,
	gp,
	playoffs,
});

describe("face history: first pro season and labels", () => {
	test("a prospect generated years before his draft: rookie is his first pro season, not when he was generated", () => {
		// Generated as a prospect in 2023 (snapshots 2023-2025 may exist from older versions), drafted 2025
		const p: HistoryPlayer = {
			tid: 4,
			draft: { year: 2025 },
			stats: [row(2026, 4), row(2026, 4, 3, true), row(2027, 4)],
		};
		expect(firstProSeason(p, 2027)).toBe(2026);
		expect(firstSeasonLabel(p, 2026, 2020)).toBe("Rookie");
	});

	test("a prospect has no pro season (his own page shows his current face, no history)", () => {
		const p: HistoryPlayer = { tid: -2, draft: { year: 2027 }, stats: [] };
		expect(firstProSeason(p, 2026)).toBeUndefined();
		// Just drafted, same season: still not a pro season
		expect(firstProSeason({ ...p, tid: 3, draft: { year: 2026 } }, 2026)).toBe(
			undefined,
		);
		// Next season, on the roster before any game
		expect(firstProSeason({ ...p, tid: 3, draft: { year: 2026 } }, 2027)).toBe(
			2027,
		);
	});

	test("undrafted, signed later: his first season on a team is his rookie season", () => {
		const p: HistoryPlayer = {
			tid: 9,
			draft: { year: 2024 },
			stats: [row(2027, 9, 12)],
		};
		expect(firstProSeason(p, 2028)).toBe(2027);
		expect(firstSeasonLabel(p, 2027, 2020)).toBe("Rookie");
	});

	test("veterans at league creation are never called rookies", () => {
		const vet: HistoryPlayer = {
			tid: 1,
			draft: { year: 2015 },
			stats: [row(2025, 1), row(2026, 1)],
		};
		expect(firstProSeason(vet, 2026)).toBe(2025);
		expect(firstSeasonLabel(vet, 2025, 2025)).toBe("League start");
		// A veteran free agent at league start who signed later
		expect(firstSeasonLabel(vet, 2027, 2025)).toBe("First season");
		// Drafted the year before the league began: a real rookie in the first season
		expect(
			firstSeasonLabel({ ...vet, draft: { year: 2024 } }, 2025, 2025),
		).toBe("Rookie");
	});

	test("college leagues: his first college season", () => {
		const p: HistoryPlayer = {
			tid: 30,
			draft: { year: 2026 },
			stats: [row(2026, 30)],
		};
		expect(firstProSeason(p, 2027, true)).toBe(2026);
		expect(firstSeasonLabel(p, 2026, 2020, true)).toBe("First season");
	});
});

describe("face history: jerseys and prime", () => {
	test("the team he played the most games for, a tie to the later one, none when retired", () => {
		const p: HistoryPlayer = {
			tid: 5,
			draft: { year: 2020 },
			stats: [
				row(2024, 2, 30),
				row(2024, 5, 52),
				row(2025, 5, 20),
				row(2025, 7, 20),
				row(2025, 7, 10, true),
				row(2026, 8, 70),
			],
			retiredYear: 2026,
		};
		expect(seasonTeam(p, 2024, 2030)).toBe(5);
		expect(seasonTeam(p, 2025, 2030)).toBe(7);
		expect(seasonTeam(p, 2026, 2030)).toBe(8);
		expect(seasonTeam(p, 2027, 2030)).toBeUndefined();
		// No games yet this season: his current team
		const active = { ...p, retiredYear: undefined, tid: 9 };
		expect(seasonTeam(active, 2030, 2030)).toBe(9);
		expect(seasonTeam(active, 2029, 2030)).toBeUndefined();
	});

	test("prime: the pro season with his best ovr, the first on a tie", () => {
		const p: HistoryPlayer = {
			tid: -3,
			draft: { year: 2020 },
			stats: [],
			retiredYear: 2032,
			ratings: [
				{ season: 2020, ovr: 80 },
				{ season: 2021, ovr: 50 },
				{ season: 2026, ovr: 71 },
				{ season: 2028, ovr: 71 },
				{ season: 2033, ovr: 90 },
			],
		};
		// The prospect-year rating and anything after he retired don't count
		expect(primeSeason(p, 2021)).toBe(2026);
	});
});
