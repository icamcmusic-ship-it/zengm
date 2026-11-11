/* A basketball game's play-by-play, stored with its box score (game.pbp) in a compact form: the events the sim logged, not the text. The
   text is made again from them by the same flavor session the live view uses, and since that session is seeded by the game id and the
   position of each event (rng.ts), the stored game reads exactly as it did live.

   Format: one string of "varints", 5 bits per character (64 URL-safe characters; the upper 32 mean "more follows"). First a header (version,
   then each player: pid, team, 14 ratings), then the events. Every event starts with a code: a stat (the running box score the text reads:
   points, rebounds...), one of the event types below with its fields in a fixed order, or, for anything the schema can't hold exactly, the
   event as JSON. Clocks are hundredths of a second, as a change from the previous clock. Players are indexes into the header. About 7 KB a
   game. */
import { CAREER_LENGTH } from "./career.ts";
import { EXTRA_KEYS } from "./story.ts";
import { RATING_KEYS } from "./types.ts";

const ALPHABET =
	"0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz-_";
const CHAR_VALUE: Record<string, number> = {};
for (const [i, c] of [...ALPHABET].entries()) {
	CHAR_VALUE[c] = i;
}

// 2: each player also has his temper score (player traits, for the trash talk; 0 = none).
// 3: the header starts with how heated the teams' rivalry is (0 none, 1 heated, 2 bitter), and each player also has what he had done before
// the game (career.ts: games played, career and season highs, career totals; a flag, then CAREER_LENGTH numbers, 0 = not known).
// 4: then the game's context (worker/util/pbpGameContext.ts: each team's record, streak and rank coming in; a count, then the numbers), and
// each player also has his extra ratings and traits for the wording (story.ts EXTRA_KEYS: a count, then each one, 0 = none).
// Version 1, 2 and 3 strings still decode
const VERSION = 4;

// Stats, most common first. Keep in sync with STORED_STATS in GameSim.basketball/PlayByPlayLogger.ts. Never reorder: stored games use these
const STATS = [
	"fga",
	"pts",
	"fg",
	"drb",
	"ast",
	"tpa",
	"tov",
	"fta",
	"pf",
	"orb",
	"ft",
	"tp",
	"stl",
	"blk",
	"ba",
	"gs",
	"sPts",
	"sAtt",
] as const;
const CODE_STAT_ANY = STATS.length; // any stat, any amount
const CODE_PTS2 = CODE_STAT_ANY + 1;
const CODE_PTS3 = CODE_STAT_ANY + 2;
const CODE_JSON = CODE_STAT_ANY + 3;
const FIRST_EVENT_CODE = CODE_STAT_ANY + 4;

// t: team, p: player, c: clock, f: hundredths (possession length), n: integer, b: boolean, a: players, e: one of a few strings
type Kind = "t" | "p" | "c" | "f" | "n" | "b" | "a" | `e:${string}`;
type Field = [string, Kind];

const T: Field = ["t", "t"];
const P: Field = ["pid", "p"];
const C: Field = ["clock", "c"];
const POSS: Field = ["poss", "f"];
const PERIOD: Field = ["period", "n"];

// Event types and their fields. Never reorder or remove: stored games use these codes. New types go at the end
const SCHEMAS: [string, Field[]][] = [
	["sub", [T, ["pids", "a"], ["pidsOff", "a"], C]],
	["drb", [T, P, C]],
	["fgaAtRim", [T, P, C, POSS]],
	["fgaMidRange", [T, P, C, POSS]],
	["fgaTp", [T, P, C, ["desperation", "b"], POSS]],
	["missTp", [T, P, C]],
	[
		"fgAtRim",
		[T, P, C, ["pidDefense", "p"], ["pidAst", "p"], ["pidFoul", "p"], PERIOD],
	],
	["missMidRange", [T, P, C]],
	["fgMidRange", [T, P, C, ["pidAst", "p"], ["pidFoul", "p"], PERIOD]],
	["tp", [T, P, C, ["pidAst", "p"], ["pidFoul", "p"], PERIOD]],
	["orb", [T, P, C]],
	["ft", [T, P, C, PERIOD, ["tech", "b"]]],
	["missAtRim", [T, P, C]],
	["fgaLowPost", [T, P, C, POSS]],
	["tov", [T, P, ["outOfBounds", "b"], C, POSS]],
	["stl", [T, P, ["pidTov", "p"], ["outOfBounds", "b"], C, POSS]],
	["pfNonShooting", [T, P, C]],
	["pfFG", [T, P, ["pidShooting", "p"], C]],
	["missFt", [T, P, C, ["tech", "b"]]],
	["fgLowPost", [T, P, C, ["pidAst", "p"], ["pidFoul", "p"], PERIOD]],
	["missLowPost", [T, P, C]],
	["outOfBounds", [T, ["on", "e:offense,defense"], C]],
	["timeouts", [["timeouts", "a"]]],
	["blkAtRim", [T, P, C]],
	[
		"fgAtRimAndOne",
		[T, P, C, ["pidDefense", "p"], ["pidAst", "p"], ["pidFoul", "p"], PERIOD],
	],
	["fgMidRangeAndOne", [T, P, C, ["pidAst", "p"], ["pidFoul", "p"], PERIOD]],
	["fgLowPostAndOne", [T, P, C, ["pidAst", "p"], ["pidFoul", "p"], PERIOD]],
	["tpAndOne", [T, P, C, ["pidAst", "p"], ["pidFoul", "p"], PERIOD]],
	["pfBonus", [T, P, ["pidShooting", "p"], C]],
	["pfTP", [T, P, ["pidShooting", "p"], C]],
	["blkLowPost", [T, P, C]],
	["blkMidRange", [T, P, C]],
	["blkTp", [T, P, C]],
	["blkTipIn", [T, P, C]],
	["blkPutBack", [T, P, C]],
	["fgaTpFake", [T, P, C, ["desperation", "b"], POSS]],
	["fgaTipIn", [T, P, C, ["pidPass", "p"], POSS]],
	["fgaPutBack", [T, P, C, POSS]],
	["fgTipIn", [T, P, C, ["pidAst", "p"], ["pidFoul", "p"], PERIOD]],
	["fgTipInAndOne", [T, P, C, ["pidAst", "p"], ["pidFoul", "p"], PERIOD]],
	["fgPutBack", [T, P, C, ["pidFoul", "p"], PERIOD]],
	["fgPutBackAndOne", [T, P, C, ["pidFoul", "p"], PERIOD]],
	["missTipIn", [T, P, C]],
	["missPutBack", [T, P, C]],
	["foulOut", [T, P, C]],
	["injury", [T, P, C]],
	["jumpBall", [T, P, ["pid2", "p"], C]],
	["period", [C, PERIOD]],
	["overtime", [C, PERIOD]],
	["gameOver", []],
	["timeout", [T, ["numLeft", "n"], ["advancesBall", "b"], C]],
	["endOfPeriod", [T, ["reason", "e:runOutClock,noShot,intentionalFoul"], C]],
	["elamActive", [["target", "n"]]],
	["shootoutStart", [["rounds", "n"], C]],
	["shootoutTeam", [T, P]],
	["shootoutShot", [T, P, ["made", "b"]]],
	["shootoutTie", []],
	["techFoul", [T, P, ["num", "n"], C]],
	["flagrantFoul", [T, P, ["pidShooting", "p"], ["level", "n"], C]],
	["ejection", [T, P, ["reason", "e:flagrant2,flagrants,techs"], C]],
];
const SCHEMA_BY_TYPE = new Map(
	SCHEMAS.map(([type, fields], i) => [
		type,
		{
			code: FIRST_EVENT_CODE + i,
			fields,
			// For encoding (hot: every event of every game when play-by-play is stored)
			keys: new Set(fields.map(([key]) => key)),
		},
	]),
);
// "e:a,b,c" enum kinds, split once
const enumValues = new Map<string, string[]>();
const getEnumValues = (kind: string) => {
	let values = enumValues.get(kind);
	if (!values) {
		values = kind.slice(2).split(",");
		enumValues.set(kind, values);
	}
	return values;
};
const STAT_INDEX = new Map<unknown, number>();
for (const [i, stat] of STATS.entries()) {
	if (!STAT_INDEX.has(stat)) {
		STAT_INDEX.set(stat, i);
	}
}

export type StoredPlayer = {
	pid: number;
	t: 0 | 1;
	ratings: Record<string, number> | undefined;
	career?: number[];
};

const isInt = (x: unknown): x is number =>
	typeof x === "number" && Number.isInteger(x) && x >= 0;
const isHundredths = (x: number) =>
	Number.isFinite(x) && Math.round(x * 100) / 100 === x;

// Appends to a string (V8 makes that cheap), rather than collecting one-character strings to join
class Writer {
	out = "";
	num(v: number) {
		while (v >= 32) {
			this.out += ALPHABET[32 + (v % 32)]!;
			v = Math.floor(v / 32);
		}
		this.out += ALPHABET[v]!;
	}
	raw(s: string) {
		this.out += s;
	}
}

class Reader {
	i = 0;
	s: string;
	constructor(s: string) {
		this.s = s;
	}
	done() {
		return this.i >= this.s.length;
	}
	num() {
		let v = 0;
		let mult = 1;
		while (true) {
			const c = this.s[this.i];
			this.i += 1;
			const x = c === undefined ? undefined : CHAR_VALUE[c];
			if (x === undefined) {
				throw new Error("Bad stored play-by-play");
			}
			if (x >= 32) {
				v += (x - 32) * mult;
				mult *= 32;
			} else {
				return v + x * mult;
			}
		}
	}
	raw(n: number) {
		const s = this.s.slice(this.i, this.i + n);
		this.i += n;
		return s;
	}
}

const zigzag = (x: number) => (x >= 0 ? 2 * x : -2 * x - 1);
const unzigzag = (x: number) => (x % 2 === 0 ? x / 2 : -(x + 1) / 2);

// The sim's events (as PlayByPlayLogger logged them, starting with the init event) to a string. Minutes and the other stats the text
// doesn't use are left out
export const encodePlayByPlay = (events: readonly any[]): string => {
	const players: StoredPlayer[] = [];
	const index = new Map<number, number>();
	const init = events.find((e) => e?.type === "init");
	if (Array.isArray(init?.boxScore)) {
		for (const [t, team] of (init.boxScore as any[]).entries()) {
			for (const p of team?.player ?? []) {
				if (typeof p?.id === "number" && !index.has(p.id)) {
					index.set(p.id, players.length);
					players.push({
						pid: p.id,
						t: t === 1 ? 1 : 0,
						ratings: p.pbpRatings,
						career:
							Array.isArray(p.pbpCareer) && p.pbpCareer.length >= CAREER_LENGTH
								? p.pbpCareer
								: undefined,
					});
				}
			}
		}
	}

	const body = new Writer();
	let prevClock = 0;

	const pidOk = (x: unknown) => x === undefined || isInt(x);
	const ref = (pid: number | undefined) => {
		if (pid === undefined) {
			return 0;
		}
		let i = index.get(pid);
		if (i === undefined) {
			// Not in the init event (should not happen): kept, on team 0, with default ratings
			i = players.length;
			index.set(pid, i);
			players.push({ pid, t: 0, ratings: undefined });
		}
		return i + 1;
	};

	const fits = (e: any, fields: Field[], keys: Set<string>) => {
		for (const key in e) {
			if (key !== "type" && !keys.has(key)) {
				if (e[key] !== undefined) {
					return false;
				}
			}
		}
		for (const [key, kind] of fields) {
			const v = e[key];
			if (kind === "t") {
				if (v !== undefined && v !== 0 && v !== 1) {
					return false;
				}
			} else if (kind === "p") {
				if (!pidOk(v)) {
					return false;
				}
			} else if (kind === "c" || kind === "f") {
				if (
					v !== undefined &&
					!(typeof v === "number" && (v === Infinity || isHundredths(v)))
				) {
					return false;
				}
				if (kind === "f" && v === Infinity) {
					return false;
				}
			} else if (kind === "n") {
				if (v !== undefined && !isInt(v)) {
					return false;
				}
			} else if (kind === "b") {
				if (v !== undefined && typeof v !== "boolean") {
					return false;
				}
			} else if (kind === "a") {
				if (!Array.isArray(v) || !v.every(isInt)) {
					return false;
				}
			} else {
				if (v !== undefined && !getEnumValues(kind).includes(v)) {
					return false;
				}
			}
		}
		return true;
	};

	for (const e of events) {
		if (!e || e.type === "init") {
			continue;
		}

		if (e.type === "stat") {
			const s = STAT_INDEX.get(e.s) ?? -1;
			if (s < 0) {
				continue;
			}
			const pid = e.pid ?? undefined;
			if (
				!pidOk(pid) ||
				(pid === undefined && e.t !== 0 && e.t !== 1) ||
				(pid !== undefined && players[ref(pid) - 1]!.t !== e.t)
			) {
				// fall through to JSON below
			} else if (e.amt === 1) {
				body.num(s);
				body.num(ref(pid));
				if (pid === undefined) {
					body.num(e.t);
				}
				continue;
			} else if (e.s === "pts" && (e.amt === 2 || e.amt === 3)) {
				body.num(e.amt === 2 ? CODE_PTS2 : CODE_PTS3);
				body.num(ref(pid));
				if (pid === undefined) {
					body.num(e.t);
				}
				continue;
			} else if (isInt(e.amt)) {
				body.num(CODE_STAT_ANY);
				body.num(s);
				body.num(e.amt);
				body.num(ref(pid));
				if (pid === undefined) {
					body.num(e.t);
				}
				continue;
			}
		} else {
			const schema = SCHEMA_BY_TYPE.get(e.type);
			if (schema && fits(e, schema.fields, schema.keys)) {
				body.num(schema.code);
				for (const [key, kind] of schema.fields) {
					const v = e[key];
					if (kind === "t") {
						body.num(v === undefined ? 2 : v);
					} else if (kind === "p") {
						body.num(ref(v));
					} else if (kind === "c") {
						if (v === undefined) {
							body.num(0);
						} else if (v === Infinity) {
							body.num(1);
						} else {
							const cs = Math.round(v * 100);
							body.num(2 + zigzag(prevClock - cs));
							prevClock = cs;
						}
					} else if (kind === "f") {
						body.num(v === undefined ? 0 : Math.round(v * 100) + 1);
					} else if (kind === "n") {
						body.num(v === undefined ? 0 : v + 1);
					} else if (kind === "b") {
						body.num(v === undefined ? 2 : v ? 1 : 0);
					} else if (kind === "a") {
						body.num(v.length);
						for (const x of v) {
							body.num(key === "timeouts" ? x : ref(x));
						}
					} else {
						body.num(v === undefined ? 0 : getEnumValues(kind).indexOf(v) + 1);
					}
				}
				continue;
			}
		}

		// Anything else: as JSON
		const json = JSON.stringify(e);
		body.num(CODE_JSON);
		body.num(json.length);
		body.raw(json);
	}

	const head = new Writer();
	head.num(VERSION);
	const rivalry = init?.boxScore?.[0]?.pbpRivalry;
	head.num(isInt(rivalry) ? rivalry : 0);
	const game: unknown = init?.boxScore?.[0]?.pbpGame;
	if (
		Array.isArray(game) &&
		game.every((x) => typeof x === "number" && Number.isInteger(x))
	) {
		head.num(game.length);
		for (const x of game) {
			head.num(zigzag(x));
		}
	} else {
		head.num(0);
	}
	head.num(players.length);
	for (const p of players) {
		head.num(p.pid);
		head.num(p.t);
		if (p.ratings) {
			head.num(1);
			for (const key of RATING_KEYS) {
				const v = p.ratings[key];
				// (ratings are whole numbers; anything else is rounded)
				head.num(
					typeof v === "number" && Number.isFinite(v)
						? Math.max(0, Math.round(v)) + 1
						: 0,
				);
			}
		} else {
			head.num(0);
		}
		const temper = p.ratings?.["temper"];
		head.num(
			typeof temper === "number" && Number.isFinite(temper)
				? Math.max(0, Math.round(temper)) + 1
				: 0,
		);
		if (p.career) {
			head.num(1);
			for (let i = 0; i < CAREER_LENGTH; i++) {
				const v = p.career[i];
				head.num(isInt(v) ? v + 1 : 0);
			}
		} else {
			head.num(0);
		}
		head.num(EXTRA_KEYS.length);
		for (const key of EXTRA_KEYS) {
			const v = p.ratings?.[key];
			head.num(
				typeof v === "number" && Number.isFinite(v)
					? Math.max(0, Math.round(v)) + 1
					: 0,
			);
		}
	}

	return head.out + body.out;
};

// The string back to the players (in the sim's roster order) and the events, as the sim logged them (minus the stats left out)
export const decodePlayByPlay = (
	s: string,
): {
	players: StoredPlayer[];
	events: any[];
	rivalry: number;
	// the game's context (version 4 on)
	game?: number[];
} => {
	const r = new Reader(s);
	const version = r.num();
	if (version < 1 || version > VERSION) {
		throw new Error(`Unknown stored play-by-play version ${version}`);
	}
	const rivalry = version >= 3 ? r.num() : 0;
	let game: number[] | undefined;
	if (version >= 4) {
		const n = r.num();
		if (n > 0) {
			game = [];
			for (let i = 0; i < n; i++) {
				game.push(unzigzag(r.num()));
			}
		}
	}
	const numPlayers = r.num();
	const players: StoredPlayer[] = [];
	for (let i = 0; i < numPlayers; i++) {
		const pid = r.num();
		const t = r.num() === 1 ? 1 : 0;
		let ratings: Record<string, number> | undefined;
		if (r.num() === 1) {
			ratings = {};
			for (const key of RATING_KEYS) {
				const v = r.num();
				if (v > 0) {
					ratings[key] = v - 1;
				}
			}
		}
		if (version >= 2) {
			const temper = r.num();
			if (temper > 0) {
				ratings ??= {};
				ratings["temper"] = temper - 1;
			}
		}
		let career: number[] | undefined;
		if (version >= 3 && r.num() === 1) {
			career = [];
			for (let j = 0; j < CAREER_LENGTH; j++) {
				career.push(r.num() - 1);
			}
		}
		if (version >= 4) {
			const n = r.num();
			for (let j = 0; j < n; j++) {
				const v = r.num();
				const key = EXTRA_KEYS[j];
				if (v > 0 && key !== undefined) {
					ratings ??= {};
					ratings[key] = v - 1;
				}
			}
		}
		players.push(career ? { pid, t, ratings, career } : { pid, t, ratings });
	}

	const pidOf = (x: number) => (x === 0 ? undefined : players[x - 1]?.pid);
	const teams = new Map(players.map((p) => [p.pid, p.t]));
	const teamOfPid = (pid: number) => teams.get(pid) ?? 0;

	const events: any[] = [];
	let prevClock = 0;
	while (!r.done()) {
		const code = r.num();
		if (code < CODE_JSON) {
			let s: string;
			let amt = 1;
			if (code === CODE_STAT_ANY) {
				s = STATS[r.num()]!;
				amt = r.num();
			} else if (code === CODE_PTS2 || code === CODE_PTS3) {
				s = "pts";
				amt = code === CODE_PTS2 ? 2 : 3;
			} else {
				s = STATS[code]!;
			}
			const pid = pidOf(r.num());
			const t = pid === undefined ? r.num() : teamOfPid(pid);
			events.push({ type: "stat", t, pid, s, amt });
			continue;
		}
		if (code === CODE_JSON) {
			const n = r.num();
			events.push(JSON.parse(r.raw(n)));
			continue;
		}
		const schema = SCHEMAS[code - FIRST_EVENT_CODE];
		if (!schema) {
			throw new Error("Bad stored play-by-play");
		}
		const [type, fields] = schema;
		const e: any = { type };
		for (const [key, kind] of fields) {
			const v = r.num();
			if (kind === "t") {
				if (v !== 2) {
					e[key] = v;
				}
			} else if (kind === "p") {
				const pid = pidOf(v);
				if (pid !== undefined) {
					e[key] = pid;
				}
			} else if (kind === "c") {
				if (v === 1) {
					e[key] = Infinity;
				} else if (v >= 2) {
					const cs = prevClock - unzigzag(v - 2);
					prevClock = cs;
					e[key] = cs / 100;
				}
			} else if (kind === "f") {
				if (v > 0) {
					e[key] = (v - 1) / 100;
				}
			} else if (kind === "n") {
				if (v > 0) {
					e[key] = v - 1;
				}
			} else if (kind === "b") {
				if (v !== 2) {
					e[key] = v === 1;
				}
			} else if (kind === "a") {
				const arr = [];
				for (let i = 0; i < v; i++) {
					const x = r.num();
					arr.push(key === "timeouts" ? x : pidOf(x));
				}
				e[key] = arr;
			} else if (v > 0) {
				e[key] = kind.slice(2).split(",")[v - 1];
			}
		}
		events.push(e);
	}

	return game
		? { players, events, rivalry, game }
		: { players, events, rivalry };
};

// The init event the live view starts from, for a stored game: players in the sim's order, with names and positions from the box score
export const storedInitEvent = (
	players: StoredPlayer[],
	boxScoreTeams: readonly { players: readonly any[] }[],
	// (how heated the rivalry was: decodePlayByPlay's rivalry)
	rivalry = 0,
	// (the game's context: decodePlayByPlay's game)
	game?: number[],
) => {
	const info = new Map<number, { name: string; pos: string }>();
	for (const t of boxScoreTeams) {
		for (const p of t.players) {
			info.set(p.pid, { name: p.name, pos: p.pos });
		}
	}
	const teams: { player: any[]; pbpRivalry?: number; pbpGame?: number[] }[] = [
		{ player: [] },
		{ player: [] },
	];
	if (rivalry > 0) {
		teams[0]!.pbpRivalry = rivalry;
	}
	if (game) {
		teams[0]!.pbpGame = game;
	}
	for (const p of players) {
		const i = info.get(p.pid);
		teams[p.t]!.player.push({
			id: p.pid,
			name: i?.name ?? "???",
			pos: i?.pos ?? "",
			pbpRatings: p.ratings,
			...(p.career ? { pbpCareer: p.career } : undefined),
		});
	}
	return { type: "init", boxScore: teams };
};
