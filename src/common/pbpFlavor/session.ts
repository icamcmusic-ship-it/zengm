/* The "flavor" layer of the basketball play-by-play. Ported from the BBGM League Explorer's play-by-play engine, but fed by BBGM's own
   live events (src/worker/core/GameSim.basketball/PlayByPlayLogger.ts) instead of a box score: one FlavorSession per live game turns each
   event, as the live view reaches it, into a line of text with ratings-based plays, varied phrasing, running tallies, milestones, runs,
   momentum, timeouts, substitutions and crowd colour.

   The layer only words what the sim logged. It never reads or writes the sim's state and never uses Math.random: choices come from a
   separate generator seeded with the game id and the position of the event (see rng.ts), so the same game always reads the same and
   the result of a game cannot depend on its wording. */
import type { PlayByPlayEventOutput } from "../../worker/core/GameSim.basketball/PlayByPlayLogger.ts";
import {
	alleyOop as _alleyOop,
	blockText,
	madeShot,
	missText,
	rebText,
	tovText,
} from "./phrases.ts";
import {
	crowdLine,
	endOfPeriod,
	ejectionText,
	flagrantFoul,
	foulOutText,
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
import { Rng } from "./rng.ts";
import { VarietyMemory, pickV, setVariety, weighted } from "./variety.ts";
import {
	bare,
	cap,
	clockOf,
	makeRatings,
	poss as possessive,
	type FPlayer,
	type TeamLabel,
} from "./types.ts";

void _alleyOop;

export type FlavorStat = {
	pts: number;
	ast: number;
	trb: number;
	stl: number;
	blk: number;
	tov: number;
	pf: number;
};

// What the session needs to know about the live game. All numbers are the live box score, already updated for the stat events that
// come before the play being worded
export type FlavorHost = {
	stat: (pid: number) => FlavorStat | undefined;
	score: () => [number, number];
	onCourt: (t: 0 | 1) => number[];
};

export type FlavorResult = {
	text: string;
	// A second, quieter line: running milestones, runs, crowd
	note?: string;
	danger?: boolean;
	// For structural events (a new period...) the UI keeps its own text and only appends the note
	keepText?: boolean;
	// The kind of play, for tests and tuning ("alleyoop", "poster", "pick6", "chasedown"...)
	ptype?: string;
};

export type FlavorInit = {
	gid: number;
	numPeriods: number;
	// Minutes
	quarterLength: number;
	female: boolean;
	teams: [TeamLabel, TeamLabel];
	// "Lakers" or, for the All-Star Game, "Team LeBron" (no article)
	noArticle: boolean;
	players: {
		pid: number;
		name: string;
		pos: string;
		t: 0 | 1;
		ratings?: Record<string, number>;
	}[];
};

// The init event the sim sends first: both teams, with each player's name, position and raw ratings
export const playersFromInitEvent = (event: any): FlavorInit["players"] => {
	const out: FlavorInit["players"] = [];
	const teams = event?.boxScore;
	if (!Array.isArray(teams)) {
		return out;
	}
	for (const [t, team] of teams.entries()) {
		for (const p of team?.player ?? []) {
			out.push({
				pid: p.id,
				name: String(p.name ?? "???"),
				pos: String(p.pos ?? ""),
				t: t === 1 ? 1 : 0,
				ratings: p.pbpRatings,
			});
		}
	}
	return out;
};

type Attempt = {
	pid: number;
	t: 0 | 1;
	kind: "rim" | "post" | "mid" | "three" | "fake" | "tip" | "put";
	poss: number | undefined;
	desperation: boolean;
	clock: number;
	pidPass: number | undefined;
};

type ShotMeta = {
	three: boolean;
	zone: "rim" | "post" | "mid" | undefined;
	andOne: boolean;
	putback: boolean;
	tip: boolean;
};

const MADE: Record<string, ShotMeta> = {
	fgAtRim: {
		three: false,
		zone: "rim",
		andOne: false,
		putback: false,
		tip: false,
	},
	fgAtRimAndOne: {
		three: false,
		zone: "rim",
		andOne: true,
		putback: false,
		tip: false,
	},
	fgLowPost: {
		three: false,
		zone: "post",
		andOne: false,
		putback: false,
		tip: false,
	},
	fgLowPostAndOne: {
		three: false,
		zone: "post",
		andOne: true,
		putback: false,
		tip: false,
	},
	fgMidRange: {
		three: false,
		zone: "mid",
		andOne: false,
		putback: false,
		tip: false,
	},
	fgMidRangeAndOne: {
		three: false,
		zone: "mid",
		andOne: true,
		putback: false,
		tip: false,
	},
	tp: {
		three: true,
		zone: undefined,
		andOne: false,
		putback: false,
		tip: false,
	},
	tpAndOne: {
		three: true,
		zone: undefined,
		andOne: true,
		putback: false,
		tip: false,
	},
	fgPutBack: {
		three: false,
		zone: "rim",
		andOne: false,
		putback: true,
		tip: false,
	},
	fgPutBackAndOne: {
		three: false,
		zone: "rim",
		andOne: true,
		putback: true,
		tip: false,
	},
	fgTipIn: {
		three: false,
		zone: "rim",
		andOne: false,
		putback: false,
		tip: true,
	},
	fgTipInAndOne: {
		three: false,
		zone: "rim",
		andOne: true,
		putback: false,
		tip: true,
	},
};

const MISSED: Record<string, ShotMeta> = {
	missAtRim: {
		three: false,
		zone: "rim",
		andOne: false,
		putback: false,
		tip: false,
	},
	missLowPost: {
		three: false,
		zone: "post",
		andOne: false,
		putback: false,
		tip: false,
	},
	missMidRange: {
		three: false,
		zone: "mid",
		andOne: false,
		putback: false,
		tip: false,
	},
	missTp: {
		three: true,
		zone: undefined,
		andOne: false,
		putback: false,
		tip: false,
	},
	missPutBack: {
		three: false,
		zone: "rim",
		andOne: false,
		putback: true,
		tip: false,
	},
	missTipIn: {
		three: false,
		zone: "rim",
		andOne: false,
		putback: false,
		tip: true,
	},
	blkAtRim: {
		three: false,
		zone: "rim",
		andOne: false,
		putback: false,
		tip: false,
	},
	blkLowPost: {
		three: false,
		zone: "post",
		andOne: false,
		putback: false,
		tip: false,
	},
	blkMidRange: {
		three: false,
		zone: "mid",
		andOne: false,
		putback: false,
		tip: false,
	},
	blkTp: {
		three: true,
		zone: undefined,
		andOne: false,
		putback: false,
		tip: false,
	},
	blkPutBack: {
		three: false,
		zone: "rim",
		andOne: false,
		putback: true,
		tip: false,
	},
	blkTipIn: {
		three: false,
		zone: "rim",
		andOne: false,
		putback: false,
		tip: true,
	},
};

const ATTEMPT_KIND: Record<string, Attempt["kind"]> = {
	fgaAtRim: "rim",
	fgaLowPost: "post",
	fgaMidRange: "mid",
	fgaTp: "three",
	fgaTpFake: "fake",
	fgaTipIn: "tip",
	fgaPutBack: "put",
};

type StartKind = "make" | "dead" | "steal" | "drb" | "orb" | "tov";

const isStatEvent = (e: any) => e && e.type === "stat";
const isStructural = (e: any) =>
	e &&
	(e.type === "period" ||
		e.type === "overtime" ||
		e.type === "gameOver" ||
		e.type === "overtime");

// The words that name a stat in a running tally: "Smith (14 PTS)"
const TALLY_LABEL = {
	PTS: "PTS",
	AST: "AST",
	REB: "REB",
	STL: "STL",
	BLK: "BLK",
	TOV: "TOV",
};

export class FlavorSession {
	private gid: number;
	private numPeriods: number;
	private quarterLength: number;
	private noArticle: boolean;
	private female: boolean;
	private labels: [TeamLabel, TeamLabel];
	private players = new Map<number, FPlayer>();
	private variety: VarietyMemory;
	private host!: FlavorHost;
	private idx = 0;

	// Game state, only what is needed to word things
	private period = 1;
	private periodLens: number[] = [];
	private absBase = 0;
	private prevScore: [number, number] = [0, 0];
	private pending: Attempt | undefined;
	private lastShot:
		| { p?: FPlayer; three: boolean; blk?: FPlayer; ft?: boolean; t: 0 | 1 }
		| undefined;
	private lastReb: { pid: number; own: boolean; t: 0 | 1 } | undefined;
	private defReb: number | undefined;
	private stealer: number | undefined;
	private startKind: StartKind = "dead";
	private trip: Trip | null = null;
	private teamFouls: [number, number] = [0, 0];
	private ato: [boolean, boolean] = [false, false];
	private injured = new Set<number>();
	private fouledOut = new Set<number>();
	private ejected = new Set<number>();
	// the type of the last event worded, and whether it was a dunk (for the wording of a technical foul)
	private lastType: string | undefined;
	private lastDunk = false;
	private foulTrouble = new Set<number>();
	private seen = new Map<
		number,
		{
			PTS: number;
			REB: number;
			AST: number;
			STL: number;
			BLK: number;
			dd: boolean;
			td: boolean;
		}
	>();
	private qPts = new Map<number, number>();
	private streak: [
		{ pid: number | undefined; pts: number; said: boolean },
		{ pid: number | undefined; pts: number; said: boolean },
	] = [
		{ pid: undefined, pts: 0, said: false },
		{ pid: undefined, pts: 0, said: false },
	];
	private hot = new Map<number, number>();
	private hotSaid = new Set<number>();
	private lastScoreAbs: [number | undefined, number | undefined] = [
		undefined,
		undefined,
	];
	private run: { t: 0 | 1 | undefined; S: number; O: number; said: number } = {
		t: undefined,
		S: 0,
		O: 0,
		said: 0,
	};
	private twoForOne = false;
	private lastShotSaid = false;
	private crowdN = 0;
	private lastPtype: string | undefined;
	// each team's defensive look, from its roster (quick guards press, length plays zone...)
	private scheme: [string, string] = ["man", "man"];
	// a rare stoppage, at most one a game
	private oddity: boolean;

	constructor(init: FlavorInit) {
		this.gid = init.gid;
		this.numPeriods = init.numPeriods;
		this.quarterLength = init.quarterLength;
		this.noArticle = init.noArticle;
		this.female = init.female;
		this.labels = init.teams;
		for (const p of init.players) {
			const R = makeRatings(p.ratings);
			// No dunks in a league of women: a rating of 0 keeps every dunk out of the wording
			if (this.female) {
				R.dnk = 0;
			}
			this.players.set(p.pid, {
				pid: p.pid,
				name: p.name.replaceAll(/\s+/g, " ").trim() || "???",
				pos: p.pos,
				t: p.t,
				R,
			});
		}
		const names = [...this.players.values()].map((p) => p.name);
		for (const l of init.teams) {
			names.push(l.name);
		}
		this.variety = new VarietyMemory(names);
		this.oddity = new Rng(this.gid, 555).random() < 0.06;
		for (const t of [0, 1] as const) {
			const r = new Rng(this.gid, 777 + t);
			const ps = [...this.players.values()]
				.filter((p) => p.t === t)
				.slice(0, 8);
			const avg = (k: "spd" | "hgt") =>
				ps.reduce((a, p) => a + p.R[k], 0) / Math.max(1, ps.length);
			const [r1, r2, r3] = [r.random(), r.random(), r.random()];
			this.scheme[t] =
				avg("spd") >= 62 && r1 < 0.5
					? "press"
					: avg("hgt") >= 58 && r2 < 0.4
						? "zone"
						: r3 < 0.5
							? "switch"
							: "man";
		}
		this.periodLens[1] = init.quarterLength * 60;
	}

	// ---- small helpers ----
	private pl(pid: number | undefined): FPlayer {
		let p = pid === undefined ? undefined : this.players.get(pid);
		if (!p) {
			p = {
				pid: pid ?? -1,
				name: "???",
				pos: "",
				t: 0,
				R: makeRatings(undefined),
			};
			if (pid !== undefined) {
				this.players.set(pid, p);
			}
		}
		return p;
	}

	private the(t: 0 | 1) {
		const n = this.labels[t].name;
		return this.noArticle ? n : `the ${n}`;
	}

	private floor(t: 0 | 1): FPlayer[] {
		return this.host.onCourt(t).map((pid) => this.pl(pid));
	}

	private abs(clock: number | undefined) {
		if (clock === undefined || !Number.isFinite(clock)) {
			return undefined;
		}
		const len = this.periodLens[this.period] ?? this.quarterLength * 60;
		return this.absBase + (len - clock);
	}

	private finalPeriod() {
		return this.period >= this.numPeriods;
	}

	// Does the sim's next real event start a new period (or end the game)? Then what we are describing was the last thing to happen
	private endsPeriodNext(future: readonly any[] | undefined) {
		if (!future) {
			return false;
		}
		for (const f of future) {
			if (isStatEvent(f) || f.type === "timeouts" || f.type === "sub") {
				continue;
			}
			return (
				f.type === "period" ||
				f.type === "overtime" ||
				f.type === "gameOver" ||
				f.type === "endOfPeriod" ||
				f.type === "elamActive"
			);
		}
		return true;
	}

	// Points still to come, from the stat events after this one: [team 0, team 1], up to the next period
	private pointsAhead(
		future: readonly any[] | undefined,
		untilOvertime: boolean,
	) {
		const out: { t: number; amt: number }[] = [];
		let sawOvertime = false;
		if (!future) {
			return { events: out, sawOvertime };
		}
		for (const f of future) {
			if (f.type === "overtime" || f.type === "shootoutStart") {
				sawOvertime = true;
				if (untilOvertime) {
					break;
				}
			}
			if (isStatEvent(f) && f.s === "pts" && f.t !== undefined && f.amt) {
				out.push({ t: f.t, amt: f.amt });
			}
		}
		return { events: out, sawOvertime };
	}

	// ---- the entry point ----
	describe(
		e: PlayByPlayEventOutput,
		host: FlavorHost,
		future?: readonly any[],
	): FlavorResult | "silent" | undefined {
		this.idx += 1;
		setVariety(this.variety);
		this.host = host;
		const rng = new Rng(this.gid, this.idx);
		const score = host.score();
		const dPts: [number, number] = [
			score[0] - this.prevScore[0],
			score[1] - this.prevScore[1],
		];
		this.prevScore = [score[0], score[1]];
		const ev: any = e;
		let res: FlavorResult | "silent" | undefined;

		switch (e.type) {
			case "period":
			case "overtime":
				res = this.onPeriod(rng, ev, score);
				break;
			case "gameOver":
				res = this.onGameOver(rng, score);
				break;
			case "jumpBall":
				res = this.onJumpBall(rng, ev);
				break;
			case "fgaAtRim":
			case "fgaLowPost":
			case "fgaMidRange":
			case "fgaTp":
			case "fgaTpFake":
			case "fgaTipIn":
			case "fgaPutBack":
				this.pending = {
					pid: ev.pid,
					t: ev.t,
					kind: ATTEMPT_KIND[e.type]!,
					poss: ev.poss,
					desperation: !!ev.desperation,
					clock: ev.clock,
					pidPass: ev.pidPass,
				};
				// (the ball is theirs: nothing to word until the shot has an outcome)
				res = "silent";
				break;
			default:
				if (MADE[e.type]) {
					res = this.onMade(rng, ev, MADE[e.type]!, dPts, score, future);
				} else if (MISSED[e.type]) {
					res = this.onMissOrBlock(
						rng,
						ev,
						MISSED[e.type]!,
						e.type.startsWith("blk"),
						score,
						future,
					);
				} else if (e.type === "tov") {
					res = this.onTov(rng, ev, score);
				} else if (e.type === "stl") {
					res = this.onSteal(rng, ev, score);
				} else if (e.type === "orb" || e.type === "drb") {
					res = this.onRebound(rng, ev);
				} else if ((e.type === "ft" || e.type === "missFt") && ev.tech) {
					res = this.onTechFt(rng, ev, dPts, score, future);
				} else if (e.type === "ft" || e.type === "missFt") {
					res = this.onFt(rng, ev, dPts, score, future);
				} else if (e.type === "techFoul") {
					res = this.onTechFoul(rng, ev, future);
				} else if (e.type === "flagrantFoul") {
					res = this.onFlagrant(rng, ev);
				} else if (e.type === "ejection") {
					res = this.onEjection(rng, ev);
				} else if (
					e.type === "pfNonShooting" ||
					e.type === "pfBonus" ||
					e.type === "pfFG" ||
					e.type === "pfTP"
				) {
					res = this.onFoul(rng, ev, score);
				} else if (e.type === "foulOut") {
					this.fouledOut.add(ev.pid);
					res = {
						text: foulOutText(rng, this.pl(ev.pid), this.host.stat(ev.pid)?.pf),
						danger: true,
					};
				} else if (e.type === "sub") {
					res = this.onSub(rng, ev);
				} else if (e.type === "timeout") {
					res = this.onTimeout(rng, ev, score);
				} else if (e.type === "injury") {
					this.injured.add(ev.pid);
					res = { text: injuryText(rng, this.pl(ev.pid)) };
				} else if (e.type === "endOfPeriod") {
					res = this.onEndOfPeriod(rng, ev);
				} else if (e.type === "outOfBounds") {
					res = this.onOutOfBounds(rng, ev);
				}
		}

		if (
			typeof res === "object" &&
			this.oddity &&
			(e.type === "timeout" || e.type === "outOfBounds" || e.type === "sub") &&
			rng.random() < 0.03
		) {
			this.oddity = false;
			const fl = this.floor(0).concat(this.floor(1));
			const someone = fl.length > 0 ? rng.pick(fl).name : "A player";
			const odd = pickV(rng, [
				"A wet spot near the baseline brings out the mop crew.",
				"The shot clock malfunctions; play stops while it's reset.",
				`${someone} loses a shoe and has to stop to put it back on.`,
				"The scoreboard briefly shows the wrong score; it's fixed during the stoppage.",
			]);
			res.note = [res.note, odd].filter(Boolean).join(" ");
		}
		if (typeof res === "object") {
			this.lastType = e.type;
			this.lastDunk =
				MADE[e.type] !== undefined &&
				/dunk|slam|jam|flush|throws it down|hammers|tomahawk|posteriz/i.test(
					res.text,
				);
		}
		return typeof res === "object" ? this.cleanResult(res, undefined) : res;
	}

	// ---- structure ----
	private onPeriod(rng: Rng, ev: any, score: [number, number]): FlavorResult {
		const prevLabel =
			this.period > this.numPeriods
				? "overtime"
				: `${["first", "second", "third", "fourth", "fifth", "sixth"][this.period - 1] ?? "last"} ${this.numPeriods === 2 ? "half" : "quarter"}`;
		const prevLen = this.periodLens[this.period] ?? this.quarterLength * 60;
		this.absBase += prevLen;
		this.period = ev.period;
		this.periodLens[this.period] = Number.isFinite(ev.clock)
			? ev.clock
			: prevLen;
		this.teamFouls = [0, 0];
		this.qPts.clear();
		this.twoForOne = false;
		this.lastShotSaid = false;
		this.startKind = "dead";
		this.pending = undefined;
		this.lastReb = undefined;
		this.defReb = undefined;
		this.stealer = undefined;
		this.ato = [false, false];
		const label = prevLabel.replace(/^(\w+) quarter$/, "$1 quarter");
		const notes = [
			quarterNote(
				rng,
				label,
				this.labels[0].name,
				this.labels[1].name,
				score[0],
				score[1],
			),
		];
		if (
			ev.type === "period" &&
			this.period <= this.numPeriods &&
			rng.random() < 0.45
		) {
			const ti: 0 | 1 = rng.random() < 0.5 ? 0 : 1;
			const look = {
				press: "pick up full court with a press",
				zone: "switch to a 2-3 zone",
				switch: "start switching everything on defense",
				man: "go back to man-to-man",
			}[this.scheme[ti]];
			notes.push(`${cap(this.the(ti))} ${look}.`);
		}
		if (ev.type === "overtime") {
			const n = this.period - this.numPeriods;
			if (n >= 2) {
				notes.push(
					pickV(rng, [
						`Overtime number ${n}. Legs are heavy on both benches.`,
						"Another five minutes. Hands on knees all around during the break.",
						"Into overtime again; the starters look gassed.",
					]),
				);
			} else {
				notes.push(
					pickV(rng, [
						"Nobody could separate them in regulation.",
						"The building braces for extra basketball.",
						"Five more minutes to settle it.",
					]),
				);
			}
		}
		return { text: "", note: notes.join(" "), keepText: true };
	}

	private onGameOver(rng: Rng, score: [number, number]): FlavorResult {
		const w: 0 | 1 = score[0] >= score[1] ? 0 : 1;
		const top = [...this.players.values()]
			.map((p) => ({ p, pts: this.host.stat(p.pid)?.pts ?? 0 }))
			.sort((a, b) => b.pts - a.pts)[0];
		const bits = [
			`Final: ${bare(this.the(w))} ${score[w]}, ${bare(this.the(w === 0 ? 1 : 0))} ${score[w === 0 ? 1 : 0]}.`,
		];
		if (top && top.pts >= 20) {
			bits.push(
				pickV(rng, [
					`${top.p.name} led all scorers with ${top.pts}.`,
					`${top.p.name} finished with a game-high ${top.pts} points.`,
				]),
			);
		}
		return { text: "", note: bits.join(" "), keepText: true };
	}

	private onJumpBall(rng: Rng, ev: any): FlavorResult {
		const a = this.pl(ev.pid);
		const b = this.pl(ev.pid2);
		// (the opening tip happens with a full period on the clock)
		if (this.period === 1 && Number.isFinite(ev.clock)) {
			this.periodLens[1] = ev.clock;
		}
		this.startKind = "dead";
		return {
			text: tipOff(rng, a, b, this.the(ev.t), this.period > this.numPeriods),
		};
	}

	// ---- shots ----
	private defenderPicker(
		rng: Rng,
		shooterT: 0 | 1,
		ev: any,
		fouler: FPlayer | undefined,
	) {
		return (x: any, big: boolean) => {
			if (fouler && x.andOne && rng.random() < 0.85) {
				return fouler;
			}
			if (ev.pidDefense !== undefined && big) {
				return this.pl(ev.pidDefense);
			}
			const ds = this.floor(shooterT === 0 ? 1 : 0);
			return ds.length > 0
				? weighted(rng, ds, (p) =>
						big ? Math.pow(Math.max(20, p.R.hgt) / 50, 3) : 1,
					)
				: null;
		};
	}

	private baseCtx(
		rng: Rng,
		t: 0 | 1,
		poss: number | undefined,
		p: FPlayer | undefined,
		ev: any,
		fouler?: FPlayer,
	) {
		const o: 0 | 1 = t === 0 ? 1 : 0;
		const gap = poss ?? 10;
		// A shot soon after a steal or a long rebound is a break
		let trans = false;
		if (poss !== undefined && poss <= 9) {
			if (this.startKind === "steal") {
				trans = rng.random() < 0.7;
			} else if (this.startKind === "drb") {
				trans = poss <= 7 && rng.random() < 0.22;
			}
		}
		const score = this.host.score();
		const late =
			this.finalPeriod() &&
			(ev.clock ?? 999) <= 120 &&
			Math.abs(score[t] - score[o]) <= 5;
		const ctx: any = {
			trans,
			lastReb: this.lastReb && this.lastReb.t === t ? this.lastReb : null,
			defReb: this.startKind === "drb" ? this.defReb : undefined,
			stealer: this.startKind === "steal" ? this.stealer : undefined,
			gap,
			late,
			inbound:
				(this.startKind === "make" || this.startKind === "dead") &&
				gap <= 7 &&
				!trans,
			fouler,
			mate: (x: any) => {
				const ms = this.floor(x.ti ?? t).filter((q) => q.pid !== x.p.pid);
				return ms.length > 0 ? rng.pick(ms) : null;
			},
			third: (x: any) => {
				const ms = this.floor(x.ti ?? t).filter(
					(q) => q !== x.p && q !== x.ast,
				);
				return ms.length > 0 ? rng.pick(ms) : null;
			},
			def: this.defenderPicker(rng, t, ev, fouler),
			dmate: (x: any) => {
				const ds = this.floor(o).filter((q) => q !== x.stl);
				return ds.length > 0 ? rng.pick(ds) : null;
			},
			female: this.female,
			zone: this.scheme[o] === "zone",
			press: this.scheme[o] === "press",
		};
		void p;
		return ctx;
	}

	private foulTagFor(fouler: FPlayer, defT: 0 | 1, andOne: boolean) {
		// (the personal foul of an and-one is recorded just after its shot)
		const pf = (this.host.stat(fouler.pid)?.pf ?? 0) + (andOne ? 1 : 0);
		const tf = this.teamFouls[defT] + (andOne ? 1 : 0);
		return `P${pf}, team foul ${tf}`;
	}

	private onMade(
		rng: Rng,
		ev: any,
		meta: ShotMeta,
		dPts: [number, number],
		score: [number, number],
		future: readonly any[] | undefined,
	): FlavorResult {
		const t: 0 | 1 = ev.t;
		const o: 0 | 1 = t === 0 ? 1 : 0;
		const att = this.pending;
		this.pending = undefined;
		const p = this.pl(ev.pid);
		const ast = ev.pidAst === undefined ? undefined : this.pl(ev.pidAst);
		const fouler = ev.pidFoul === undefined ? undefined : this.pl(ev.pidFoul);
		const pts = dPts[t] || (meta.three ? 3 : 2);
		const fake = att?.kind === "fake";
		const play: any = {
			k: "fg",
			made: true,
			three: meta.three && !fake,
			zone: fake ? "mid" : meta.zone,
			p,
			ast,
			andOne: meta.andOne,
			putback: meta.putback,
			ti: t,
		};
		const ctx = this.baseCtx(rng, t, att?.poss, p, ev, fouler);
		if (fouler) {
			ctx.foulTag = this.foulTagFor(fouler, o, true);
		}
		const lastAction = this.endsPeriodNext(future);
		const heave =
			meta.three &&
			!fake &&
			!!att?.desperation &&
			(att.clock ?? 99) <= 2.5 &&
			lastAction;
		let text: string;
		if (heave) {
			text = heaveText(rng, p, true);
			ctx.ptype = "heave-made";
			ctx.wow = true;
		} else if (meta.tip) {
			text = this.tipIn(rng, play, att, true);
		} else if (fake) {
			text = this.deepTwo(rng, play, true);
		} else {
			ctx.shotEnd = undefined;
			let t0 = madeShot(rng, play, ctx);
			// the and-one belongs to the shot: it goes before the pass that set it up
			const cut =
				ctx.shotEnd !== undefined && ctx.shotEnd < t0.length
					? ctx.shotEnd
					: t0.length;
			const tail = t0.slice(cut);
			t0 = t0.slice(0, cut);
			if (meta.andOne) {
				const f = fouler;
				const hit = /contact|hit|bump|foul/.test(t0);
				if (f && ctx.defUsed === f) {
					t0 +=
						pickV(rng, [
							`, and ${f.name} is called for the foul`,
							`, and ${f.name} is whistled on the play`,
							`, and the whistle is on ${f.name}`,
						]) + ` (${ctx.foulTag})`;
				} else if (f) {
					t0 +=
						pickV(
							rng,
							hit
								? [
										`, and the foul on ${f.name}`,
										`, and ${f.name} is whistled for the foul`,
									]
								: [
										`, and the foul on ${f.name}`,
										` through contact from ${f.name}; and-one`,
										`, and ${f.name} is whistled for the foul`,
										` while getting hit by ${f.name}: and-one`,
										`, drawing the foul from ${f.name}`,
									],
						) + ` (${ctx.foulTag})`;
				} else {
					t0 += pickV(
						rng,
						hit
							? [", and the foul", "; and-one"]
							: [
									", and he's fouled",
									", and the foul",
									" through contact, and the foul",
									"; and-one",
									", and the basket counts",
								],
					);
				}
			}
			text =
				t0 + (tail && meta.andOne ? `, ${tail.replace(/^,?\s*/, "")}` : tail);
			if (
				!heave &&
				lastAction &&
				(att?.clock ?? 99) <= 3 &&
				!/horn|buzzer/.test(text)
			) {
				text += pickV(rng, [
					" at the buzzer",
					" as the horn sounds",
					" just before the horn",
				]);
				ctx.wow = true;
			}
			text += ".";
		}

		// the assist's own stats, the team foul of an and-one
		if (meta.andOne && fouler) {
			this.teamFouls[o] += 1;
		}
		this.trip = meta.andOne
			? {
					shooter: p,
					n: 1,
					i: 0,
					m: 0,
					three: meta.three && !fake,
					andOne: true,
					intentional: false,
					bonus: false,
					fouler,
				}
			: null;
		if (meta.andOne && fouler) {
			const pf = (this.host.stat(fouler.pid)?.pf ?? 0) + 1;
			this.checkFoulTrouble(fouler, pf);
		}
		this.afterPlay("make", t, ctx);
		const margin = score[t] - pts - score[o];
		const res: FlavorResult = { text: "", ptype: ctx.ptype };
		const notes = this.scoreNotes(rng, {
			t,
			p,
			pts,
			margin,
			clock: ev.clock,
			wow: !!ctx.wow,
			future,
			three: meta.three,
			andOne: meta.andOne,
			ast,
			fg: true,
		});
		res.text = this.tally(text, ev, { p, ast });
		this.rememberFoul(ev);
		this.lastShot = undefined;
		res.text = this.leadIn(rng, res.text, t, ev, att, ctx);
		this.finishNotes(res, notes);
		return this.cleanResult(res, ctx);
	}

	private rememberFoul(_ev: any) {
		// (kept for symmetry with the other handlers; and-one fouls are counted in onMade)
	}

	private tipIn(rng: Rng, play: any, att: Attempt | undefined, made: boolean) {
		const n = play.p.name;
		const pass = att?.pidPass === undefined ? play.ast : this.pl(att.pidPass);
		const an = pass ? pass.name : "a teammate";
		const r = play.p.R;
		const dunk = r.dnk >= 60 && r.jmp >= 60;
		if (made) {
			return (
				pickV(rng, [
					`${n} cuts to the rim and ${dunk ? "flushes" : "tips in"} the inbound lob from ${an}`,
					`${an} lobs the inbound pass and ${n} ${dunk ? "slams it home" : "tips it in"}`,
					`${n} catches the lob off the inbound from ${an} and ${dunk ? "throws it down" : "finishes at the rim"}`,
				]) + "."
			);
		}
		return (
			pickV(rng, [
				`${n} cuts to the rim for the inbound lob from ${an} but can't get it to fall`,
				`${an} lobs the inbound pass, and ${n}'s tip-in attempt rolls off`,
				`${n} goes up for the inbound lob from ${an} and misses`,
			]) + "."
		);
	}

	private deepTwo(rng: Rng, play: any, made: boolean) {
		const n = play.p.name;
		return made
			? pickV(rng, [
					`${n} knocks down a deep two from way out`,
					`${n} hits a long jumper from beyond the old three-point line`,
					`${n} drains a deep shot from downtown`,
					`${n} pulls up from deep and hits`,
				]) + "."
			: pickV(rng, [
					`${n}'s deep shot is off the mark`,
					`${n} misses a long jumper from deep`,
					`${n}'s deep shot rims out`,
					`${n} throws up a deep one that falls short`,
				]) + ".";
	}

	private onMissOrBlock(
		rng: Rng,
		ev: any,
		meta: ShotMeta,
		blocked: boolean,
		score: [number, number],
		future: readonly any[] | undefined,
	): FlavorResult {
		const att = this.pending;
		this.pending = undefined;
		let shooter: FPlayer | undefined;
		if (blocked) {
			shooter = att
				? this.pl(att.pid)
				: this.lastReb
					? this.pl(this.lastReb.pid)
					: undefined;
		} else {
			shooter = this.pl(ev.pid);
		}
		const shotT: 0 | 1 = blocked ? (ev.t === 0 ? 1 : 0) : ev.t;
		const blocker = blocked ? this.pl(ev.pid) : undefined;
		const fake = att?.kind === "fake";
		const three = meta.three && !fake;
		const ctx = this.baseCtx(rng, shotT, att?.poss, shooter, ev);
		// a miss by the player who just rebounded is a putback attempt
		const play: any = {
			k: "fg",
			made: false,
			three,
			zone: fake ? "mid" : meta.zone,
			p: shooter ?? blocker,
			blk: blocker,
			ti: shotT,
		};
		const lastAction = this.endsPeriodNext(future);
		let text: string;
		let ptype: string | undefined;
		if (!shooter) {
			text = `${cap(pickV(rng, [`blocked by ${blocker!.name}`, `${blocker!.name} gets a hand on it`, `${blocker!.name} swats it away`]))}.`;
		} else if (
			!blocked &&
			three &&
			att?.desperation &&
			(att.clock ?? 99) <= 2.5 &&
			lastAction
		) {
			text = heaveText(rng, shooter, false);
			ptype = "heave";
		} else if (meta.tip) {
			text = this.tipIn(
				rng,
				{
					p: shooter,
					ast: att?.pidPass === undefined ? undefined : this.pl(att.pidPass),
				},
				att,
				false,
			);
			if (blocked) {
				text = `${shooter.name} cuts to the rim for the inbound lob; ${pickV(rng, [`blocked by ${blocker!.name}`, `${blocker!.name} swats it away`])}.`;
			}
		} else if (fake) {
			text = blocked
				? `${shooter.name} tries a deep shot; ${pickV(rng, [`blocked by ${blocker!.name}`, `${blocker!.name} gets a hand on it`])}.`
				: this.deepTwo(rng, play, false);
		} else {
			if (meta.putback && !blocked) {
				ctx.lastReb = { pid: shooter.pid, own: true };
			}
			const trans =
				!!ctx.trans && !(ctx.lastReb && ctx.lastReb.pid === shooter.pid);
			text =
				missText(rng, play, ctx) +
				(blocked ? `; ${blockText(rng, blocker, three, trans, ctx)}` : "") +
				".";
			ptype = ctx.ptype;
		}
		if (blocked && blocker) {
			this.lastShot = { p: shooter, three, blk: blocker, t: shotT };
		} else {
			this.lastShot = { p: shooter, three, t: shotT };
		}
		this.afterPlay("miss", shotT, ctx);
		if (shooter && !blocked) {
			// a miss ends his hot streak
			this.hot.set(shooter.pid, 0);
		}
		const notes: string[] = [];
		// a block by a big or a chase-down earns a reaction now and then
		if (
			blocked &&
			(ctx.wow || ctx.ptype === "chasedown") &&
			notes.length === 0 &&
			rng.random() < 0.45
		) {
			notes.push(crowdLine(rng, "wow", this.the(ev.t)));
		}
		this.ato = [false, false];
		const res: FlavorResult = { text: "", ptype: ptype ?? ctx.ptype };
		res.text = this.tally(text, ev, { p: shooter, blk: blocker });
		if (shooter && !blocked && !/heave|horn/.test(text)) {
			res.text = this.leadIn(rng, res.text, shotT, ev, att, ctx);
		}
		void score;
		this.finishNotes(res, notes);
		if (blocker) {
			this.milestoneNotes(res, [blocker]);
		}
		return this.cleanResult(res, ctx);
	}

	// ---- turnovers, steals ----
	private onTov(rng: Rng, ev: any, score: [number, number]): FlavorResult {
		const t: 0 | 1 = ev.t;
		const o: 0 | 1 = t === 0 ? 1 : 0;
		const p = this.pl(ev.pid);
		const ctx = this.baseCtx(rng, t, ev.poss, p, ev);
		const play: any = { k: "tov", p, ti: t };
		// a turnover after a very long possession is a shot-clock violation, if the shot clock was on (not at the end of a period, when the game
		// clock was under 24 seconds as the possession started)
		if (
			!ev.outOfBounds &&
			ev.poss !== undefined &&
			ev.poss >= 17 &&
			(typeof ev.clock !== "number" || ev.clock + ev.poss >= 24)
		) {
			play.shotClock = true;
		}
		const ds = this.floor(o);
		ctx.drawer =
			ds.length > 0 ? weighted(rng, ds, (q) => 0.5 + q.R.diq / 100) : null;
		ctx.offFoul = !ev.outOfBounds;
		ctx.offFoulW = 0.7;
		ctx.oob = !!ev.outOfBounds;
		ctx.trans = false;
		const s = tovText(rng, play, ctx);
		let text = `${s.charAt(0).toUpperCase()}${s.slice(1)}.`;
		if (ctx.chargeTaken && rng.random() < 0.12) {
			text += ` ${ctx.chargeTaken.name} takes a moment to get up after the contact.`;
		}
		this.afterPlay(ev.outOfBounds ? "dead" : "tov", t, ctx);
		this.lastShot = undefined;
		void score;
		const res: FlavorResult = {
			text: this.tally(text, ev, { p }),
			ptype: play.shotClock
				? "shotclock"
				: ctx.offFoulUsed
					? ctx.chargeTaken
						? "charge"
						: "offensive-foul"
					: undefined,
		};
		this.ato = [false, false];
		return this.cleanResult(res, ctx);
	}

	private onSteal(rng: Rng, ev: any, score: [number, number]): FlavorResult {
		const t: 0 | 1 = ev.t; // the stealer's team
		const o: 0 | 1 = t === 0 ? 1 : 0;
		const stealer = this.pl(ev.pid);
		const victim = this.pl(ev.pidTov);
		const ctx = this.baseCtx(rng, o, ev.poss, victim, ev);
		const play: any = { k: "tov", p: victim, stl: stealer, ti: o };
		ctx.oob = !!ev.outOfBounds;
		const s = tovText(rng, play, ctx);
		const text = `${s.charAt(0).toUpperCase()}${s.slice(1)}.`;
		this.afterPlay(ev.outOfBounds ? "dead" : "steal", o, ctx);
		if (!ev.outOfBounds) {
			this.stealer = stealer.pid;
		}
		this.lastShot = undefined;
		void score;
		const res: FlavorResult = {
			text: this.tally(text, ev, { p: victim, stl: stealer }),
			ptype: "steal",
		};
		const notes: string[] = [];
		this.ato = [false, false];
		this.finishNotes(res, notes);
		this.milestoneNotes(res, [stealer]);
		return this.cleanResult(res, ctx);
	}

	// ---- rebounds ----
	private onRebound(rng: Rng, ev: any): FlavorResult {
		const p = this.pl(ev.pid);
		const off = ev.type === "orb";
		const ls = this.lastShot;
		const ownBlock = off && !!ls?.blk && ls.p?.pid === p.pid;
		let text: string;
		if (ls?.ft && !ls.blk && rng.random() < 0.35) {
			text = off
				? pickV(rng, [
						`${p.name} gets the offensive rebound off the missed free throw`,
						`${p.name} fights for the rebound after the miss at the line and keeps it alive`,
					])
				: pickV(rng, [
						`${p.name} grabs the rebound off the missed free throw`,
						`${p.name} collects the miss at the line`,
					]);
		} else {
			text = rebText(rng, p, off, !!ls?.three, ownBlock, ls?.blk);
		}
		text = `${cap(text)}.`;
		const t: 0 | 1 = ev.t;
		if (off) {
			this.lastReb = { pid: p.pid, own: ls?.p?.pid === p.pid, t };
			this.startKind = "orb";
			this.defReb = undefined;
		} else {
			this.defReb = p.pid;
			this.lastReb = undefined;
			this.startKind = "drb";
		}
		this.stealer = undefined;
		this.lastShot = undefined;
		this.trip = null;
		const res: FlavorResult = { text: this.tally(text, ev, { p }) };
		this.milestoneNotes(res, [p]);
		this.ato = [false, false];
		return this.cleanResult(res, {});
	}

	// ---- fouls and free throws ----
	private checkFoulTrouble(f: FPlayer, pf: number) {
		const firstHalf = this.period <= Math.floor(this.numPeriods / 2);
		if (pf >= 5 || (pf >= 3 && firstHalf)) {
			this.foulTrouble.add(f.pid);
		}
	}

	private isIntentional(
		fouledT: 0 | 1,
		score: [number, number],
		clock: number,
	) {
		const margin = score[fouledT] - score[fouledT === 0 ? 1 : 0];
		return (
			this.finalPeriod() &&
			Number.isFinite(clock) &&
			clock <= 27 &&
			margin >= 1 &&
			margin <= 6
		);
	}

	private onFoul(rng: Rng, ev: any, score: [number, number]): FlavorResult {
		const f = this.pl(ev.pid);
		const defT: 0 | 1 = ev.t;
		const offT: 0 | 1 = defT === 0 ? 1 : 0;
		this.teamFouls[defT] += 1;
		const pf = this.host.stat(f.pid)?.pf ?? 0;
		this.checkFoulTrouble(f, pf);
		const tag = `P${pf}, team foul ${this.teamFouls[defT]}`;
		let text: string;
		this.startKind = "dead";
		this.lastReb = undefined;
		this.defReb = undefined;
		this.stealer = undefined;
		this.lastShot = undefined;
		this.pending = undefined;
		if (ev.type === "pfNonShooting") {
			const intentional = this.isIntentional(offT, score, ev.clock);
			text = nonShootingFoul(rng, f, tag, this.the(offT), {
				intentional,
				bonus: false,
			});
			this.trip = null;
		} else if (ev.type === "pfBonus") {
			const shooter = this.pl(ev.pidShooting);
			const intentional = this.isIntentional(offT, score, ev.clock);
			text = nonShootingFoul(rng, f, tag, this.the(offT), {
				intentional,
				shooter,
				bonus: true,
				teamPenalty: this.the(defT),
			});
			this.trip = {
				shooter,
				n: 2,
				i: 0,
				m: 0,
				three: false,
				andOne: false,
				intentional,
				bonus: true,
				fouler: f,
			};
		} else {
			const shooter = this.pl(ev.pidShooting);
			const three = ev.type === "pfTP";
			text = shootingFoul(rng, shooter, f, tag, three, three ? 3 : 2);
			this.trip = {
				shooter,
				n: three ? 3 : 2,
				i: 0,
				m: 0,
				three,
				andOne: false,
				intentional: false,
				bonus: false,
				fouler: f,
			};
		}
		this.ato = [false, false];
		const res: FlavorResult = { text };
		const notes: string[] = [];
		if (
			pf >= 5 ||
			(pf >= 3 &&
				this.period <= Math.floor(this.numPeriods / 2) &&
				!this.fouledOut.has(f.pid))
		) {
			if (pf >= 3 && !this.fouledOut.has(f.pid) && rng.random() < 0.55) {
				notes.push(
					pickV(rng, [
						`That's foul number ${pf} on ${f.name}.`,
						`${f.name} is in foul trouble with ${pf}.`,
					]),
				);
			}
		}
		this.finishNotes(res, notes);
		return this.cleanResult(res, {});
	}

	private onFt(
		rng: Rng,
		ev: any,
		dPts: [number, number],
		score: [number, number],
		future: readonly any[] | undefined,
	): FlavorResult {
		const made = ev.type === "ft";
		const p = this.pl(ev.pid);
		const t: 0 | 1 = ev.t;
		const o: 0 | 1 = t === 0 ? 1 : 0;
		const margin = score[t] - (dPts[t] || 0) - score[o];
		const late =
			this.finalPeriod() && (ev.clock ?? 999) <= 120 && Math.abs(margin) <= 5;
		const trip =
			this.trip && this.trip.shooter.pid === p.pid ? this.trip : null;
		const text = freeThrow(rng, trip, p, made, {
			late,
			makesBefore: trip?.m ?? 0,
		});
		let lastOfTrip = true;
		if (trip) {
			trip.i += 1;
			if (made) {
				trip.m += 1;
			}
			lastOfTrip = trip.i >= trip.n;
			if (lastOfTrip) {
				this.trip = null;
			}
		}
		const keepBall = !!trip?.keepBall;
		if (made && lastOfTrip && !keepBall) {
			this.startKind = "make";
		} else if (lastOfTrip) {
			this.startKind = "dead";
		}
		this.lastShot =
			lastOfTrip && !made && !keepBall
				? { p, three: false, ft: true, t }
				: undefined;
		const res: FlavorResult = { text: "" };
		const notes = made
			? this.scoreNotes(rng, {
					t,
					p,
					pts: 1,
					margin,
					clock: ev.clock,
					wow: false,
					future,
					three: false,
					andOne: false,
					ast: undefined,
					fg: false,
				})
			: [];
		res.text = this.tally(text, ev, { p });
		this.finishNotes(res, notes);
		this.ato = [false, false];
		return this.cleanResult(res, {});
	}

	// ---- technical and flagrant fouls, ejections ----
	private onTechFoul(
		rng: Rng,
		ev: any,
		future: readonly any[] | undefined,
	): FlavorResult {
		const t: 0 | 1 = ev.t;
		const p = ev.pid === undefined ? undefined : this.pl(ev.pid);
		let shooter: FPlayer | undefined;
		for (const f of future ?? []) {
			if ((f.type === "ft" || f.type === "missFt") && f.tech) {
				shooter = this.pl(f.pid);
				break;
			}
			if (!isStatEvent(f) && f.type !== "ejection" && f.type !== "sub") {
				break;
			}
		}
		const text = technicalFoul(rng, p, this.the(t), ev.num ?? 1, {
			afterDunk: this.lastDunk,
			afterFoul:
				this.lastType !== undefined &&
				(this.lastType.startsWith("pf") || this.lastType === "missFt"),
			shooter,
		});
		this.ato = [false, false];
		return { text, ptype: "technical" };
	}

	private onTechFt(
		rng: Rng,
		ev: any,
		dPts: [number, number],
		score: [number, number],
		future: readonly any[] | undefined,
	): FlavorResult {
		const made = ev.type === "ft";
		const p = this.pl(ev.pid);
		const t: 0 | 1 = ev.t;
		const o: 0 | 1 = t === 0 ? 1 : 0;
		const margin = score[t] - (dPts[t] || 0) - score[o];
		const res: FlavorResult = { text: "" };
		const notes = made
			? this.scoreNotes(rng, {
					t,
					p,
					pts: 1,
					margin,
					clock: ev.clock,
					wow: false,
					future,
					three: false,
					andOne: false,
					ast: undefined,
					fg: false,
				})
			: [];
		res.text = this.tally(technicalFreeThrow(rng, p, made), ev, { p });
		this.finishNotes(res, notes);
		return this.cleanResult(res, {});
	}

	private onFlagrant(rng: Rng, ev: any): FlavorResult {
		const f = this.pl(ev.pid);
		const shooter = this.pl(ev.pidShooting);
		const defT: 0 | 1 = ev.t;
		const offT: 0 | 1 = defT === 0 ? 1 : 0;
		this.teamFouls[defT] += 1;
		const pf = this.host.stat(f.pid)?.pf ?? 0;
		this.checkFoulTrouble(f, pf);
		const tag = `P${pf}, team foul ${this.teamFouls[defT]}`;
		const level: 1 | 2 = ev.level === 2 ? 2 : 1;
		this.startKind = "dead";
		this.lastReb = undefined;
		this.defReb = undefined;
		this.stealer = undefined;
		this.lastShot = undefined;
		this.pending = undefined;
		this.trip = {
			shooter,
			n: 2,
			i: 0,
			m: 0,
			three: false,
			andOne: false,
			intentional: false,
			bonus: false,
			fouler: f,
			keepBall: true,
		};
		this.ato = [false, false];
		return {
			text: flagrantFoul(rng, f, shooter, tag, level, this.the(offT)),
			danger: level === 2,
			ptype: level === 2 ? "flagrant2" : "flagrant1",
		};
	}

	private onEjection(rng: Rng, ev: any): FlavorResult {
		const p = ev.pid === undefined ? undefined : this.pl(ev.pid);
		if (p) {
			this.ejected.add(p.pid);
		}
		return {
			text: ejectionText(rng, p, this.the(ev.t), ev.reason),
			danger: true,
			ptype: "ejection",
		};
	}

	// ---- substitutions, timeouts, the rest ----
	private onSub(rng: Rng, ev: any): FlavorResult {
		const on: number[] = ev.pids ?? [];
		const off: number[] = ev.pidsOff ?? [];
		const pairs = on.map((pid, i): [FPlayer, FPlayer | undefined] => [
			this.pl(pid),
			off[i] === undefined ? undefined : this.pl(off[i]),
		]);
		const text = substitution(rng, this.the(ev.t), pairs, {
			foulTrouble: this.foulTrouble,
			injured: this.injured,
			fouledOut: this.fouledOut,
			ejected: this.ejected,
		});
		for (const pid of off) {
			this.foulTrouble.delete(pid);
		}
		return { text };
	}

	private onTimeout(rng: Rng, ev: any, score: [number, number]): FlavorResult {
		const t: 0 | 1 = ev.t;
		const o: 0 | 1 = t === 0 ? 1 : 0;
		const opts: Parameters<typeof timeoutText>[3] = {
			advancesBall: !!ev.advancesBall,
		};
		if (this.run.t === o && this.run.S >= 8) {
			opts.runBy = { team: this.the(o), label: `${this.run.S}-${this.run.O}` };
		} else if (this.period >= this.numPeriods - 1 && (ev.clock ?? 999) <= 60) {
			const margin = score[o] - score[t];
			if (margin >= 1 && margin <= 3) {
				opts.down = { margin, clock: clockOf(ev.clock) };
			} else if (margin === 0) {
				opts.lateTie = true;
			}
		}
		this.ato[t] = true;
		this.startKind = "dead";
		this.pending = undefined;
		this.lastShot = undefined;
		this.lastReb = undefined;
		this.stealer = undefined;
		return { text: timeoutText(rng, this.the(t), ev.numLeft ?? 0, opts) };
	}

	private onEndOfPeriod(rng: Rng, ev: any): FlavorResult {
		const t: 0 | 1 = ev.t;
		let sh: FPlayer | undefined;
		if (ev.reason === "noShot") {
			const ps = this.floor(t);
			sh =
				ps.length > 0
					? (weighted(
							rng,
							ps,
							(p) => 0.5 + p.R.fg / 100 + p.R.tp / 100 + p.R.drb / 200,
						) ?? undefined)
					: undefined;
		}
		return { text: endOfPeriod(rng, ev.reason, this.the(t), sh) };
	}

	private onOutOfBounds(rng: Rng, ev: any): FlavorResult {
		const touched: 0 | 1 = ev.t;
		const other: 0 | 1 = touched === 0 ? 1 : 0;
		const prev: "shot" | "block" | "other" = this.lastShot
			? this.lastShot.blk
				? "block"
				: "shot"
			: "other";
		const defT: 0 | 1 = ev.on === "defense" ? touched : other;
		const offT: 0 | 1 = defT === 0 ? 1 : 0;
		const fo = this.floor(offT);
		const fd = this.floor(defT);
		const text = outOfBounds(rng, {
			on: ev.on,
			prev,
			teamOn: this.the(touched),
			other: this.the(other),
			a: fo.length > 0 ? rng.pick(fo) : undefined,
			d:
				fd.length > 0
					? (weighted(rng, fd, (p) => 0.6 + p.R.diq / 100) ?? undefined)
					: undefined,
			blocker: this.lastShot?.blk,
		});
		const keeps = other;
		void keeps;
		this.lastShot = undefined;
		this.startKind = "dead";
		this.lastReb = undefined;
		this.defReb = undefined;
		return { text };
	}

	// ---- state kept after a play ----
	private afterPlay(
		kind: StartKind | "miss" | "dead" | "make",
		t: 0 | 1,
		ctx: any,
	) {
		void t;
		void ctx;
		if (kind === "miss") {
			// a rebound comes next: possession state is set there
			this.stealer = undefined;
			this.lastReb = undefined;
			this.defReb = undefined;
			return;
		}
		this.startKind = kind as StartKind;
		this.lastReb = undefined;
		this.defReb = undefined;
		if (kind !== "steal") {
			this.stealer = undefined;
		}
	}

	// ---- lead-ins: out of a timeout, two-for-one, holding for the last shot ----
	private leadIn(
		rng: Rng,
		text: string,
		t: 0 | 1,
		ev: any,
		att: Attempt | undefined,
		ctx: any,
	) {
		const lead = (w: string) => {
			const names = [...this.players.values()].some((p) =>
				text.startsWith(p.name),
			);
			return (
				w +
				(names || /^[A-Z][a-z]+ [A-Z]/.test(text)
					? text
					: text.charAt(0).toLowerCase() + text.slice(1))
			);
		};
		const clock = att?.clock ?? ev.clock;
		const poss = att?.poss;
		if (this.ato[t]) {
			this.ato[t] = false;
			return lead("Out of the timeout: ");
		}
		if (
			!this.twoForOne &&
			Number.isFinite(clock) &&
			clock >= 28 &&
			clock <= 40 &&
			!ctx.trans &&
			rng.random() < 0.3
		) {
			this.twoForOne = true;
			return lead("Going for the two-for-one, ");
		}
		if (
			!this.lastShotSaid &&
			Number.isFinite(clock) &&
			clock > 2 &&
			clock <= 14 &&
			(poss ?? 0) >= 10 &&
			!ctx.trans &&
			rng.random() < 0.6
		) {
			const sc = this.host.score();
			const o: 0 | 1 = t === 0 ? 1 : 0;
			if (!(this.finalPeriod() && sc[t] < sc[o]) && !/horn|buzzer/.test(text)) {
				this.lastShotSaid = true;
				return lead("Holding for the last shot, ");
			}
		}
		return text;
	}

	// ---- notes after a scoring play: milestones, runs, momentum, lead changes, the crowd ----
	private scoreNotes(
		rng: Rng,
		o: {
			t: 0 | 1;
			p: FPlayer;
			pts: number;
			margin: number;
			clock: number | undefined;
			wow: boolean;
			future: readonly any[] | undefined;
			three: boolean;
			andOne: boolean;
			ast: FPlayer | undefined;
			fg: boolean;
		},
	): string[] {
		const { t, p, pts } = o;
		const opp: 0 | 1 = t === 0 ? 1 : 0;
		const out: string[] = [];
		const clutch: string[] = [];
		const score = this.host.score();
		const marginAfter = score[t] - score[opp];
		const abs = this.abs(o.clock);

		// ---- the run, tracked from every basket and free throw ----
		const run = this.run;
		let ended = "";
		if (run.t === t) {
			run.S += pts;
		} else if (run.t === opp) {
			run.O += pts;
			// the other side scored too much: that run is over
			if (run.O > 4 || run.O * 3 > run.S) {
				if (run.said > 0) {
					ended = `That ends ${run.S >= 11 && /^(8|11|18)/.test(String(run.S)) ? "an" : "a"} ${run.S}-${run.O - pts} run by ${this.the(opp)}.`;
				}
				run.t = t;
				run.S = pts;
				run.O = 0;
				run.said = 0;
			}
		} else {
			run.t = t;
			run.S = pts;
			run.O = 0;
			run.said = 0;
		}
		let runNote = "";
		if (run.t === t && run.S >= 10 && run.S >= run.said + 4 && !o.andOne) {
			run.said = run.S;
			runNote = pickV(rng, [
				`That's ${/^(8|11|18)/.test(String(run.S)) ? "an" : "a"} ${run.S}-${run.O} run for ${this.the(t)}.`,
				`${cap(this.the(t))} have ${run.S} of the last ${run.S + run.O} points.`,
			]);
		}

		// ---- the player's streak ----
		const st = this.streak[t];
		if (st.pid === p.pid) {
			st.pts += pts;
		} else {
			st.pid = p.pid;
			st.pts = pts;
			st.said = false;
		}
		this.streak[opp].pid = undefined;
		let streakNote = "";
		if (st.pts >= 8 && !st.said) {
			st.said = true;
			streakNote = `${p.name} has scored ${st.pts} straight for ${this.the(t)}.`;
		}

		// ---- a drought that just ended ----
		let droughtNote = "";
		const last = this.lastScoreAbs[t];
		if (abs !== undefined) {
			if (last !== undefined && abs - last >= 180) {
				const d = clockOf(abs - last);
				droughtNote = `That ends ${/^(8|11|18)\b/.test(d) ? "an" : "a"} ${d} drought for ${this.the(t)}.`;
			}
			this.lastScoreAbs[t] = abs;
		}

		// ---- the hot hand ----
		let hotNote = "";
		if (o.fg) {
			const h = (this.hot.get(p.pid) ?? 0) + 1;
			this.hot.set(p.pid, h);
			if (h >= 4 && !this.hotSaid.has(p.pid)) {
				this.hotSaid.add(p.pid);
				hotNote = `${p.name} is heating up: ${h} straight makes.`;
			}
		}

		// ---- ten in a quarter ----
		let tenNote = "";
		const qp = (this.qPts.get(p.pid) ?? 0) + pts;
		this.qPts.set(p.pid, qp);
		if (qp >= 10 && qp - pts < 10 && rng.random() < 0.6) {
			const per = this.numPeriods === 2 ? "half" : "quarter";
			tenNote = pickV(rng, [
				`That's 10 in the ${this.period > this.numPeriods ? "period" : per} for ${p.name}.`,
				`${p.name} has 10 in the ${this.period > this.numPeriods ? "period" : per} already.`,
			]);
		}

		// ---- the finish: game-winners and forcing overtime, from what the sim goes on to log ----
		if (
			this.finalPeriod() &&
			o.future &&
			Number.isFinite(o.clock ?? Number.NaN)
		) {
			const ahead = this.pointsAhead(o.future, true);
			let diff = marginAfter;
			let minDiff = diff;
			for (const f of ahead.events) {
				diff += f.t === t ? f.amt : -f.amt;
				minDiff = Math.min(minDiff, diff);
			}
			const noMoreScoring = ahead.events.length === 0;
			const marginBefore = marginAfter - pts;
			const secs = Math.max(0, o.clock ?? 0);
			const when =
				secs < 1
					? " at the buzzer"
					: secs <= 10
						? ` with ${Math.round(secs * 10) / 10} seconds left`
						: "";
			if (
				ahead.sawOvertime &&
				marginAfter === 0 &&
				noMoreScoring &&
				secs <= 15 &&
				this.period === this.numPeriods
			) {
				clutch.push(
					pickV(rng, [
						`${p.name} ties it${when} to force overtime.`,
						`That sends it to overtime${when}.`,
					]),
				);
			} else if (
				!ahead.sawOvertime &&
				marginBefore <= 0 &&
				marginAfter > 0 &&
				minDiff > 0 &&
				!o.andOne
			) {
				clutch.push(
					secs <= 10
						? pickV(rng, [
								`${p.name} has the game-winner${when}!`,
								`That's the game-winner${when}.`,
							])
						: `That puts ${this.the(t)} ahead for good.`,
				);
			} else if (
				!ahead.sawOvertime &&
				marginBefore <= 0 &&
				marginAfter > 0 &&
				minDiff > 0 &&
				o.andOne
			) {
				clutch.push(
					`That puts ${this.the(t)} ahead for good, and there's a free throw coming.`,
				);
			}
		}

		// ---- the lead changes hands in a close finish ----
		let leadNote = "";
		const marginBefore = marginAfter - pts;
		if (
			this.finalPeriod() &&
			(o.clock ?? 999) <= 300 &&
			!o.andOne &&
			clutch.length === 0
		) {
			if (marginBefore <= 0 && marginAfter > 0) {
				leadNote =
					marginBefore === 0
						? `${cap(this.the(t))} take the lead.`
						: `${cap(this.the(t))} go back in front, ${score[t]}-${score[opp]}.`;
			} else if (marginAfter === 0 && marginBefore < 0) {
				leadNote = `That ties it at ${score[t]}.`;
			}
		}

		// ---- the crowd and the bench, now and then ----
		let crowdNote = "";
		const late =
			this.finalPeriod() &&
			(o.clock ?? 999) <= 120 &&
			Math.abs(marginAfter) <= 3;
		if (o.wow && rng.random() < 0.45) {
			crowdNote = crowdLine(rng, "wow", this.the(t));
		} else if (o.fg && late && this.crowdN < 2 && rng.random() < 0.3) {
			this.crowdN += 1;
			crowdNote = crowdLine(rng, "tight", this.the(t));
		}

		if (ended) {
			out.push(ended);
		}
		out.push(...clutch);
		const mil = this.milestones([p, o.ast].filter((x): x is FPlayer => !!x));
		out.push(...mil);
		for (const n of [
			runNote,
			leadNote,
			streakNote,
			droughtNote,
			hotNote,
			tenNote,
			crowdNote,
		]) {
			if (n && out.length < 2) {
				out.push(n);
			}
		}
		return out.slice(0, 2);
	}

	private milestones(ps: FPlayer[]): string[] {
		const notes: string[] = [];
		for (const p of ps) {
			const st = this.host.stat(p.pid);
			if (!st) {
				continue;
			}
			const before = this.seen.get(p.pid) ?? {
				PTS: 0,
				REB: 0,
				AST: 0,
				STL: 0,
				BLK: 0,
				dd: false,
				td: false,
			};
			const now = {
				PTS: st.pts,
				REB: st.trb,
				AST: st.ast,
				STL: st.stl,
				BLK: st.blk,
			};
			const last =
				p.name
					.split(" ")
					.filter((w) => !/^(Jr\.?|Sr\.?|II|III|IV)$/.test(w))
					.pop() ?? p.name;
			const firstHalf =
				this.numPeriods >= 4 && this.period <= this.numPeriods / 2;
			const nameIdx =
				[...this.players.values()].filter(
					(q) => q.name.split(" ").pop() === last,
				).length > 1;
			const short = nameIdx ? p.name : last;
			let said = false;
			for (const m of [30, 40, 50, 60]) {
				if (before.PTS < m && now.PTS >= m) {
					notes.push(`That's ${m} for ${short}.`);
					said = true;
				}
			}
			const tens = [now.PTS, now.REB, now.AST, now.STL, now.BLK].filter(
				(v) => v >= 10,
			).length;
			const nextState = { ...now, dd: before.dd, td: before.td };
			if (tens >= 3 && !before.td) {
				nextState.td = true;
				nextState.dd = true;
				notes.push(`That's a triple-double for ${p.name}.`);
			} else if (tens >= 2 && !before.dd) {
				nextState.dd = true;
				notes.push(`Double-double for ${p.name}.`);
			} else if (!said && firstHalf && before.PTS < 20 && now.PTS >= 20) {
				notes.push(
					p.pid % 2 === 0
						? `${short} already has 20, and it's still the first half.`
						: `20 points before halftime for ${short}.`,
				);
			} else if (before.BLK < 5 && now.BLK >= 5) {
				notes.push(
					p.pid % 2 === 0
						? `That's 5 blocks for ${short}.`
						: `${short} is protecting the rim: 5 blocks now.`,
				);
			} else if (before.STL < 5 && now.STL >= 5) {
				notes.push(
					p.pid % 2 === 0
						? `That's 5 steals for ${short}.`
						: `${short} has 5 steals already.`,
				);
			} else if (before.AST < 10 && now.AST >= 10 && notes.length === 0) {
				notes.push(
					p.pid % 2 === 0
						? `That's 10 assists for ${short}.`
						: `${short} reaches double figures in assists.`,
				);
			}
			this.seen.set(p.pid, nextState);
		}
		return notes;
	}

	private milestoneNotes(res: FlavorResult, ps: FPlayer[]) {
		const m = this.milestones(ps);
		if (m.length > 0) {
			res.note = [res.note, ...m].filter(Boolean).join(" ");
		}
	}

	private finishNotes(res: FlavorResult, notes: string[]) {
		if (notes.length > 0) {
			res.note = notes.join(" ");
		}
	}

	// ---- running totals after each name: "Jalen Jackson makes a jumper (27 PTS) ... from Chris Norton (8 AST)" ----
	private tally(
		text: string,
		ev: any,
		o: { p?: FPlayer; ast?: FPlayer; blk?: FPlayer; stl?: FPlayer },
	) {
		const at = (s: string, i: number, name: string, label: string) => {
			if (i < 0) {
				return s;
			}
			let j = i + name.length;
			if (s.startsWith("'s ", j)) {
				const m = /^'s [A-Za-z-]+/.exec(s.slice(j));
				j += m ? m[0].length : 2;
			} else if (s.startsWith("' ", j)) {
				const m = /^' [A-Za-z-]+/.exec(s.slice(j));
				j += m ? m[0].length : 1;
			}
			return `${s.slice(0, j)} (${label})${s.slice(j)}`;
		};
		const first = (s: string, name: string, label: string) =>
			at(s, s.indexOf(name), name, label);
		const lastOf = (s: string, name: string, label: string) =>
			at(s, s.lastIndexOf(name), name, label);
		const stat = (p: FPlayer | undefined) =>
			p ? this.host.stat(p.pid) : undefined;
		let s = text;
		const type: string = ev.type;
		if (MADE[type] && o.p) {
			const ps = stat(o.p);
			if (o.ast) {
				const a = stat(o.ast);
				if (a) {
					s = lastOf(s, o.ast.name, `${a.ast} ${TALLY_LABEL.AST}`);
				}
			}
			if (ps) {
				s = first(s, o.p.name, `${ps.pts} ${TALLY_LABEL.PTS}`);
			}
		} else if (type.startsWith("blk") && o.blk) {
			const b = stat(o.blk);
			if (b) {
				s = lastOf(s, o.blk.name, `${b.blk} ${TALLY_LABEL.BLK}`);
			}
		} else if (type === "ft" && o.p) {
			const ps = stat(o.p);
			if (ps) {
				s = first(s, o.p.name, `${ps.pts} ${TALLY_LABEL.PTS}`);
			}
		} else if ((type === "orb" || type === "drb") && o.p) {
			const ps = stat(o.p);
			if (ps) {
				s = first(s, o.p.name, `${ps.trb} ${TALLY_LABEL.REB}`);
			}
		} else if (type === "tov" && o.p) {
			const ps = stat(o.p);
			if (ps) {
				s = lastOf(s, o.p.name, `${ps.tov} ${TALLY_LABEL.TOV}`);
			}
		} else if (type === "stl") {
			if (o.stl) {
				const sp = stat(o.stl);
				if (sp) {
					s = first(s, o.stl.name, `${sp.stl} ${TALLY_LABEL.STL}`);
				}
			}
			if (o.p) {
				const ps = stat(o.p);
				if (ps) {
					s = lastOf(s, o.p.name, `${ps.tov} ${TALLY_LABEL.TOV}`);
				}
			}
		}
		return s;
	}

	// ---- final cleanup of a line: doubled punctuation, "s's", pronouns for women's leagues, anything that must never show ----
	private cleanText(s: string): string {
		let t = s
			.replaceAll(/(?<!\.)\.\.(?=\s|$)/g, ".")
			.replaceAll(/\.([,;]) /g, ".$1 ")
			.replaceAll(/\s+([!,.:;])/g, "$1")
			.replaceAll(/ {2,}/g, " ")
			.replaceAll(/\b([A-Z][\w.À-ɏ-]*s)'s\b/g, "$1'")
			.replaceAll(
				/\b(the|a|an|and|to|of|in|on|for|his|her|he|she|it|is|at|by) \1\b/gi,
				"$1",
			)
			.trim();
		if (this.female) {
			t = t
				.replaceAll(/\bhimself\b/g, "herself")
				.replaceAll(/\bhim\b/g, "her")
				.replaceAll(/\bhis\b/g, "her")
				.replaceAll(/\bHe's\b/g, "She's")
				.replaceAll(/\bhe's\b/g, "she's")
				.replaceAll(/\bHe\b/g, "She")
				.replaceAll(/\bhe\b/g, "she");
		}
		return t;
	}

	private cleanResult(res: FlavorResult, ctx: any): FlavorResult {
		const text = this.cleanText(res.text);
		const note = res.note ? this.cleanText(res.note) : undefined;
		const bad = /undefined|NaN|\[object|null\b/;
		const out: FlavorResult = { ...res, text, note };
		if (bad.test(text) || (note && bad.test(note))) {
			out.text =
				text.replaceAll(/\s*\(?(undefined|NaN|null)\)?/g, "").trim() ||
				"Play continues.";
			out.note = undefined;
		}
		if (ctx && ctx.wow) {
			// (carried for tests; the UI does not use it)
		}
		this.lastPtype = out.ptype;
		return out;
	}

	// For tests: the last kind of play worded
	lastKind() {
		return this.lastPtype;
	}
}

export const hasText = (
	r: FlavorResult | "silent" | undefined,
): r is FlavorResult => r !== undefined && r !== "silent";
export { isStructural };
void possessive;
