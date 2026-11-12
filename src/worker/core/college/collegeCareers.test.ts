// College mode, coaching careers and conference realignment (docs/college-mode.md): a power-conference league played through one season
// and into the next. The coaches get a made-up history first, so the carousel has records to judge (a new league's coaches have none).
import "fake-indexeddb/auto";
import { assert, describe, test } from "vitest";
import { LEAGUE_DATABASE_VERSION, PHASE } from "../../../common/constants.ts";
import { makeSeededRandom } from "../../../common/random.ts";
import { COACH_FREE_AGENT } from "../../../common/staff.ts";
import { getCollegeLeagueTeams } from "../../../common/college/teams.ts";
import { getCollegeSettings } from "../../../common/college/settings.ts";
import { game, league, phase, team } from "../index.ts";
import * as views from "../../views/index.ts";
import { idb } from "../../db/index.ts";
import { getDefaultSettings } from "../../views/newLeague.ts";
import { g } from "../../util/index.ts";
import { getCollegeArchive } from "./archive.ts";
import { getTeamPrestige } from "./players.ts";
import { realignConferences } from "./realignment.ts";
import { getCollegeState } from "./state.ts";
import { respondToOffer } from "../staff/collegeCarousel.ts";

const loadView = async (id: string, params: Record<string, unknown> = {}) => {
	const view = (views as any)[id];
	const inputs = view.processInputs ? view.processInputs(params, {}) : {};
	const out = await view.load({
		inputs,
		updateEvents: new Set(["firstRun"]),
		prevInputs: inputs,
		prevOutput: {},
		conditions: {},
	});
	assert.isUndefined((out as any)?.errorMessage);
	return out as any;
};

const playPhase = async (p: number) => {
	let days = 0;
	while (g.get("phase") === p) {
		await game.play(1, {});
		days += 1;
		assert.isBelow(days, 120);
	}
};

const headOf = async (tid: number) =>
	(await idb.cache.coaches.getAll()).find(
		(c) => c.tid === tid && c.role === "head",
	);

describe("college coaching careers and realignment", () => {
	test(
		"carousel, offers, firing, realignment",
		{ timeout: 30 * 60 * 1000 },
		async () => {
			Math.random = makeSeededRandom(11);
			const { teams, confs, divs } = getCollegeLeagueTeams("power");
			const settings: any = {
				...getDefaultSettings(),
				...getCollegeSettings("power"),
				collegeQuickSim: true,
			};
			// The user coaches the smallest program, so bigger ones can want him
			const byPrestige = teams
				.map((t, tid) => ({ tid, p: getTeamPrestige(t as any) }))
				.sort((a, b) => a.p - b.p);
			const userTid = byPrestige[0]!.tid;
			await league.createStream(
				{},
				{
					confs,
					divs,
					fromFile: {
						gameAttributes: undefined,
						hasRookieContracts: true,
						maxGid: undefined,
						startingSeason: undefined,
						teams: undefined,
						version: LEAGUE_DATABASE_VERSION,
					},
					getLeagueOptions: undefined,
					keptKeys: new Set(),
					lid: 0,
					name: "college careers",
					setLeagueCreationStatus: () => {},
					settings,
					shuffleRosters: false,
					startingSeasonFromInput: "2025",
					teamsFromInput: teams.map((t) => ({ ...t, popRank: 1 })) as any,
					tid: userTid,
				},
			);
			await league.loadGameAttributes();
			assert.isTrue(g.get("collegeRealignment" as any));
			const season = g.get("season");

			await phase.newPhase(PHASE.REGULAR_SEASON, {});
			await playPhase(PHASE.REGULAR_SEASON);
			await playPhase(PHASE.AFTER_TRADE_DEADLINE);

			// A made-up history before the offseason: every head coach coached his school the two seasons before, at about the expected record.
			// The user's coach (and one coach at a small school) did much better, and the two biggest programs have an opening
			const coaches = await idb.cache.coaches.getAll();
			const userCoach = coaches.find(
				(c) => c.tid === userTid && c.role === "head",
			)!;
			assert.isDefined(userCoach);
			const star = coaches.find(
				(c) => c.tid === byPrestige[3]!.tid && c.role === "head",
			)!;
			for (const c of coaches) {
				if (c.tid < 0 || c.role !== "head") {
					continue;
				}
				const great = c.cid === userCoach.cid || c.cid === star.cid;
				for (const s of [season - 2, season - 1]) {
					c.stats.push({
						season: s,
						tid: c.tid,
						role: "head",
						won: great ? 28 : 15,
						lost: great ? 3 : 15,
						tied: 0,
						otl: 0,
						playoffRoundsWon: great ? 3 : -1,
					});
				}
				if (great) {
					c.awards.push({ season: season - 1, type: "Coach of the Year" });
				}
				await idb.cache.coaches.put(c);
			}
			const top = byPrestige.slice(-2).map((row) => row.tid);
			for (const tid of top) {
				const c = (await headOf(tid))!;
				c.tid = COACH_FREE_AGENT;
				await idb.cache.coaches.put(c);
			}

			await playPhase(PHASE.PLAYOFFS);
			assert.strictEqual(g.get("phase"), PHASE.DRAFT_LOTTERY);

			// Offers to the user from the open jobs at bigger programs, those jobs held for him
			const offers = getCollegeState()!.coachOffers ?? [];
			assert.isAbove(offers.length, 0, "job offers");
			for (const o of offers) {
				assert.isUndefined(await headOf(o.tid), "held job");
				assert.isAbove(o.prestige, byPrestige[0]!.p);
			}
			// Every other school has a head coach
			for (const t of await idb.cache.teams.getAll()) {
				if (!offers.some((o) => o.tid === t.tid)) {
					assert.isDefined(await headOf(t.tid), `${t.region} head coach`);
				}
			}
			const carousel = await loadView("collegeCarousel");
			assert.lengthOf(carousel.offers, offers.length);
			assert.isDefined(carousel.you);
			assert.isAbove(carousel.rows.length, 0, "carousel moves");
			const moves = carousel.rows.filter(
				(r: any) => r.type === "hired" && r.fromType === "left",
			);
			// Open jobs not offered to the user go to free agents or to sitting head coaches of smaller programs, who leave them
			for (const r of moves) {
				assert.isAbove(
					getTeamPrestige((await idb.cache.teams.get(r.tid))!),
					getTeamPrestige((await idb.cache.teams.get(r.fromTid))!),
				);
			}

			// Accept the best offer: the user and his coach move, the old school hires someone
			const offer = offers[0]!;
			assert.deepEqual(await respondToOffer(offer.tid, true), {});
			assert.strictEqual(g.get("userTid"), offer.tid);
			assert.strictEqual(
				(await idb.cache.coaches.get(userCoach.cid))!.tid,
				offer.tid,
			);
			assert.isDefined(await headOf(userTid), "old school hired a coach");
			assert.lengthOf(getCollegeState()!.coachOffers!, 0);
			const moved = await idb.cache.coaches.get(userCoach.cid);
			assert.deepEqual(
				moved!.transactions.slice(-2).map((tx) => [tx.type, tx.tid]),
				[
					["left", userTid],
					["hired", offer.tid],
				],
			);

			// Realignment (forced here; by chance in a real league)
			const cidsBefore = new Map(
				(await idb.cache.teams.getAll()).map((t) => [t.tid, t.cid]),
			);
			// A school of the weakest conference that has outgrown it
			{
				const all = await idb.cache.teams.getAll();
				const byConf = Map.groupBy(all, (t) => t.cid);
				const avg = (cid: number) =>
					byConf.get(cid)!.reduce((sum, t) => sum + getTeamPrestige(t), 0) /
					byConf.get(cid)!.length;
				const weakest = [...byConf.keys()].sort((a, b) => avg(a) - avg(b))[0]!;
				const best = Math.max(...[...byConf.keys()].map(avg));
				const t = byConf.get(weakest)![0]!;
				(t as any).collegePrestige = best + 1;
				await idb.cache.teams.put(t);
			}
			const realigned = await realignConferences(true);
			assert.isAbove(realigned.length, 0, "realignment moves");
			assert.isTrue(realigned.some((m) => m.reason === "upgrade"));
			for (const m of realigned) {
				const t = (await idb.cache.teams.get(m.tid))!;
				assert.strictEqual(cidsBefore.get(m.tid), m.from);
				assert.strictEqual(t.cid, m.to);
				assert.strictEqual(
					g.get("divs").find((d) => d.did === t.did)!.cid,
					m.to,
				);
			}
			assert.deepEqual(
				(await getCollegeArchive(season))?.realignment,
				realigned,
			);
			const page = await loadView("collegeCarousel");
			assert.lengthOf(page.realignment, realigned.length);

			// On to next season: the schedule follows the new conferences
			await phase.newPhase(PHASE.DRAFT, {});
			await phase.newPhase(PHASE.AFTER_DRAFT, {});
			await phase.newPhase(PHASE.RESIGN_PLAYERS, {});
			await phase.newPhase(PHASE.FREE_AGENCY, {});
			await phase.newPhase(PHASE.PRESEASON, {});
			await phase.newPhase(PHASE.REGULAR_SEASON, {});
			const games = await idb.cache.schedule.getAll();
			const cid = new Map(
				(await idb.cache.teams.getAll()).map((t) => [t.tid, t.cid]),
			);
			const mover = realigned[0]!;
			const confGames = games.filter(
				(gm) =>
					(gm.homeTid === mover.tid || gm.awayTid === mover.tid) &&
					cid.get(gm.homeTid) === cid.get(gm.awayTid),
			);
			assert.isAtLeast(
				confGames.length,
				14,
				"conference games in the new conference",
			);
			for (const gm of confGames) {
				const other = gm.homeTid === mover.tid ? gm.awayTid : gm.homeTid;
				assert.strictEqual(cid.get(other), mover.to);
			}
			const ts = await idb.cache.teamSeasons.indexGet(
				"teamSeasonsBySeasonTid",
				[season + 1, mover.tid],
			);
			assert.strictEqual(ts!.cid, mover.to);
			const tsOld = await idb.cache.teamSeasons.indexGet(
				"teamSeasonsBySeasonTid",
				[season, mover.tid],
			);
			assert.strictEqual(
				tsOld!.cid,
				mover.from,
				"history keeps the old conference",
			);

			// Fired: the owner fires the user, who takes another job and his coach goes with him
			const userNow = g.get("userTid");
			const coachNow = (await headOf(userNow))!;
			const newSchool =
				byPrestige[1]!.tid === userNow
					? byPrestige[2]!.tid
					: byPrestige[1]!.tid;
			await league.setGameAttributes({ gameOver: true });
			await team.switchTo(newSchool);
			assert.strictEqual(g.get("userTid"), newSchool);
			const after = (await idb.cache.coaches.get(coachNow.cid))!;
			assert.strictEqual(after.tid, newSchool);
			assert.includeDeepMembers(
				after.transactions.slice(-2).map((tx) => [tx.type, tx.tid]),
				[
					["fired", userNow],
					["hired", newSchool],
				],
			);
		},
	);
});
