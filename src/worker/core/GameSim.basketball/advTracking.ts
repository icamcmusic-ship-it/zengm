// Advanced Tracking Stats (League extras, see docs/native-features.md and common/advStats.ts): records play types, defense, on/off,
// lineups, assisted/unassisted makes, catch-and-shoot vs pull-up threes and clutch stats while a game is simulated.
//
// Recording never changes a game: nothing here draws a random number (the classifier splits ambiguous plays with a hash of the game id
// and a counter, not Math.random) or touches anything the sim reads. With the setting off the GameSim has no tracker and none of this runs.
import {
	ADV,
	LU,
	LU_FIELDS,
	newAdv,
	PT_FGA,
	PT_FGM,
	PT_INDEX,
	PT_POSS,
	PT_TOV,
	PT_PTS,
	ptIndex,
	TEAM_ADV,
	TEAM_ADV_LEN,
	type PlayTypeKey,
	type TeamAdv,
} from "../../../common/advStats.ts";

type TeamNum = 0 | 1;

// The parts of the sim's player and team objects used here
export type AdvPlayer = {
	id: number;
	stat: any;
	compositeRating: any;
	// Raw ratings, set by loadTeams with the setting on
	advR?: { hgt: number; drb: number; pss: number; spd: number };
	adv?: number[];
};
type AdvTeam = {
	player: AdvPlayer[];
	adv?: TeamAdv;
};

export type ShotKind =
	| "atRim"
	| "ft"
	| "lowPost"
	| "midRange"
	| "threePointer"
	| "tipIn"
	| "putBack";

const clamp01 = (x: number) => (x < 0 ? 0 : x > 1 ? 1 : x);

// How big (roll man, post), how much of a creator (ball handler, isolation), how much of a mover (off screens) a player is, 0 to 1, from
// his raw ratings (height 35 → 70, average of dribbling and passing 35 → 70, speed 40 → 80), and whether he leans to isolation (dribbling
// over passing)
export const roleOf = (p: AdvPlayer) => {
	const r = p.advR ?? { hgt: 50, drb: 50, pss: 50, spd: 50 };
	return {
		big: clamp01((r.hgt - 35) / 35),
		creator: clamp01(((r.drb + r.pss) / 2 - 35) / 35),
		mover: clamp01((r.spd - 40) / 40),
		isoTilt: clamp01(0.5 + (r.drb - r.pss) / 40),
	};
};
type Role = ReturnType<typeof roleOf>;

// Deterministic number in [0, 1) from the game and a counter (not a random draw: the sim's random numbers are untouched)
const hashUnit = (a: number, b: number) => {
	let x = (Math.imul(a | 0, 0x9e3779b1) ^ Math.imul(b | 0, 0x85ebca77)) | 0;
	x ^= x >>> 16;
	x = Math.imul(x, 0x7feb352d);
	x ^= x >>> 15;
	x = Math.imul(x, 0x846ca68b);
	x ^= x >>> 16;
	return (x >>> 0) / 4294967296;
};

type Weights = Partial<Record<PlayTypeKey, number>>;

export const pickPlayType = (w: Weights, u: number): PlayTypeKey => {
	let total = 0;
	for (const key in w) {
		total += Math.max(0, w[key as PlayTypeKey]!);
	}
	let x = u * total;
	let last: PlayTypeKey = "misc";
	for (const key in w) {
		const v = Math.max(0, w[key as PlayTypeKey]!);
		if (v <= 0) {
			continue;
		}
		last = key as PlayTypeKey;
		if (x < v) {
			return last;
		}
		x -= v;
	}
	return last;
};

// The play type of a shot (or a shooting foul) after the special cases (tip-in off an inbound, transition, putback, post-up) are out of
// the way. "Assisted" means the ball came from a teammate: the assister, or with Spacing & Shot Creation the creator when he is not the
// shooter. See docs/native-features.md for the rules.
export const shotWeights = (
	type: ShotKind,
	shooter: Role,
	passer: Role | undefined,
): Weights => {
	const bp = shooter.big;
	if (passer) {
		const hr = passer.creator;
		const br = passer.big;
		if (type === "threePointer") {
			return {
				spot: 0.7,
				offs: 0.2 * shooter.mover * (1 - bp),
				ho: 0.06 + 0.1 * br * (1 - bp),
				prr: 0.35 * bp * hr,
			};
		}
		if (type === "midRange") {
			return {
				spot: 0.45,
				offs: 0.3 * shooter.mover * (1 - bp),
				ho: 0.08 + 0.12 * br * (1 - bp),
				prr: 0.4 * bp * hr,
			};
		}
		// At the rim
		return {
			prr: 0.05 + 0.6 * bp * hr,
			cut: 0.35 + 0.25 * (1 - bp),
			spot: 0.25 * (1 - bp),
			ho: 0.12 * br * (1 - bp),
		};
	}
	const c = shooter.creator;
	const iso = 0.15 + 0.3 * shooter.isoTilt;
	if (type === "threePointer") {
		return {
			prb: 0.05 + 0.5 * c,
			iso: iso * (0.4 + 0.6 * c),
			spot: 0.5 * (1 - c),
			offs: 0.12 * shooter.mover * (1 - c),
			ho: 0.05,
		};
	}
	if (type === "midRange") {
		return {
			prb: 0.05 + 0.6 * c,
			iso: iso * (0.4 + 0.6 * c) + 0.1 * bp,
			spot: 0.35 * (1 - c),
			offs: 0.1 * shooter.mover * (1 - c),
		};
	}
	return {
		prb: 0.05 + 0.6 * c * (1 - 0.6 * bp),
		iso: iso * (0.5 + 0.5 * c),
		cut: 0.2 * (1 - c),
		prr: 0.25 * bp * (1 - c),
		spot: 0.15 * (1 - c),
	};
};

export const turnoverWeights = (p: Role): Weights => ({
	prb: 0.05 + 0.45 * p.creator,
	iso: 0.2 * p.creator,
	post: 0.3 * p.big,
	prr: 0.15 * p.big,
	cut: 0.1,
	spot: 0.12 * (1 - p.creator),
	ho: 0.04,
	offs: 0.04,
});

const isRim = (type: ShotKind) =>
	type === "atRim" || type === "putBack" || type === "tipIn";

// What the sim knows about the shot that is up
export type ShotContext = {
	shooter: AdvPlayer;
	passer: AdvPlayer | undefined;
	creator: AdvPlayer | undefined;
	type: ShotKind;
	tipInFromOutOfBounds: boolean;
	transition: boolean;
	putback: boolean;
	defender: AdvPlayer | undefined;
	threePointers: boolean;
};

type Current = {
	p: AdvPlayer;
	pt: number;
	type: ShotKind;
	assisted: boolean;
	transition: boolean;
	defender: AdvPlayer | undefined;
	threePointer: boolean;
};

export class AdvTracker {
	gid: number;
	teams: [AdvTeam, AdvTeam];
	numPlayers: number;
	counter = 0;
	roles = new Map<AdvPlayer, Role>();
	// The play being recorded (from the shot until the end of the possession segment)
	cur: Current | undefined;
	clutch = false;
	lastO: TeamNum | undefined;
	lastPeriod = 0;
	teamTotals: [number[], number[]] = [
		new Array(TEAM_ADV_LEN).fill(0),
		new Array(TEAM_ADV_LEN).fill(0),
	];
	oppRim: [number, number] = [0, 0];
	lineups: [Map<string, number[]>, Map<string, number[]>] = [
		new Map(),
		new Map(),
	];
	lineupCache: [AdvPlayer[], AdvPlayer[]] = [[], []];
	lineupRow: [number[] | undefined, number[] | undefined] = [
		undefined,
		undefined,
	];

	constructor(gid: number, teams: [AdvTeam, AdvTeam], numPlayers: number) {
		this.gid = gid;
		this.teams = teams;
		this.numPlayers = numPlayers;
		for (const t of teams) {
			for (const p of t.player) {
				p.adv = newAdv();
			}
		}
	}

	role(p: AdvPlayer) {
		let r = this.roles.get(p);
		if (!r) {
			r = roleOf(p);
			this.roles.set(p, r);
		}
		return r;
	}

	unit() {
		this.counter += 1;
		return hashUnit(this.gid, this.counter);
	}

	lineup(t: TeamNum, onCourt: AdvPlayer[]) {
		const cache = this.lineupCache[t];
		let same = cache.length === onCourt.length;
		for (let i = 0; same && i < onCourt.length; i++) {
			same = cache[i] === onCourt[i];
		}
		if (!same || !this.lineupRow[t]) {
			this.lineupCache[t] = [...onCourt];
			const pids = onCourt.map((p) => p.id).sort((a, b) => a - b);
			const key = pids.join(",");
			let row = this.lineups[t].get(key);
			if (!row) {
				row = [...pids, ...new Array(LU_FIELDS).fill(0)];
				this.lineups[t].set(key, row);
			}
			this.lineupRow[t] = row;
		}
		return this.lineupRow[t]!;
	}

	// Start of each possession segment (simPossession): a new possession when the ball changed hands or a period started
	possessionStart(
		o: TeamNum,
		period: number,
		clutch: boolean,
		onCourt: [AdvPlayer[], AdvPlayer[]],
	) {
		this.cur = undefined;
		this.clutch = clutch;
		if (o === this.lastO && period === this.lastPeriod) {
			return;
		}
		this.lastO = o;
		this.lastPeriod = period;
		const d: TeamNum = o === 0 ? 1 : 0;
		for (const p of onCourt[o]) {
			p.adv![ADV.possFor]! += 1;
		}
		for (const p of onCourt[d]) {
			p.adv![ADV.possAgainst]! += 1;
		}
		this.teamTotals[o][TEAM_ADV.possFor]! += 1;
		this.teamTotals[d][TEAM_ADV.possAgainst]! += 1;
		if (clutch) {
			this.teamTotals[o][TEAM_ADV.clPossFor]! += 1;
			this.teamTotals[d][TEAM_ADV.clPossAgainst]! += 1;
		}
		this.lineup(o, onCourt[o])[this.numPlayers + LU.possFor]! += 1;
		this.lineup(d, onCourt[d])[this.numPlayers + LU.possAgainst]! += 1;
	}

	possessionEnd() {
		this.cur = undefined;
	}

	// Time played in the possession segment
	time(seconds: number, onCourt: [AdvPlayer[], AdvPlayer[]]) {
		for (const t of [0, 1] as const) {
			this.lineup(t, onCourt[t])[this.numPlayers + LU.sec]! += seconds;
			if (this.clutch) {
				this.teamTotals[t][TEAM_ADV.clSec]! += seconds;
				for (const p of onCourt[t]) {
					p.adv![ADV.clSec]! += seconds;
				}
			}
		}
	}

	// A shot goes up (or a shooting foul on one): its play type
	shot(ctx: ShotContext) {
		const { shooter, type } = ctx;
		let key: PlayTypeKey;
		let assisted = ctx.passer !== undefined;
		if (type === "tipIn" && ctx.tipInFromOutOfBounds) {
			key = "misc";
		} else if (ctx.transition) {
			key = "tr";
		} else if (ctx.putback) {
			key = "pb";
		} else if (type === "lowPost") {
			key = "post";
		} else {
			// With Spacing & Shot Creation the creator passed to the shooter even when no assist is credited
			const from =
				ctx.passer ??
				(ctx.creator !== undefined && ctx.creator !== shooter
					? ctx.creator
					: undefined);
			const weights = shotWeights(
				type,
				this.role(shooter),
				from ? this.role(from) : undefined,
			);
			key = pickPlayType(weights, this.unit());
		}
		if (type === "putBack" || type === "tipIn") {
			assisted = ctx.passer !== undefined;
		}
		const pt = PT_INDEX[key];
		shooter.adv![ptIndex(pt, PT_POSS)]! += 1;
		this.cur = {
			p: shooter,
			pt,
			type,
			assisted,
			transition: ctx.transition,
			defender: ctx.defender,
			threePointer: type === "threePointer" && ctx.threePointers,
		};
	}

	// The shot's result (not called for a missed shot that drew a foul, which is not a field goal attempt). blocker: the shot was blocked
	shotDone(
		made: boolean,
		blocker: AdvPlayer | undefined,
		d: TeamNum,
		onCourtD: AdvPlayer[],
	) {
		const cur = this.cur;
		if (!cur) {
			return;
		}
		const a = cur.p.adv!;
		a[ptIndex(cur.pt, PT_FGA)]! += 1;
		const three = cur.type === "threePointer";
		if (made) {
			a[ptIndex(cur.pt, PT_FGM)]! += 1;
			const zone = isRim(cur.type)
				? 0
				: cur.type === "lowPost"
					? 1
					: cur.type === "midRange"
						? 2
						: 3;
			a[(cur.assisted ? ADV.astRim : ADV.unRim) + zone]! += 1;
		}
		if (three) {
			if (cur.assisted) {
				a[ADV.cs3a]! += 1;
				if (made) {
					a[ADV.cs3m]! += 1;
				}
			} else {
				a[ADV.pu3a]! += 1;
				if (made) {
					a[ADV.pu3m]! += 1;
				}
			}
		}

		// Defense
		const defender = blocker ?? cur.defender;
		if (defender?.adv) {
			const da = defender.adv;
			da[three ? ADV.dfga3 : ADV.dfga2]! += 1;
			if (made) {
				da[three ? ADV.dfgm3 : ADV.dfgm2]! += 1;
			}
			if (!cur.transition) {
				da[three ? ADV.con3 : ADV.con2]! += 1;
			}
		}
		if (isRim(cur.type)) {
			this.oppRim[d] += 1;
			let protector: AdvPlayer | undefined;
			let best = -Infinity;
			for (const p of onCourtD) {
				p.adv![ADV.oppRimOn]! += 1;
				const v = p.compositeRating.blocking ?? 0;
				if (v > best) {
					best = v;
					protector = p;
				}
			}
			if (protector) {
				protector.adv![ADV.rimDfga]! += 1;
				if (made) {
					protector.adv![ADV.rimDfgm]! += 1;
				}
			}
		}
	}

	turnover(
		p: AdvPlayer,
		transition: boolean,
		putback: boolean,
	) {
		let key: PlayTypeKey;
		if (transition) {
			key = "tr";
		} else if (putback) {
			key = "pb";
		} else {
			key = pickPlayType(turnoverWeights(this.role(p)), this.unit());
		}
		const pt = PT_INDEX[key];
		p.adv![ptIndex(pt, PT_POSS)]! += 1;
		p.adv![ptIndex(pt, PT_TOV)]! += 1;
		this.cur = undefined;
	}

	// Every recordStat
	stat(
		t: TeamNum,
		p: AdvPlayer | undefined,
		s: string,
		amt: number,
		onCourt: [AdvPlayer[], AdvPlayer[]],
	) {
		if (s === "pts") {
			const o = t;
			const d: TeamNum = t === 0 ? 1 : 0;
			for (const q of onCourt[o]) {
				q.adv![ADV.ptsFor]! += amt;
				if (this.clutch) {
					q.adv![ADV.clPm]! += amt;
				}
			}
			for (const q of onCourt[d]) {
				q.adv![ADV.ptsAgainst]! += amt;
				if (this.clutch) {
					q.adv![ADV.clPm]! -= amt;
				}
			}
			this.lineup(o, onCourt[o])[this.numPlayers + LU.ptsFor]! += amt;
			this.lineup(d, onCourt[d])[this.numPlayers + LU.ptsAgainst]! += amt;
			if (this.clutch) {
				this.teamTotals[o][TEAM_ADV.clPtsFor]! += amt;
				this.teamTotals[d][TEAM_ADV.clPtsAgainst]! += amt;
			}
			if (this.cur && p === this.cur.p) {
				p.adv![ptIndex(this.cur.pt, PT_PTS)]! += amt;
			}
		}
		if (!this.clutch) {
			return;
		}
		if (p?.adv) {
			const a = p.adv;
			switch (s) {
				case "pts":
					a[ADV.clPts]! += amt;
					break;
				case "fga":
					a[ADV.clFga]! += amt;
					break;
				case "fg":
					a[ADV.clFg]! += amt;
					break;
				case "tpa":
					a[ADV.clTpa]! += amt;
					break;
				case "tp":
					a[ADV.clTp]! += amt;
					break;
				case "fta":
					a[ADV.clFta]! += amt;
					break;
				case "ft":
					a[ADV.clFt]! += amt;
					break;
				case "tov":
					a[ADV.clTov]! += amt;
					break;
			}
		}
		const tm =
			s === "fga"
				? ADV.clTmFga
				: s === "fta"
					? ADV.clTmFta
					: s === "tov"
						? ADV.clTmTov
						: undefined;
		if (tm !== undefined) {
			for (const q of onCourt[t]) {
				q.adv![tm]! += amt;
			}
		}
	}

	// End of the game: the players' and teams' records, on the objects the sim returns (players who didn't play get none)
	finish() {
		for (const t of [0, 1] as const) {
			const d: TeamNum = t === 0 ? 1 : 0;
			const totals = this.teamTotals[t];
			const ptsFor = this.teams[t].player.reduce(
				(sum, p) => sum + (p.stat.pts ?? 0),
				0,
			);
			const ptsAgainst = this.teams[d].player.reduce(
				(sum, p) => sum + (p.stat.pts ?? 0),
				0,
			);
			for (const p of this.teams[t].player) {
				const a = p.adv!;
				if (!(p.stat.min > 0)) {
					delete p.adv;
					continue;
				}
				a[ADV.tmPossFor] = totals[TEAM_ADV.possFor]!;
				a[ADV.tmPossAgainst] = totals[TEAM_ADV.possAgainst]!;
				a[ADV.tmPtsFor] = ptsFor;
				a[ADV.tmPtsAgainst] = ptsAgainst;
				a[ADV.tmOppRim] = this.oppRim[t];
				a[ADV.clSec] = Math.round(a[ADV.clSec]!);
				a[ADV.clGp] = a[ADV.clSec]! > 0 ? 1 : 0;
			}
			totals[TEAM_ADV.clSec] = Math.round(totals[TEAM_ADV.clSec]!);
			const lu: number[][] = [];
			for (const row of this.lineups[t].values()) {
				row[this.numPlayers + LU.sec] = Math.round(
					row[this.numPlayers + LU.sec]!,
				);
				if (row[this.numPlayers + LU.sec]! > 0 || row.some((x, i) => i >= this.numPlayers && x !== 0)) {
					lu.push(row);
				}
			}
			this.teams[t].adv = { t: totals, lu };
		}
	}
}
