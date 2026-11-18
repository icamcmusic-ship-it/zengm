// @ts-nocheck (diagnostic script)
// A scan of the play-by-play text against the game it describes: many simulated games (several rule sets), every line rendered as the live
// view renders it, checked against a running game state kept from the events: broken text, running tallies, personal and team foul counts,
// free throw trips (one-and-ones too), scores, ties, leads, runs and streaks, lead changes, clock, period and shot clock words, buzzer and
// game-winner claims, career claims, who is on the floor, substitution reasons, and the stored play-by-play against the live text. Rule sets:
// default, technicals, college (halves, one-and-one, 30-second shot clock), short quarters, 3 periods, Elam, shootouts, traits and playoffs,
// no threes, the All-Star Game, careers, and overtime games (two overtime lengths). Run with
// PBP_SCAN=1 npx vitest --run --project basketball src/common/pbpFlavor/scan.script.test.ts
// (PBP_SCAN_OUT=<file> writes the full report; PBP_SCAN_GAMES scales the number of games; PBP_DEBUG=<scenario> PBP_DEBUG_SEED=<seed>
// PBP_DEBUG_OUT=<file> dumps every line of one game with its events). Findings marked "(sim)" are about the events, not the text; "player
// acting after he left the game" only shows with injuryRate 0.01, when a team runs out of healthy players
import { test } from "vitest";
import { appendFileSync, writeFileSync } from "node:fs";
import GameSim, {
	TECHNICAL_FOUL_RATES,
} from "../../worker/core/GameSim.basketball/index.ts";
import loadTeams from "../../worker/core/game/loadTeams.ts";
import { g } from "../../worker/util/index.ts";
import { local } from "../../ui/util/local.ts";
import processLiveGameEvents from "../../ui/util/processLiveGameEvents.basketball.tsx";
import { buildPlayByPlayEntries } from "../../ui/components/BoxScorePlayByPlay.basketball.tsx";
import {
	genTeams,
	makeLiveBoxScore,
	nodeToText,
	withSeededRandom,
} from "../../worker/core/GameSim.basketball/simLiveGameForTests.ts";
import { encodePlayByPlay } from "./store.ts";
import { makeCareer } from "./career.ts";

const RATES = { ...TECHNICAL_FOUL_RATES };

const FIRST =
	"Aaron Bennett Calvin Dorian Emmett Fletcher Grady Hollis Ignacio Jasper Keegan Lorenzo Mason Nolan Oscar Preston Quincy Rowan Silas Tobias Ulysses Vaughn Wesley Xavier Yusuf Zeke Abel Bruno Cyrus Dante".split(
		" ",
	);
// (some ending in s, a suffix, an apostrophe: the possessives)
const LAST =
	"Abernathy Blackwood Castellano Dunleavy Eastwood Fairbanks Galloway Holloway Ingram Jefferson Kowalski Lindqvist Montgomery Northcutt Okafor Pemberton Quarles Radcliffe Sorensen Thornton Underwood Vasquez Whitaker Xiong Yarborough Zimmerman Ashford Barlow Crenshaw Delacroix".split(
		" ",
	);
LAST[5] = "Hammonds";
LAST[16] = "O'Rourke";
LAST[22] = "Rivers";

const ALL_ON = {
	technicalFouls: true,
	smartEndgame: true,
	matchupDefense: true,
	realisticTurnovers: true,
	simFixes: true,
	injuryRate: 0.01,
};

const SCALE = Number(process.env.PBP_SCAN_GAMES ?? 1);
const SCENARIOS = [
	{ name: "default", seeds: 30 },
	{
		name: "all on, techs",
		seeds: 20,
		settings: ALL_ON,
		techRates: {
			techPerDeadBall: 0.05,
			flagrantPerPossession: 0.01,
			flagrant2: 0.3,
		},
	},
	{
		name: "all on, techs, normal injury rate",
		seeds: 40,
		settings: { ...ALL_ON, injuryRate: undefined },
		techRates: {
			techPerDeadBall: 0.05,
			flagrantPerPossession: 0.01,
			flagrant2: 0.3,
		},
	},
	{
		name: "college",
		seeds: 25,
		settings: {
			numPeriods: 2,
			quarterLength: 20,
			overtimeLength: 5,
			foulsNeededToFoulOut: 5,
			foulsUntilBonus: [10, 1, 10],
			oneAndOne: true,
			oneAndOneFouls: 7,
			customShotClock: true,
			shotClockLength: 30,
			realisticPossessions: true,
			smartEndgame: true,
		},
	},
	{
		name: "college, stock possessions",
		seeds: 10,
		settings: {
			numPeriods: 2,
			quarterLength: 20,
			foulsNeededToFoulOut: 5,
			foulsUntilBonus: [10, 1, 10],
			oneAndOne: true,
			oneAndOneFouls: 7,
		},
	},
	{ name: "5-minute quarters", seeds: 15, settings: { quarterLength: 5 } },
	{
		name: "3 periods of 15",
		seeds: 10,
		settings: { numPeriods: 3, quarterLength: 15 },
	},
	{ name: "elam", seeds: 10, settings: { ...ALL_ON, elam: true } },
	{
		name: "shootouts",
		seeds: 25,
		settings: { maxOvertimes: 0, shootoutRounds: 3 },
	},
	{
		name: "traits, playoffs, bitter rivalry",
		seeds: 20,
		settings: { ...ALL_ON, playerTraits: true, playerTraitsSeed: 5 },
		playoffs: true,
		rivalry: 2,
		hot: true,
	},
	{ name: "no threes", seeds: 5, settings: { threePointers: false } },
	{ name: "overtime hunt", seeds: 500, otOnly: true },
	{ name: "all-star", seeds: 10, allStar: true },
	{ name: "careers", seeds: 25, careers: true },
	{ name: "careers, playoffs", seeds: 10, careers: true, playoffs: true },
	{
		name: "overtime hunt, 3-minute overtimes",
		seeds: 300,
		otOnly: true,
		settings: { overtimeLength: 3 },
	},
	{
		name: "overtime hunt, college",
		seeds: 300,
		otOnly: true,
		settings: {
			numPeriods: 2,
			quarterLength: 20,
			overtimeLength: 5,
			foulsNeededToFoulOut: 5,
			foulsUntilBonus: [10, 1, 10],
			oneAndOne: true,
			oneAndOneFouls: 7,
			customShotClock: true,
			shotClockLength: 30,
			realisticPossessions: true,
			smartEndgame: true,
		},
	},
];

const escape = (s: string) =>
	s.replaceAll(/[$()*+.?[\\\]^{|}]/g, String.raw`\$&`);

const simGame = (seed: number, sc: any) =>
	withSeededRandom(seed, async () => {
		await genTeams();
		for (const [key, value] of Object.entries(sc.settings ?? {})) {
			if (value === undefined) {
				continue;
			}
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
		return {
			result,
			events: result.playByPlay!.slice() as any[],
			numPeriods: g.get("numPeriods"),
			quarterLength: g.get("quarterLength"),
			foulsUntilBonus: g.get("foulsUntilBonus"),
			oneAndOne: g.get("oneAndOne") ? g.get("oneAndOneFouls") : undefined,
			foulOut: g.get("foulsNeededToFoulOut"),
		};
	});

type Finding = { kind: string; where: string; text: string; detail: string };

const MADE_TYPES = new Set([
	"fgAtRim",
	"fgAtRimAndOne",
	"fgLowPost",
	"fgLowPostAndOne",
	"fgMidRange",
	"fgMidRangeAndOne",
	"tp",
	"tpAndOne",
	"fgPutBack",
	"fgPutBackAndOne",
	"fgTipIn",
	"fgTipInAndOne",
]);
const MISS_TYPES = new Set([
	"missAtRim",
	"missLowPost",
	"missMidRange",
	"missTp",
	"missPutBack",
	"missTipIn",
	"blkAtRim",
	"blkLowPost",
	"blkMidRange",
	"blkTp",
	"blkPutBack",
	"blkTipIn",
]);
const STATS = [
	"pts",
	"ast",
	"orb",
	"drb",
	"stl",
	"blk",
	"tov",
	"pf",
	"fg",
	"fga",
	"tp",
	"tpa",
	"ft",
	"fta",
];
const LABEL_STAT = {
	PTS: (s) => s.pts,
	AST: (s) => s.ast,
	REB: (s) => s.orb + s.drb,
	STL: (s) => s.stl,
	BLK: (s) => s.blk,
	TOV: (s) => s.tov,
};

const findings: Finding[] = [];
const counts = new Map<string, number>();
const add = (kind: string, where: string, text: string, detail = "") => {
	counts.set(kind, (counts.get(kind) ?? 0) + 1);
	findings.push({ kind, where, text, detail });
};
const shapes = new Map<string, number>();
let totalLines = 0;
let totalGames = 0;
const gamesBy = new Map<string, number>();
let otGames = 0;

const scanGame = async (seed: number, sc: any) => {
	const sim = await simGame(seed, sc);
	if (sc.otOnly && !(sim.result.overtimes > 0)) {
		return;
	}
	const { result, events, numPeriods, quarterLength } = sim;
	// Unique names
	const names = new Map<number, string>();
	const careers = new Map<number, number[]>();
	let k = 0;
	const tOf = new Map<number, 0 | 1>();
	for (const [ti, t] of result.team.entries()) {
		for (const p of t.player as any[]) {
			names.set(p.id, `${FIRST[k % 30]} ${LAST[(k * 7) % 30]}`);
			p.name = names.get(p.id);
			tOf.set(p.id, ti);
			k += 1;
		}
	}
	for (const e of events) {
		if (e.type === "init") {
			if (sc.rivalry) {
				e.boxScore[0].pbpRivalry = sc.rivalry;
			}
			for (const team of e.boxScore) {
				for (const [i, p] of team.player.entries()) {
					p.name = names.get(p.id) ?? p.name;
					if (sc.careers) {
						const v = (i * 7 + seed) % 11;
						p.pbpCareer = makeCareer({
							gp: v === 0 ? 0 : 30 + v * 20,
							gpSeason: 12 + v,
							td: v % 3 === 0 ? 0 : 2,
							age: 22 + v,
							rookie: v === 0,
							high:
								v === 0
									? { pts: 0, trb: 0, ast: 0, tp: 0, blk: 0, stl: 0 }
									: {
											pts: 8 + v * 2,
											trb: 5 + v,
											ast: 3 + v,
											tp: 1 + (v % 4),
											blk: 1 + (v % 3),
											stl: 1 + (v % 3),
										},
							seasonHigh: {
								pts: 6 + v * 2,
								trb: 4 + v,
								ast: 2 + v,
								tp: 1 + (v % 3),
								blk: 1,
								stl: 1,
							},
							total: {
								pts: 1000 * v - 5 - v,
								trb: 1000 - 3 - v,
								ast: 1000 - 2 - v,
								tp: 500 - 2 - v,
							},
						});
						careers.set(p.id, p.pbpCareer);
					}
					if (sc.hot) {
						p.pbpRatings = {
							...p.pbpRatings,
							temper: i % 3 === 0 ? 10 : (p.pbpRatings?.temper ?? 50),
						};
					}
				}
			}
		}
	}
	const pidByName = new Map<string, number>();
	for (const [pid, n] of names) {
		pidByName.set(n, pid);
	}
	const lastNameOf = (n: string) => n.split(" ").at(-1)!;

	const box: any = makeLiveBoxScore(result, seed);
	box.numPeriods = numPeriods;
	box.quarterLength = quarterLength;
	if (sc.settings?.customShotClock) {
		box.shotClockLength = sc.settings.shotClockLength;
	}
	if (sc.playoffs) {
		box.playoffs = true;
	}
	if (sc.allStar) {
		box.teams[0].tid = -1;
		box.teams[1].tid = -2;
		box.teams[0].region = "Team";
		box.teams[0].name = "Celtics";
		box.teams[1].region = "Team";
		box.teams[1].name = "Mavericks";
	}
	const eventsCopy = structuredClone(events);

	// ---- running state ----
	const score: [number, number] = [0, 0];
	const st = new Map<number, Record<string, number>>();
	const S = (pid: number) => {
		let s = st.get(pid);
		if (!s) {
			s = Object.fromEntries(STATS.map((x) => [x, 0]));
			st.set(pid, s);
		}
		return s;
	};
	const onCourt: [Set<number>, Set<number>] = [new Set(), new Set()];
	const fouledOut = new Set<number>();
	const ejected = new Set<number>();
	const injured = new Set<number>();
	let period = 1;
	let clock = quarterLength * 60;
	let teamFouls: [number, number] = [0, 0];
	// each scoring: [team, amt, pid]
	const hist: [0 | 1, number, number | undefined][] = [];
	let lastPlay: any; // last non-stat event
	let lastPossStart: string | undefined; // what began the current possession: steal, drb, orb, make, dead
	let trip: { n: number; i: number; m: number; pid: number } | undefined;
	let elam = false;
	let pendingShooter: number | undefined;
	let pendingPoss: number | undefined;
	const wasBenched = new Set<number>();
	const claims: any[] = [];
	let shootout = false;
	const recent: string[] = [];
	const recentNotes: string[] = [];
	const madeStreak = new Map<number, number>();
	const qPts = new Map<number, number>();
	const lastScoreTime: [number | undefined, number | undefined] = [
		undefined,
		undefined,
	];
	const periodLen = (p: number) =>
		p <= numPeriods ? quarterLength * 60 : (g.get("overtimeLength") ?? 5) * 60;
	const absTime = () => {
		let base = 0;
		for (let p = 1; p < period; p++) {
			base += periodLen(p);
		}
		return base + (periodLen(period) - clock);
	};

	const suffixHas = (
		h: typeof hist,
		team: 0 | 1 | undefined,
		Sx: number,
		Ox: number,
	) => {
		let a = [0, 0];
		for (let i = h.length - 1; i >= 0; i--) {
			a[h[i][0]] += h[i][1];
			for (const tt of team === undefined ? [0, 1] : [team]) {
				if (a[tt] === Sx && a[1 - tt] === Ox) {
					return true;
				}
			}
			if (a[0] + a[1] > Sx + Ox) {
				break;
			}
		}
		return false;
	};

	const teamOfText = (s: string): 0 | 1 | undefined =>
		/Celtics/.test(s) ? 0 : /Mavericks/.test(s) ? 1 : undefined;

	let overtimes = 0;
	let quarters: string[] = [];
	const queue = events.slice();
	let pos = 0;
	const liveLines: string[] = [];
	while (queue.length > 0) {
		const before = queue.length;
		const prevScore = [score[0], score[1]];
		const o = processLiveGameEvents({
			events: queue,
			boxScore: box,
			overtimes,
			quarters,
		});
		overtimes = o.overtimes;
		quarters = o.quarters;
		const consumed = events.slice(pos, pos + before - queue.length);
		pos += before - queue.length;
		// state before the text event's own changes (who is on the floor)
		const onCourtBefore = [new Set(onCourt[0]), new Set(onCourt[1])];
		const tripBefore = trip ? { ...trip } : undefined;
		const teamFoulsBefore = [teamFouls[0], teamFouls[1]];
		let ev: any;
		let batchStart: number | undefined = hist.length;
		for (const e of consumed) {
			if (e.type !== "stat") {
				batchStart = hist.length;
			}
			if (e.type === "stat") {
				if (e.s === "pts") {
					score[e.t] += e.amt;
					// (a three is logged as 2 points and then 1: one basket)
					const lastH = hist.at(-1);
					if (
						lastH &&
						batchStart !== undefined &&
						hist.length > batchStart &&
						lastH[0] === e.t &&
						lastH[2] === e.pid
					) {
						lastH[1] += e.amt;
					} else {
						hist.push([e.t, e.amt, e.pid]);
					}
					qPts.set(e.pid, (qPts.get(e.pid) ?? 0) + e.amt);
				}
				if (e.s === "gs") {
					onCourt[e.t].add(e.pid);
				}
				if (e.pid !== undefined && STATS.includes(e.s)) {
					S(e.pid)[e.s] += e.amt;
				}
				continue;
			}
			ev = e;
			if (e.clock !== undefined && Number.isFinite(e.clock)) {
				clock = e.clock;
			}
			if (e.type === "period" || e.type === "overtime") {
				period = e.period;
				teamFouls = [0, 0];
				qPts.clear();
			}
			if (e.type === "elamActive") {
				elam = true;
			}
			if (e.type === "shootoutStart") {
				shootout = true;
			}
			if (e.type.startsWith("fga")) {
				pendingShooter = e.pid;
				pendingPoss = e.poss;
			}
		}
		if (!ev || o.text === undefined) {
			// (the stats after the last line)
			continue;
		}
		totalLines += 1;
		const full = nodeToText(o.text);
		const [text, ...rest] = full.split("\n");
		const note = rest.join(" ");
		liveLines.push(full);
		if (sc.allStar) {
			for (const s0 of [text, note]) {
				if (
					/\b(the|The) Team\b|\bTeam (Celtics|Mavericks)'s?\b(?! (ball|keep|bench|lead|are|have|take|call|use|stop|go|get|pick|start|inbound|send|swap|make|shuffle|rotate|change|led|were|finally|snap|run|dribble|hold|let|think|can't|never|win|score|up|down|by))/.test(
						s0,
					)
				) {
					add("all-star team naming", `${sc.name} seed ${seed}`, s0);
				}
			}
		}
		const where = `${sc.name} seed ${seed} #${liveLines.length} ${ev.type} P${period} ${clock}s ${score[0]}-${score[1]}`;
		const both = [text, note].filter(Boolean);
		const type = ev.type;
		const t: 0 | 1 | undefined = ev.t === 0 || ev.t === 1 ? ev.t : undefined;

		// ---- broken text ----
		const rules: [string, RegExp][] = [
			["undefined/NaN", /undefined|NaN|\[object|\bnull\b|\?\?\?/],
			["doubled word", /\b(['a-z]{2,}) \1\b/i],
			[
				"doubled punctuation",
				/[,:;]{2}|\.\.(?!\.)|, ,|\. \.|[.!?][,;:]|[,;:][.!?]/,
			],
			["space before punctuation", /\s[!,.:;?](\s|$)/],
			["double space", / {2}/],
			["s's possessive", /\b[A-Za-z]+s's\b/],
			["a before a vowel", /\b[Aa] (?!one|Euro|uni|US|U\.|use)[AEIOUaeiou]/],
			[
				"an before a consonant",
				/\b[Aa]n (?!hour|honest|8|11|18|[AEIOUaeiou])[A-Za-z0-9]/,
			],
			["a before 8/11/18", /\ba (8|11|18|8\d)\b/],
			["lowercase start", /^[a-z]/],
			["lowercase after period", /[a-z]{2}\. [a-z]/],
			["empty parentheses", /\(\s*\)/],
			["tally on nothing", /\(0 (PTS|AST|REB|STL|BLK)\)/],
			["unbalanced parentheses", /^[^()]*\)|\([^)]*$/],
			["comma before end", /,\s*$/],
		];
		for (const s of both) {
			for (const [name, re] of rules) {
				if (re.test(s)) {
					add(name, where, s);
				}
			}
			if (!/[.!?)"]$/.test(s) && !o.textOnly) {
				add("no end mark", where, s);
			}
			// possessives of the names, against the poss helper
			for (const n of names.values()) {
				if (/s$/.test(n) && s.includes(`${n}'s`)) {
					add("possessive s's", where, s);
				}
				if (!/s$/.test(n) && new RegExp(`${escape(n)}'(?!s)`).test(s)) {
					add("possessive missing s", where, s);
				}
			}
		}

		// shapes (variety)
		const key = text
			.replaceAll(/\([^)]*\)/g, "")
			.replaceAll(/[A-Z][\w'.-]*( [A-Z][\w'.-]*)*/g, "N")
			.replaceAll(/\d+(\.\d+)?/g, "#");
		shapes.set(key, (shapes.get(key) ?? 0) + 1);
		if (!o.textOnly && recent.includes(text)) {
			add("identical line within 4", where, text);
		}
		recent.push(text);
		if (recent.length > 4) {
			recent.shift();
		}
		if (note) {
			for (const sentence of note.split(/(?<=[.!?]) /)) {
				if (recentNotes.includes(sentence)) {
					add("identical note sentence within 8 lines", where, sentence);
				}
			}
			recentNotes.push(...note.split(/(?<=[.!?]) /));
			while (recentNotes.length > 8) {
				recentNotes.shift();
			}
		}

		// ---- running tallies ----
		for (const s of both) {
			for (const [n, pid] of pidByName) {
				const re = new RegExp(
					`${escape(n)}(?:'s? [A-Za-z-]+|')? \\((\\d+) (PTS|AST|REB|STL|BLK|TOV)\\)`,
					"g",
				);
				for (const m of s.matchAll(re)) {
					const want = LABEL_STAT[m[2]](S(pid));
					if (Number(m[1]) !== want) {
						add(
							"tally mismatch",
							where,
							s,
							`${n} ${m[1]} ${m[2]}, box ${want}`,
						);
					}
				}
			}
		}

		// ---- career claims ----
		if (careers.size > 0 && note) {
			const CS = ["pts", "trb", "ast", "tp", "blk", "stl"];
			const W = {
				point: "pts",
				points: "pts",
				rebound: "trb",
				rebounds: "trb",
				assist: "ast",
				assists: "ast",
				three: "tp",
				threes: "tp",
				block: "blk",
				blocks: "blk",
				steal: "stl",
				steals: "stl",
			};
			const now = (pid, k) => {
				const x = S(pid);
				return k === "trb" ? x.orb + x.drb : x[k];
			};
			for (const sentence of note.split(/(?<=[.!?]) /))
				for (const [n, pid] of pidByName) {
					if (!sentence.includes(n)) {
						continue;
					}
					const note = sentence;
					const c = careers.get(pid);
					if (!c) {
						continue;
					}
					// layout: see makeCareer (flags, gp, gpSeason, td, age, high x6, seasonHigh x6, total x4)
					const idx = (k) => CS.indexOf(k);
					const high = (k) => c[5 + idx(k)];
					const sHigh = (k) => c[11 + idx(k)];
					for (const m of note.matchAll(
						/(?:new career high|career night|never had more|new personal best)[^.]*?(\d+) (points?|rebounds?|assists?|threes?|blocks?|steals?)|(\d+) (points?|rebounds?|assists?|threes?|blocks?|steals?) for [^,.]+, and that's a new career high|(?:new career high (?:for [^:]+: |with )(\d+) (\w+))/g,
					)) {
						const v = Number(m[1] ?? m[3] ?? m[5]);
						const k = W[m[2] ?? m[4] ?? m[6]];
						if (k && (v <= high(k) || now(pid, k) !== v)) {
							add(
								"career high claim",
								where,
								note,
								`${n} ${k} now ${now(pid, k)}, high ${high(k)}`,
							);
						}
					}
					const tm =
						/(?:ties [^.]*career high|matches his career high|equaling his career best|level with his career high)[^.]*?(\d+) (\w+)|(\d+) (\w+) for [^,]+, equaling his career best/.exec(
							note,
						);
					if (tm) {
						const v = Number(tm[1] ?? tm[3]);
						const k = W[tm[2] ?? tm[4]];
						if (k && (v !== high(k) || now(pid, k) !== v)) {
							add(
								"career tie claim",
								where,
								note,
								`${n} ${k} now ${now(pid, k)}, high ${high(k)}`,
							);
						}
					}
					const am =
						/(\d+) away from his career high of (\d+)|needs (\d+) more to match his career high of (\d+)|career high is (\d+), and he's (\d+) short|(\d+) more and [^.]* ties his career best of (\d+)/.exec(
							note,
						);
					if (am) {
						const d = Number(am[1] ?? am[3] ?? am[6] ?? am[7]);
						const h = Number(am[2] ?? am[4] ?? am[5] ?? am[8]);
						if (h !== high("pts") || now(pid, "pts") !== h - d) {
							add(
								"career away claim",
								where,
								note,
								`${n} pts ${now(pid, "pts")}, high ${high("pts")}`,
							);
						}
					}
					const sm =
						/season high[^.]*?(\d+) (\w+)|(\d+) (\w+) for [^,]+, (?:his most in a game this season|equaling his best of the season)|hasn't had this many all season: (\d+) (\w+)|(\d+) (\w+) for [^,]+, his best of the season/.exec(
							note,
						);
					if (sm) {
						const v = Number(sm[1] ?? sm[3] ?? sm[5] ?? sm[7]);
						const k = W[sm[2] ?? sm[4] ?? sm[6] ?? sm[8]];
						if (k && (v < sHigh(k) || now(pid, k) !== v)) {
							add(
								"season high claim",
								where,
								note,
								`${n} ${k} now ${now(pid, k)}, season high ${sHigh(k)}`,
							);
						}
					}
					const mm =
						/(\d{1,3}(?:,\d{3})*) (?:career (points|rebounds|assists|threes)|(points|rebounds|assists|threes) for his career)|([\d,]+)-point club/.exec(
							note,
						);
					if (mm) {
						const v = Number((mm[1] ?? mm[4]).replaceAll(",", ""));
						const k = W[mm[2] ?? mm[3] ?? "points"];
						const total = c[17 + ["pts", "trb", "ast", "tp"].indexOf(k)];
						if (total + now(pid, k) < v || total + (now(pid, k) - 3) >= v) {
							add(
								"career total claim",
								where,
								note,
								`${n} ${k} total ${total} + ${now(pid, k)}`,
							);
						}
						if (sc.playoffs) {
							add("career total claim in the playoffs", where, note);
						}
					}
					if (
						/first points of|first career points/.test(note) &&
						!(c[1] === 0 || c[5] === 0)
					) {
						add("first points claim", where, note);
					}
					if (
						/first career triple-double|first triple-double of|never had a triple-double/.test(
							note,
						) &&
						c[3] !== 0
					) {
						add("first triple-double claim", where, note);
					}
				}
		}

		// ---- foul tags ----
		const ft = /\(P(\d+), team foul (\d+)\)/.exec(text);
		if (ft) {
			let fouler: number | undefined;
			let pfAdd = 0;
			let defT: 0 | 1 | undefined;
			if (MADE_TYPES.has(type)) {
				fouler = ev.pidFoul;
				pfAdd = 1;
				defT = t === 0 ? 1 : 0;
			} else {
				fouler = ev.pid;
				defT = t;
			}
			if (fouler !== undefined) {
				if (Number(ft[1]) !== S(fouler).pf + pfAdd) {
					add(
						"personal foul count",
						where,
						text,
						`box pf ${S(fouler).pf + pfAdd}`,
					);
				}
			}
			if (MADE_TYPES.has(type) && ev.pidFoul !== undefined) {
				teamFouls[defT] += 1;
			}
			if (
				["pfNonShooting", "pfBonus", "pfFG", "pfTP", "flagrantFoul"].includes(
					type,
				)
			) {
				teamFouls[defT] += 1;
			}
			if (Number(ft[2]) !== teamFouls[defT]) {
				add("team foul count", where, text, `sim count ${teamFouls[defT]}`);
			}
		} else {
			if (MADE_TYPES.has(type) && ev.pidFoul !== undefined) {
				teamFouls[t === 0 ? 1 : 0] += 1;
			}
			if (
				["pfNonShooting", "pfBonus", "pfFG", "pfTP", "flagrantFoul"].includes(
					type,
				)
			) {
				teamFouls[t] += 1;
				add("foul line without tag", where, text);
			}
		}
		if (type === "pfNonShooting" && /bonus|penalty|over the limit/.test(text)) {
			add("bonus stated on a non-bonus foul", where, text);
		}
		if (type === "pfBonus") {
			// a one-and-one: before the two-shot bonus
			const ub = sim.foulsUntilBonus;
			const fullBonus =
				teamFouls[t] >= ub[period > numPeriods ? 1 : 0] ||
				(clock <= 120 && false);
			let nft = 0;
			for (let j = pos; j < events.length; j++) {
				const f = events[j];
				if (
					f.type === "stat" ||
					f.type === "sub" ||
					f.type === "timeouts" ||
					f.type === "foulOut"
				) {
					continue;
				}
				if (
					(f.type === "ft" || f.type === "missFt") &&
					f.pid === ev.pidShooting &&
					!f.tech
				) {
					nft += 1;
					continue;
				}
				break;
			}
			if (nft < 2 && !elam) {
				if (/\btwo\b/.test(text)) {
					add(
						"one-and-one worded as two shots",
						where,
						text,
						`team fouls ${teamFouls[t]}`,
					);
				}
			}
			void fullBonus;
		}

		// ---- free throw trips ----
		if (["pfFG", "pfTP", "pfBonus", "flagrantFoul"].includes(type)) {
			trip = {
				n: type === "pfTP" ? 3 : 2,
				i: 0,
				m: 0,
				pid: ev.pidShooting,
				oneAndOne:
					type === "pfBonus" &&
					sim.oneAndOne !== undefined &&
					period <= numPeriods &&
					teamFoulsBefore[t] + 1 < sim.foulsUntilBonus[0],
			};
		} else if (MADE_TYPES.has(type) && ev.pidFoul !== undefined) {
			trip = { n: 1, i: 0, m: 0, pid: ev.pid };
		} else if ((type === "ft" || type === "missFt") && !ev.tech) {
			if (!trip || trip.pid !== ev.pid) {
				add("free throw outside a trip", where, text);
			} else {
				trip.i += 1;
				if (type === "ft") {
					trip.m += 1;
				}
				const ordm = /\b(?:the|on the) (first|second|third)\b/.exec(text);
				const ordIdx = { first: 1, second: 2, third: 3 };
				if (
					ordm &&
					ordIdx[ordm[1]] !== trip.i &&
					!/second (as well|too)|the second for|the second;|the second,|the second free throw;/.test(
						"",
					)
				) {
					add("free throw ordinal", where, text, `shot ${trip.i} of ${trip.n}`);
				}
				const ofm = /\b(\d) (?:of|for) (\d)\b/.exec(text);
				if (ofm && (Number(ofm[1]) !== trip.m || Number(ofm[2]) !== trip.n)) {
					add(
						"free throw tally",
						where,
						text,
						`${trip.m} of ${trip.n}, shot ${trip.i}`,
					);
				}
				if (
					/\bboth\b|perfect trip|two for two|2 for 2|all 3/.test(text) &&
					!/misses both|either|leaves both|empty|misses all/.test(text) &&
					trip.m !== trip.n
				) {
					add("free throw 'both'", where, text, `${trip.m} of ${trip.n}`);
				}
				if (/second|both|pair/.test(text) && trip.oneAndOne && trip.i === 1) {
					// fine
				}
				if (trip.oneAndOne && /(first|second) free throw/.test(text) && false) {
					//
				}
				if (
					type === "missFt" &&
					trip.oneAndOne &&
					trip.i === 1 &&
					/first/.test(text)
				) {
					add(
						"one-and-one front end missed, worded as the first of a trip",
						where,
						text,
					);
				}
			}
		}
		if (type === "ft" || type === "missFt") {
			if (ev.tech && !/technical/.test(text)) {
				add("technical free throw not said", where, text);
			}
		}

		// ---- scores, leads, runs ----
		const marg = (tt: 0 | 1) => score[tt] - score[1 - tt];
		for (const s of both) {
			let m = /ties it at (\d+)/.exec(s);
			if (m && !(score[0] === score[1] && Number(m[1]) === score[0])) {
				add("tie claim", where, s);
			}
			m = /(Celtics|Mavericks) take the lead/.exec(s);
			if (m) {
				const tt = m[1] === "Celtics" ? 0 : 1;
				if (!(marg(tt) > 0 && prevScore[tt] === prevScore[1 - tt])) {
					add("take the lead claim", where, s, `prev ${prevScore}`);
				}
			}
			m = /go back in front, (\d+)-(\d+)/.exec(s);
			if (
				m &&
				!(
					Math.max(...score) === Number(m[1]) &&
					Math.min(...score) === Number(m[2])
				)
			) {
				add("back in front score", where, s);
			}
			for (const mm of s.matchAll(/\b(\d+)-(\d+) (?:run|spurt|burst)\b/g)) {
				const Sx = Number(mm[1]);
				const Ox = Number(mm[2]);
				const ended = /\bends\b|stopping|stop the bleeding|\bafter\b/.test(s);
				const h = ended && MADE_TYPES.has(type) ? hist.slice(0, -1) : hist;
				let ok = suffixHas(h, undefined, Sx, Ox);
				if (!ok && ended) {
					// (a free throw line: the last point too)
					ok =
						suffixHas(hist.slice(0, -1), undefined, Sx, Ox) ||
						suffixHas(hist.slice(0, -2), undefined, Sx, Ox);
				}
				if (!ok) {
					add("run numbers", where, s);
				}
			}
			m = /have (\d+) of the last (\d+) points/.exec(s);
			if (
				m &&
				!suffixHas(hist, undefined, Number(m[1]), Number(m[2]) - Number(m[1]))
			) {
				add("run numbers", where, s);
			}
			m = /(?:scored (\d+) straight\.|(\d+) unanswered)/.exec(s);
			if (m && !suffixHas(hist, undefined, Number(m[1] ?? m[2]), 0)) {
				add("run numbers", where, s);
			}
			// a player's streak of the game's points
			m =
				/(?:(?:has scored|show:) (\d+) straight|(\d+) straight points for|(\d+) in a row for)/.exec(
					s,
				);
			if (m) {
				const n = Number(m[1] ?? m[2] ?? m[3]);
				let sum = 0;
				let ok = false;
				let pidOf: number | undefined;
				for (let i = hist.length - 1; i >= 0; i--) {
					if (pidOf === undefined) {
						pidOf = hist[i][2];
					}
					if (hist[i][2] !== pidOf) {
						break;
					}
					sum += hist[i][1];
					if (sum === n) {
						ok = true;
					}
				}
				const named = [...pidByName].find(([nm]) => s.includes(nm));
				if (!ok || (named && named[1] !== pidOf)) {
					add(
						"player streak numbers",
						where,
						s,
						`last scorer ${names.get(pidOf)}, his streak ${sum}`,
					);
				}
			}
			{
				// lead changes and ties, from the scoring so far
				let lc = 0;
				let ties = 0;
				let last: number | undefined;
				let leader: number | undefined;
				const sc2 = [0, 0];
				for (const [tt, amt] of hist) {
					sc2[tt] += amt;
					if (sc2[0] !== sc2[1]) {
						const l = sc2[0] > sc2[1] ? 0 : 1;
						if (last !== undefined && last !== l) {
							lc += 1;
						}
						last = l;
						leader = l;
					} else if (leader !== undefined) {
						ties += 1;
						leader = undefined;
					}
				}
				const mm =
					/(\d+) lead changes and (\d+|no) ties?|lead has changed hands (\d+) times|(\d+)(?:st|nd|rd|th) lead change|Lead change number (\d+)|(\d+) lead changes and counting/.exec(
						s,
					);
				if (mm) {
					const n = Number(mm[1] ?? mm[3] ?? mm[4] ?? mm[5] ?? mm[6]);
					if (n !== lc) {
						add("lead change count", where, s, `real ${lc}`);
					}
					if (
						mm[2] !== undefined &&
						(mm[2] === "no" ? 0 : Number(mm[2])) !== ties
					) {
						add("tie count", where, s, `real ${ties}`);
					}
				}
				const mt =
					/(\d+)(?:st|nd|rd|th) tie of the game|Tied for the (\d+)(?:st|nd|rd|th) time/.exec(
						s,
					);
				if (mt && Number(mt[1] ?? mt[2]) !== ties) {
					add("tie count", where, s, `real ${ties}`);
				}
				if (/\b1 ties\b|\b0 ties\b|\b1 lead changes\b/.test(s)) {
					add("plural with 1", where, s);
				}
			}
			m = /lead by (\d+)\./.exec(s);
			if (m && Math.abs(score[0] - score[1]) !== Number(m[1])) {
				add("lead by claim", where, s);
			}
			m = /two-possession game now, (\d+)-(\d+)/.exec(s);
			if (
				m &&
				!(
					Math.max(...score) === Number(m[1]) &&
					Math.min(...score) === Number(m[2])
				)
			) {
				add("score claim", where, s);
			}
			m = /an? (\d+)-point game/.exec(s);
			if (m && Math.abs(score[0] - score[1]) !== Number(m[1])) {
				add("n-point game claim", where, s);
			}
			m =
				/(?:All tied at (\d+)|(Celtics|Mavericks) lead (\d+)-(\d+)|we're tied at (\d+)|it's (Celtics|Mavericks) by (\d+))/.exec(
					s,
				);
			if (
				m &&
				(type === "period" || type === "overtime" || type === "gameOver")
			) {
				const tie = m[1] ?? m[5];
				if (tie !== undefined) {
					if (!(score[0] === score[1] && score[0] === Number(tie))) {
						add("period score", where, s);
					}
				} else if (m[2]) {
					const tt = m[2] === "Celtics" ? 0 : 1;
					if (!(score[tt] === Number(m[3]) && score[1 - tt] === Number(m[4]))) {
						add("period score", where, s);
					}
				} else if (m[6]) {
					const tt = m[6] === "Celtics" ? 0 : 1;
					if (marg(tt) !== Number(m[7])) {
						add("period score", where, s);
					}
				}
			}
			m = /Final: (Celtics|Mavericks) (\d+), (Celtics|Mavericks) (\d+)/.exec(s);
			if (m) {
				const a = m[1] === "Celtics" ? 0 : 1;
				if (score[a] !== Number(m[2]) || score[1 - a] !== Number(m[4])) {
					add("final score", where, s);
				}
			}
			m =
				/(?:leads all scorers with|game-high|led all scorers with|best player on the floor:) (\d+)/.exec(
					s,
				);
			if (m) {
				const named = [...pidByName].find(([nm]) => s.includes(nm));
				const max = Math.max(...[...st.values()].map((x) => x.pts));
				if (
					!named ||
					S(named[1]).pts !== Number(m[1]) ||
					max !== Number(m[1])
				) {
					add("top scorer claim", where, s, `max ${max}`);
				}
			}
			m = /(?:That's|reaches|point number) (30|40|50|60)\b/.exec(s);
			if (m) {
				const named = [...pidByName].find(
					([nm]) => s.includes(nm) || s.includes(lastNameOf(nm)),
				);
				if (named && S(named[1]).pts < Number(m[1])) {
					add("points milestone", where, s);
				}
			}
			if (/double-double/i.test(s) && !/triple/.test(s)) {
				const named = [...pidByName].find(([nm]) => s.includes(nm));
				if (named) {
					const x = S(named[1]);
					const tens = [x.pts, x.orb + x.drb, x.ast, x.stl, x.blk].filter(
						(v) => v >= 10,
					).length;
					if (tens < 2) {
						add("double-double claim", where, s);
					}
				}
			}
			m =
				/That's (\d+) in the (quarter|half|period) for|has (\d+) in the (quarter|half|period) already|this (quarter|half|period): (\d+) points/.exec(
					s,
				);
			if (m) {
				const which = m[2] ?? m[4] ?? m[5];
				const want =
					period > numPeriods
						? "period"
						: numPeriods === 2
							? "half"
							: numPeriods === 4
								? "quarter"
								: "period";
				if (which !== want) {
					add("period word", where, s, `want ${want}`);
				}
				const named = [...pidByName].find(([nm]) => s.includes(nm));
				const n = Number(m[1] ?? m[3] ?? m[6]);
				if (named && (qPts.get(named[1]) ?? 0) < n) {
					add("points in the period", where, s, `${qPts.get(named[1])}`);
				}
			}
			m =
				/ends? an? (\d+):(\d\d) (?:scoring )?drought|ending an? (\d+):(\d\d) drought|snap an? (\d+):(\d\d) scoring drought/.exec(
					s,
				);
			if (m && t !== undefined) {
				const d =
					Number(m[1] ?? m[3] ?? m[5]) * 60 + Number(m[2] ?? m[4] ?? m[6]);
				// the team that scored: the line's team
				const tt = MADE_TYPES.has(type) || type === "ft" ? t : undefined;
				if (tt !== undefined && lastScoreTime[tt] !== undefined) {
					const real = absTime() - lastScoreTime[tt];
					if (Math.abs(real - d) > 2) {
						add("drought length", where, s, `real ${real.toFixed(1)}s`);
					}
				}
			}
			m = /, down (\d+) with/.exec(s);
			if (m && t !== undefined && marg(t) !== -Number(m[1])) {
				add("timeout down claim", where, s, `margin ${marg(t)}`);
			}
			m =
				/led by (\d+)\. It's down to (\d+)|led by (\d+); it's tied now|led by (\d+) and now trail by (\d+)|lead has become (\d+)/.exec(
					s,
				);
			if (m && t !== undefined) {
				const now =
					m[2] ??
					(m[3] !== undefined
						? "0"
						: m[5] !== undefined
							? String(-Number(m[5]))
							: m[6]);
				if (marg(t) !== Number(now)) {
					add("slipping lead claim", where, s, `margin ${marg(t)}`);
				}
			}
			// clock claims
			m = /with ([\d.]+) seconds? (?:left|remaining|to go)/.exec(s);
			if (m && Math.abs(Number(m[1]) - clock) > 0.6 && !elam) {
				add("seconds left claim", where, s, `clock ${clock}`);
			}
			if (
				elam &&
				/seconds left|with \d+:\d\d left|at the buzzer|\bhorn\b|\bclock\b/.test(
					s,
				) &&
				!shootout
			) {
				add("clock words in an Elam ending", where, s);
			}
			// period words
			if (
				numPeriods !== 4 &&
				/\bquarter\b|After three|After one\b/.test(s) &&
				!/three-quarter|quarter court/.test(s)
			) {
				add("quarter word in a non-4-period league", where, s);
			}
			if (
				numPeriods !== 2 &&
				numPeriods !== 4 &&
				/\bhalf\b(?! court|-court)|halftime/.test(s) &&
				!/half court|half-court/.test(s)
			) {
				add("half word in an odd-period league", where, s);
			}
			if (
				period <= numPeriods &&
				/\bovertime\b/i.test(s) &&
				!/force overtime|to overtime|into overtime|sends it to overtime|regulation/.test(
					s,
				) &&
				type !== "overtime"
			) {
				add("overtime word in regulation", where, s);
			}
		}
		// what comes next (the next event that is not a stat)
		let next: any;
		for (let j = pos; j < events.length; j++) {
			if (
				events[j].type !== "stat" &&
				events[j].type !== "sub" &&
				events[j].type !== "timeouts"
			) {
				next = events[j];
				break;
			}
		}
		const endsNext =
			!next ||
			[
				"period",
				"overtime",
				"gameOver",
				"endOfPeriod",
				"elamActive",
				"shootoutStart",
			].includes(next.type);
		if (
			(MADE_TYPES.has(type) || MISS_TYPES.has(type)) &&
			/at the buzzer|at the horn|as the horn sounds|as time expires|with time expiring|as the clock hits zero|just before the horn|beat the buzzer|Beat the buzzer|At the horn/.test(
				full,
			) &&
			!(endsNext && clock <= 3.5)
		) {
			add(
				"buzzer words without the buzzer",
				where,
				full.replace("\n", " / "),
				`clock ${clock}, next ${next?.type}`,
			);
		}
		if (
			/foul trouble with (\d+)|foul number (\d+) on/.test(note) &&
			next?.type === "foulOut"
		) {
			add(
				"foul trouble note on the fouling-out foul",
				where,
				`${text} / ${note}`,
			);
		}
		if (
			/game-winner|ahead for good|to force overtime|sends it to overtime|That wins it|Ballgame/.test(
				full,
			) &&
			t !== undefined
		) {
			claims.push({
				where,
				text: full.replace("\n", " / "),
				t,
				at: hist.length,
				kind: /overtime/.test(full) ? "ot" : "win",
				period,
				type,
			});
		}
		if (type === "sub") {
			for (const [n, pid] of pidByName) {
				if (
					new RegExp(
						`injured ${escape(n)}|${escape(n)} is replaced by [^.]* after the injury`,
					).test(text) &&
					!injured.has(pid)
				) {
					add("sub: injured claim", where, text, n);
				}
				if (
					new RegExp(`${escape(n)}, who has fouled out`).test(text) &&
					!fouledOut.has(pid)
				) {
					add("sub: fouled out claim", where, text, n);
				}
				if (
					new RegExp(
						`${escape(n)} heads to the bench in foul trouble|replaces ${escape(n)}, who has picked up too many fouls`,
					).test(text) &&
					S(pid).pf < 2
				) {
					add("sub: foul trouble claim", where, text, `${n} pf ${S(pid).pf}`);
				}
				if (
					new RegExp(
						`${escape(n)} (returns for|is back in for)|${escape(n)} heads back to the scorer`,
					).test(text) &&
					!wasBenched.has(pid)
				) {
					add("sub: return claim", where, text, n);
				}
				if (
					new RegExp(
						`ejected ${escape(n)}|${escape(n)}, who has been tossed`,
					).test(text) &&
					!ejected.has(pid)
				) {
					add("sub: ejected claim", where, text, n);
				}
			}
		}
		if (
			/five minutes|Five more minutes/i.test(full) &&
			(sc.settings?.overtimeLength ?? 5) !== 5
		) {
			add("overtime length", where, full);
		}
		if (/Overtime tip/.test(text) && period <= numPeriods) {
			add("overtime tip in regulation", where, text);
		}
		// the shot clock, in a league whose shot clock is not 24 seconds
		const shotClockLen = sc.settings?.customShotClock
			? sc.settings.shotClockLength
			: 24;
		if (shotClockLen !== 24 && /shot clock|shot-clock/i.test(full)) {
			const poss = type === "tov" ? ev.poss : pendingPoss;
			if (poss === undefined || poss < shotClockLen - 3) {
				add(
					"shot clock words, shot clock not near zero",
					where,
					full.replace("\n", " / "),
					`poss ${poss}, shot clock ${shotClockLen}`,
				);
			}
		}
		// ---- shots ----
		if (MADE_TYPES.has(type)) {
			if (
				/\b(misses|no good|rims out|off the mark|can't get it to fall|comes up empty|won't fall|blocked|rejected|swatted)\b/i.test(
					text,
				) &&
				!/goaltending/.test(text)
			) {
				add("make worded as a miss?", where, text);
			}
			const three = type === "tp" || type === "tpAndOne";
			if (
				!three &&
				/\bthree(?!-point play| free|-quarter| defenders)|from deep|beyond the arc|downtown|\btrey\b|from long range/i.test(
					text,
				)
			) {
				add("two worded as a three?", where, text);
			}
			if (ev.pidAst !== undefined && ev.pidAst === ev.pid) {
				add("assist to the shooter (sim)", where, text);
			}
			if (ev.pidAst !== undefined && tOf.get(ev.pidAst) !== t) {
				add("assist from the other team (sim)", where, text);
			}
			if (
				/putback|puts it back|follow-up|tip-in|tips it in|second effort/i.test(
					text,
				) &&
				!(type.startsWith("fgPutBack") || type.startsWith("fgTipIn")) &&
				lastPossStart !== "orb"
			) {
				add(
					"putback words without an offensive rebound",
					where,
					text,
					`poss start ${lastPossStart}`,
				);
			}
			if (
				/fast break|on the break|in transition|coast to coast|leaks? out|2-on-1|outlet|runs the floor|sprints the lane|runs the wing|in the open floor/i.test(
					text,
				) &&
				!["steal", "drb"].includes(lastPossStart)
			) {
				add(
					"fast-break words without a steal or rebound",
					where,
					text,
					`poss start ${lastPossStart}`,
				);
			}
			// streak of makes
			const prevStreak = madeStreak.get(ev.pid) ?? 0;
			madeStreak.set(ev.pid, prevStreak + 1);
			const hm =
				/(\d+) straight makes|(\d+) makes in a row|can't miss: (\d+) in a row|(\d+) straight buckets|that's (\d+) straight\.|found his rhythm: (\d+) in a row/.exec(
					note,
				);
			if (hm) {
				const n = Number(hm.slice(1).find((x) => x !== undefined));
				if (n !== prevStreak + 1) {
					add("made-shot streak", where, note, `real ${prevStreak + 1}`);
				}
			}
			const tm = t;
			lastScoreTime[tm] = absTime();
		}
		if (MISS_TYPES.has(type)) {
			madeStreak.set(type.startsWith("blk") ? pendingShooter : ev.pid, 0);
			if (
				/\b(scores|it's good|knocks it down|buries it|drains it|and it drops|banks it in|it falls)\b/i.test(
					text,
				)
			) {
				add("miss worded as a make?", where, text);
			}
			const three = type === "missTp" || type === "blkTp";
			if (
				!three &&
				/\bthree(?!-point play| free|-quarter| defenders)|from deep|beyond the arc|downtown|\btrey\b|from long range/i.test(
					text,
				)
			) {
				add("two worded as a three? (miss)", where, text);
			}
		}
		if (type === "ft") {
			lastScoreTime[t] = absTime();
		}
		if (
			(type === "orb" || type === "drb") &&
			lastPlay &&
			!MISS_TYPES.has(lastPlay.type) &&
			lastPlay.type !== "missFt"
		) {
			add(
				"rebound with no miss before it (sim)",
				where,
				text,
				`after ${lastPlay.type}`,
			);
		}

		// ---- who is on the floor ----
		if (
			![
				"sub",
				"foulOut",
				"ejection",
				"injury",
				"techFoul",
				"period",
				"overtime",
				"gameOver",
				"jumpBall",
				"shootoutTeam",
				"shootoutShot",
				"shootoutStart",
				"shootoutTie",
				"elamActive",
			].includes(type)
		) {
			for (const [n, pid] of pidByName) {
				if (
					text.includes(n) &&
					!onCourtBefore[tOf.get(pid)].has(pid) &&
					!onCourt[tOf.get(pid)].has(pid)
				) {
					add("named player not on the floor", where, text, n);
				}
				if (text.includes(n) && (fouledOut.has(pid) || ejected.has(pid))) {
					add(
						`player acting after he left the game (${sc.name})`,
						where,
						text,
						n,
					);
				}
			}
		}
		// team names: a line about team t's play that names the other team as the doer
		// (spot-checked by hand)

		// ---- state after ----
		if (type === "sub") {
			for (const pid of ev.pidsOff) {
				onCourt[t].delete(pid);
				wasBenched.add(pid);
			}
			for (const pid of ev.pids) {
				onCourt[t].add(pid);
			}
		}
		if (type === "foulOut") {
			fouledOut.add(ev.pid);
		}
		if (type === "ejection" && ev.pid !== undefined) {
			ejected.add(ev.pid);
		}
		if (
			process.env.PBP_DEBUG &&
			sc.name === process.env.PBP_DEBUG &&
			seed === Number(process.env.PBP_DEBUG_SEED)
		) {
			appendFileSync(
				process.env.PBP_DEBUG_OUT,
				`${where} | ${JSON.stringify(consumed.filter((e) => e.type !== "stat" || e.s === "pf" || e.s === "gs"))} | ${text} | ${note}\n`,
			);
		}
		if (type === "injury") {
			injured.add(ev.pid);
		}
		if (type === "stl") {
			lastPossStart = ev.outOfBounds ? "dead" : "steal";
		} else if (type === "drb") {
			lastPossStart = "drb";
		} else if (type === "orb") {
			lastPossStart = "orb";
		} else if (MADE_TYPES.has(type) || (type === "ft" && !ev.tech)) {
			lastPossStart = "make";
		} else if (
			[
				"tov",
				"pfNonShooting",
				"pfBonus",
				"pfFG",
				"pfTP",
				"timeout",
				"outOfBounds",
				"period",
				"overtime",
				"jumpBall",
				"flagrantFoul",
			].includes(type)
		) {
			lastPossStart = "dead";
		}
		lastPlay = ev;
	}

	// the finish claims: the team won, and (game-winner, ahead for good) never trailed or was tied after
	const finalWinner =
		score[0] > score[1] ? 0 : score[1] > score[0] ? 1 : undefined;
	for (const c of claims) {
		if (c.kind === "win" && !shootout) {
			let m = 0;
			for (let i = 0; i < hist.length; i++) {
				m += hist[i][0] === c.t ? hist[i][1] : -hist[i][1];
				if (i >= c.at - 1 && m <= 0) {
					add("game-winner claim: lead lost later", c.where, c.text);
					break;
				}
			}
			if (finalWinner !== c.t) {
				add("game-winner claim: team lost", c.where, c.text);
			}
		}
		if (c.kind === "ot" && overtimes === 0 && !shootout) {
			add("overtime claim with no overtime", c.where, c.text);
		}
	}
	totalGames += 1;
	gamesBy.set(sc.name, (gamesBy.get(sc.name) ?? 0) + 1);
	if (overtimes > 0) {
		otGames += 1;
	}

	// ---- stored vs live ----
	if (seed % 3 === 0) {
		const stored = encodePlayByPlay(eventsCopy);
		const storedBox = {
			...makeLiveBoxScore(result, seed),
			...(sc.allStar ? {} : {}),
			gid: seed,
			numPeriods,
			quarterLength,
			playoffs: !!sc.playoffs,
			shotClockLength: box.shotClockLength,
			pbp: stored,
		};
		storedBox.teams = storedBox.teams.map((tm, i) => ({
			...tm,
			tid: box.teams[i].tid,
			region: box.teams[i].region,
			name: box.teams[i].name,
		}));
		const entries = buildPlayByPlayEntries(storedBox);
		const storedText = entries.map((e) => nodeToText(e.text));
		let diff = 0;
		for (let i = 0; i < Math.max(storedText.length, liveLines.length); i++) {
			if (storedText[i] !== liveLines[i]) {
				diff += 1;
				if (diff <= 2) {
					add(
						"stored differs from live",
						`${sc.name} seed ${seed} line ${i}`,
						`live: ${liveLines[i]}`,
						`stored: ${storedText[i]}`,
					);
				}
			}
		}
	}
};

test.skipIf(!process.env.PBP_SCAN)(
	"play-by-play scan",
	async () => {
		local.setState({ featurePbpFlavor: true } as any);
		for (const sc of SCENARIOS) {
			local
				.getState()
				.actions.update({ gender: sc.female ? "female" : "male" });
			for (let seed = 1; seed <= Math.round(sc.seeds * SCALE); seed++) {
				await scanGame(seed, sc);
			}
		}
		Object.assign(TECHNICAL_FOUL_RATES, RATES);
		const byKind = new Map<string, Finding[]>();
		for (const f of findings) {
			byKind.set(f.kind, [...(byKind.get(f.kind) ?? []), f]);
		}
		const out: string[] = [
			`${totalGames} games (${otGames} with overtime), ${totalLines} lines`,
		];
		out.push(
			`games by scenario: ${JSON.stringify(Object.fromEntries(gamesBy))}`,
		);
		for (const [kind, fs] of [...byKind].sort(
			(a, b) => b[1].length - a[1].length,
		)) {
			const by = new Map<string, number>();
			for (const f of fs) {
				const name =
					SCENARIOS.map((x) => x.name)
						.filter((nm) => f.where.startsWith(`${nm} `))
						.sort((a, b) => b.length - a.length)[0] ?? "?";
				by.set(name, (by.get(name) ?? 0) + 1);
			}
			out.push(
				`\n== ${kind}: ${fs.length}  ${JSON.stringify(Object.fromEntries(by))}`,
			);
			for (const f of fs.slice(
				0,
				kind === "stored differs from live" ? 20 : 8,
			)) {
				out.push(
					`  [${f.where}] ${f.text}${f.detail ? `  -- ${f.detail}` : ""}`,
				);
			}
		}
		out.push("\n== most common shapes");
		for (const [s, n] of [...shapes].sort((a, b) => b[1] - a[1]).slice(0, 30)) {
			out.push(`  ${n} ${s}`);
		}
		const report = out.join("\n");
		if (process.env.PBP_SCAN_OUT) {
			writeFileSync(process.env.PBP_SCAN_OUT, report);
		}
		console.log(report.slice(0, 3000));
	},
	3_600_000,
);
