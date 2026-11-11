/* Storylines in the play-by-play: where the teams stand at tip-off (streaks, the top and the bottom of the standings), a player facing his
   former team, a rookie's debut, and calls that come from what a player is known for: catch-and-shoot or pull-up jumpers, the offensive glass,
   long arms, lockdown perimeter and interior defense, switching onto a big, a motor that still runs late, ball security, a veteran leader
   pulling the group together, a big-game player in the playoffs, a closer late; and garbage time in a blowout.

   Nothing is said without the data: the expanded ratings come only with that setting on, the traits only with Player Traits on, the records
   and former teams only for games played since they were stored (worker/util/pbpGameContext.ts, stored with the game, so a stored game
   reads like the live one), and every call also checks the play it is attached to (a catch-and-shoot call needs an assisted jumper, a debut
   needs a career that is all on record with no games in it...).

   Cosmetic only, like the rest of the flavor layer: it reads the events and the live box score, picks its words from its own seeded stream
   (no other part of the layer uses it, and it does not touch the shared variety memory) and only adds a note, so the rest of the text is
   the same with or without it. */
import { parseCareer, type PbpCareer } from "./career.ts";
import type { FlavorResult } from "./session.ts";
import { Rng } from "./rng.ts";
import { cap, poss, type FPlayer } from "./types.ts";

// The expanded ratings and traits the sim sends with a player's ratings (loadTeams), for the wording only
export const PBP_EXPANDED_KEYS = [
	"wng",
	"pdef",
	"idef",
	"oreb",
	"csh",
	"dsh",
	"bsc",
] as const;
export const PBP_TRAIT_KEYS = [
	"motor",
	"leadership",
	"bigGame",
	"defensiveVersatility",
	"clutch",
	"hustle",
] as const;
// Stored after the 14 ratings and the temper (store.ts version 4). Never reorder; add new keys at the end. "former": he has played for the
// other team (worker/util/pbpGameContext.ts)
export const EXTRA_KEYS = [
	...PBP_EXPANDED_KEYS,
	...PBP_TRAIT_KEYS,
	"former",
] as const;
type ExtraKey = (typeof EXTRA_KEYS)[number];

// A team's numbers in the game context: [won, lost, streak, rank, number of teams, neutral]
export type TeamStanding = {
	won: number;
	lost: number;
	streak: number;
	rank: number;
	numTeams: number;
};

export const parseGameContext = (
	raw: unknown,
): { teams: [TeamStanding, TeamStanding]; neutral: boolean } | undefined => {
	if (
		!Array.isArray(raw) ||
		raw.length < 12 ||
		!raw.every((x) => typeof x === "number" && Number.isFinite(x))
	) {
		return undefined;
	}
	const team = (i: number): TeamStanding => ({
		won: raw[i],
		lost: raw[i + 1],
		streak: raw[i + 2],
		rank: raw[i + 3],
		numTeams: raw[i + 4],
	});
	return { teams: [team(0), team(6)], neutral: raw[5] === 1 };
};

// Coaching systems (worker/core/staff/systems.ts applyCoachSystems): after this marker in the game context, each team's offense and defense
// system (indexes into common/coachSystems.ts OFFENSE_SYSTEMS / DEFENSE_SYSTEMS), home team first
const COACH_SYSTEMS_MARKER = 9101;
const OFFENSE_KEYS = [
	"motion",
	"paceSpace",
	"heliocentric",
	"post",
	"iso",
	"princeton",
	"sevenSeconds",
] as const;
const DEFENSE_KEYS = [
	"switch",
	"drop",
	"blitz",
	"packPaint",
	"zone",
	"press",
] as const;
export type CoachSystemsContext = [
	{ off: (typeof OFFENSE_KEYS)[number]; def: (typeof DEFENSE_KEYS)[number] },
	{ off: (typeof OFFENSE_KEYS)[number]; def: (typeof DEFENSE_KEYS)[number] },
];

export const parseCoachSystems = (
	raw: unknown,
): CoachSystemsContext | undefined => {
	if (!Array.isArray(raw)) {
		return undefined;
	}
	for (let i = 12; i + 4 < raw.length; i++) {
		if (raw[i] === COACH_SYSTEMS_MARKER) {
			const [o0, d0, o1, d1] = raw.slice(i + 1, i + 5);
			const off0 = OFFENSE_KEYS[o0];
			const def0 = DEFENSE_KEYS[d0];
			const off1 = OFFENSE_KEYS[o1];
			const def1 = DEFENSE_KEYS[d1];
			if (off0 && def0 && off1 && def1) {
				return [
					{ off: off0, def: def0 },
					{ off: off1, def: def1 },
				];
			}
		}
	}
	return undefined;
};

const OFFENSE_PHRASES: Record<(typeof OFFENSE_KEYS)[number], string[]> = {
	motion: [
		"move the ball in their motion offense",
		"run a read-and-react motion offense",
	],
	paceSpace: [
		"play five-out, pace and space",
		"spread the floor and fire away from three",
	],
	heliocentric: [
		"run everything through the pick-and-roll",
		"put the ball in their star's hands and spread the floor around him",
	],
	post: ["play inside-out through their bigs", "pound it into the post"],
	iso: ["clear out and go one-on-one", "lean on isolation scoring"],
	princeton: [
		"run the Princeton offense, all cuts and passing",
		"look for backdoor cuts",
	],
	sevenSeconds: [
		"want a shot in seven seconds or less",
		"push the pace at every chance",
	],
};
const DEFENSE_PHRASES: Record<(typeof DEFENSE_KEYS)[number], string[]> = {
	switch: ["switch everything", "switch every screen"],
	drop: ["drop their big back to protect the rim", "play drop coverage"],
	blitz: ["blitz the pick-and-roll", "trap the ball handler"],
	packPaint: ["pack the paint", "wall off the lane"],
	zone: ["sit in a zone", "play zone"],
	press: ["press full court", "pick up full court"],
};

const STREAM = 9_000_000;

// The kinds of call, for tests
export type StoryKind =
	| "standing"
	| "former"
	| "formerPays"
	| "debut"
	| "catchShoot"
	| "pullUp"
	| "oreb"
	| "length"
	| "lockdown"
	| "wall"
	| "switch"
	| "motor"
	| "secure"
	| "leader"
	| "bigGame"
	| "closer"
	| "garbage"
	| "benchMob"
	| "system";

export type StoryEnv = {
	idx: number;
	ev: any;
	res: FlavorResult;
	pl: (pid: number) => FPlayer;
	floor: (t: 0 | 1) => FPlayer[];
	stat: (pid: number) => { pts: number; ast: number; tov: number } | undefined;
	the: (t: 0 | 1) => string;
	score: [number, number];
	period: number;
	numPeriods: number;
	// seconds left in the period, when known
	clock: number | undefined;
	// the shooter of a blocked shot
	pendingShooter: number | undefined;
	// a run by a team: [team, its points, the other team's]
	run: { t: 0 | 1 | undefined; S: number };
};

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

const PULL_UP_SHOTS = new Set([
	"pull-up",
	"step-back",
	"fadeaway",
	"pull-up-three",
	"step-back-three",
]);

const isBig = (p: FPlayer) => /^(C|FC|PF)$/.test(p.pos);
const isGuard = (p: FPlayer) => /^(PG|SG|G|GF)$/.test(p.pos);

export class StoryNotes {
	private gid: number;
	private female: boolean;
	private playoffs: boolean;
	private extras = new Map<number, Partial<Record<ExtraKey, number>>>();
	private careers = new Map<number, PbpCareer>();
	private game: ReturnType<typeof parseGameContext>;
	private systems: CoachSystemsContext | undefined;
	private systemNotes = 0;
	private said = new Set<string>();
	private used = new Set<string>();
	private perPlayer = new Map<number, number>();
	private lastIdx = -100;
	private count = 0;
	private orb = new Map<number, number>();
	private garbage = false;
	// players who came in after garbage time started
	private garbageSubs = new Set<number>();
	private debuted = new Set<number>();
	readonly active: boolean;
	readonly calls: { idx: number; pid?: number; kind: StoryKind }[] = [];

	constructor(
		gid: number,
		players: readonly {
			pid: number;
			ratings?: Record<string, number>;
			career?: unknown;
		}[],
		opts: {
			playoffs?: boolean;
			exhibition?: boolean;
			female: boolean;
			game?: unknown;
		},
	) {
		this.gid = gid;
		this.female = opts.female;
		this.playoffs = !!opts.playoffs;
		for (const p of players) {
			const x: Partial<Record<ExtraKey, number>> = {};
			for (const key of EXTRA_KEYS) {
				const v = p.ratings?.[key];
				if (typeof v === "number" && Number.isFinite(v)) {
					x[key] = v;
				}
			}
			this.extras.set(p.pid, x);
			if (!opts.exhibition) {
				const c = parseCareer(p.career);
				if (c) {
					this.careers.set(p.pid, c);
				}
			}
		}
		this.game = opts.exhibition ? undefined : parseGameContext(opts.game);
		this.systems = opts.exhibition ? undefined : parseCoachSystems(opts.game);
		// (never in the All-Star Game: no records, no debuts, no storylines)
		this.active = !opts.exhibition;
	}

	private x(pid: number | undefined, key: ExtraKey) {
		return pid === undefined ? undefined : this.extras.get(pid)?.[key];
	}

	private his() {
		return this.female ? "her" : "his";
	}
	private he() {
		return this.female ? "she" : "he";
	}

	// A line not used before in this game
	private pick(rng: Rng, lines: string[]): string | undefined {
		const fresh = lines.filter((l) => !this.used.has(l));
		if (fresh.length === 0) {
			return undefined;
		}
		const line = rng.pick(fresh);
		this.used.add(line);
		return line;
	}

	// The everyday calls are spaced out: one at least 6 events after the last, at most 3 a player and 14 a game
	private room(idx: number, pid: number | undefined) {
		return (
			idx - this.lastIdx >= 6 &&
			this.count < 14 &&
			(pid === undefined || (this.perPlayer.get(pid) ?? 0) < 3)
		);
	}

	private record(
		env: StoryEnv,
		kind: StoryKind,
		pid: number | undefined,
		line: string | undefined,
		key?: string,
	) {
		if (!line) {
			return false;
		}
		if (key) {
			this.said.add(key);
		}
		this.lastIdx = env.idx;
		this.count += 1;
		if (pid !== undefined) {
			this.perPlayer.set(pid, (this.perPlayer.get(pid) ?? 0) + 1);
		}
		this.calls.push({ idx: env.idx, pid, kind });
		env.res.note = [env.res.note, line].filter(Boolean).join(" ");
		return true;
	}

	private late(env: StoryEnv) {
		return env.period >= env.numPeriods;
	}

	check(env: StoryEnv) {
		if (!this.active) {
			return;
		}
		const rng = new Rng(this.gid, STREAM + env.idx);
		const type: string = env.ev.type;
		if (type === "jumpBall") {
			if (env.period === 1) {
				this.tipOff(rng, env);
			}
		} else if (type === "sub") {
			this.onSub(rng, env);
		} else if (MADE_TYPES.has(type)) {
			const before = this.count;
			this.onMade(rng, env);
			if (this.count === before) {
				this.onSystemPlay(rng, env);
			}
		} else if (type.startsWith("blk")) {
			this.onBlock(rng, env);
		} else if (type === "stl") {
			const before = this.count;
			this.onSteal(rng, env);
			if (this.count === before) {
				this.onSystemPlay(rng, env);
			}
		} else if (type === "orb") {
			this.onOrb(rng, env);
		} else if (type === "timeout") {
			this.onTimeout(rng, env);
		} else if (type === "period") {
			this.onPeriod(rng, env);
		}
	}

	// ---- tip-off ----
	private tipOff(rng: Rng, env: StoryEnv) {
		const bits: string[] = [];
		const g = this.game;
		if (g && !this.playoffs) {
			const line = this.standingLine(rng, env, g.teams);
			if (line) {
				bits.push(line);
				this.calls.push({ idx: env.idx, kind: "standing" });
			}
		}
		// one player with a story: a debut, then a former team, then a big-game reputation in the playoffs
		const starters = [...env.floor(0), ...env.floor(1)];
		const debut = starters.find((p) => this.isDebut(p.pid));
		if (debut) {
			this.debuted.add(debut.pid);
			bits.push(
				this.pick(rng, [
					`${debut.name} makes ${this.his()} professional debut, and ${this.he()} starts.`,
					`A first career game for ${debut.name}, in the starting lineup no less.`,
					`${debut.name} gets the start in ${this.his()} first professional game.`,
				])!,
			);
			this.calls.push({ idx: env.idx, pid: debut.pid, kind: "debut" });
		}
		for (const p of starters) {
			if (this.isDebut(p.pid)) {
				this.debuted.add(p.pid);
			}
		}
		if (bits.length < 2) {
			const former = starters.find((p) => this.x(p.pid, "former") === 1);
			if (former) {
				const o: 0 | 1 = former.t === 0 ? 1 : 0;
				const atHome = o === 0 && !g?.neutral && g !== undefined;
				const line = this.pick(
					rng,
					atHome
						? [
								`${former.name} is back in the building where ${this.he()} used to play, this time in the visitors' uniform.`,
								`A return for ${former.name}: ${this.he()} used to call this arena home.`,
							]
						: [
								`${former.name} faces ${env.the(o)}, ${this.his()} former team.`,
								`Some history here: ${former.name} used to play for ${env.the(o)}.`,
								`${former.name} gets a look at ${this.his()} old team tonight.`,
							],
				);
				if (line) {
					bits.push(line);
					this.said.add(`former${former.pid}`);
					this.calls.push({ idx: env.idx, pid: former.pid, kind: "former" });
				}
			}
		}
		if (bits.length < 2 && this.playoffs) {
			const star = starters.find(
				(p) =>
					(this.x(p.pid, "bigGame") ?? 0) >= 75 &&
					!this.said.has(`former${p.pid}`),
			);
			if (star) {
				bits.push(
					this.pick(rng, [
						`${star.name} has a reputation for rising to the occasion in games like this.`,
						`Playoff basketball, and ${star.name} tends to like the big stage.`,
					])!,
				);
				this.calls.push({ idx: env.idx, pid: star.pid, kind: "bigGame" });
			}
		}
		if (bits.length < 2 && this.systems) {
			const t: 0 | 1 = rng.random() < 0.5 ? 0 : 1;
			const s = this.systems[t];
			const o: 0 | 1 = t === 0 ? 1 : 0;
			const so = this.systems[o];
			bits.push(
				rng.pick([
					`${cap(env.the(t))} ${rng.pick(OFFENSE_PHRASES[s.off])}; ${env.the(o)} ${rng.pick(DEFENSE_PHRASES[so.def])}.`,
					`On the other end, ${env.the(o)} ${rng.pick(OFFENSE_PHRASES[so.off])}, and ${env.the(t)} ${rng.pick(DEFENSE_PHRASES[s.def])}.`,
				]),
			);
			this.calls.push({ idx: env.idx, kind: "system" });
		}
		if (bits.length > 0) {
			env.res.note = [env.res.note, ...bits].filter(Boolean).join(" ");
		}
	}

	// Coaching systems: a play that is what a team's system is about (at most 3 a game)
	private onSystemPlay(rng: Rng, env: StoryEnv) {
		const sys = this.systems;
		const tRaw: unknown = env.ev.t;
		if (!sys || (tRaw !== 0 && tRaw !== 1) || this.systemNotes >= 3) {
			return;
		}
		const t: 0 | 1 = tRaw;
		if (!this.room(env.idx, undefined) || rng.random() > 0.25) {
			return;
		}
		const o: 0 | 1 = t === 0 ? 1 : 0;
		const type: string = env.ev.type;
		const team = cap(env.the(t));
		let lines: string[] | undefined;
		if (type === "stl" && (sys[t].def === "press" || sys[t].def === "blitz")) {
			lines =
				sys[t].def === "press"
					? [
							`The full-court press forces another one for ${env.the(t)}.`,
							`${team}' pressure pays off again.`,
						]
					: [
							`${team} trap the ball handler and it pays off.`,
							`The blitz on the pick-and-roll gets ${env.the(t)} a turnover.`,
						];
		} else if (
			(type === "tp" || type === "tpAndOne") &&
			(sys[o].def === "packPaint" || sys[o].def === "zone")
		) {
			lines = [
				`That's the shot ${env.the(o)} are giving up, and ${env.the(t)} are taking it.`,
				`${cap(env.the(o))} pack it in, so the three is there.`,
			];
		} else if (
			(type === "tp" || type === "tpAndOne") &&
			(sys[t].off === "paceSpace" || sys[t].off === "sevenSeconds")
		) {
			lines = [
				`Spacing and shooting: that's how ${env.the(t)} want to play.`,
				`Another three for ${env.the(t)}, right out of the system.`,
			];
		} else if (
			(type === "fgLowPost" || type === "fgLowPostAndOne") &&
			sys[o].def === "switch"
		) {
			lines = [
				`${cap(env.the(o))} switch, and ${env.the(t)} go right at the mismatch inside.`,
				`Hunting the mismatch after the switch, and it works.`,
			];
		} else if (
			(type === "fgLowPost" || type === "fgLowPostAndOne") &&
			sys[t].off === "post"
		) {
			lines = [
				`${team} go inside, like they always do.`,
				`Through the post again for ${env.the(t)}.`,
			];
		} else if (
			(type === "fgMidRange" || type === "fgMidRangeAndOne") &&
			sys[o].def === "drop"
		) {
			lines = [
				`${cap(env.the(o))} drop back, and the pull-up is open.`,
				`That's the mid-range jumper drop coverage concedes.`,
			];
		}
		if (lines && this.record(env, "system", undefined, this.pick(rng, lines))) {
			this.systemNotes += 1;
		}
	}

	private standingLine(
		rng: Rng,
		env: StoryEnv,
		teams: [TeamStanding, TeamStanding],
	): string | undefined {
		const lines: string[] = [];
		for (const t of [0, 1] as const) {
			const s = teams[t];
			const team = cap(env.the(t));
			if (s.streak >= 3) {
				lines.push(
					rng.pick([
						`${team} come in on a ${s.streak}-game winning streak.`,
						`${team} have won ${s.streak} straight.`,
						`${team} are winners of ${s.streak} in a row.`,
					]),
				);
			} else if (s.streak <= -3) {
				lines.push(
					rng.pick([
						`${team} have dropped ${-s.streak} straight.`,
						`${team} come in having lost ${-s.streak} in a row.`,
						`${team} are looking to snap a ${-s.streak}-game skid.`,
					]),
				);
			}
		}
		const gp = (s: TeamStanding) => s.won + s.lost;
		if (gp(teams[0]) >= 10 && gp(teams[1]) >= 10 && teams[0].numTeams >= 6) {
			const [a, b] = teams;
			if (a.rank <= 3 && b.rank <= 3) {
				lines.push(
					rng.pick([
						"Two of the league's top three teams by record meet tonight.",
						"A meeting of two of the three best records in the league.",
					]),
				);
			} else {
				for (const t of [0, 1] as const) {
					const s = teams[t];
					if (s.rank === 1) {
						lines.push(
							rng.pick([
								`${cap(env.the(t))} sit atop the league standings.`,
								`Nobody in the league has a better record than ${env.the(t)}.`,
							]),
						);
						break;
					}
					if (s.rank === s.numTeams) {
						lines.push(
							rng.pick([
								`${cap(env.the(t))} come in at the bottom of the league standings.`,
								`Nobody in the league has a worse record than ${env.the(t)}.`,
							]),
						);
						break;
					}
				}
			}
		}
		return lines.length > 0 ? lines.slice(0, 2).join(" ") : undefined;
	}

	private isDebut(pid: number) {
		const c = this.careers.get(pid);
		return !!c && c.complete && c.rookie && c.gp === 0 && !this.playoffs;
	}

	// ---- substitutions: a debut off the bench, garbage time ----
	private onSub(rng: Rng, env: StoryEnv) {
		const ev = env.ev;
		const t: 0 | 1 = ev.t;
		const on: number[] = ev.pids ?? [];
		if (this.garbage) {
			for (const pid of on) {
				this.garbageSubs.add(pid);
			}
		}
		const debut = on.find((pid) => this.isDebut(pid) && !this.debuted.has(pid));
		if (debut !== undefined) {
			this.debuted.add(debut);
			const p = env.pl(debut);
			this.record(
				env,
				"debut",
				debut,
				this.pick(rng, [
					`${p.name} checks in for ${this.his()} professional debut.`,
					`First career minutes for ${p.name}.`,
					`${p.name} gets into ${this.his()} first professional game.`,
					`${p.name} makes ${this.his()} debut.`,
				]),
			);
			return;
		}
		// garbage time: the last period of regulation, 6 minutes or less, a lead of 25 or more, and the leading team going to its bench
		const margin = env.score[t] - env.score[t === 0 ? 1 : 0];
		if (
			!this.garbage &&
			env.period === env.numPeriods &&
			env.clock !== undefined &&
			env.clock <= 360 &&
			margin >= 25 &&
			on.length >= 2
		) {
			this.garbage = true;
			for (const pid of on) {
				this.garbageSubs.add(pid);
			}
			this.record(
				env,
				"garbage",
				undefined,
				this.pick(rng, [
					`Garbage time: ${env.the(t)} empty the bench with a ${margin}-point lead.`,
					`With this one decided, ${env.the(t)} send in the reserves.`,
					`The starters can grab a towel; ${env.the(t)} are up ${margin}.`,
					`Mop-up duty begins for ${env.the(t)}, up ${margin}.`,
				]),
			);
		}
	}

	// ---- made shots ----
	private onMade(rng: Rng, env: StoryEnv) {
		const ev = env.ev;
		const pid: number = ev.pid;
		const p = env.pl(pid);
		const res = env.res;
		const tags = res.tags ?? [];
		const shot = res.shot ?? "";
		const three = ev.type === "tp" || ev.type === "tpAndOne";
		const pts = env.stat(pid)?.pts ?? 0;
		const finalPeriod = this.late(env);
		const close = Math.abs(env.score[0] - env.score[1]) <= 4;

		// (the once-a-game calls first: they skip the spacing)
		// making his old team pay
		if (
			this.x(pid, "former") === 1 &&
			finalPeriod &&
			pts >= 20 &&
			!this.said.has(`pays${pid}`)
		) {
			const o: 0 | 1 = p.t === 0 ? 1 : 0;
			if (
				this.record(
					env,
					"formerPays",
					pid,
					this.pick(rng, [
						`${p.name} is making ${this.his()} old team pay: ${pts} points against ${env.the(o)}.`,
						`${pts} for ${p.name} against ${this.his()} former team.`,
					]),
					`pays${pid}`,
				)
			) {
				return;
			}
		}
		// a big-game player in the playoffs
		if (
			this.playoffs &&
			(this.x(pid, "bigGame") ?? 0) >= 75 &&
			(pts === 25 || pts === 26 || pts >= 30) &&
			!this.said.has(`big${pid}`)
		) {
			if (
				this.record(
					env,
					"bigGame",
					pid,
					this.pick(rng, [
						`Big stage, big numbers: ${p.name} has ${pts}.`,
						`This is the time of year ${p.name} lives for. ${pts} points now.`,
						`${p.name} has ${pts}, and ${this.he()} is known for nights like this in the playoffs.`,
					]),
					`big${pid}`,
				)
			) {
				return;
			}
		}
		// a closer: the final period, under two minutes, a close game
		if (
			finalPeriod &&
			env.clock !== undefined &&
			env.clock <= 120 &&
			close &&
			(this.x(pid, "clutch") ?? 0) >= 75 &&
			!this.said.has(`closer${pid}`)
		) {
			if (
				this.record(
					env,
					"closer",
					pid,
					this.pick(rng, [
						`${p.name} wants the ball at this time of night, and it shows.`,
						`Give it to the closer: ${p.name} delivers again.`,
						`${p.name} has always lived for moments like this.`,
					]),
					`closer${pid}`,
				)
			) {
				return;
			}
		}
		// the bench mob: a reserve sent in for garbage time scores
		if (
			this.garbage &&
			this.garbageSubs.has(pid) &&
			(three || /dunk/.test(shot)) &&
			!this.said.has("benchMob")
		) {
			if (
				this.record(
					env,
					"benchMob",
					pid,
					this.pick(rng, [
						"The bench is on its feet for that one.",
						`The reserves on the bench go wild for ${p.name}.`,
						`Towels are waving on the bench for ${p.name}.`,
					]),
					"benchMob",
				)
			) {
				return;
			}
		}

		if (!this.room(env.idx, pid)) {
			return;
		}
		// a ball-secure passer: lots of assists, no turnovers, late
		const astPid: number | undefined = ev.pidAst;
		if (astPid !== undefined && finalPeriod) {
			const a = env.stat(astPid);
			if (
				a &&
				a.ast >= 7 &&
				a.tov === 0 &&
				(this.x(astPid, "bsc") ?? 0) >= 65 &&
				!this.said.has(`secure${astPid}`) &&
				rng.random() < 0.6
			) {
				const ap = env.pl(astPid);
				this.record(
					env,
					"secure",
					astPid,
					this.pick(rng, [
						`${a.ast} assists for ${ap.name}, and not a single turnover.`,
						`${ap.name} has ${a.ast} assists without a turnover. That's how you take care of the ball.`,
						`${poss(ap.name)} handle: ${a.ast} assists, zero giveaways.`,
					]),
					`secure${astPid}`,
				);
				return;
			}
		}
		// catch-and-shoot or off the dribble
		const jumper =
			three || ev.type === "fgMidRange" || ev.type === "fgMidRangeAndOne";
		if (
			jumper &&
			tags.includes("assisted") &&
			(this.x(pid, "csh") ?? 0) >= 70 &&
			rng.random() < 0.22
		) {
			this.record(
				env,
				"catchShoot",
				pid,
				this.pick(rng, [
					`Catch and shoot: that's ${p.name}'s bread and butter.`,
					`${p.name} doesn't need a dribble. Catch, rise, splash.`,
					`Feet set before the ball arrives; ${p.name} is one of the purest spot-up shooters around.`,
					`Find ${p.name} on the catch and it's money.`,
					`One of the best catch-and-shoot players in the league, and ${this.he()} shows why.`,
				]),
			);
			return;
		}
		if (
			jumper &&
			!tags.includes("assisted") &&
			(PULL_UP_SHOTS.has(shot) || (shot === "jumper" && !ev.pidAst)) &&
			(this.x(pid, "dsh") ?? 0) >= 70 &&
			rng.random() < 0.25
		) {
			this.record(
				env,
				"pullUp",
				pid,
				this.pick(rng, [
					`${p.name} can get that jumper off the dribble any time ${this.he()} wants.`,
					`Shot creation: ${p.name} makes it look easy off the bounce.`,
					`Nobody had to set that up for ${p.name}. Off the dribble, all ${this.his()} own.`,
					`${p.name} is as dangerous off the dribble as anyone.`,
				]),
			);
			return;
		}
		// a motor that still runs: a break or a putback in the last period
		if (
			finalPeriod &&
			(this.x(pid, "motor") ?? 0) >= 75 &&
			(tags.includes("transition") ||
				ev.type.startsWith("fgPutBack") ||
				ev.type.startsWith("fgTipIn")) &&
			rng.random() < 0.5
		) {
			this.record(
				env,
				"motor",
				pid,
				this.pick(rng, [
					`${p.name} is still running hard this late. That motor never stops.`,
					`Fresh legs? No, that's just ${p.name}. Still going full speed.`,
					`Late in the game and ${p.name} is still outworking everyone.`,
				]),
			);
		}
	}

	// ---- defense ----
	private onBlock(rng: Rng, env: StoryEnv) {
		const blocker: number = env.ev.pid;
		if (!this.room(env.idx, blocker)) {
			return;
		}
		const b = env.pl(blocker);
		const shooter =
			env.pendingShooter === undefined ? undefined : env.pl(env.pendingShooter);
		const type: string = env.ev.type;
		const jumper = type === "blkMidRange" || type === "blkTp";
		// a guard switched onto a big and won
		if (
			shooter &&
			isGuard(b) &&
			isBig(shooter) &&
			(this.x(blocker, "defensiveVersatility") ?? 0) >= 70 &&
			rng.random() < 0.6
		) {
			this.record(
				env,
				"switch",
				blocker,
				this.pick(rng, [
					`${b.name} switched onto the big man and held ${this.his()} ground.`,
					`Mismatch? Not for ${b.name}, who can guard anybody.`,
					`${b.name} gives up inches on the switch and still gets the stop.`,
				]),
			);
			return;
		}
		if (!jumper && (this.x(blocker, "idef") ?? 0) >= 72 && rng.random() < 0.3) {
			this.record(
				env,
				"wall",
				blocker,
				this.pick(rng, [
					`${b.name} is a wall in there.`,
					`Nothing comes easy at the rim with ${b.name} around.`,
					`${b.name} owns the paint tonight.`,
					`Think twice before going at ${b.name}.`,
				]),
			);
			return;
		}
		if ((this.x(blocker, "wng") ?? 0) >= 72 && rng.random() < 0.3) {
			this.record(
				env,
				"length",
				blocker,
				this.pick(rng, [
					`That wingspan: ${b.name} gets a piece of a shot that looked clean.`,
					`${poss(b.name)} long arms come out of nowhere.`,
					`Length kills. ${b.name} recovers and still gets there.`,
				]),
			);
			return;
		}
		if (jumper && (this.x(blocker, "pdef") ?? 0) >= 72 && rng.random() < 0.3) {
			this.record(
				env,
				"lockdown",
				blocker,
				this.pick(rng, [
					`${b.name} is a lockdown defender, and ${this.he()} stayed glued to ${this.his()} man.`,
					`Perimeter defense of the highest order from ${b.name}.`,
				]),
			);
		}
	}

	private onSteal(rng: Rng, env: StoryEnv) {
		const pid: number = env.ev.pid;
		if (!this.room(env.idx, pid)) {
			return;
		}
		const p = env.pl(pid);
		if ((this.x(pid, "pdef") ?? 0) >= 72 && rng.random() < 0.3) {
			this.record(
				env,
				"lockdown",
				pid,
				this.pick(rng, [
					`${p.name} is a lockdown defender, and ${this.he()} makes ${this.his()} man pay.`,
					`On-ball pressure from ${p.name}; ball handlers hate seeing ${this.female ? "her" : "him"}.`,
					`${p.name} hounds the ball handler into a mistake.`,
				]),
			);
			return;
		}
		if ((this.x(pid, "wng") ?? 0) >= 72 && rng.random() < 0.3) {
			this.record(
				env,
				"length",
				pid,
				this.pick(rng, [
					`${poss(p.name)} long arms get into the passing lane.`,
					`That wingspan takes away the passing lane.`,
					`${p.name} gets a fingertip on it; those arms go on forever.`,
				]),
			);
			return;
		}
		if (
			this.late(env) &&
			(this.x(pid, "motor") ?? 0) >= 75 &&
			rng.random() < 0.35
		) {
			this.record(
				env,
				"motor",
				pid,
				this.pick(rng, [
					`${p.name} is still flying around this late in the game.`,
					`Relentless: ${p.name} hasn't taken a play off.`,
				]),
			);
		}
	}

	private onOrb(rng: Rng, env: StoryEnv) {
		const pid: number = env.ev.pid;
		const n = (this.orb.get(pid) ?? 0) + 1;
		this.orb.set(pid, n);
		if (
			n < 3 ||
			(this.x(pid, "oreb") ?? 0) < 68 ||
			!this.room(env.idx, pid) ||
			this.said.has(`orb${pid}:${n}`) ||
			rng.random() >= 0.45
		) {
			return;
		}
		const p = env.pl(pid);
		const ord = n === 3 ? "3rd" : `${n}th`;
		this.record(
			env,
			"oreb",
			pid,
			this.pick(rng, [
				`That's ${poss(p.name)} ${ord} offensive rebound. ${cap(this.he())} crashes every time.`,
				`${p.name} keeps crashing the offensive glass: ${n} offensive boards now.`,
				`${n} offensive rebounds for ${p.name}. Somebody has to put a body on ${this.female ? "her" : "him"}.`,
				`Another one off the offensive glass for ${p.name}, ${this.his()} ${ord}.`,
			]),
			`orb${pid}:${n}`,
		);
	}

	// ---- leadership ----
	private leaderOf(t: 0 | 1, env: StoryEnv) {
		return env
			.floor(t)
			.filter((p) => (this.x(p.pid, "leadership") ?? 0) >= 75)
			.sort(
				(a, b) =>
					(this.x(b.pid, "leadership") ?? 0) -
						(this.x(a.pid, "leadership") ?? 0) || a.pid - b.pid,
			)[0];
	}

	private onTimeout(rng: Rng, env: StoryEnv) {
		const t: 0 | 1 = env.ev.t;
		const o: 0 | 1 = t === 0 ? 1 : 0;
		if (env.run.t !== o || env.run.S < 8 || this.said.has(`leader${t}`)) {
			return;
		}
		const p = this.leaderOf(t, env);
		if (!p) {
			return;
		}
		const age = this.careers.get(p.pid)?.age;
		const who =
			age !== undefined && age >= 30 ? `the veteran ${p.name}` : p.name;
		this.record(
			env,
			"leader",
			p.pid,
			this.pick(rng, [
				`${cap(who)} gathers everyone on the way to the bench.`,
				`${cap(who)} is doing the talking in the huddle before the coach gets there.`,
				`You can see ${who} rallying the group.`,
			]),
			`leader${t}`,
		);
	}

	private onPeriod(rng: Rng, env: StoryEnv) {
		// the last period of a close game: a leader on the floor (the five who start it are not known yet; those who ended the last one are)
		if (
			env.ev.type !== "period" ||
			env.period !== env.numPeriods ||
			Math.abs(env.score[0] - env.score[1]) > 6
		) {
			return;
		}
		for (const t of rng.random() < 0.5
			? ([0, 1] as const)
			: ([1, 0] as const)) {
			if (this.said.has(`leader${t}`)) {
				continue;
			}
			const p = this.leaderOf(t, env);
			if (p && rng.random() < 0.6) {
				this.record(
					env,
					"leader",
					p.pid,
					this.pick(rng, [
						`${p.name} pulls ${this.his()} teammates together before the final period. ${cap(this.he())} has been here before.`,
						`${p.name}, the voice of that locker room, has the group huddled up.`,
					]),
					`leader${t}`,
				);
				return;
			}
		}
	}
}
