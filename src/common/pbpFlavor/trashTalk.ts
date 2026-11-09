/* Trash talk in the play-by-play, driven by the Temper player trait (basketball, the playerTraits setting). Cosmetic only: it words what the
   sim already logged and adds a note line. Its choices come from its own seeded generator (rng.ts, seeded with the game id and the event's
   position, on a stream no other part of the flavor layer uses), never Math.random, so a game's result can't depend on it and the rest of the
   wording is the same with or without it.

   Temper is 0-100 with 50 average; LOW temper is a hothead (see common/playerTraits). Only clear hotheads (score below 45) ever talk, more the
   lower the score; even-keeled players never do. Game context (playoffs, a rivalry, a close game late, a big run, a game that is already
   heated) makes it more likely. */
import { Rng } from "./rng.ts";
import type { FPlayer } from "./types.ts";

// How hot-headed: 0 at a temper score of 45 or more (never talks), 1 at 10 or less
export const trashTalkHeat = (temper: number | undefined) =>
	temper === undefined || !Number.isFinite(temper)
		? 0
		: Math.max(0, Math.min(1, (45 - temper) / 35));

export type TrashTalkContext = {
	playoffs?: boolean;
	rivalry?: boolean;
	// Within 6 points
	close?: boolean;
	// Final period or overtime
	late?: boolean;
	// The talker's team is on a run of this many unanswered-ish points
	run?: number;
	// How many trash talk moments, technicals and flagrants this game has had already
	heated?: number;
};

// Context multiplier, 1 for an ordinary regular season moment
export const trashTalkContextMult = (c: TrashTalkContext) =>
	(c.playoffs ? 1.5 : 1) *
	(c.rivalry ? 1.5 : 1) *
	(c.close && c.late ? 1.4 : c.close ? 1.15 : 1) *
	((c.run ?? 0) >= 8 ? 1.3 : 1) *
	(1 + 0.15 * Math.min(4, c.heated ?? 0));

// Base chances at heat 1 and context 1
export const TRASH_TALK_RATES = {
	bigPlay: 0.22,
	jawing: 0.12,
	// Lines per player per game, at most
	perPlayer: 3,
	// Events between two trash talk lines, at least
	cooldown: 8,
};

export type BigPlay = "dunk" | "andOne" | "three" | "block";

const BIG_PLAY: Record<BigPlay, ((p: string, o: string) => string)[]> = {
	dunk: [
		(p, o) => `${p} stares down ${o} after the slam.`,
		(p, o) => `${p} lets ${o} hear about it on the way back up the court.`,
		(p) => `${p} hangs on the rim a beat too long and yells at the crowd.`,
		(p, o) => `${p} stands over ${o} for a second before jogging back.`,
		(p, o) => `${p} tells ${o} to "get that out of here" on the way back.`,
	],
	andOne: [
		(p, o) => `${p} screams "and one!" right in ${o}'s face.`,
		(p) => `${p} flexes for the crowd after the and-one.`,
		(p, o) => `${p} has a few words for ${o} before heading to the line.`,
		(p) => `${p} pounds his chest and points to the bench.`,
	],
	three: [
		(p, o) => `${p} backpedals and says something to ${o} after the three.`,
		(p, o) => `${p} holds the follow-through, staring at ${o}.`,
		(p) => `${p} turns to the opposing bench after that one.`,
		(p, o) => `${p} waves goodbye to ${o} as it drops.`,
		(p, o) => `${p} tells ${o} he can't guard him.`,
		(p) => `${p} puts three fingers up at the crowd and keeps talking.`,
	],
	block: [
		(p, o) => `${p} lets ${o} know he's not welcome in here.`,
		(p, o) => `${p} wags a finger at ${o}.`,
		(p) => `${p} barks at the crowd after the rejection.`,
		(p, o) => `${p} stands over ${o} after the swat.`,
	],
};

const JAWING_ONE: ((p: string, o: string) => string)[] = [
	(p, o) => `${p} has words for ${o} after the whistle.`,
	(p, o) => `${p} gets in ${o}'s ear on the way down the floor.`,
	(p, o) => `${p} and ${o} bump shoulders; ${p} keeps talking.`,
	(p) => `${p} is chirping at anyone who will listen.`,
];

const JAWING_BOTH: ((p: string, o: string) => string)[] = [
	(p, o) => `Words exchanged between ${p} and ${o}.`,
	(p, o) => `${p} and ${o} get into it; the refs step in to separate them.`,
	(p, o) => `${p} and ${o} jaw at each other all the way to the other end.`,
	(p, o) => `The officials have to pull ${p} and ${o} apart.`,
];

const TECH_LEAD_IN: ((p: string) => string)[] = [
	(p) => `${p} has been chirping all night...`,
	(p) => `${p} has been barking at the refs for a while now...`,
	(p) => `${p} just won't let it go...`,
	(p) => `${p} has been getting into it with the other bench...`,
];

const TECH_LEAD_IN_HOTHEAD: ((p: string) => string)[] = [
	(p) => `${p} was always going to lose it tonight...`,
	(p) => `That temper of ${p}'s finally boils over...`,
];

// Every line this layer can write, with "\u0001" and "\u0002" for the names: for tests
export const trashTalkTemplatesForTests = () => {
	const out: string[] = [];
	for (const list of [
		...Object.values(BIG_PLAY),
		JAWING_ONE,
		JAWING_BOTH,
		TECH_LEAD_IN,
		TECH_LEAD_IN_HOTHEAD,
	]) {
		for (const f of list) {
			out.push(f("\u0001", "\u0002"));
		}
	}
	return out;
};

// Stream id for this layer's generator (other flavor streams are small numbers)
const STREAM = 7_000_000;

export class TrashTalk {
	private gid: number;
	private heat = new Map<number, number>();
	private said = new Map<number, number>();
	private lastIdx = -Infinity;
	private used = new Set<string>();
	heated = 0;
	readonly active: boolean;

	constructor(gid: number, tempers: Map<number, number | undefined>) {
		this.gid = gid;
		for (const [pid, temper] of tempers) {
			const h = trashTalkHeat(temper);
			if (h > 0) {
				this.heat.set(pid, h);
			}
		}
		this.active = this.heat.size > 0;
	}

	heatOf(pid: number | undefined) {
		return pid === undefined ? 0 : (this.heat.get(pid) ?? 0);
	}

	// Pick a template not used yet this game (then any), so the same line doesn't come up twice in a row
	// Pick a template he hasn't used this game (one nobody has used, if there is one), so no line ever repeats. Undefined when he has used
	// them all
	private template<T>(
		rng: Rng,
		group: string,
		list: readonly T[],
		pid: number,
	): T | undefined {
		const options = list.map((x, i) => ({ x, key: `${group}|${i}` }));
		const mine = options.filter(({ key }) => !this.used.has(`${key}|${pid}`));
		const fresh = mine.filter(({ key }) => !this.used.has(key));
		const pool = fresh.length > 0 ? fresh : mine;
		if (pool.length === 0) {
			return;
		}
		const choice = rng.pick(pool);
		this.used.add(choice.key);
		this.used.add(`${choice.key}|${pid}`);
		return choice.x;
	}

	private canTalk(idx: number, pid: number) {
		return (
			idx - this.lastIdx >= TRASH_TALK_RATES.cooldown &&
			(this.said.get(pid) ?? 0) < TRASH_TALK_RATES.perPlayer
		);
	}

	private record(idx: number, pid: number) {
		this.lastIdx = idx;
		this.said.set(pid, (this.said.get(pid) ?? 0) + 1);
		this.heated += 1;
	}

	// After a big make (dunk, and-one, three) or a block, the player may talk to the man he did it to
	bigPlay(
		idx: number,
		kind: BigPlay,
		p: FPlayer,
		// The man he did it to, or the opponents on the floor to pick one from
		target: FPlayer | readonly FPlayer[] | undefined,
		context: TrashTalkContext,
	): string | undefined {
		const heat = this.heatOf(p.pid);
		if (heat <= 0 || !this.canTalk(idx, p.pid)) {
			return;
		}
		const rng = new Rng(this.gid, STREAM + idx);
		const prob = Math.min(
			0.6,
			TRASH_TALK_RATES.bigPlay *
				heat *
				trashTalkContextMult({ ...context, heated: this.heated }),
		);
		if (rng.random() >= prob) {
			return;
		}
		const f = this.template(rng, kind, BIG_PLAY[kind], p.pid);
		if (!f) {
			return;
		}
		this.record(idx, p.pid);
		const who = Array.isArray(target)
			? target.length > 0
				? rng.pick(target)
				: undefined
			: (target as FPlayer | undefined);
		return f(p.name, who?.name ?? "the defense");
	}

	// After a foul between two players: one hothead talking, or both getting into it
	jawing(
		idx: number,
		a: FPlayer,
		b: FPlayer,
		context: TrashTalkContext,
	): string | undefined {
		const ha = this.heatOf(a.pid);
		const hb = this.heatOf(b.pid);
		if (ha <= 0 && hb <= 0) {
			return;
		}
		const [talker, other] = ha >= hb ? [a, b] : [b, a];
		if (!this.canTalk(idx, talker.pid)) {
			return;
		}
		const rng = new Rng(this.gid, STREAM + idx);
		const prob = Math.min(
			0.5,
			TRASH_TALK_RATES.jawing *
				Math.max(ha, hb) *
				trashTalkContextMult({ ...context, heated: this.heated }),
		);
		if (rng.random() >= prob) {
			return;
		}
		const both = ha > 0 && hb > 0;
		const f = both
			? this.template(rng, "both", JAWING_BOTH, talker.pid)
			: this.template(rng, "one", JAWING_ONE, talker.pid);
		if (!f) {
			return;
		}
		this.record(idx, talker.pid);
		if (both) {
			this.said.set(other.pid, (this.said.get(other.pid) ?? 0) + 1);
		}
		return f(talker.name, other.name);
	}

	// A technical on a player who has been talking (or a real hothead) gets a lead-in. Always (no chance involved) when he has been talking
	techLeadIn(idx: number, p: FPlayer | undefined): string | undefined {
		this.heated += 1;
		if (!p) {
			return;
		}
		const talked = (this.said.get(p.pid) ?? 0) > 0;
		const heat = this.heatOf(p.pid);
		if (!talked && heat < 0.5) {
			return;
		}
		const rng = new Rng(this.gid, STREAM + idx);
		const f = talked
			? this.template(rng, "tech", TECH_LEAD_IN, p.pid)
			: this.template(rng, "techHot", TECH_LEAD_IN_HOTHEAD, p.pid);
		return f?.(p.name);
	}
}

// The temper scores the sim sends with each player's play-by-play ratings (only with player traits on)
export const tempersFromPlayers = (
	players: readonly { pid: number; ratings?: Record<string, number> }[],
) => {
	const out = new Map<number, number | undefined>();
	for (const p of players) {
		const temper = p.ratings?.["temper"];
		out.set(p.pid, typeof temper === "number" ? temper : undefined);
	}
	return out;
};

const DUNK_RE =
	/dunk|slam|jam|flush|throws it down|hammers|tomahawk|posteriz|windmill|rocks the rim/i;

export type TrashTalkHost = {
	idx: number;
	// The shooter of the attempt this event finishes (for blocks)
	pendingShooter: number | undefined;
	pl: (pid: number) => FPlayer;
	// The players of team t on the floor
	floor: (t: 0 | 1) => FPlayer[];
	score: [number, number];
	late: boolean;
	run: { t: 0 | 1 | undefined; S: number };
	playoffs?: boolean;
	rivalry?: boolean;
};

const addNote = (res: { note?: string }, line: string | undefined) => {
	if (line) {
		res.note = [res.note, line].filter(Boolean).join(" ");
	}
};

// The hook the session calls once per worded event: may add a note (trash talk after a big play, jawing after a foul) or a lead-in to a
// technical foul. Does nothing unless a hothead is in the game
export const applyTrashTalk = (
	tt: TrashTalk,
	ev: any,
	res: { text: string; note?: string },
	host: TrashTalkHost,
) => {
	if (!tt.active || !ev) {
		return;
	}
	const type: string = ev.type;
	const context = (t: 0 | 1): TrashTalkContext => {
		const o = t === 0 ? 1 : 0;
		return {
			playoffs: host.playoffs,
			rivalry: host.rivalry,
			close: Math.abs(host.score[t] - host.score[o]) <= 6,
			late: host.late,
			run: host.run.t === t ? host.run.S : 0,
		};
	};
	if (type === "techFoul") {
		const lead = tt.techLeadIn(
			host.idx,
			ev.pid === undefined ? undefined : host.pl(ev.pid),
		);
		if (lead) {
			res.text = `${lead} ${res.text}`;
		}
		return;
	}
	if (typeof ev.pid !== "number" || (ev.t !== 0 && ev.t !== 1)) {
		return;
	}
	const t: 0 | 1 = ev.t;
	const p = host.pl(ev.pid);
	if (type.startsWith("blk")) {
		const target =
			host.pendingShooter === undefined
				? undefined
				: host.pl(host.pendingShooter);
		addNote(res, tt.bigPlay(host.idx, "block", p, target, context(t)));
		return;
	}
	if (type === "flagrantFoul") {
		tt.heated += 1;
	}
	if (
		type === "flagrantFoul" ||
		type === "pfFG" ||
		type === "pfTP" ||
		type === "pfBonus"
	) {
		if (typeof ev.pidShooting === "number") {
			addNote(res, tt.jawing(host.idx, p, host.pl(ev.pidShooting), context(t)));
		}
		return;
	}
	const andOne = type.endsWith("AndOne");
	const three = type === "tp" || type === "tpAndOne";
	const made =
		type.startsWith("fg") && !type.startsWith("fga")
			? true
			: type === "tp" || type === "tpAndOne";
	if (!made) {
		return;
	}
	const kind: BigPlay | undefined = andOne
		? "andOne"
		: three
			? "three"
			: DUNK_RE.test(res.text)
				? "dunk"
				: undefined;
	if (!kind) {
		return;
	}
	const targetPid =
		typeof ev.pidDefense === "number"
			? ev.pidDefense
			: typeof ev.pidFoul === "number"
				? ev.pidFoul
				: undefined;
	addNote(
		res,
		tt.bigPlay(
			host.idx,
			kind,
			p,
			targetPid === undefined
				? host.floor(t === 0 ? 1 : 0)
				: host.pl(targetPid),
			context(t),
		),
	);
};
