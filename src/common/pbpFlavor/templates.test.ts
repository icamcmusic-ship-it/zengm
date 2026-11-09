import { assert, test } from "vitest";
import {
	alleyOop,
	blockText,
	dunkKinds,
	handleSetups,
	madeShot,
	missText,
	passWord,
	rebText,
	shotOptions,
	tovText,
} from "./phrases.ts";
import {
	crowdLine,
	endOfPeriod,
	ejectionText,
	flagrantFoul,
	freeThrow,
	heaveText,
	injuryText,
	nonShootingFoul,
	outOfBounds,
	quarterNote,
	shootingFoul,
	substitution,
	technicalFoul,
	technicalFreeThrow,
	timeoutText,
	tipOff,
	type Trip,
} from "./plays.ts";
import {
	SHOT_KINDS,
	archetypeOf,
	beatClockText,
	bigCall,
	classifyShot,
	doubleDouble,
	doubleFigures,
	droughtLine,
	heatCheckNote,
	homeCrowd,
	hotLine,
	lateClockMiss,
	pointsMilestone,
	runEndedLine,
	runLine,
	secondChanceLead,
	streakLine,
	tripleDouble,
	tripleDoubleWatch,
	type CallKind,
	type ShotKind,
} from "./calls.ts";
import { Rng } from "./rng.ts";
import { VarietyMemory, setVariety } from "./variety.ts";
import { RATING_KEYS, clockOf, type FPlayer, type Ratings } from "./types.ts";

/*
 * Every template of the play-by-play, filled in for players of every kind (all ratings low, all high, and many in between) and every
 * context the session passes: no placeholder is ever left unfilled, and every shot template reads as the kind of shot its table says.
 */

const BAD = /undefined|NaN|\bnull\b|\[object|\${|[{}]| {2}|^\s|\s$/;

const ratingsFrom = (rng: Rng, fixed?: number): Ratings => {
	const R: any = {};
	for (const k of RATING_KEYS) {
		R[k] = fixed ?? Math.round(15 + rng.random() * 85);
	}
	return R;
};

const NAMES = [
	"Joe Smith",
	"Marcus Hammonds",
	"Andre Davis Jr.",
	"Shaq O'Neal",
	"Jose Garcia-Lopez",
	"Luka De La Cruz",
	"Ty Banks",
];

const players = (() => {
	const rng = new Rng(1, 1);
	const out: FPlayer[] = [];
	for (let i = 0; i < 160; i++) {
		const fixed = i === 0 ? 0 : i === 1 ? 100 : i === 2 ? 50 : undefined;
		out.push({
			pid: i,
			name: NAMES[i % NAMES.length]!,
			pos: "G",
			t: (i % 2) as 0 | 1,
			R: ratingsFrom(rng, fixed),
		});
	}
	return out;
})();

const check = (where: string, text: unknown) => {
	assert.isString(text, where);
	const s = text as string;
	assert.isAbove(s.length, 0, `${where}: empty`);
	assert.notMatch(s, BAD, `${where}: ${s}`);
};

const ctxFor = (rng: Rng, p: FPlayer, o: Record<string, unknown> = {}) => {
	const others = players.filter((q) => q.pid !== p.pid).slice(0, 12);
	return {
		trans: false,
		lastReb: null,
		gap: 10,
		late: false,
		inbound: false,
		mate: () => rng.pick(others),
		third: () => rng.pick(others),
		def: () => rng.pick(others),
		dmate: () => rng.pick(others),
		female: false,
		zone: false,
		press: false,
		beatClockText: () => beatClockText(rng),
		...o,
	};
};

const KINDS_FOR: Record<string, ShotKind[]> = {
	three: [
		"three",
		"logo-three",
		"deep-three",
		"corner-three",
		"step-back-three",
		"pull-up-three",
		"catch-and-shoot-three",
	],
	dunk: ["dunk"],
	rim: ["layup", "floater"],
	post: ["hook", "post-move", "fadeaway", "layup"],
	mid: ["jumper", "fadeaway", "step-back", "pull-up", "bank-shot", "floater"],
	// a putback's own kinds
	putrim: ["putback"],
	tip: ["tip-in"],
	putdunk: ["putback-dunk"],
};

test("every shot template fills in and reads as its kind of shot", () => {
	setVariety(new VarietyMemory(NAMES));
	const rng = new Rng(2, 2);
	const seen = new Set<string>();
	const kinds = new Set<ShotKind>();
	for (const p of players) {
		for (const three of [false, true]) {
			for (const putback of [false, true]) {
				if (three && putback) {
					continue;
				}
				for (const trans of [false, true]) {
					for (const andOne of [false, true]) {
						for (const own of [false, true]) {
							const e = { p, three, andOne, ast: undefined };
							const ctx = ctxFor(rng, p, {
								lastReb: own ? { pid: p.pid, own: true } : null,
							});
							for (const x of shotOptions(e, putback, trans, ctx)) {
								check(`shot ${x.cls}`, x.t);
								assert.isTrue(x.t.startsWith(p.name), x.t);
								if (seen.has(x.t)) {
									continue;
								}
								seen.add(x.t);
								const cls = putback && x.cls === "rim" ? "putrim" : x.cls;
								const kind = classifyShot(x.t.replaceAll(p.name, "N"), {
									three,
									zone:
										cls === "post"
											? "post"
											: cls === "mid"
												? "mid"
												: three
													? undefined
													: "rim",
									putback,
									inboundTip: false,
									fake: false,
									ptype: undefined,
								});
								kinds.add(kind);
								assert.include(
									KINDS_FOR[cls] ?? [],
									kind,
									`${x.t} (${cls}) reads as ${kind}`,
								);
							}
						}
					}
				}
			}
		}
		for (const [, t] of dunkKinds(p)) {
			check("dunk kind", t);
		}
		for (const [, t] of handleSetups(p)) {
			check("dribble move", t);
		}
	}
	assert.isAbove(seen.size, 350, "shot templates");
	for (const k of [
		"layup",
		"floater",
		"hook",
		"fadeaway",
		"step-back",
		"pull-up",
		"dunk",
		"corner-three",
		"logo-three",
		"step-back-three",
		"pull-up-three",
		"catch-and-shoot-three",
		"putback",
		"tip-in",
		"putback-dunk",
	] as ShotKind[]) {
		assert.isTrue(kinds.has(k), `no ${k} template`);
	}
	for (const k of kinds) {
		assert.include(SHOT_KINDS, k);
	}
}, 60_000);

test("made shots, misses, blocks, passes, steals, turnovers and rebounds fill in for every context", () => {
	setVariety(new VarietyMemory(NAMES));
	const rng = new Rng(3, 3);
	const zones = ["rim", "post", "mid", undefined] as const;
	for (const [i, p] of players.entries()) {
		const ast = players[(i + 1) % players.length]!;
		const blk = players[(i + 3) % players.length]!;
		for (const zone of zones) {
			for (const three of [false, true]) {
				for (const trans of [false, true]) {
					const ctx = ctxFor(rng, p, {
						trans,
						stealer: i % 3 === 0 ? p.pid : undefined,
						defReb: i % 4 === 0 ? ast.pid : undefined,
						beatClock: i % 5 === 0,
						gap: i % 5 === 0 ? 23 : 8,
					});
					const e = {
						p,
						three,
						zone: three ? undefined : zone,
						ast: i % 2 === 0 ? ast : undefined,
						andOne: i % 7 === 0,
						putback: false,
						ti: 0,
					};
					check("made", madeShot(rng, e, ctx));
					check("miss", missText(rng, { ...e, made: false }, ctx));
					check(
						"blocked",
						missText(rng, { ...e, made: false, blk }, ctx) +
							"; " +
							blockText(rng, blk, three, trans, ctx),
					);
					const oop = alleyOop(rng, { ...e, ast }, ctx, trans);
					if (oop) {
						check("alley-oop", oop);
					}
					for (const cls of ["three", "mid", "post", "rim", "dunk"]) {
						check("pass", passWord(rng, ast, cls, ctx, undefined));
					}
					check("pop", passWord(rng, ast, "three", ctx, "pop"));
				}
			}
		}
		for (const oob of [false, true]) {
			for (const press of [false, true]) {
				for (const shotClock of [false, true]) {
					const ctx = ctxFor(rng, p, {
						oob,
						press,
						inbound: press,
						offFoul: !oob,
						offFoulW: 0.7,
						drawer: blk,
						gap: shotClock ? 23 : 8,
						defReb: press ? p.pid : undefined,
					});
					check("tov", tovText(rng, { k: "tov", p, ti: 0, shotClock }, ctx));
					check(
						"steal",
						tovText(rng, { k: "tov", p, stl: blk, ti: 0 }, { ...ctx, oob }),
					);
				}
			}
		}
		for (const off of [false, true]) {
			check("rebound", rebText(rng, p, off, i % 2 === 0, false, undefined));
			check("rebound after block", rebText(rng, p, off, false, false, blk));
			check("own block", rebText(rng, p, true, false, true, blk));
		}
	}
}, 60_000);

test("fouls, free throws, substitutions, timeouts and the rest fill in", () => {
	setVariety(new VarietyMemory(NAMES));
	const rng = new Rng(4, 4);
	for (let i = 0; i < players.length; i++) {
		const a = players[i]!;
		const b = players[(i + 1) % players.length]!;
		const c = players[(i + 2) % players.length]!;
		const tag = `P${(i % 5) + 1}, team foul ${(i % 6) + 1}`;
		for (const intentional of [false, true]) {
			for (const bonus of [false, true]) {
				check(
					"foul",
					nonShootingFoul(rng, a, tag, "the Celtics", {
						intentional,
						bonus,
						shooter: bonus ? b : undefined,
						teamPenalty: "the Mavericks",
					}),
				);
			}
		}
		for (const three of [false, true]) {
			check(
				"shooting foul",
				shootingFoul(
					rng,
					b,
					i % 3 === 0 ? undefined : a,
					tag,
					three,
					three ? 3 : 2,
				),
			);
		}
		for (const n of [1, 2, 3]) {
			const trip: Trip = {
				shooter: b,
				n,
				i: 0,
				m: 0,
				three: n === 3,
				andOne: n === 1,
				intentional: false,
				bonus: false,
				fouler: a,
			};
			for (let k = 0; k < n; k++) {
				const made = (i + k) % 3 !== 0;
				check(
					"free throw",
					freeThrow(rng, trip, b, made, {
						late: i % 4 === 0,
						makesBefore: trip.m,
					}),
				);
				trip.i += 1;
				if (made) {
					trip.m += 1;
				}
			}
		}
		check(
			"lone free throw",
			freeThrow(rng, null, b, i % 2 === 0, { late: true, makesBefore: 0 }),
		);
		const why = {
			foulTrouble: new Set(i % 3 === 0 ? [b.pid] : []),
			injured: new Set(i % 5 === 0 ? [b.pid] : []),
			fouledOut: new Set(i % 7 === 0 ? [b.pid] : []),
			ejected: new Set<number>(),
			back: new Set(i % 2 === 0 ? [a.pid] : []),
		};
		check("sub", substitution(rng, "the Celtics", [[a, b]], why));
		check(
			"sub, no one off",
			substitution(rng, "the Celtics", [[a, undefined]], why),
		);
		check(
			"subs",
			substitution(
				rng,
				"the Celtics",
				[
					[a, b],
					[c, undefined],
				],
				why,
			),
		);
		for (const opts of [
			{ advancesBall: false },
			{ advancesBall: true },
			{ advancesBall: false, runBy: { team: "the Mavericks", label: "11-0" } },
			{ advancesBall: true, down: { margin: 2, clock: "0:14" } },
			{ advancesBall: false, lateTie: true },
		]) {
			check("timeout", timeoutText(rng, "the Celtics", i % 4, opts));
		}
		for (const on of ["offense", "defense"] as const) {
			for (const prev of ["shot", "block", "other"] as const) {
				check(
					"out of bounds",
					outOfBounds(rng, {
						on,
						prev,
						teamOn: "the Celtics",
						other: "the Mavericks",
						a,
						d: b,
						blocker: prev === "block" ? c : undefined,
					}),
				);
			}
		}
		for (const reason of [
			"runOutClock",
			"noShot",
			"intentionalFoul",
		] as const) {
			check("end of period", endOfPeriod(rng, reason, "the Celtics", a));
		}
		check("heave", heaveText(rng, a, i % 2 === 0));
		check("injury", injuryText(rng, a));
		check("tip", tipOff(rng, a, b, "the Celtics", i % 2 === 0));
		for (const label of [
			"first quarter",
			"second quarter",
			"third quarter",
			"fourth quarter",
			"first half",
			"overtime",
		]) {
			check(
				"period",
				quarterNote(rng, label, "the Celtics", "the Mavericks", i, 50),
			);
		}
		check(
			"crowd",
			crowdLine(rng, i % 2 === 0 ? "wow" : "tight", "the Celtics"),
		);
		check(
			"technical",
			technicalFoul(
				rng,
				i % 3 === 0 ? undefined : a,
				"the Celtics",
				(i % 2) + 1,
				{
					afterDunk: i % 2 === 0,
					afterFoul: i % 3 === 0,
					shooter: b,
				},
			),
		);
		check(
			"flagrant",
			flagrantFoul(rng, a, b, tag, i % 2 === 0 ? 1 : 2, "the Celtics"),
		);
		for (const reason of ["flagrant2", "flagrants", "techs"]) {
			check(
				"ejection",
				ejectionText(rng, i % 4 === 0 ? undefined : a, "the Celtics", reason),
			);
		}
		check("technical free throw", technicalFreeThrow(rng, a, i % 2 === 0));
	}
}, 60_000);

test("calls, crowd, momentum and milestone lines fill in", () => {
	setVariety(new VarietyMemory(NAMES));
	const rng = new Rng(5, 5);
	const calls: CallKind[] = [
		"poster",
		"dunk",
		"oop",
		"block",
		"chasedown",
		"deep",
		"buzzer",
		"winner",
		"dagger",
		"heat",
		"heave",
	];
	const archetypes = new Set<string>();
	for (let i = 0; i < 300; i++) {
		const p = players[i % players.length]!;
		archetypes.add(archetypeOf(p));
		for (const k of calls) {
			check(`call ${k}`, bigCall(rng, k));
		}
		for (const kind of ["wow", "tight", "run"] as const) {
			check("home crowd", homeCrowd(rng, i % 2 === 0, kind, "the Celtics"));
		}
		check(
			"run",
			runLine(
				rng,
				"the Celtics",
				8 + (i % 12),
				i % 5,
				i % 3 === 0 ? undefined : 30 + i,
				clockOf,
			),
		);
		check(
			"run ended",
			runEndedLine(
				rng,
				"the Celtics",
				"the Mavericks",
				`${10 + (i % 9)}-${i % 4}`,
			),
		);
		check("streak", streakLine(rng, p.name, 8 + (i % 6), "the Celtics"));
		check("hot", hotLine(rng, p.name, 4 + (i % 4)));
		check("drought", droughtLine(rng, clockOf(180 + i * 7), "the Celtics"));
		check("heat check", heatCheckNote(rng, p.name, 3 + (i % 4), i % 2 === 0));
		check(
			"milestone",
			pointsMilestone(
				rng,
				"Smith",
				30 + 10 * (i % 4),
				i % 2 === 0,
				i % 3 === 0,
			),
		);
		check(
			"double-double",
			doubleDouble(rng, p.name, "12 points", "10 rebounds"),
		);
		check(
			"triple-double",
			tripleDouble(rng, p.name, "12 points, 10 rebounds and 11 assists"),
		);
		check(
			"triple-double watch",
			tripleDoubleWatch(rng, "Smith", 1 + (i % 3), "assists"),
		);
		check("double figures", doubleFigures(rng, "Smith", "assists"));
		check("second chance", secondChanceLead(rng, i % 2 === 0).trim());
		check("late clock", lateClockMiss(rng).trim());
		check("beat clock", beatClockText(rng).trim());
	}
	// a's and an's in runs
	assert.notMatch(
		runLine(rng, "the Celtics", 8, 0, undefined, clockOf),
		/\ba 8\b/,
	);
	assert.isAbove(archetypes.size, 4);
}, 60_000);
