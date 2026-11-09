// Announcer colour that follows the whole game: lead changes and ties, the largest lead, comebacks and blown leads, shooting lines
// ("he's 6-of-7 tonight"), the battle on the glass, bench reactions, free-throw routines, a coach thinking about a challenge, and the
// teams' records coming in. It only reads the score and the box score the session is given; choices come from the session's seeded
// generator (never Math.random), so none of it can change a game.
import { pickV } from "./variety.ts";
import type { Rng } from "./rng.ts";
import { aNum, cap, poss, type FPlayer } from "./types.ts";

export const ordinal = (n: number) => {
	const s = ["th", "st", "nd", "rd"];
	const v = n % 100;
	return `${n}${s[(v - 20) % 10] ?? s[v] ?? s[0]}`;
};

// ---- the flow of the score: who has led, by how much, how often it changed hands ----
export class GameFlow {
	leader: 0 | 1 | undefined;
	private lastLeader: 0 | 1 | undefined;
	leadChanges = 0;
	ties = 0;
	// each team's largest lead so far
	largest: [number, number] = [0, 0];
	private comebackSaid: [boolean, boolean] = [false, false];
	private slipSaid: [boolean, boolean] = [false, false];
	private bigLeadSaid: [number, number] = [0, 0];
	private changesSaid = 0;
	private tiesSaid = 0;

	// After a score by team t: what changed. (Call with the score after the play)
	update(score: [number, number], t: 0 | 1) {
		const o: 0 | 1 = t === 0 ? 1 : 0;
		const m = score[t] - score[o];
		let leadChange = false;
		let tie = false;
		if (m > 0) {
			// (a lead change, even through a tie: the other team was the last to lead)
			if (this.lastLeader === o) {
				this.leadChanges += 1;
				leadChange = true;
			}
			this.leader = t;
			this.lastLeader = t;
		} else if (m === 0 && this.leader !== undefined) {
			this.ties += 1;
			tie = true;
			this.leader = undefined;
		}
		const newLargest = m > this.largest[t];
		if (newLargest) {
			this.largest[t] = m;
		}
		return { leadChange, tie, margin: m, newLargest };
	}

	// A line about the flow after team t scored, or "" (at most one: the caller has room for one more note)
	note(
		rng: Rng,
		o: {
			t: 0 | 1;
			score: [number, number];
			teams: [string, string];
			late: boolean;
			change: ReturnType<GameFlow["update"]>;
		},
	): string {
		const { t, change } = o;
		const opp: 0 | 1 = t === 0 ? 1 : 0;
		const Team = cap(o.teams[t]);
		const Opp = cap(o.teams[opp]);
		const m = change.margin;
		// a comeback: they trailed by a lot and now lead
		const deficit = this.largest[opp];
		if (change.leadChange && deficit >= 12 && !this.comebackSaid[t]) {
			this.comebackSaid[t] = true;
			return pickV(rng, [
				`${Team} were down ${deficit} at one point. Now they lead.`,
				`What a turnaround: ${o.teams[t]} trailed by ${deficit} and they're in front.`,
				`${Team} have erased ${aNum(deficit)} ${deficit}-point deficit.`,
				`From ${deficit} down to the lead: ${o.teams[t]} have completed the comeback, for now.`,
			]);
		}
		// a big lead slipping away
		if (
			m < 0 &&
			-m <= 3 &&
			this.largest[opp] >= 14 &&
			!this.slipSaid[opp] &&
			this.leader === opp
		) {
			this.slipSaid[opp] = true;
			return pickV(rng, [
				`${Opp} led by ${this.largest[opp]}; it's a ${-m}-point game now.`,
				`That ${this.largest[opp]}-point lead is down to ${-m}.`,
				`${Opp} have watched ${aNum(this.largest[opp])} ${this.largest[opp]}-point lead shrink to ${-m}.`,
			]);
		}
		if (change.leadChange || change.tie) {
			const n = change.leadChange ? this.leadChanges : this.ties;
			const enough = change.leadChange ? 6 : 5;
			const said = change.leadChange ? this.changesSaid : this.tiesSaid;
			if (n >= enough && n > said + 2 && (o.late || rng.random() < 0.5)) {
				if (change.leadChange) {
					this.changesSaid = n;
				} else {
					this.tiesSaid = n;
				}
				return change.leadChange
					? pickV(rng, [
							`That's the ${ordinal(n)} lead change of the game.`,
							`The lead has changed hands ${n} times now.`,
							`Lead change number ${n}. Neither team can shake the other.`,
							`${n} lead changes and counting.`,
						])
					: pickV(rng, [
							`That's the ${ordinal(n)} tie of the game.`,
							`Tied for the ${ordinal(n)} time tonight.`,
						]);
			}
		}
		// a new largest lead, now and then
		if (
			change.newLargest &&
			m >= 15 &&
			m >= this.bigLeadSaid[t] + 5 &&
			rng.random() < 0.5
		) {
			this.bigLeadSaid[t] = m;
			return m > this.largest[opp]
				? pickV(rng, [
						`That's the biggest lead of the game, ${m}.`,
						`${Team} lead by ${m}, the largest margin of the night.`,
						`The lead swells to ${m}, a new high.`,
					])
				: pickV(rng, [
						`${Team} lead by ${m}, their largest of the night.`,
						`That's ${poss(o.teams[t])} biggest lead yet, ${m}.`,
					]);
		}
		return "";
	}

	// A summary for a break between periods, or ""
	summary(rng: Rng, teams: [string, string]): string {
		const t: 0 | 1 = this.largest[0] >= this.largest[1] ? 0 : 1;
		const big = this.largest[t];
		if (this.leadChanges >= 5) {
			return pickV(rng, [
				`${this.leadChanges} lead changes and ${this.ties} ties so far.`,
				`The lead has changed hands ${this.leadChanges} times.`,
			]);
		}
		if (big >= 10) {
			return pickV(rng, [
				`Largest lead so far: ${teams[t]} by ${big}.`,
				`${cap(teams[t])} have led by as many as ${big}.`,
			]);
		}
		return "";
	}
}

// ---- shooting lines ----
export type ShootingLine = {
	fg?: number;
	fga?: number;
	tp?: number;
	tpa?: number;
	ft?: number;
	fta?: number;
};

export class ShootingNotes {
	private saidFg = new Map<number, number>();
	private saidTp = new Map<number, number>();
	private saidCold = new Set<string>();
	private saidFt = new Set<number>();

	// After a made field goal (s is his line, this shot included)
	made(
		rng: Rng,
		p: FPlayer,
		s: ShootingLine | undefined,
		three: boolean,
		role: string | undefined,
	): string {
		if (!s || s.fg === undefined || s.fga === undefined) {
			return "";
		}
		const who = role && rng.random() < 0.35 ? role : p.name;
		const Who = cap(who);
		if (three && s.tp !== undefined && s.tpa !== undefined && s.tp >= 4) {
			const last = this.saidTp.get(p.pid) ?? 0;
			if (s.tp >= last + 2 && s.tp / s.tpa >= 0.5) {
				this.saidTp.set(p.pid, s.tp);
				return s.tp === s.tpa
					? pickV(rng, [
							`${Who} is a perfect ${s.tp}-for-${s.tpa} from three.`,
							`${s.tp} threes, no misses for ${who}.`,
						])
					: pickV(rng, [
							`That's ${s.tp}-of-${s.tpa} from deep for ${who}.`,
							`${Who} has hit ${s.tp} threes tonight on ${s.tpa} tries.`,
							`${Who} is ${s.tp}-of-${s.tpa} from beyond the arc.`,
						]);
			}
		}
		const last = this.saidFg.get(p.pid) ?? 0;
		if (s.fg >= 5 && s.fg >= last + 3 && s.fg / s.fga >= 0.7) {
			this.saidFg.set(p.pid, s.fg);
			return s.fg === s.fga
				? pickV(rng, [
						`${Who} is a perfect ${s.fg}-for-${s.fga} from the field.`,
						`${Who} hasn't missed: ${s.fg}-for-${s.fga}.`,
						`Still perfect for ${who}: ${s.fg}-of-${s.fga} tonight.`,
					])
				: pickV(rng, [
						`${Who} is ${s.fg}-of-${s.fga} from the field tonight.`,
						`${Who} is now ${s.fg}-of-${s.fga} shooting.`,
						`That's ${s.fg}-of-${s.fga} for ${who}. Efficient night.`,
						`${Who} keeps cashing in: ${s.fg}-of-${s.fga} from the floor.`,
					]);
		}
		return "";
	}

	// After a miss: a cold night, once a half
	missed(
		rng: Rng,
		p: FPlayer,
		s: ShootingLine | undefined,
		half: number,
	): string {
		if (!s || s.fg === undefined || s.fga === undefined) {
			return "";
		}
		const key = `${p.pid}|${half}`;
		if (s.fga >= 9 && s.fg / s.fga <= 0.25 && !this.saidCold.has(key)) {
			this.saidCold.add(key);
			return pickV(rng, [
				`Rough night for ${p.name}: ${s.fg}-of-${s.fga} from the field.`,
				`${p.name} just can't find it. He's ${s.fg}-of-${s.fga}.`,
				`${p.name} is ${s.fg}-of-${s.fga} now; nothing is falling for him.`,
			]);
		}
		return "";
	}

	// After a made free throw, the last of his trip
	freeThrows(rng: Rng, p: FPlayer, s: ShootingLine | undefined): string {
		if (!s || s.ft === undefined || s.fta === undefined) {
			return "";
		}
		if (s.fta >= 8 && s.ft === s.fta && !this.saidFt.has(p.pid)) {
			this.saidFt.add(p.pid);
			return pickV(rng, [
				`${p.name} is ${s.ft}-for-${s.fta} at the line tonight.`,
				`Perfect at the stripe for ${p.name}: ${s.ft}-for-${s.fta}.`,
			]);
		}
		return "";
	}
}

// ---- reactions ----
export const benchLine = (
	rng: Rng,
	kind: "hustle" | "move" | "block",
	team: string,
	who: string,
) => {
	const Team = cap(team);
	if (kind === "hustle") {
		return pickV(rng, [
			`${Team} bench is up to help ${who} off the floor.`,
			`${who} gets a standing ovation from his own bench for that one.`,
			`Teammates sprint over to pick ${who} up.`,
			`That's the kind of effort that wins games. ${Team} bench loves it.`,
		]);
	}
	if (kind === "block") {
		return pickV(rng, [
			`${Team} bench is waving him back down the floor.`,
			`${who} lets out a yell on the way back up the court.`,
			`${Team} bench is on its feet after that rejection.`,
		]);
	}
	return pickV(rng, [
		`${Team} bench is falling over itself.`,
		`Somebody on ${team} bench needs a towel to cover his mouth.`,
		`${Team} bench can't believe it.`,
		`The defender is still looking for his footing.`,
	]);
};

// ---- the bench role names come in now and then on a big play by a big ----
export const roleBlockNote = (rng: Rng, role: string, blk: number) =>
	pickV(rng, [
		`${cap(role)} strikes again: block number ${blk}.`,
		`Not in ${role}'s house. That's ${blk} blocks.`,
		`${cap(role)} is patrolling the paint: ${blk} blocks tonight.`,
	]);

// ---- a free-throw routine (each player keeps his own, game after game) ----
const ROUTINES = [
	"three dribbles, a spin of the ball, a deep breath",
	"a bounce, a look at the rim, a bounce",
	"a quick spin and straight up",
	"two dribbles, a pause, two more",
	"a long exhale and a single dribble",
	"he wipes his hands on his shorts, then two dribbles",
	"a nod to the bench and three quick bounces",
	"he twirls the ball in his fingers, then rises",
];

export const ftRoutine = (rng: Rng, p: FPlayer) => {
	const r = ROUTINES[Math.abs(p.pid) % ROUTINES.length]!;
	return pickV(rng, [
		`${p.name} goes through his usual routine: ${r}.`,
		`Same routine as always for ${p.name}: ${r}.`,
	]);
};

// ---- a coach who wants a whistle overturned (no challenge is used: the call stands) ----
export const challengeNote = (rng: Rng, team: string) =>
	pickV(rng, [
		`${cap(team)} bench wants a challenge, but the coach decides to keep it.`,
		`The coach for ${team} thinks about challenging, then waves it off.`,
		`${cap(team)} bench is pleading for a review; no challenge comes.`,
	]);

// ---- the battle on the glass, from the box score ----
export const glassNote = (rng: Rng, team: string, a: number, b: number) =>
	pickV(rng, [
		`${cap(team)} are winning the battle of the boards, ${a}-${b}.`,
		`${cap(team)} own the glass so far: ${a} rebounds to ${b}.`,
		`The rebounding edge belongs to ${team}, ${a}-${b}.`,
	]);

// ---- the records the teams bring in (live games only: a stored game's records are after it was played) ----
export type TeamRecord = { won: number; lost: number };

export const recordsNote = (
	rng: Rng,
	teams: [string, string],
	rec: [TeamRecord | undefined, TeamRecord | undefined],
	series: [number, number] | undefined,
): string => {
	if (series) {
		const [a, b] = series;
		if (a === b) {
			return a === 0
				? `Game 1 of the series.`
				: rng.pick([
						`The series is tied ${a}-${b}.`,
						`All square in the series, ${a}-${b}.`,
					]);
		}
		const t: 0 | 1 = a > b ? 0 : 1;
		return rng.pick([
			`${cap(teams[t])} lead the series ${Math.max(a, b)}-${Math.min(a, b)}.`,
			`${cap(teams[t])} are up ${Math.max(a, b)}-${Math.min(a, b)} in the series.`,
		]);
	}
	const [x, y] = rec;
	if (!x || !y || x.won + x.lost + y.won + y.lost < 4) {
		return "";
	}
	const pct = (r: TeamRecord) => r.won / Math.max(1, r.won + r.lost);
	const line = `${cap(teams[0])} (${x.won}-${x.lost}) host ${teams[1]} (${y.won}-${y.lost}).`;
	if (pct(x) >= 0.65 && pct(y) >= 0.65) {
		return `${line} ${rng.pick(["Two of the best in the league.", "A matchup of top teams."])}`;
	}
	if (Math.abs(pct(x) - pct(y)) >= 0.3) {
		const fav: 0 | 1 = pct(x) > pct(y) ? 0 : 1;
		return `${line} ${rng.pick([`On paper, this one belongs to ${teams[fav]}.`, `${cap(teams[fav])} are the clear favorites.`])}`;
	}
	return line;
};
