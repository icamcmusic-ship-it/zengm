/* Trash talk in the play-by-play, driven by the Temper player trait (basketball, the playerTraits setting). Cosmetic only: it words what the
   sim already logged and adds a note line. Its choices come from its own seeded generator (rng.ts, seeded with the game id and the event's
   position, on a stream no other part of the flavor layer uses), never Math.random, so a game's result can't depend on it and the rest of the
   wording is the same with or without it.

   Temper is 0-100 with 50 average; LOW temper is a hothead (see common/playerTraits). Only clear hotheads (score below 45) ever start
   anything, more the lower the score; even-keeled players never do (they can only answer with a shot, or step in to calm a teammate down).
   Game context (playoffs, a heated or bitter rivalry, a close game late, a big run, a game that is already heated) makes it more likely.

   Situations: after a dunk, an and-one, a three, a block or a steal he turned into a basket; jawing after a foul; two players who keep
   going at each other all game (a feud, once both have had words); talking at the other bench on the way to a timeout; a calm teammate
   (a veteran, when his age is known) walking a hothead away; the home crowd getting on a visitor who has been talking; the player who was
   talked at answering with a big shot; a lead-in to a technical foul, and a second technical on the other side soon after the first
   ("it has boiled over"). Technical fouls are only ever worded: the layer never makes one up. */
import { Rng } from "./rng.ts";
import type { FPlayer } from "./types.ts";

// How hot-headed: 0 at a temper score of 45 or more (never talks), 1 at 10 or less
export const trashTalkHeat = (temper: number | undefined) =>
	temper === undefined || !Number.isFinite(temper)
		? 0
		: Math.max(0, Math.min(1, (45 - temper) / 35));

export type TrashTalkContext = {
	playoffs?: boolean;
	// true or 1: a heated rivalry; 2: a bitter one (the tiers of common/rivalries)
	rivalry?: boolean | number;
	// Within 6 points
	close?: boolean;
	// Final period or overtime
	late?: boolean;
	// The talker's team is on a run of this many unanswered-ish points
	run?: number;
	// How many trash talk moments, technicals and flagrants this game has had already
	heated?: number;
};

export const rivalryLevel = (r: boolean | number | undefined) =>
	r === true ? 1 : typeof r === "number" && Number.isFinite(r) ? r : 0;

// The rivalry tiers that reach the play-by-play (the init event's pbpRivalry): 1 heated, 2 bitter
export const rivalryLevelOfTier = (tier: string | undefined) =>
	tier === "Bitter" ? 2 : tier === "Heated" ? 1 : 0;

// Context multiplier, 1 for an ordinary regular season moment
export const trashTalkContextMult = (c: TrashTalkContext) => {
	const rivalry = rivalryLevel(c.rivalry);
	return (
		(c.playoffs ? 1.5 : 1) *
		(rivalry >= 2 ? 2 : rivalry >= 1 ? 1.5 : 1) *
		(c.close && c.late ? 1.4 : c.close ? 1.15 : 1) *
		((c.run ?? 0) >= 8 ? 1.3 : 1) *
		(1 + 0.15 * Math.min(4, c.heated ?? 0))
	);
};

// Base chances at heat 1 and context 1
export const TRASH_TALK_RATES = {
	bigPlay: 0.22,
	jawing: 0.12,
	// Talking at the other bench on the way to a timeout the other team had to call
	bench: 0.3,
	// The home crowd getting on a visitor who has been talking, after his miss at the line or his turnover
	crowd: 0.35,
	// A calm teammate stepping in after jawing or a technical
	calm: 0.4,
	// The player who was talked at answering with a big shot (no temper needed: he is answering)
	answer: 0.4,
	// How much likelier two players who have already had words are to go again
	feud: 2,
	// Lines per player per game, at most (two more for a feud)
	perPlayer: 3,
	// Events between two trash talk lines, at least
	cooldown: 8,
	// How long (in events) an answer, a steal turned into a basket, or a second technical still counts
	answerWindow: 30,
	stealWindow: 6,
	techWindow: 45,
	// Lines a game, at most (more in the playoffs and in a rivalry game)
	perGame: 12,
};

export type BigPlay = "dunk" | "andOne" | "three" | "block" | "stealScore";

type Line2 = (p: string, o: string) => string;

const BIG_PLAY: Record<BigPlay, Line2[]> = {
	dunk: [
		(p, o) => `${p} stares down ${o} after the slam.`,
		(p, o) => `${p} lets ${o} hear about it on the way back up the court.`,
		(p) => `${p} hangs on the rim a beat too long and yells at the crowd.`,
		(p, o) => `${p} stands over ${o} for a second before jogging back.`,
		(p, o) => `${p} tells ${o} to "get that out of here" on the way back.`,
		(p, o) => `${p} lands, turns and glares at ${o}.`,
		(p, o) => `A long look at ${o} from ${p} as he backpedals.`,
		(p) => `${p} lets out a roar toward the baseline seats.`,
		(p, o) => `${p} has a word for ${o} while the ball is still bouncing.`,
		(p, o) => `${p} flexes in front of ${o} and takes his time getting back.`,
		(p) => `${p} mean-mugs the whole front row on his way down the floor.`,
	],
	andOne: [
		(p, o) => `${p} screams "and one!" right in ${o}'s face.`,
		(p) => `${p} flexes for the crowd after the and-one.`,
		(p, o) => `${p} has a few words for ${o} before heading to the line.`,
		(p) => `${p} pounds his chest and points to the bench.`,
		(p, o) => `${p} pops up off the floor and lets ${o} know he's too small.`,
		(p, o) => `${p} claps in ${o}'s direction on his way to the stripe.`,
		(p) =>
			`${p} stays down for a second, grinning, then shouts at the rafters.`,
		(p, o) => `${p} tells ${o} that's going to happen all night.`,
		(p, o) => `${p} gives ${o} a little shrug before the free throw.`,
	],
	three: [
		(p, o) => `${p} backpedals and says something to ${o} after the three.`,
		(p, o) => `${p} holds the follow-through, staring at ${o}.`,
		(p) => `${p} turns to the opposing bench after that one.`,
		(p, o) => `${p} waves goodbye to ${o} as it drops.`,
		(p, o) => `${p} tells ${o} he can't guard him.`,
		(p) => `${p} puts three fingers up at the crowd and keeps talking.`,
		(p, o) => `${p} is talking to ${o} before the ball is through the net.`,
		(p) => `${p} shushes the other bench on his way back.`,
		(p, o) => `${p} taps his wrist at ${o}: too late on the closeout.`,
		(p, o) => `${p} shrugs at ${o} and jogs back.`,
		(p) => `${p} has plenty to say to the other sideline after that one.`,
		(p, o) =>
			`${p} asks ${o} if he wants to step out a little further next time.`,
	],
	block: [
		(p, o) => `${p} lets ${o} know he's not welcome in here.`,
		(p, o) => `${p} wags a finger at ${o}.`,
		(p) => `${p} barks at the crowd after the rejection.`,
		(p, o) => `${p} stands over ${o} after the swat.`,
		(p, o) => `${p} tells ${o} not to bring that in here again.`,
		(p, o) => `${p} has a long look at ${o} after sending it back.`,
		(p) => `${p} shakes his head at the other bench: not tonight.`,
		(p, o) => `${p} is in ${o}'s ear about that one all the way up the floor.`,
		(p, o) => `${p} points at ${o}, then at the spot where the ball landed.`,
		(p) => `${p} lets out a yell and slaps the floor.`,
	],
	stealScore: [
		(p, o) => `${p} points back at ${o} after turning the steal into points.`,
		(p, o) => `${p} tells ${o} to take better care of the ball.`,
		(p, o) => `${p} thanks ${o} for the gift on his way back.`,
		(p, o) => `${p} has a laugh in ${o}'s direction after that one.`,
		(p) =>
			`${p} picks a pocket, scores, and tells the other bench all about it.`,
		(p, o) => `${p} holds a hand out to ${o}, asking for another one.`,
		(p, o) => `${p} lets ${o} know that one was too easy.`,
		(p) => `${p} cups a hand to his ear in front of the crowd.`,
	],
};

const JAWING_ONE: Line2[] = [
	(p, o) => `${p} has words for ${o} after the whistle.`,
	(p, o) => `${p} gets in ${o}'s ear on the way down the floor.`,
	(p, o) => `${p} and ${o} bump shoulders; ${p} keeps talking.`,
	(p) => `${p} is chirping at anyone who will listen.`,
	(p, o) => `${p} doesn't like it and tells ${o} so.`,
	(p, o) => `${p} follows ${o} for a few steps, still talking.`,
	(p, o) => `${p} claps sarcastically in ${o}'s direction.`,
	(p, o) => `${p} has something to say; ${o} just walks away.`,
	(p) => `${p} keeps talking long after the whistle.`,
	(p, o) => `${p} lets ${o} know what he thought of that.`,
];

const JAWING_BOTH: Line2[] = [
	(p, o) => `Words exchanged between ${p} and ${o}.`,
	(p, o) => `${p} and ${o} get into it; the refs step in to separate them.`,
	(p, o) => `${p} and ${o} jaw at each other all the way to the other end.`,
	(p, o) => `The officials have to pull ${p} and ${o} apart.`,
	(p, o) => `${p} and ${o} go nose to nose before teammates get between them.`,
	(p, o) => `${p} and ${o} are face to face, and neither one is backing up.`,
	(p, o) => `A little shove from ${p}, a few words back from ${o}.`,
	(p, o) =>
		`${p} and ${o} have a long conversation, and it isn't a friendly one.`,
	(p, o) =>
		`An official steps between ${p} and ${o} and tells them both to knock it off.`,
];

// Two players who have already had words this game
const FEUD: Line2[] = [
	(p, o) => `${p} and ${o} are at it again.`,
	(p, o) => `More from ${p} and ${o}; this has been going on for a while.`,
	(p, o) => `${p} makes sure ${o} saw that one.`,
	(p, o) => `${p} has the last word with ${o}, for now.`,
	(p, o) => `That one was for ${o}, and ${p} tells him so.`,
	(p, o) => `${p} and ${o} pick up right where they left off.`,
	(p, o) => `${p} goes looking for ${o} on the way back down the floor.`,
	(p, o) => `The running conversation between ${p} and ${o} continues.`,
	(p, o) => `${p} and ${o} still have plenty to say to each other.`,
	(p, o) => `${p} with another message for ${o}.`,
];

// Deep into a feud (the third exchange and later)
const FEUD_LONG: Line2[] = [
	(p, o) => `${p} and ${o} have been going at each other all night.`,
	(p, o) => `This has become personal between ${p} and ${o}.`,
	(p, o) =>
		`${p} and ${o} again. The officials are keeping a close eye on those two.`,
	(p, o) => `Nobody is enjoying ${p} against ${o} more than the crowd.`,
	(p, o) => `${p} and ${o} are playing their own game inside this one.`,
];

// On the way to a timeout the other team called
const BENCH: ((p: string) => string)[] = [
	(p) => `${p} is still talking as the teams head to the benches.`,
	(p) => `${p} walks past the other bench with something to say.`,
	(p) =>
		`${p} lets the other bench know about the run on his way to the huddle.`,
	(p) => `${p} waves the opposing bench off as the timeout is called.`,
	(p) => `${p} tells the other huddle a timeout won't help.`,
	(p) => `${p} stares at the opposing bench the whole way to his own.`,
	(p) => `${p} has a few words for the other coach on his way to the bench.`,
];

// A calm teammate steps in (c), the hothead is p
const CALM: Line2[] = [
	(c, p) => `${c} pulls ${p} away before it goes any further.`,
	(c, p) => `${c} gets an arm around ${p} and walks him back.`,
	(c, p) => `${c} steps in front of ${p} and tells him to let it go.`,
	(c, p) => `${c} has a quiet word with ${p}.`,
	(c, p) => `${c} drags ${p} toward the other end of the floor.`,
	(c, p) => `${c} puts a hand on ${p}'s chest: that's enough.`,
];
const CALM_VETERAN: Line2[] = [
	(c, p) => `The veteran ${c} pulls ${p} aside and settles him down.`,
	(c, p) => `${c}, the veteran, gets between ${p} and trouble.`,
	(c, p) => `${c} has seen this before; he walks ${p} away from it.`,
	(c, p) => `A word from the veteran ${c}, and ${p} lets it go.`,
	(c, p) => `${c} uses all of his experience to talk ${p} down.`,
];

// The home crowd on a visitor who has been talking
const CROWD: ((p: string) => string)[] = [
	(p) => `The crowd lets ${p} hear it after that one.`,
	(p) => `The home fans have been waiting for that: ${p} gets an earful.`,
	(p) => `${p} hears it from every corner of the building.`,
	(p) => `The crowd has not forgotten what ${p} had to say earlier.`,
	(p) => `Loud, mocking cheers for ${p}.`,
	(p) => `The fans behind the basket are all over ${p} now.`,
	(p) =>
		`${p} has made himself the villain tonight, and the crowd loves that one.`,
];

// The player who was talked at (p) answers the talker (o) with a big shot
const ANSWER: Line2[] = [
	(p, o) => `${p} answers ${o} without saying a word.`,
	(p, o) => `That's ${p}'s reply to ${o}.`,
	(p, o) => `${p} heard everything ${o} had to say. There's his answer.`,
	(p, o) => `${p} lets his game do the talking back to ${o}.`,
	(p, o) => `${o} did the talking; ${p} just did the scoring.`,
	(p, o) => `${p} looks over at ${o} and says nothing at all.`,
	(p, o) => `No words from ${p}, just a basket, and a glance at ${o}.`,
];

const TECH_LEAD_IN: ((p: string) => string)[] = [
	(p) => `${p} has been chirping all night...`,
	(p) => `${p} has been barking at the refs for a while now...`,
	(p) => `${p} just won't let it go...`,
	(p) => `${p} has been getting into it with the other bench...`,
	(p) => `${p} was warned once already...`,
	(p) => `${p} had one more thing to say, and it was one too many...`,
	(p) => `The officials have heard enough from ${p}...`,
];

const TECH_LEAD_IN_HOTHEAD: ((p: string) => string)[] = [
	(p) => `${p} was always going to lose it tonight...`,
	(p) => `That temper of ${p}'s finally boils over...`,
	(p) => `${p} has a short fuse, and it just ran out...`,
	(p) => `Nobody who has watched ${p} play will be surprised...`,
];

// A technical on the other side soon after one on this side (two real technical foul events, one each way)
const TECH_BOTH: ((p: string) => string)[] = [
	(p) =>
		`It has boiled over: a technical on each side now. This one is on ${p}...`,
	(p) => `Now ${p} gets one too, and that's a technical each way in a hurry...`,
	(p) =>
		`The officials are trying to get this game back under control, and ${p} is next...`,
	(p) =>
		`Tempers on both sides now: the second technical in a matter of minutes, this one on ${p}...`,
];

const EJECTED: ((p: string) => string)[] = [
	(p) => `${p} is still talking on his way to the tunnel.`,
	(p) => `${p} has one last thing to say to the officials before he goes.`,
	(p) => `${p} waves to the crowd on his way out.`,
];

// Every line this layer can write, with "\u0001" and "\u0002" for the names: for tests
export const trashTalkTemplatesForTests = () => {
	const out: string[] = [];
	for (const list of [
		...Object.values(BIG_PLAY),
		JAWING_ONE,
		JAWING_BOTH,
		FEUD,
		FEUD_LONG,
		BENCH,
		CALM,
		CALM_VETERAN,
		CROWD,
		ANSWER,
		TECH_LEAD_IN,
		TECH_LEAD_IN_HOTHEAD,
		TECH_BOTH,
		EJECTED,
	] as Line2[][]) {
		for (const f of list) {
			out.push(f("\u0001", "\u0002"));
		}
	}
	return out;
};

// Stream ids for this layer's generator (other flavor streams are small numbers; the career calls use 8,000,000)
const STREAM = 7_000_000;
const STREAM_CALM = 9_000_000;

// A calm player: the only kind who steps in
const CALM_TEMPER = 58;
const VETERAN_AGE = 30;

const pairKey = (a: number, b: number) => (a < b ? `${a}|${b}` : `${b}|${a}`);

export class TrashTalk {
	private gid: number;
	private heat = new Map<number, number>();
	private tempers: Map<number, number | undefined>;
	private ages = new Map<number, number>();
	private said = new Map<number, number>();
	private lastIdx = -Infinity;
	private used = new Set<string>();
	private total = 0;
	private cap: number = TRASH_TALK_RATES.perGame;
	// pairs who have had words, and how many times
	private feuds = new Map<string, number>();
	// the last time someone was talked at: he may answer
	private talkedAt:
		| { talker: FPlayer; target: number; idx: number }
		| undefined;
	private lastSteal: { pid: number; victim: number; idx: number } | undefined;
	private lastTech: { t: 0 | 1; idx: number } | undefined;
	private crowdSaid = new Set<number>();
	private calmSaid = 0;
	private teched = new Set<number>();
	heated = 0;
	readonly active: boolean;
	// What was said, for tests and tuning: the kind of line, who started it (for "answer" and "calm": the player answering or stepping
	// in, who started nothing) and who it was aimed at
	readonly log: { idx: number; kind: string; pid: number; other?: number }[] =
		[];

	constructor(
		gid: number,
		tempers: Map<number, number | undefined>,
		ages?: Map<number, number>,
	) {
		this.gid = gid;
		this.tempers = tempers;
		if (ages) {
			this.ages = ages;
		}
		for (const [pid, temper] of tempers) {
			const h = trashTalkHeat(temper);
			if (h > 0) {
				this.heat.set(pid, h);
			}
		}
		this.active = this.heat.size > 0;
	}

	// The game's context raises how many lines it can have
	setContext(c: Pick<TrashTalkContext, "playoffs" | "rivalry">) {
		this.cap =
			TRASH_TALK_RATES.perGame +
			(c.playoffs ? 4 : 0) +
			3 * Math.min(2, rivalryLevel(c.rivalry));
	}

	heatOf(pid: number | undefined) {
		return pid === undefined ? 0 : (this.heat.get(pid) ?? 0);
	}

	// Has he talked (or been given a technical) this game?
	hasTalked(pid: number) {
		return (this.said.get(pid) ?? 0) > 0 || this.teched.has(pid);
	}

	feudCount(a: number, b: number) {
		return this.feuds.get(pairKey(a, b)) ?? 0;
	}

	// The opponent on the floor he has a feud with, if any
	feudPartner(pid: number, floor: readonly FPlayer[]) {
		return floor.find((q) => this.feudCount(pid, q.pid) > 0);
	}

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

	private canTalk(idx: number, pid: number, extra = 0) {
		return (
			idx - this.lastIdx >= TRASH_TALK_RATES.cooldown &&
			this.total < this.cap &&
			(this.said.get(pid) ?? 0) < TRASH_TALK_RATES.perPlayer + extra
		);
	}

	private record(idx: number, pid: number) {
		this.lastIdx = idx;
		this.total += 1;
		this.said.set(pid, (this.said.get(pid) ?? 0) + 1);
		this.heated += 1;
	}

	// The line for a pair with a feud going, or undefined when they have none (or its lines are used up)
	private feudLine(rng: Rng, p: FPlayer, o: FPlayer): Line2 | undefined {
		const n = this.feudCount(p.pid, o.pid);
		if (n <= 0) {
			return;
		}
		return (
			(n >= 2 ? this.template(rng, "feudLong", FEUD_LONG, p.pid) : undefined) ??
			this.template(rng, "feud", FEUD, p.pid)
		);
	}

	private addFeud(a: FPlayer, b: FPlayer) {
		// (it takes two: a calm player doesn't feud)
		if (this.heatOf(a.pid) > 0 && this.heatOf(b.pid) > 0 && a.t !== b.t) {
			const key = pairKey(a.pid, b.pid);
			this.feuds.set(key, (this.feuds.get(key) ?? 0) + 1);
		}
	}

	// After a big make (dunk, and-one, three), a block or a steal he scored from, the player may talk to the man he did it to
	bigPlay(
		idx: number,
		kind: BigPlay,
		p: FPlayer,
		// The man he did it to, or the opponents on the floor to pick one from
		target: FPlayer | readonly FPlayer[] | undefined,
		context: TrashTalkContext,
	): string | undefined {
		const heat = this.heatOf(p.pid);
		if (heat <= 0) {
			return;
		}
		// (the man he has been going at all game, when there is a choice)
		const partner = Array.isArray(target)
			? this.feudPartner(p.pid, target)
			: undefined;
		const known = Array.isArray(target)
			? partner
			: (target as FPlayer | undefined);
		const feud = known ? this.feudCount(p.pid, known.pid) > 0 : false;
		if (!this.canTalk(idx, p.pid, feud ? 2 : 0)) {
			return;
		}
		const rng = new Rng(this.gid, STREAM + idx);
		const prob = Math.min(
			0.6,
			TRASH_TALK_RATES.bigPlay *
				heat *
				(feud ? TRASH_TALK_RATES.feud : 1) *
				trashTalkContextMult({ ...context, heated: this.heated }),
		);
		if (rng.random() >= prob) {
			return;
		}
		const who =
			known ??
			(Array.isArray(target) && target.length > 0
				? rng.pick(target as readonly FPlayer[])
				: undefined);
		const f =
			(who && feud ? this.feudLine(rng, p, who) : undefined) ??
			this.template(rng, kind, BIG_PLAY[kind], p.pid);
		if (!f) {
			return;
		}
		this.record(idx, p.pid);
		this.log.push({
			idx,
			kind: who && feud ? "feud" : kind,
			pid: p.pid,
			other: who?.pid,
		});
		if (who) {
			this.addFeud(p, who);
			this.talkedAt = { talker: p, target: who.pid, idx };
		}
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
		const feud = this.feudCount(a.pid, b.pid) > 0;
		if (!this.canTalk(idx, talker.pid, feud ? 2 : 0)) {
			return;
		}
		const rng = new Rng(this.gid, STREAM + idx);
		const prob = Math.min(
			0.5,
			TRASH_TALK_RATES.jawing *
				Math.max(ha, hb) *
				(feud ? TRASH_TALK_RATES.feud : 1) *
				trashTalkContextMult({ ...context, heated: this.heated }),
		);
		if (rng.random() >= prob) {
			return;
		}
		const both = ha > 0 && hb > 0;
		const f =
			(feud ? this.feudLine(rng, talker, other) : undefined) ??
			(both
				? this.template(rng, "both", JAWING_BOTH, talker.pid)
				: this.template(rng, "one", JAWING_ONE, talker.pid));
		if (!f) {
			return;
		}
		this.record(idx, talker.pid);
		this.log.push({
			idx,
			kind: feud ? "feud" : both ? "jawingBoth" : "jawing",
			pid: talker.pid,
			other: other.pid,
		});
		if (both) {
			this.said.set(other.pid, (this.said.get(other.pid) ?? 0) + 1);
			this.addFeud(talker, other);
		} else {
			this.talkedAt = { talker, target: other.pid, idx };
		}
		return f(talker.name, other.name);
	}

	// A steal: if the stealer scores right after it, he may have something to say to the man he took it from
	noteSteal(idx: number, pid: number, victim: number | undefined) {
		this.lastSteal = victim === undefined ? undefined : { pid, victim, idx };
	}

	stealVictim(idx: number, pid: number) {
		const s = this.lastSteal;
		return s && s.pid === pid && idx - s.idx <= TRASH_TALK_RATES.stealWindow
			? s.victim
			: undefined;
	}

	// The player who was talked at a little while ago makes a big shot: his answer. He needs no temper for it (he started nothing)
	answer(
		idx: number,
		p: FPlayer,
		context: TrashTalkContext,
	): string | undefined {
		const at = this.talkedAt;
		if (
			!at ||
			at.target !== p.pid ||
			at.talker.t === p.t ||
			idx - at.idx > TRASH_TALK_RATES.answerWindow ||
			idx - this.lastIdx < 2 ||
			this.total >= this.cap
		) {
			return;
		}
		// (one chance to answer)
		this.talkedAt = undefined;
		const rng = new Rng(this.gid, STREAM + idx);
		const prob = Math.min(
			0.8,
			TRASH_TALK_RATES.answer *
				trashTalkContextMult({ ...context, heated: this.heated }),
		);
		if (rng.random() >= prob) {
			return;
		}
		const f = this.template(rng, "answer", ANSWER, p.pid);
		if (!f) {
			return;
		}
		this.lastIdx = idx;
		this.total += 1;
		this.heated += 1;
		this.log.push({ idx, kind: "answer", pid: p.pid, other: at.talker.pid });
		// (a hothead who answers is now part of it)
		this.addFeud(p, at.talker);
		return f(p.name, at.talker.name);
	}

	// The other team calls a timeout to stop a run: a hothead on the floor may talk at their bench on the way to his own
	benchTalk(
		idx: number,
		floor: readonly FPlayer[],
		context: TrashTalkContext,
	): string | undefined {
		const p = [...floor]
			.filter((q) => this.heatOf(q.pid) > 0)
			.sort(
				(a, b) => this.heatOf(b.pid) - this.heatOf(a.pid) || a.pid - b.pid,
			)[0];
		if (!p || !this.canTalk(idx, p.pid)) {
			return;
		}
		const rng = new Rng(this.gid, STREAM + idx);
		const prob = Math.min(
			0.6,
			TRASH_TALK_RATES.bench *
				this.heatOf(p.pid) *
				trashTalkContextMult({ ...context, heated: this.heated }),
		);
		if (rng.random() >= prob) {
			return;
		}
		const f = this.template(rng, "bench", BENCH, p.pid);
		if (!f) {
			return;
		}
		this.record(idx, p.pid);
		this.log.push({ idx, kind: "bench", pid: p.pid });
		return f(p.name);
	}

	// A visitor who has been talking misses at the line or throws it away: the home crowd lets him know. Once a player
	crowd(
		idx: number,
		p: FPlayer,
		context: TrashTalkContext,
	): string | undefined {
		if (
			p.t !== 1 ||
			this.heatOf(p.pid) <= 0 ||
			!this.hasTalked(p.pid) ||
			this.crowdSaid.has(p.pid) ||
			this.crowdSaid.size >= 2 ||
			idx - this.lastIdx < TRASH_TALK_RATES.cooldown ||
			this.total >= this.cap
		) {
			return;
		}
		const rng = new Rng(this.gid, STREAM + idx);
		const prob = Math.min(
			0.7,
			TRASH_TALK_RATES.crowd *
				trashTalkContextMult({ ...context, heated: this.heated }),
		);
		if (rng.random() >= prob) {
			return;
		}
		const f = this.template(rng, "crowd", CROWD, p.pid);
		if (!f) {
			return;
		}
		this.crowdSaid.add(p.pid);
		this.lastIdx = idx;
		this.total += 1;
		this.log.push({ idx, kind: "crowd", pid: p.pid });
		return f(p.name);
	}

	// After jawing or a technical: a calm teammate on the floor may step in ("the veteran", when his age is known and says so)
	calm(idx: number, p: FPlayer, mates: readonly FPlayer[]): string | undefined {
		if (this.calmSaid >= 2) {
			return;
		}
		const calm = mates
			.filter(
				(q) =>
					q.pid !== p.pid &&
					q.t === p.t &&
					(this.tempers.get(q.pid) ?? -1) >= CALM_TEMPER,
			)
			.sort(
				(a, b) =>
					(this.ages.get(b.pid) ?? 0) - (this.ages.get(a.pid) ?? 0) ||
					(this.tempers.get(b.pid) ?? 0) - (this.tempers.get(a.pid) ?? 0) ||
					a.pid - b.pid,
			)[0];
		if (!calm) {
			return;
		}
		const rng = new Rng(this.gid, STREAM_CALM + idx);
		if (rng.random() >= TRASH_TALK_RATES.calm) {
			return;
		}
		const veteran = (this.ages.get(calm.pid) ?? 0) >= VETERAN_AGE;
		const f =
			(veteran
				? this.template(rng, "calmVet", CALM_VETERAN, calm.pid)
				: undefined) ?? this.template(rng, "calm", CALM, calm.pid);
		if (!f) {
			return;
		}
		this.calmSaid += 1;
		this.log.push({ idx, kind: "calm", pid: calm.pid, other: p.pid });
		return f(calm.name, p.name);
	}

	// A technical on a player who has been talking (or a real hothead) gets a lead-in. Always (no chance involved) when he has been talking.
	// A technical on the other team soon after one on this team reads as the game boiling over (hotheads and talkers only)
	techLeadIn(
		idx: number,
		p: FPlayer | undefined,
		t?: 0 | 1,
	): string | undefined {
		this.heated += 1;
		const prev = this.lastTech;
		const team = p?.t ?? t;
		if (team !== undefined) {
			this.lastTech = { t: team, idx };
		}
		if (!p) {
			return;
		}
		const talked = (this.said.get(p.pid) ?? 0) > 0;
		const heat = this.heatOf(p.pid);
		this.teched.add(p.pid);
		if (!talked && heat < 0.5) {
			return;
		}
		const rng = new Rng(this.gid, STREAM + idx);
		const both =
			prev !== undefined &&
			prev.t !== p.t &&
			idx - prev.idx <= TRASH_TALK_RATES.techWindow;
		const fBoth = both
			? this.template(rng, "techBoth", TECH_BOTH, p.pid)
			: undefined;
		const f =
			fBoth ??
			(talked
				? this.template(rng, "tech", TECH_LEAD_IN, p.pid)
				: this.template(rng, "techHot", TECH_LEAD_IN_HOTHEAD, p.pid));
		if (f) {
			this.log.push({ idx, kind: fBoth ? "techBoth" : "tech", pid: p.pid });
		}
		return f?.(p.name);
	}

	// He is thrown out after talking all game
	ejected(idx: number, p: FPlayer | undefined): string | undefined {
		if (!p || (this.said.get(p.pid) ?? 0) <= 0) {
			return;
		}
		const rng = new Rng(this.gid, STREAM + idx);
		return this.template(rng, "ejected", EJECTED, p.pid)?.(p.name);
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
	rivalry?: boolean | number;
};

const addNote = (res: { note?: string }, line: string | undefined) => {
	if (line) {
		res.note = [res.note, line].filter(Boolean).join(" ");
	}
	return !!line;
};

// The hook the session calls once per worded event: may add a note (trash talk after a big play, jawing after a foul, the crowd, a
// teammate stepping in...) or a lead-in to a technical foul. Does nothing unless a hothead is in the game
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
		const p = ev.pid === undefined ? undefined : host.pl(ev.pid);
		const lead = tt.techLeadIn(
			host.idx,
			p,
			ev.t === 0 || ev.t === 1 ? ev.t : undefined,
		);
		if (lead) {
			res.text = `${lead} ${res.text}`;
			if (p) {
				addNote(res, tt.calm(host.idx, p, host.floor(p.t)));
			}
		}
		return;
	}
	if (type === "ejection") {
		addNote(
			res,
			tt.ejected(host.idx, ev.pid === undefined ? undefined : host.pl(ev.pid)),
		);
		return;
	}
	if (type === "timeout") {
		// (the team that didn't call it, when it is on a run)
		if (ev.t === 0 || ev.t === 1) {
			const o: 0 | 1 = ev.t === 0 ? 1 : 0;
			if (host.run.t === o && host.run.S >= 8) {
				addNote(res, tt.benchTalk(host.idx, host.floor(o), context(o)));
			}
		}
		return;
	}
	if (typeof ev.pid !== "number" || (ev.t !== 0 && ev.t !== 1)) {
		return;
	}
	const t: 0 | 1 = ev.t;
	const p = host.pl(ev.pid);
	if (type === "stl") {
		if (!ev.outOfBounds) {
			tt.noteSteal(host.idx, ev.pid, ev.pidTov);
		}
		if (typeof ev.pidTov === "number") {
			const victim = host.pl(ev.pidTov);
			addNote(res, tt.crowd(host.idx, victim, context(victim.t)));
		}
		return;
	}
	if (type === "tov" || type === "missFt") {
		addNote(res, tt.crowd(host.idx, p, context(p.t)));
		return;
	}
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
			const other = host.pl(ev.pidShooting);
			if (addNote(res, tt.jawing(host.idx, p, other, context(t)))) {
				// (the hotter of the two is the one a teammate walks away)
				const hot = tt.heatOf(p.pid) >= tt.heatOf(other.pid) ? p : other;
				addNote(res, tt.calm(host.idx, hot, host.floor(hot.t)));
			}
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
	const dunk = DUNK_RE.test(res.text);
	const big = andOne || three || dunk;
	// The man who was talked at answers with a big shot (any basket in a close game late)
	if (big || (host.late && Math.abs(host.score[0] - host.score[1]) <= 6)) {
		if (addNote(res, tt.answer(host.idx, p, context(t)))) {
			return;
		}
	}
	const victim = tt.stealVictim(host.idx, p.pid);
	const kind: BigPlay | undefined =
		victim !== undefined
			? "stealScore"
			: andOne
				? "andOne"
				: three
					? "three"
					: dunk
						? "dunk"
						: undefined;
	if (!kind) {
		return;
	}
	const targetPid =
		victim ??
		(typeof ev.pidDefense === "number"
			? ev.pidDefense
			: typeof ev.pidFoul === "number"
				? ev.pidFoul
				: undefined);
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
