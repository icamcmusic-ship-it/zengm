// Top plays of a game (League extras: Best Games & Top Plays, basketball). Ported from League Explorer's topplays.js and
// pbp-analysis.js (runs), but read from the sim's own stored events (game.pbp, see pbpFlavor/store.ts) and worded by the
// play-by-play flavor layer, so a play reads like it did live. When a game has no stored play-by-play, its clutch plays
// (game.clutchPlays: game-winners, shots to force overtime, defensive stops, recorded by the sim) are the plays.
// Pure and deterministic.
import { formatClock } from "../formatClock.ts";
import { FlavorSession, playersFromInitEvent } from "../pbpFlavor/index.ts";
import type { FlavorHost, FlavorStat } from "../pbpFlavor/index.ts";
import { clutchText } from "../hype/util.ts";

export type TopPlayKind =
	| "winner"
	| "buzzer"
	| "goAhead"
	| "tying"
	| "dagger"
	| "stop"
	| "poster"
	| "oop"
	| "dunk"
	| "block"
	| "steal"
	| "run"
	| "deep"
	| "andOne"
	| "putback"
	| "fastBreak"
	| "shotClock"
	| "chaseDown"
	| "ankles"
	| "euroStep"
	| "spinMove"
	| "charge"
	| "hustle"
	| "clutch";

export const TOP_PLAY_LABELS: Record<TopPlayKind, string> = {
	winner: "Game-winner",
	buzzer: "Buzzer-beater",
	goAhead: "Go-ahead",
	tying: "Tying shot",
	dagger: "Dagger",
	stop: "Defensive stop",
	poster: "Poster",
	oop: "Alley-oop",
	dunk: "Dunk",
	block: "Block",
	steal: "Steal",
	run: "Run capper",
	deep: "Deep shot",
	andOne: "And-one",
	putback: "Putback",
	fastBreak: "Fast break",
	shotClock: "Shot-clock beater",
	chaseDown: "Chase-down block",
	ankles: "Ankle-breaker",
	euroStep: "Euro step",
	spinMove: "Spin move",
	charge: "Charge taken",
	hustle: "Hustle play",
	clutch: "Clutch",
};

// Which tag names a play (the strongest one)
const ORDER: TopPlayKind[] = [
	"winner",
	"buzzer",
	"stop",
	"goAhead",
	"tying",
	"dagger",
	"poster",
	"oop",
	"chaseDown",
	"ankles",
	"block",
	"dunk",
	"run",
	"euroStep",
	"spinMove",
	"deep",
	"andOne",
	"putback",
	"fastBreak",
	"shotClock",
	"charge",
	"hustle",
	"steal",
	"clutch",
];

export type TopPlay = {
	gid: number;
	season: number;
	kind: TopPlayKind;
	label: string;
	tags: string[];
	score: number;
	// Plain text, with players as [[p:pid|name]] tokens for clutch plays
	text: string;
	pid?: number;
	// Team index (0 = home) of the team that made the play
	t?: 0 | 1;
	period?: number;
	clock?: string;
	// Score after the play [home, away]
	after?: [number, number];
	source: "pbp" | "clutch";
	// Home and away team ids, filled in by the worker
	tids?: [number, number];
};

export type GameForPlays = {
	gid: number;
	season: number;
	numPeriods?: number;
	quarterLength?: number;
	female?: boolean;
	teams: [GameTeamForPlays, GameTeamForPlays];
	clutchPlays?: string[];
};

type GameTeamForPlays = {
	name: string;
	abbrev: string;
	pts: number;
	players: { pid: number; name: string; pos?: string }[];
};

const WORDS: [TopPlayKind, number, RegExp][] = [
	[
		"poster",
		6,
		/\bposter|(?:dunk|slam|jam|flush)\w* (?:it )?(?:right )?over\b|throws it down over|hammers? it home over|on top of/,
	],
	["oop", 4.5, /alley-?oop|\blob(?! into the post)|lobs? it up/],
	[
		"dunk",
		3,
		/\bdunk|\bslam|\bjam\b|throws (?:it )?down|flush|hammers? (?:it )?home|tomahawk|windmill/,
	],
	["deep", 1.5, /half-?court|from the logo|from way downtown|30 feet|heave/],
];

const MADE = new Set([
	"fgAtRim",
	"fgAtRimAndOne",
	"fgMidRange",
	"fgMidRangeAndOne",
	"fgLowPost",
	"fgLowPostAndOne",
	"tp",
	"tpAndOne",
	"fgTipIn",
	"fgTipInAndOne",
	"fgPutBack",
	"fgPutBackAndOne",
]);
const BLOCK = new Set([
	"blkAtRim",
	"blkLowPost",
	"blkMidRange",
	"blkTp",
	"blkTipIn",
	"blkPutBack",
]);

type Pending = Omit<TopPlay, "kind" | "label" | "tags" | "score"> & {
	tags: Map<TopPlayKind, number>;
	last: boolean;
	close: boolean;
	idx: number;
};

const finish = (p: Pending): TopPlay | undefined => {
	if (p.tags.size === 0) {
		return undefined;
	}
	let score = 0;
	for (const v of p.tags.values()) {
		score += v;
	}
	// A highlight in a close fourth quarter or overtime counts for a little more
	if (p.last && p.close) {
		score *= 1.15;
	}
	const kind = ORDER.find((k) => p.tags.has(k))!;
	const { tags, last, close, idx, ...rest } = p;
	void last;
	void close;
	void idx;
	return {
		...rest,
		kind,
		label: TOP_PLAY_LABELS[kind],
		tags: ORDER.filter((k) => tags.has(k) && k !== kind).map(
			(k) => TOP_PLAY_LABELS[k],
		),
		score: Math.round(score * 10) / 10,
	};
};

// Plays from the stored play-by-play events (decoded, see decodePlayByPlay) and their init event
export const playsFromPbp = (
	game: GameForPlays,
	initEvent: unknown,
	events: readonly any[],
): TopPlay[] => {
	const numPeriods = game.numPeriods ?? 4;
	const session = new FlavorSession({
		gid: game.gid,
		numPeriods,
		quarterLength: game.quarterLength ?? 12,
		female: !!game.female,
		noArticle: false,
		teams: [
			{ name: game.teams[0].name, abbrev: game.teams[0].abbrev },
			{ name: game.teams[1].name, abbrev: game.teams[1].abbrev },
		],
		players: playersFromInitEvent(initEvent),
	});
	const score: [number, number] = [0, 0];
	const stats = new Map<number, FlavorStat>();
	const onCourt: [Set<number>, Set<number>] = [new Set(), new Set()];
	const host: FlavorHost = {
		stat: (pid) => stats.get(pid),
		score: () => [score[0], score[1]],
		onCourt: (t) => [...onCourt[t]],
	};
	const final: [number, number] = [game.teams[0].pts, game.teams[1].pts];
	const winner = final[0] > final[1] ? 0 : final[1] > final[0] ? 1 : -1;

	let period = 1;
	let prev: [number, number] = [0, 0];
	// The last lead change: the shot that put the winner ahead for good
	let lastGoAhead: Pending | undefined;
	// Runs: a team's points while the other side scores at most 4
	let run: { t: 0 | 1; a: number; b: number; capper: Pending } | undefined;
	const out: Pending[] = [];
	const closeRun = () => {
		if (run && run.a >= 10 && run.a - run.b >= 8) {
			const c = run.capper;
			c.tags.set("run", 2 + run.a / 5);
			c.text = `${c.text}${c.text ? " " : ""}(${run.a}-${run.b} run)`;
			if (!out.includes(c)) {
				out.push(c);
			}
		}
		run = undefined;
	};

	for (let i = 0; i < events.length; i++) {
		const e = events[i];
		if (!e) {
			continue;
		}
		if (e.type === "stat") {
			if (e.s === "pts" && (e.t === 0 || e.t === 1)) {
				score[e.t as 0 | 1] += e.amt;
			}
			if (e.pid !== undefined) {
				let s = stats.get(e.pid);
				if (!s) {
					s = {
						pts: 0,
						ast: 0,
						trb: 0,
						stl: 0,
						blk: 0,
						tov: 0,
						pf: 0,
						fg: 0,
						fga: 0,
						tp: 0,
						tpa: 0,
						ft: 0,
						fta: 0,
					};
					stats.set(e.pid, s);
				}
				const k = e.s === "orb" || e.s === "drb" ? "trb" : e.s;
				if (k in s) {
					(s as any)[k] += e.amt;
				}
				if (e.s === "gs" || e.s === "min") {
					onCourt[e.t as 0 | 1]?.add(e.pid);
				}
			}
			continue;
		}
		if (e.type === "sub" && (e.t === 0 || e.t === 1)) {
			for (const pid of e.pidsOff ?? []) {
				onCourt[e.t as 0 | 1].delete(pid);
			}
			for (const pid of e.pids ?? []) {
				onCourt[e.t as 0 | 1].add(pid);
			}
		}
		if (e.type === "period" || e.type === "overtime") {
			period = typeof e.period === "number" ? e.period : period + 1;
		}
		let fr;
		try {
			fr = session.describe(e, host, events.slice(i + 1, i + 60));
		} catch {
			fr = undefined;
		}
		const text = fr && fr !== "silent" ? fr.text : "";
		const pts: [number, number] = [score[0] - prev[0], score[1] - prev[1]];
		const before = prev;
		prev = [score[0], score[1]];
		const t = e.t === 0 || e.t === 1 ? (e.t as 0 | 1) : undefined;
		const clock: number = typeof e.clock === "number" ? e.clock : 0;
		const last = period >= numPeriods;
		const p: Pending = {
			gid: game.gid,
			season: game.season,
			text,
			pid: e.pid,
			t,
			period,
			clock: formatClock(clock),
			after: [score[0], score[1]],
			source: "pbp",
			tags: new Map(),
			last,
			close: Math.abs(score[0] - score[1]) <= 6,
			idx: i,
		};
		const tag = (k: TopPlayKind, v: number) => {
			if (v > (p.tags.get(k) ?? 0)) {
				p.tags.set(k, v);
			}
		};
		const low = text.toLowerCase();
		const made = MADE.has(e.type);
		const scored = t !== undefined ? pts[t] : 0;

		if (made && t !== undefined) {
			for (const [k, v, re] of WORDS) {
				if (re.test(low)) {
					tag(k, v);
				}
			}
			if (fr && fr !== "silent") {
				if (fr.ptype === "poster") {
					tag("poster", 6);
				} else if (fr.ptype === "alleyoop") {
					tag("oop", 4.5);
				} else if (fr.ptype === "heave") {
					tag("deep", 4);
				}
				// The flavor layer's derived play types: the kind of shot (from the sim's zone and the words picked) and what else it was
				const shot = fr.shot;
				const ftags = new Set(fr.tags ?? []);
				if (shot === "heave") {
					tag("deep", 5);
				} else if (shot === "logo-three") {
					tag("deep", 2.5);
				} else if (shot === "deep-three") {
					tag("deep", 1.5);
				} else if (shot === "alley-oop") {
					tag("oop", 4.5);
				} else if (shot === "dunk" || shot === "putback-dunk") {
					tag("dunk", 3);
				}
				if (shot === "putback-dunk" || shot === "tip-in") {
					tag("putback", shot === "putback-dunk" ? 2 : 1.2);
				}
				if (
					fr.ptype === "pick6" ||
					fr.ptype === "2on1" ||
					fr.ptype === "coast" ||
					fr.ptype === "fastbreak-oop"
				) {
					tag("fastBreak", fr.ptype === "pick6" ? 2 : 1.5);
				}
				// the move that got the shot off, and a leak-out (see pbpFlavor/actions.ts)
				if (fr.action === "ankle-breaker") {
					tag("ankles", 5);
				} else if (fr.action === "euro-step") {
					tag("euroStep", 3.5);
				} else if (fr.action === "spin-move") {
					tag("spinMove", 3);
				} else if (fr.action === "leak-out") {
					tag("fastBreak", 1.5);
				}
				if (ftags.has("shot-clock")) {
					tag("shotClock", 1.5);
				}
				if (ftags.has("buzzer") && clock <= 3) {
					tag("buzzer", last ? 5 : 3.5);
				}
				if (ftags.has("dagger")) {
					tag("dagger", 4);
				}
			}
			if (e.type.endsWith("AndOne")) {
				tag("andOne", 1.5);
			}
			if (clock <= 1) {
				tag("buzzer", last ? 6 : 4);
			}
			if (last && clock <= 120) {
				const late = 1 + (120 - clock) / 40;
				const mBefore = before[t] - before[1 - t]!;
				const mAfter = score[t] - score[1 - t]!;
				if (mBefore <= 0 && mAfter > 0) {
					tag("goAhead", 3 + 1.5 * late);
				} else if (mBefore < 0 && mAfter === 0) {
					tag("tying", 2.5 + late);
				}
			}
		}
		if (e.type === "ft" && t !== undefined && last && clock <= 30) {
			const mBefore = before[t] - before[1 - t]!;
			const mAfter = score[t] - score[1 - t]!;
			if (mBefore <= 0 && mAfter > 0) {
				tag("goAhead", 4);
			}
		}
		const action = fr && fr !== "silent" ? fr.action : undefined;
		if (BLOCK.has(e.type)) {
			tag("block", fr && fr !== "silent" && fr.ptype === "chasedown" ? 4 : 2.5);
			if (action === "chase-down") {
				tag("chaseDown", 5);
			}
		}
		if (e.type === "stl") {
			tag("steal", fr && fr !== "silent" && fr.ptype === "pick6" ? 3 : 1.2);
			if (action === "loose-ball") {
				tag("hustle", 3);
			}
		}
		// A charge taken: the play belongs to the defender who drew it
		if (
			e.type === "tov" &&
			action === "charge-taken" &&
			fr &&
			fr !== "silent" &&
			fr.pidHero !== undefined &&
			t !== undefined
		) {
			const d: 0 | 1 = t === 0 ? 1 : 0;
			p.pid = fr.pidHero;
			p.t = d;
			tag("charge", 3.5);
			const lead = score[d] - score[t];
			if (last && clock <= 24 && lead >= 0 && lead <= 3) {
				tag("stop", 6 + (24 - clock) / 8);
			}
		}
		// Defensive stops late in a one-possession game
		if (
			(BLOCK.has(e.type) || e.type === "stl") &&
			t !== undefined &&
			last &&
			clock <= 24
		) {
			const lead = score[t] - score[1 - t]!;
			if (lead >= 0 && lead <= 3) {
				tag("stop", 6 + (24 - clock) / 8);
			}
		}

		// Runs: the play that capped a run is tagged when the run ends
		if (t !== undefined && scored > 0) {
			if (run && run.t !== t) {
				run.b += scored;
				if (run.b > 4) {
					closeRun();
					run = { t, a: scored, b: 0, capper: p };
				}
			} else if (run) {
				run.a += scored;
				run.capper = p;
			} else {
				run = { t, a: scored, b: 0, capper: p };
			}
		}

		if (made && t !== undefined && winner === t) {
			const mBefore = before[t] - before[1 - t]!;
			const mAfter = score[t] - score[1 - t]!;
			if (mBefore <= 0 && mAfter > 0) {
				lastGoAhead = p;
			}
		}

		if (p.tags.size > 0 || p === lastGoAhead) {
			out.push(p);
		}
	}

	closeRun();
	out.sort((a, b) => a.idx - b.idx);

	// The game-winner: the winner's last go-ahead shot, in the final minute of the last period
	if (
		lastGoAhead &&
		lastGoAhead.period !== undefined &&
		lastGoAhead.period >= numPeriods
	) {
		const secs = clockSeconds(lastGoAhead.clock);
		if (secs <= 60) {
			lastGoAhead.tags.set("winner", 8 + (60 - secs) / 10);
		}
	}

	return out.map(finish).filter((x) => x !== undefined);
};

const clockSeconds = (c: string | undefined) => {
	const m = /^(\d+):(\d+(?:\.\d+)?)$/.exec(c ?? "");
	if (m) {
		return Number(m[1]) * 60 + Number(m[2]);
	}
	const n = Number(c);
	return Number.isFinite(n) ? n : 0;
};

// Plays from the sim's clutch-play notes, for a game with no stored play-by-play
export const playsFromClutch = (game: GameForPlays): TopPlay[] => {
	const out: TopPlay[] = [];
	for (const html of game.clutchPlays ?? []) {
		const text = clutchText(html).replace(/\.$/, "");
		const low = text.toLowerCase();
		let kind: TopPlayKind = "clutch";
		let score = 6;
		if (
			/at the buzzer|as time expires|at the horn|no time on the clock/.test(low)
		) {
			kind = "buzzer";
			score = 12;
		} else if (
			/block|steal|strips|picks off|swat|stops|forces|deflect|turnover|denies/.test(
				low,
			)
		) {
			kind = "stop";
			score = 8;
		} else if (/overtime|to force|ties|tying|knots/.test(low)) {
			kind = "tying";
			score = 8;
		} else if (/win|ahead|lead/.test(low)) {
			kind = "winner";
			score = 10;
		}
		const m = /\[\[p:(\d+)\|/.exec(text);
		out.push({
			gid: game.gid,
			season: game.season,
			kind,
			label: TOP_PLAY_LABELS[kind],
			tags: [],
			score,
			text,
			pid: m ? Number(m[1]) : undefined,
			source: "clutch",
		});
	}
	return out;
};

// Best plays of a list, at most perKind of a kind and one of a kind per player
export const pickTopPlays = (
	plays: readonly TopPlay[],
	{
		limit = 10,
		perKind = 3,
		min = 4,
	}: { limit?: number; perKind?: number; min?: number } = {},
) => {
	const sorted = plays
		.filter((p) => p.score >= min)
		.sort((a, b) => b.score - a.score || a.gid - b.gid);
	const picked: TopPlay[] = [];
	const kinds = new Map<string, number>();
	const seen = new Set<string>();
	for (const p of sorted) {
		const key = `${p.kind}|${p.pid ?? "-"}|${p.gid}`;
		if (seen.has(key) || (kinds.get(p.kind) ?? 0) >= perKind) {
			continue;
		}
		seen.add(key);
		kinds.set(p.kind, (kinds.get(p.kind) ?? 0) + 1);
		picked.push(p);
		if (picked.length >= limit) {
			break;
		}
	}
	return picked;
};
