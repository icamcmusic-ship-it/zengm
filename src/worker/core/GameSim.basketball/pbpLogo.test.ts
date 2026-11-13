import { afterEach, assert, test } from "vitest";
import GameSim, { TECHNICAL_FOUL_RATES } from "./index.ts";
import loadTeams from "../game/loadTeams.ts";
import { g } from "../../util/index.ts";
import { local } from "../../../ui/util/local.ts";
import processLiveGameEvents from "../../../ui/util/processLiveGameEvents.basketball.tsx";
import {
	genTeams,
	makeLiveBoxScore,
	nodeToText,
	withSeededRandom,
} from "./simLiveGameForTests.ts";

/*
 * The team logo next to a play-by-play line is the team of the line's subject: the player or team the text names first, the one doing
 * what the line says. "Smith is fouled by Jones" shows Smith's team, "Jones draws the charge on Smith" shows Jones's, "Tip-off: Smith
 * wins the tip" shows Smith's. Checked on every line of many games, with the flavor text on and off and with every kind of event the sim
 * can log (technicals, flagrants, ejections, the endgame timeouts, Elam endings, shootouts...).
 */

const RATES = { ...TECHNICAL_FOUL_RATES };
afterEach(() => {
	Object.assign(TECHNICAL_FOUL_RATES, RATES);
	local.setState({ featurePbpFlavor: true } as any);
});

// The test rosters reuse names (and a name can be on both teams); here every player gets his own, so a name says whose team it is
const FIRST =
	"Aaron Bennett Calvin Dorian Emmett Fletcher Grady Hollis Ignacio Jasper Keegan Lorenzo Mason Nolan Oscar Preston Quincy Rowan Silas Tobias Ulysses Vaughn Wesley Xavier Yusuf Zeke Abel Bruno Cyrus Dante".split(
		" ",
	);
const LAST =
	"Abernathy Blackwood Castellano Dunleavy Eastwood Fairbanks Galloway Holloway Ingram Jefferson Kowalski Lindqvist Montgomery Northcutt Okafor Pemberton Quarles Radcliffe Sorensen Thornton Underwood Vasquez Whitaker Xiong Yarborough Zimmerman Ashford Barlow Crenshaw Delacroix".split(
		" ",
	);
// How the lines name the teams (makeLiveBoxScore: Boston Celtics and Dallas Mavericks)
const TEAM_WORDS: [string, 0 | 1][] = [
	["Celtics", 0],
	["Boston", 0],
	["BOS", 0],
	["Mavericks", 1],
	["Dallas", 1],
	["DAL", 1],
];

type Scenario = {
	name: string;
	seeds: number;
	settings?: Record<string, unknown>;
	techRates?: Partial<typeof TECHNICAL_FOUL_RATES>;
};

const simGame = (seed: number, sc: Scenario) =>
	withSeededRandom(seed, async () => {
		await genTeams();
		for (const [key, value] of Object.entries(sc.settings ?? {})) {
			g.setWithoutSavingToDB(key as any, value as any);
		}
		Object.assign(TECHNICAL_FOUL_RATES, RATES, sc.techRates);
		const teams = await loadTeams([0, 1], {});
		const sim = new GameSim({
			gid: seed,
			teams: [teams[0]!, teams[1]!],
			baseInjuryRate: g.get("injuryRate"),
			doPlayByPlay: true,
			homeCourtFactor: 1,
			allStarGame: false,
			neutralSite: false,
		});
		const result = sim.run();
		return { result, events: result.playByPlay!.slice() as any[] };
	});

const escape = (s: string) =>
	s.replaceAll(/[$()*+.?[\\\]^{|}]/g, String.raw`\$&`);

type Checked = {
	lines: number;
	named: number;
	types: Set<string>;
	problems: string[];
	// "Smith is fouled by Jones" lines (the bug report's case)
	fouledBy: number;
};

const checkScenario = async (sc: Scenario, flavor: boolean) => {
	local.setState({ featurePbpFlavor: flavor } as any);
	const out: Checked = {
		lines: 0,
		named: 0,
		types: new Set(),
		problems: [],
		fouledBy: 0,
	};
	for (let seed = 1; seed <= sc.seeds; seed++) {
		const { result, events } = await simGame(seed, sc);

		// Unique names, in the results (the live box score) and in the init event (the flavor text)
		const names = new Map<number, string>();
		let k = 0;
		for (const t of result.team) {
			for (const p of t.player as any[]) {
				names.set(p.id, `${FIRST[k % 30]} ${LAST[k % 30]}`);
				p.name = names.get(p.id);
				k += 1;
			}
		}
		for (const e of events) {
			if (e.type === "init") {
				for (const t of e.boxScore) {
					for (const p of t.player) {
						p.name = names.get(p.id) ?? p.name;
					}
				}
			}
		}

		const box: any = makeLiveBoxScore(result, seed);
		const pairs: [string, 0 | 1][] = [...TEAM_WORDS];
		for (const [t, team] of box.teams.entries()) {
			for (const p of team.players) {
				pairs.push([p.name, t], [p.name.split(" ")[1], t]);
			}
		}
		const patterns = pairs.map(
			([w, t]) =>
				[
					new RegExp(
						String.raw`(?<![\p{L}\p{N}])${escape(w)}(?![\p{L}\p{N}])`,
						"u",
					),
					t,
					w.length,
				] as const,
		);

		let overtimes = 0;
		let quarters: string[] = [];
		const queue = events.slice();
		while (queue.length > 0) {
			const o = processLiveGameEvents({
				events: queue,
				boxScore: box,
				overtimes,
				quarters,
			});
			overtimes = o.overtimes;
			quarters = o.quarters;
			if (o.text === undefined || !o.event) {
				continue;
			}
			const ev: any = o.event;
			out.types.add(ev.type);
			out.lines += 1;
			// The main line (a second line is a quieter note under it)
			const text = nodeToText(o.text).split("\n")[0]!;

			let first: { at: number; len: number; t: 0 | 1 } | undefined;
			for (const [re, t, len] of patterns) {
				const m = re.exec(text);
				if (
					m &&
					(!first ||
						m.index < first.at ||
						(m.index === first.at && len > first.len))
				) {
					first = { at: m.index, len, t };
				}
			}

			const eventT = ev.t === 0 || ev.t === 1 ? ev.t : undefined;
			const where = `seed ${seed}, ${flavor ? "flavor" : "stock"} ${ev.type}: "${text}"`;
			if (eventT === undefined) {
				// (lines about the game, not a team: start of a period, the end, the Elam target, the shootout)
				if (o.t !== undefined) {
					out.problems.push(`logo on a line with no team (${o.t}), ${where}`);
				}
				continue;
			}
			if (/^(He|She|His|Her|They|Their)\b/.test(text) || !first) {
				// "He slams it home", "Out of bounds, last touched by the offense": the event's own team
				if (o.t !== eventT) {
					out.problems.push(`logo ${o.t}, event team ${eventT}, ${where}`);
				}
				continue;
			}
			out.named += 1;
			if (o.t !== first.t) {
				out.problems.push(
					`logo ${o.t}, but the line is about team ${first.t}, ${where}`,
				);
			}
			if (
				(ev.type === "pfFG" || ev.type === "pfTP") &&
				first.t !== eventT &&
				/\bby\b/.test(text)
			) {
				out.fouledBy += 1;
			}
		}
	}
	return out;
};

const ALL_ON = {
	technicalFouls: true,
	smartEndgame: true,
	matchupDefense: true,
	realisticTurnovers: true,
	simFixes: true,
	injuryRate: 0.01,
};

const SCENARIOS: Scenario[] = [
	{ name: "default", seeds: 30 },
	{
		name: "every setting on, many technicals and flagrants",
		seeds: 20,
		settings: ALL_ON,
		techRates: {
			techPerDeadBall: 0.05,
			flagrantPerPossession: 0.01,
			flagrant2: 0.3,
		},
	},
	{ name: "Elam ending", seeds: 10, settings: { ...ALL_ON, elam: true } },
	{
		name: "shootouts",
		seeds: 40,
		settings: { maxOvertimes: 0, shootoutRounds: 3 },
	},
];

for (const flavor of [true, false]) {
	test(`the logo next to every line is the team of its subject (${flavor ? "flavor text" : "stock text"})`, async () => {
		const types = new Set<string>();
		let named = 0;
		let fouledBy = 0;
		const problems: string[] = [];
		for (const sc of SCENARIOS) {
			const r = await checkScenario(sc, flavor);
			for (const type of r.types) {
				types.add(type);
			}
			named += r.named;
			fouledBy += r.fouledBy;
			problems.push(...r.problems.map((p) => `[${sc.name}] ${p}`));
		}
		assert.deepStrictEqual(
			problems.slice(0, 20),
			[],
			`${problems.length} lines with the wrong logo`,
		);
		assert.isAbove(named, 5000);
		if (flavor) {
			// The reported case: the fouled shooter leads the line, and it's his team's logo, not the fouler's
			assert.isAbove(fouledBy, 50);
		}
		// Every kind of line was seen
		for (const type of [
			"jumpBall",
			"fgAtRim",
			"fgAtRimAndOne",
			"fgLowPost",
			"fgMidRange",
			"tp",
			"missAtRim",
			"missLowPost",
			"missMidRange",
			"missTp",
			"blkAtRim",
			"blkLowPost",
			"blkMidRange",
			"blkTp",
			"orb",
			"drb",
			"stl",
			"tov",
			"ft",
			"missFt",
			"pfNonShooting",
			"pfBonus",
			"pfFG",
			"pfTP",
			"techFoul",
			"flagrantFoul",
			"ejection",
			"foulOut",
			"sub",
			"timeout",
			"injury",
			"outOfBounds",
			"endOfPeriod",
			"period",
			"overtime",
			"elamActive",
			"shootoutStart",
			"shootoutTeam",
			"shootoutShot",
			"gameOver",
		]) {
			assert.isTrue(types.has(type), `no ${type} line`);
		}
	}, 600_000);
}
