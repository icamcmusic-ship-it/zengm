import { afterEach, assert, test } from "vitest";
import GameSim, { TECHNICAL_FOUL_RATES } from "./index.ts";
import loadTeams from "../game/loadTeams.ts";
import { g } from "../../util/index.ts";
import { defaultGameAttributes } from "../../../common/defaultGameAttributes.ts";
import {
	genTeams,
	makeLiveBoxScore,
	playLive,
	withSeededRandom,
} from "./simLiveGameForTests.ts";
import {
	decodePlayByPlay,
	encodePlayByPlay,
	storedInitEvent,
} from "../../../common/pbpFlavor/store.ts";

/*
 * Technical and flagrant fouls, ejections: the technicalFouls setting. Off by default (existing leagues, and outcomeInvariance.test.ts,
 * which must stay byte-identical), on here.
 */

const RATES = { ...TECHNICAL_FOUL_RATES };
afterEach(() => {
	Object.assign(TECHNICAL_FOUL_RATES, RATES);
});

// Many games between the same two teams (made once, slow), each with its own seed
const simGames = async (
	seed: number,
	numGames: number,
	opts: { techFouls?: boolean; doPlayByPlay?: boolean } = {},
) => {
	return withSeededRandom(seed, async () => {
		await genTeams();
		g.setWithoutSavingToDB("technicalFouls", opts.techFouls ?? true);
		const out = [];
		for (let i = 0; i < numGames; i++) {
			const teams = await loadTeams([0, 1], {});
			const sim = new GameSim({
				gid: seed * 1000 + i,
				teams: [teams[0]!, teams[1]!],
				baseInjuryRate: g.get("injuryRate"),
				doPlayByPlay: opts.doPlayByPlay ?? false,
				homeCourtFactor: 1,
				allStarGame: false,
				neutralSite: false,
			});
			const result = sim.run();
			out.push({ result, sim, events: result.playByPlay!.slice() as any[] });
		}
		return out;
	});
};

const count = (events: any[], type: string, f?: (e: any) => boolean) =>
	events.filter((e) => e.type === type && (!f || f(e))).length;

test("the setting is off for existing leagues and tests, so their games play out as before", () => {
	assert.strictEqual(defaultGameAttributes.technicalFouls, false);
});

test("technical and flagrant fouls happen at realistic rates", async () => {
	const games = await simGames(1, 2000);
	let techs = 0;
	let flagrant1 = 0;
	let flagrant2 = 0;
	let ejections = 0;
	for (const { events } of games) {
		techs += count(events, "techFoul");
		flagrant1 += count(events, "flagrantFoul", (e) => e.level === 1);
		flagrant2 += count(events, "flagrantFoul", (e) => e.level === 2);
		ejections += count(events, "ejection");
	}
	const n = games.length;
	console.log(
		`per game: technicals ${techs / n}, flagrant 1 ${flagrant1 / n}, flagrant 2 ${flagrant2 / n}, ejections ${ejections / n}`,
	);
	assert.isTrue(techs / n >= 0.25 && techs / n <= 0.6, `techs ${techs / n}`);
	assert.isTrue(
		flagrant1 / n >= 0.03 && flagrant1 / n <= 0.15,
		`flagrant 1s ${flagrant1 / n}`,
	);
	assert.isTrue(flagrant2 / n <= 0.03, `flagrant 2s ${flagrant2 / n}`);
	assert.isTrue(ejections / n <= 0.06, `ejections ${ejections / n}`);
}, 60_000);

test("a technical is one free throw for the other team, and possession doesn't change", async () => {
	TECHNICAL_FOUL_RATES.techPerDeadBall = 0.05;
	const games = await simGames(2, 6);
	let seen = 0;
	for (const { events } of games) {
		for (const [i, e] of events.entries()) {
			if (e.type !== "techFoul") {
				continue;
			}
			seen += 1;
			const fts = [];
			let j = i + 1;
			for (; j < events.length; j++) {
				const f = events[j];
				if (f.type === "stat" || f.type === "ejection" || f.type === "sub") {
					continue;
				}
				if ((f.type === "ft" || f.type === "missFt") && f.tech) {
					fts.push(f);
					continue;
				}
				break;
			}
			assert.strictEqual(fts.length, 1, "one free throw");
			assert.strictEqual(fts[0].t, e.t === 0 ? 1 : 0, "by the other team");
		}
	}
	assert.isTrue(seen > 20, `techs seen: ${seen}`);

	// The team with the ball is the same before and after: check it in the sim itself
	TECHNICAL_FOUL_RATES.techPerDeadBall = 1;
	await withSeededRandom(3, async () => {
		await genTeams();
		g.setWithoutSavingToDB("technicalFouls", true);
		const teams = await loadTeams([0, 1], {});
		const sim = new GameSim({
			gid: 3,
			teams: [teams[0]!, teams[1]!],
			baseInjuryRate: 0,
			doPlayByPlay: false,
			homeCourtFactor: 1,
			allStarGame: false,
			neutralSite: false,
		});
		const original = sim.maybeTechnicalFoul.bind(sim);
		let calls = 0;
		sim.maybeTechnicalFoul = (outcome) => {
			const before = [sim.o, sim.d, sim.prevPossessionOutcome];
			const fta = sim.team.map((t) => t.stat.fta);
			original(outcome);
			calls += 1;
			assert.deepStrictEqual([sim.o, sim.d, sim.prevPossessionOutcome], before);
			const dFta = sim.team.map((t, i) => t.stat.fta - fta[i]!);
			assert.isTrue(
				(dFta[0] === 0 && dFta[1] <= 1) || (dFta[1] === 0 && dFta[0]! <= 1),
			);
		};
		sim.run();
		assert.isTrue(calls > 50);
	});
});

test("a flagrant foul is a personal foul, two free throws and the ball", async () => {
	TECHNICAL_FOUL_RATES.flagrantPerPossession = 0.03;
	const games = await simGames(4, 4);
	let seen = 0;
	for (const { events, result } of games) {
		for (const [i, e] of events.entries()) {
			if (e.type !== "flagrantFoul") {
				continue;
			}
			seen += 1;
			const offense = e.t === 0 ? 1 : 0;
			// the personal foul was recorded on him just before
			const pf = events
				.slice(Math.max(0, i - 3), i)
				.find((f) => f.type === "stat" && f.s === "pf" && f.pid === e.pid);
			assert.isDefined(pf, "PF recorded");
			const fts = [];
			let next: any;
			for (let j = i + 1; j < events.length; j++) {
				const f = events[j];
				if (
					f.type === "stat" ||
					f.type === "ejection" ||
					f.type === "sub" ||
					f.type === "foulOut" ||
					f.type === "techFoul" ||
					f.tech
				) {
					continue;
				}
				if (
					(f.type === "ft" || f.type === "missFt") &&
					f.pid === e.pidShooting &&
					fts.length < 2
				) {
					fts.push(f);
					continue;
				}
				next = f;
				break;
			}
			assert.strictEqual(fts.length, 2, "two free throws");
			for (const ft of fts) {
				assert.strictEqual(ft.t, offense);
			}
			// no rebound: the fouled team has the ball next
			if (next && next.type !== "period" && next.type !== "elamActive") {
				assert.notInclude(["orb", "drb"], next.type);
				if (next.type.startsWith("fga") || next.type === "tov") {
					assert.strictEqual(next.t, offense, `next: ${next.type}`);
				} else if (next.type === "stl" || next.type.startsWith("pf")) {
					assert.strictEqual(next.t, e.t, `next: ${next.type}`);
				}
			}
		}
		// the box score adds up
		for (const t of result.team) {
			for (const s of ["pf", "fta", "ft", "pts"]) {
				const sum = t.player.reduce((a: number, p: any) => a + p.stat[s], 0);
				assert.strictEqual(sum, t.stat[s], s);
			}
		}
	}
	assert.isTrue(seen > 10, `flagrants seen: ${seen}`);
});

test("an ejected player sits for the rest of the game", async () => {
	TECHNICAL_FOUL_RATES.flagrantPerPossession = 0.01;
	TECHNICAL_FOUL_RATES.flagrant2 = 1;
	const games = await simGames(5, 4, { doPlayByPlay: true });
	let seen = 0;
	for (const { events, sim } of games) {
		for (const [i, e] of events.entries()) {
			if (e.type !== "ejection" || e.pid === undefined) {
				continue;
			}
			seen += 1;
			const pid = e.pid;
			assert.isTrue([...sim.ejected].some((p) => p.id === pid));
			let minAfter = 0;
			for (const f of events.slice(i + 1)) {
				if (f.type === "stat" && f.s === "min" && f.pid === pid) {
					minAfter += f.amt;
				}
				if (f.type === "sub") {
					assert.notInclude(f.pids, pid, "subbed back in");
				}
				if (f.type !== "stat" && f.type !== "sub" && f.type !== "ejection") {
					assert.notStrictEqual(f.pid, pid, `plays after ejection: ${f.type}`);
				}
			}
			assert.strictEqual(minAfter, 0, "minutes after ejection");
		}
	}
	assert.isTrue(seen >= 3, `ejections seen: ${seen}`);
});

test("with the setting on, box scores, the live text and the stored play-by-play agree", async () => {
	TECHNICAL_FOUL_RATES.techPerDeadBall = 0.02;
	TECHNICAL_FOUL_RATES.flagrantPerPossession = 0.005;
	TECHNICAL_FOUL_RATES.flagrant2 = 0.3;
	const games = await simGames(6, 6, { doPlayByPlay: true });
	const all: string[] = [];
	for (const [i, { result, events }] of games.entries()) {
		const gid = 6000 + i;
		for (const t of result.team) {
			assert.strictEqual(
				t.stat.pts,
				t.stat.ptsQtrs.reduce((a: number, b: number) => a + b, 0),
			);
			assert.strictEqual(t.stat.pts, 2 * t.stat.fg + t.stat.tp + t.stat.ft);
			for (const s of ["pf", "fta", "ft", "pts", "fga", "fg"]) {
				const sum = t.player.reduce((a: number, p: any) => a + p.stat[s], 0);
				assert.strictEqual(sum, t.stat[s], s);
			}
		}

		const live = playLive(events.slice(), makeLiveBoxScore(result, gid));
		const last = live.at(-1)!;
		assert.deepStrictEqual(last.score, [
			result.team[0].stat.pts,
			result.team[1].stat.pts,
		]);

		const stored = decodePlayByPlay(encodePlayByPlay(events));
		const box = makeLiveBoxScore(result, gid);
		const replay = playLive(
			[storedInitEvent(stored.players, box.teams), ...stored.events],
			box,
		);
		assert.deepStrictEqual(replay, live);
		all.push(...live.map((l) => l.text));
	}
	const text = all.join("\n");
	assert.match(text, /[Tt]echnical/);
	assert.match(text, /flagrant/);
	assert.match(text, /ejected|tossed/);
	assert.notMatch(text, /undefined|NaN/);
});
