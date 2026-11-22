import { assert, describe, test } from "vitest";
import { generateCollegeClass, planClassMembers } from "./generate.ts";
import { makeClass } from "./career.testutil.ts";
import { estimateRecord } from "./profile.ts";
import {
	PRODUCTION_NUDGE_MAX,
	getAgeAdjustedProduction,
	getProductionNudges,
	getSeasonContext,
	strengthOfTeam,
} from "./production.ts";
import {
	TEAM_USAGE_CAP,
	buildRosters,
	getTeamRoles,
	getTeamSeason,
	isTeamSchool,
	type TeamMember,
} from "./teams.ts";
import type { CollegeProspect } from "./types.ts";

const member = (
	key: string,
	z: number,
	pos = "SF",
	extra: Partial<TeamMember> = {},
): TeamMember => ({
	key,
	draftYear: 2027,
	school: "Duke",
	season: 2026,
	z,
	pos,
	mpg: 26,
	usg: 0.24,
	...extra,
});

describe("class-aware teams", () => {
	test("a team season is the same for everyone, and its games are the estimated record's", () => {
		const a = getTeamSeason("Duke", 2026);
		assert.deepEqual(a, getTeamSeason("Duke", 2026));
		const record = estimateRecord({
			team: "Duke",
			season: 2026,
			strength: 90,
			gp: 0,
			conference: "ACC",
		});
		assert.strictEqual(record.w + record.l, a.games);
		assert.isAbove(a.pace, 60);
		assert.isBelow(a.pace, 76);
		assert.isTrue(isTeamSchool("Duke"));
		assert.isFalse(isTeamSchool("EuroLeague"));
	});

	test("a star teammate lowers usage and minutes, more at his position", () => {
		const alone = getTeamRoles(buildRosters([member("a", 0)]), () => 85);
		const withStar = getTeamRoles(
			buildRosters([member("a", 0), member("star", 2.2)]),
			() => 85,
		);
		const withStarBig = getTeamRoles(
			buildRosters([member("a", 0), member("star", 2.2, "C")]),
			() => 85,
		);
		const base = alone.get("a|2026")!;
		const star = withStar.get("a|2026")!;
		const big = withStarBig.get("a|2026")!;
		assert.isBelow(star.usageShift, base.usageShift - 0.3);
		assert.isBelow(star.mpgShift, base.mpgShift - 3);
		// A center takes a wing's shots, not so much his minutes
		assert.isAbove(big.mpgShift, star.mpgShift);
		assert.strictEqual(star.teammates, 1);
		// The star loses less to a lesser teammate than the other way around
		assert.isAbove(withStar.get("star|2026")!.mpgShift, star.mpgShift);
	});

	test("locked members get no role, but their teammates play around them", () => {
		const roles = getTeamRoles(
			buildRosters([
				member("a", 0),
				member("old", 1.5, "SF", { locked: true, draftYear: 2026 }),
			]),
			() => 85,
		);
		assert.isUndefined(roles.get("old|2026"));
		assert.strictEqual(roles.get("a|2026")!.otherClass, 1);
	});

	test("a crowded roster stays within the team's budget", () => {
		const roster = Array.from({ length: 8 }, (_, i) =>
			member(String(i), 1, ["PG", "SG", "SF", "PF", "C"][i % 5]!, {
				mpg: 30,
				usg: 0.27,
			}),
		);
		const roles = getTeamRoles(buildRosters(roster), () => 85);
		let usage = 0;
		let minutes = 0;
		for (const m of roster) {
			const r = roles.get(`${m.key}|2026`)!;
			const mpg = Math.max(7, Math.min(36, m.mpg + r.mpgShift));
			const usg = Math.max(0.13, Math.min(0.34, m.usg + 0.044 * r.usageShift));
			usage += (usg * mpg) / 40;
			minutes += mpg;
		}
		assert.isAtMost(usage, TEAM_USAGE_CAP + 0.05);
		assert.isAtMost(minutes, 200);
	});

	test("teammates from two classes share their team's games and pace", () => {
		const older = makeClass(70, "teamsA").map((p) => ({
			...p,
			college: "Kentucky",
			age: 22,
		}));
		const younger = makeClass(70, "teamsB").map((p) => ({
			...p,
			key: `y${p.key}`,
			college: "Kentucky",
			age: 20,
		}));
		const olderMembers = planClassMembers(older, {
			seed: "a",
			draftYear: 2027,
		});
		const a = generateCollegeClass(older, { seed: "a", draftYear: 2027 });
		const b = generateCollegeClass(younger, {
			seed: "b",
			draftYear: 2028,
			teamMembers: olderMembers,
		});
		const games = new Map<number, Set<number>>();
		for (const r of [...a, ...b]) {
			for (const s of r.seasons) {
				if (s.school === "Kentucky" && s.season === 2027) {
					const set = games.get(s.season) ?? new Set();
					set.add(s.teamGames);
					games.set(s.season, set);
				}
			}
			for (const y of r.career?.years ?? []) {
				if (
					y.school === "Kentucky" &&
					y.season === 2027 &&
					y.pace !== undefined
				) {
					assert.strictEqual(y.pace, getTeamSeason("Kentucky", 2027).pace);
				}
			}
		}
		assert.strictEqual(games.get(2027)?.size, 1);
		// Planned members are where generation puts them
		const kentucky2026 = olderMembers.filter(
			(m) => m.school === "Kentucky" && m.season === 2026,
		);
		assert.isAbove(kentucky2026.length, 0);
		for (const m of kentucky2026) {
			const result = a.find((r) => r.key === m.key)!;
			assert.isTrue(
				result.seasons.some(
					(s) => s.season === 2026 && s.school === "Kentucky",
				),
			);
		}
	});

	test("deterministic with teams", () => {
		const prospects = makeClass(50, "det");
		const members = planClassMembers(makeClass(50, "det2"), {
			seed: "x",
			draftYear: 2028,
		});
		const run = () =>
			JSON.stringify(
				generateCollegeClass(prospects, {
					seed: "s",
					draftYear: 2027,
					teamMembers: members,
				}),
			);
		assert.strictEqual(run(), run());
	});
});

describe("role changes", () => {
	test("late bloomers break out more, early bloomers slump more", () => {
		const count = (lateness: number) => {
			const prospects: CollegeProspect[] = makeClass(400, "roles").map((p) => ({
				...p,
				lateness,
			}));
			const results = generateCollegeClass(prospects, {
				seed: "r",
				draftYear: 2027,
			});
			let breakout = 0;
			let slump = 0;
			for (const r of results) {
				for (const y of r.career?.years ?? []) {
					breakout += y.role === "breakout" ? 1 : 0;
					slump += y.role === "slump" ? 1 : 0;
				}
			}
			return { breakout, slump };
		};
		const late = count(1);
		const early = count(-1);
		assert.isAbove(late.breakout, early.breakout);
		assert.isAbove(early.slump, late.slump);
	});

	test("a freshman who moved into the lineup starts the later games only", () => {
		const results = generateCollegeClass(makeClass(300, "fresh"), {
			seed: "f",
			draftYear: 2027,
		});
		let n = 0;
		for (const r of results) {
			for (const y of r.career?.years ?? []) {
				if (y.role === "midStarter") {
					const s = r.seasons.find((x) => x.season === y.season)!;
					assert.isBelow(s.stats.gs!, s.stats.gp!);
					n += 1;
				}
			}
		}
		assert.isAbove(n, 10);
	});
});

describe("context-adjusted production", () => {
	const row = {
		gp: 30,
		min: 900,
		pts: 450,
		fg: 170,
		fga: 360,
		fta: 120,
		ft: 90,
		orb: 40,
		drb: 140,
		stl: 30,
		ast: 70,
		blk: 20,
		pf: 60,
		tov: 60,
		bpm: 5,
	};

	test("schedule and pace adjust the right way", () => {
		const strong = getSeasonContext(row, { strength: 92, pace: 64 })!;
		const weak = getSeasonContext(row, { strength: 55, pace: 72 })!;
		assert.strictEqual(strong.pts40, weak.pts40);
		assert.isAbove(strong.adjPts40, weak.adjPts40);
		assert.isAbove(strong.adjBpm!, weak.adjBpm!);
		assert.isAbove(strong.pts100, weak.pts100);
		assert.strictEqual(strengthOfTeam("Duke") > strengthOfTeam("Albany"), true);
	});

	test("a younger player's numbers count more", () => {
		const young = getAgeAdjustedProduction([{ row, strength: 85, age: 19 }])!;
		const old = getAgeAdjustedProduction([{ row, strength: 85, age: 22 }])!;
		assert.isAbove(young.value, old.value + 4);
		assert.isUndefined(getAgeAdjustedProduction([]));
	});

	test("draft nudges are bounded and average out", () => {
		const entries = Array.from({ length: 60 }, (_, i) => ({
			key: i,
			value: i === 0 ? 80 : 10 + (i % 10),
			minutes: 1000,
		}));
		const nudges = getProductionNudges(entries);
		for (const v of nudges.values()) {
			assert.isAtMost(Math.abs(v), PRODUCTION_NUDGE_MAX);
		}
		assert.strictEqual(nudges.get(0), PRODUCTION_NUDGE_MAX);
	});
});
