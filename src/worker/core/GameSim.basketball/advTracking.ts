// Advanced Tracking Stats (League extras, see docs/native-features.md and common/advStats.ts): records play types, defense, on/off,
// lineups, assisted/unassisted makes, catch-and-shoot vs pull-up threes and clutch stats while a game is simulated.
//
// Recording never changes a game: nothing here draws a random number (the classifier splits ambiguous plays with a hash of the game id
// and a counter, not Math.random) or touches anything the sim reads. With the setting off the GameSim has no tracker and none of this runs.
import {
	ADV as ADV_,
	LU as LU_,
	newAdv,
	PT_FIELDS as PT_FIELDS_,
	PT_FGA as PT_FGA_,
	PT_FGM as PT_FGM_,
	PT_INDEX as PT_INDEX_,
	PT_POSS as PT_POSS_,
	PT_TOV as PT_TOV_,
	PT_PTS as PT_PTS_,
	TEAM_ADV as TEAM_ADV_,
	type PlayTypeKey,
	type TeamAdv,
} from "../../../common/advStats.ts";

// Local copies of the layout (read once: these are read in the sim's hot path, where a module binding can cost a getter call)
const ADV = { ...ADV_ };
const LU = { ...LU_ };
const TEAM_ADV = { ...TEAM_ADV_ };
const PT_INDEX = { ...PT_INDEX_ };
const PT_FIELDS = PT_FIELDS_;
const PT_FGA = PT_FGA_;
const PT_FGM = PT_FGM_;
const PT_POSS = PT_POSS_;
const PT_TOV = PT_TOV_;
const PT_PTS = PT_PTS_;
const ptIndex = (pt: number, field: number) => pt * PT_FIELDS + field;

type TeamNum = 0 | 1;

// The parts of the sim's player and team objects used here
export type AdvPlayer = {
	id: number;
	stat: any;
	compositeRating: any;
	// Raw ratings (loadTeams sets them for the play-by-play wording)
	pbpRatings?: Record<string, number>;
	// The player's record, set at the end of the game (the sim's player objects get no new property while it plays)
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
	const pr = p.pbpRatings;
	const r = {
		hgt: pr?.hgt ?? 50,
		drb: pr?.drb ?? 50,
		pss: pr?.pss ?? 50,
		spd: pr?.spd ?? 50,
	};
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

const PICK_KEYS: readonly PlayTypeKey[] = [
	"prb",
	"prr",
	"iso",
	"post",
	"spot",
	"cut",
	"offs",
	"ho",
	"tr",
	"pb",
	"misc",
];

export const pickPlayType = (w: Weights, u: number): PlayTypeKey => {
	let total = 0;
	for (const key of PICK_KEYS) {
		const v = w[key];
		if (v !== undefined && v > 0) {
			total += v;
		}
	}
	let x = u * total;
	let last: PlayTypeKey = "misc";
	for (const key of PICK_KEYS) {
		const v = w[key];
		if (v === undefined || v <= 0) {
			continue;
		}
		last = key;
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
	isoScale = 1,
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
	const iso = isoScale * (0.15 + 0.3 * shooter.isoTilt);
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

// Realistic Play Types: more of the self-created shots are the sim's (many more) handlers' pick-and-rolls, so a smaller isolation share
export const ISO_SCALE_REALISTIC = 0.6;

// Realistic Play Types: with fewer post-ups and more self-created shots, the turnovers follow the new mix (fewer post-ups, fewer on the
// ball handler's pick-and-roll, more off the ball)
export const turnoverWeightsRealistic = (p: Role): Weights => ({
	prb: 0.05 + 0.2 * p.creator,
	iso: 0.12 * p.creator,
	post: 0.12 * p.big,
	prr: 0.15 * p.big,
	cut: 0.1,
	spot: 0.06 + 0.2 * (1 - p.creator),
	ho: 0.04,
	offs: 0.04,
});

const isRim = (type: ShotKind) =>
	type === "atRim" || type === "putBack" || type === "tipIn";

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
	// Realistic Play Types: the turnovers and the isolations follow the sim's new mix (turnoverWeightsRealistic, ISO_SCALE_REALISTIC)
	realisticPlayTypes = false;
	roles = new Map<AdvPlayer, Role>();
	// Each player's record while the game is played
	arr = new Map<AdvPlayer, number[]>();
	// The play being recorded (from the shot until the end of the possession segment)
	cur: Current | undefined;
	curObj: Current = {
		p: { id: -1, stat: {}, compositeRating: {} },
		pt: 0,
		type: "atRim",
		assisted: false,
		transition: false,
		defender: undefined,
		threePointer: false,
	};
	clutch = false;
	// The lineups may have changed (GameSim.updatePlayersOnCourt ran)
	dirty = true;
	lastO: TeamNum | undefined;
	lastPeriod = 0;
	teamTotals: [number[], number[]] = [
		[0, 0, 0, 0, 0, 0, 0],
		[0, 0, 0, 0, 0, 0, 0],
	];
	oppRim: [number, number] = [0, 0];
	ptsFor: [number, number] = [0, 0];
	ptsAgainst: [number, number] = [0, 0];
	lineups: [Map<number, number[]>, Map<number, number[]>] = [
		new Map(),
		new Map(),
	];
	lineupCollisions: [Map<string, number[]>, Map<string, number[]>] = [
		new Map(),
		new Map(),
	];
	scratch: number[] = [];
	lineupCache: [AdvPlayer[], AdvPlayer[]] = [[], []];
	lineupRow: [number[] | undefined, number[] | undefined] = [
		undefined,
		undefined,
	];

	constructor(gid: number, teams: [AdvTeam, AdvTeam], numPlayers: number) {
		const template = newAdv();
		this.gid = gid;
		this.teams = teams;
		this.numPlayers = numPlayers;
		for (const t of teams) {
			for (const p of t.player) {
				this.arr.set(p, template.slice());
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

	// The row of team t's current lineup (no allocation unless the lineup changed, and then only for a new lineup)
	lineup(t: TeamNum, onCourt: AdvPlayer[]) {
		const cache = this.lineupCache[t];
		let same =
			cache.length === onCourt.length && this.lineupRow[t] !== undefined;
		for (let i = 0; same && i < onCourt.length; i++) {
			same = cache[i] === onCourt[i];
		}
		if (same) {
			return this.lineupRow[t]!;
		}
		// On/off by stints: a player's on-court totals are the team's counters when he leaves minus when he came in
		for (const p of cache) {
			if (!onCourt.includes(p)) {
				this.stint(t, p, 1);
			}
		}
		for (const p of onCourt) {
			if (!cache.includes(p)) {
				this.stint(t, p, -1);
			}
		}
		cache.length = onCourt.length;
		const ids = this.scratch;
		ids.length = onCourt.length;
		for (let i = 0; i < onCourt.length; i++) {
			cache[i] = onCourt[i]!;
			// Insertion sort of the ids
			const id = onCourt[i]!.id;
			let j = i;
			while (j > 0 && ids[j - 1]! > id) {
				ids[j] = ids[j - 1]!;
				j -= 1;
			}
			ids[j] = id;
		}
		let h = 0;
		for (const id of ids) {
			h = (Math.imul(h, 1000003) + id) | 0;
		}
		let row = this.lineups[t].get(h);
		if (row !== undefined) {
			for (let i = 0; i < ids.length; i++) {
				if (row[i] !== ids[i]) {
					// (a hash collision: look the lineup up by its ids)
					const key = ids.join(",");
					row = this.lineupCollisions[t].get(key);
					if (!row) {
						row = [...ids, 0, 0, 0, 0, 0];
						this.lineupCollisions[t].set(key, row);
					}
					break;
				}
			}
		} else {
			row = [...ids, 0, 0, 0, 0, 0];
			this.lineups[t].set(h, row);
		}
		this.lineupRow[t] = row;
		return row!;
	}

	stint(t: TeamNum, p: AdvPlayer, sign: 1 | -1) {
		const a = this.arr.get(p)!;
		const totals = this.teamTotals[t];
		a[ADV.possFor]! += sign * totals[TEAM_ADV.possFor]!;
		a[ADV.possAgainst]! += sign * totals[TEAM_ADV.possAgainst]!;
		a[ADV.ptsFor]! += sign * this.ptsFor[t];
		a[ADV.ptsAgainst]! += sign * this.ptsAgainst[t];
		a[ADV.oppRimOn]! += sign * this.oppRim[t];
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
		// The lineups of this segment (time() and stat() use these rows, substitutions happen between segments)
		if (this.dirty) {
			this.lineup(0, onCourt[0]);
			this.lineup(1, onCourt[1]);
			this.dirty = false;
		}
		const rowO = this.lineupRow[o]!;
		const rowD = this.lineupRow[o === 0 ? 1 : 0]!;
		if (o === this.lastO && period === this.lastPeriod) {
			return;
		}
		this.lastO = o;
		this.lastPeriod = period;
		const d: TeamNum = o === 0 ? 1 : 0;
		this.teamTotals[o][TEAM_ADV.possFor]! += 1;
		this.teamTotals[d][TEAM_ADV.possAgainst]! += 1;
		if (clutch) {
			this.teamTotals[o][TEAM_ADV.clPossFor]! += 1;
			this.teamTotals[d][TEAM_ADV.clPossAgainst]! += 1;
		}
		rowO[this.numPlayers + LU.possFor]! += 1;
		rowD[this.numPlayers + LU.possAgainst]! += 1;
	}

	possessionEnd() {
		this.cur = undefined;
	}

	// Time played in the possession segment
	time(seconds: number, onCourt: [AdvPlayer[], AdvPlayer[]]) {
		const i = this.numPlayers + LU.sec;
		this.lineupRow[0]![i]! += seconds;
		this.lineupRow[1]![i]! += seconds;
		if (this.clutch) {
			for (const t of [0, 1] as const) {
				this.teamTotals[t][TEAM_ADV.clSec]! += seconds;
				for (const p of onCourt[t]) {
					this.arr.get(p)![ADV.clSec]! += seconds;
				}
			}
		}
	}

	// A shot goes up (or a shooting foul on one): its play type
	shot(
		shooter: AdvPlayer,
		passer: AdvPlayer | undefined,
		creator: AdvPlayer | undefined,
		type: ShotKind,
		tipInFromOutOfBounds: boolean,
		transition: boolean,
		putback: boolean,
		defender: AdvPlayer | undefined,
		threePointers: boolean,
	) {
		let key: PlayTypeKey;
		const assisted = passer !== undefined;
		if (type === "tipIn" && tipInFromOutOfBounds) {
			key = "misc";
		} else if (transition) {
			key = "tr";
		} else if (putback) {
			key = "pb";
		} else if (type === "lowPost") {
			key = "post";
		} else {
			// With Spacing & Shot Creation the creator passed to the shooter even when no assist is credited
			const from =
				passer ??
				(creator !== undefined && creator !== shooter ? creator : undefined);
			const weights = shotWeights(
				type,
				this.role(shooter),
				from ? this.role(from) : undefined,
				this.realisticPlayTypes ? ISO_SCALE_REALISTIC : 1,
			);
			key = pickPlayType(weights, this.unit());
		}
		const pt = PT_INDEX[key];
		this.arr.get(shooter)![ptIndex(pt, PT_POSS)]! += 1;
		// (one object reused for every shot)
		const cur = this.curObj;
		cur.p = shooter;
		cur.pt = pt;
		cur.type = type;
		cur.assisted = assisted;
		cur.transition = transition;
		cur.defender = defender;
		cur.threePointer = type === "threePointer" && threePointers;
		this.cur = cur;
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
		const a = this.arr.get(cur.p)!;
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
		const da = defender ? this.arr.get(defender) : undefined;
		if (da) {
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
				const v = p.compositeRating.blocking ?? 0;
				if (v > best) {
					best = v;
					protector = p;
				}
			}
			if (protector) {
				const pa = this.arr.get(protector)!;
				pa[ADV.rimDfga]! += 1;
				if (made) {
					pa[ADV.rimDfgm]! += 1;
				}
			}
		}
	}

	turnover(p: AdvPlayer, transition: boolean, putback: boolean) {
		let key: PlayTypeKey;
		if (transition) {
			key = "tr";
		} else if (putback) {
			key = "pb";
		} else {
			key = pickPlayType(
				this.realisticPlayTypes
					? turnoverWeightsRealistic(this.role(p))
					: turnoverWeights(this.role(p)),
				this.unit(),
			);
		}
		const pt = PT_INDEX[key];
		const a = this.arr.get(p)!;
		a[ptIndex(pt, PT_POSS)]! += 1;
		a[ptIndex(pt, PT_TOV)]! += 1;
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
			this.ptsFor[o] += amt;
			this.ptsAgainst[d] += amt;
			if (this.clutch) {
				for (const q of onCourt[o]) {
					this.arr.get(q)![ADV.clPm]! += amt;
				}
				for (const q of onCourt[d]) {
					this.arr.get(q)![ADV.clPm]! -= amt;
				}
			}
			const rowO = this.lineupRow[o] ?? this.lineup(o, onCourt[o]);
			const rowD = this.lineupRow[d] ?? this.lineup(d, onCourt[d]);
			rowO[this.numPlayers + LU.ptsFor]! += amt;
			rowD[this.numPlayers + LU.ptsAgainst]! += amt;
			if (this.clutch) {
				this.teamTotals[o][TEAM_ADV.clPtsFor]! += amt;
				this.teamTotals[d][TEAM_ADV.clPtsAgainst]! += amt;
			}
			if (this.cur && p === this.cur.p) {
				this.arr.get(p)![ptIndex(this.cur.pt, PT_PTS)]! += amt;
			}
		}
		if (!this.clutch) {
			return;
		}
		const a = p ? this.arr.get(p) : undefined;
		if (a) {
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
				this.arr.get(q)![tm]! += amt;
			}
		}
	}

	// End of the game: the players' and teams' records, on the objects the sim returns (players who didn't play get none)
	finish() {
		// Close the stints of the players on the court
		for (const t of [0, 1] as const) {
			for (const p of this.lineupCache[t]) {
				this.stint(t, p, 1);
			}
			this.lineupCache[t] = [];
		}
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
				if (!(p.stat.min > 0)) {
					continue;
				}
				const a = this.arr.get(p)!;
				p.adv = a;
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
			for (const row of [
				...this.lineups[t].values(),
				...this.lineupCollisions[t].values(),
			]) {
				row[this.numPlayers + LU.sec] = Math.round(
					row[this.numPlayers + LU.sec]!,
				);
				if (
					row[this.numPlayers + LU.sec]! > 0 ||
					row.some((x, i) => i >= this.numPlayers && x !== 0)
				) {
					lu.push(row);
				}
			}
			this.teams[t].adv = { t: totals, lu };
		}
	}
}
