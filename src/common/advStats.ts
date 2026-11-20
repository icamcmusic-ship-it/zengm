// Advanced Tracking Stats (League extras, basketball, see docs/native-features.md): the layout of the compact season totals the game sim
// records (GameSim.basketball/advTracking.ts) and the stats derived from them. Shared by the worker (storage, views, awards, GOAT lab) and
// the UI.
//
// A player's stats row gets `adv`, an array of integers (ADV_LEN long) summed over his games. A team's stats row gets `adv`, a TeamAdv
// (team totals and its top five-man lineups). The layout is append-only: a later version may add fields at the end, and every reader
// treats a missing field as 0.

export const PLAY_TYPES = [
	{ key: "prb", name: "P&R Ball Handler", short: "PnR BH" },
	{ key: "prr", name: "P&R Roll Man", short: "PnR Roll" },
	{ key: "iso", name: "Isolation", short: "Iso" },
	{ key: "post", name: "Post-Up", short: "Post" },
	{ key: "spot", name: "Spot-Up", short: "Spot" },
	{ key: "cut", name: "Cut", short: "Cut" },
	{ key: "offs", name: "Off Screen", short: "Off Scr" },
	{ key: "ho", name: "Handoff", short: "Handoff" },
	{ key: "tr", name: "Transition", short: "Trans" },
	{ key: "pb", name: "Putback", short: "Putback" },
	{ key: "misc", name: "Miscellaneous", short: "Misc" },
] as const;

export type PlayTypeKey = (typeof PLAY_TYPES)[number]["key"];

export const PT_INDEX: Record<PlayTypeKey, number> = Object.fromEntries(
	PLAY_TYPES.map((pt, i) => [pt.key, i]),
) as Record<PlayTypeKey, number>;

// Per play type: possessions, points, field goal attempts, field goals made, turnovers
export const PT_FIELDS = 5;
export const PT_POSS = 0;
export const PT_PTS = 1;
export const PT_FGA = 2;
export const PT_FGM = 3;
export const PT_TOV = 4;

const NUM_PT = PLAY_TYPES.length;

// Start of each section, and the fields in it
export const ADV = {
	pt: 0,
	// Assisted makes by zone (rim, short mid = post-ups and short shots, long mid = mid-range jumpers, three), unassisted makes by zone,
	// catch-and-shoot threes attempted/made, pull-up threes attempted/made
	astRim: NUM_PT * PT_FIELDS,
	astShort: NUM_PT * PT_FIELDS + 1,
	astLong: NUM_PT * PT_FIELDS + 2,
	ast3: NUM_PT * PT_FIELDS + 3,
	unRim: NUM_PT * PT_FIELDS + 4,
	unShort: NUM_PT * PT_FIELDS + 5,
	unLong: NUM_PT * PT_FIELDS + 6,
	un3: NUM_PT * PT_FIELDS + 7,
	cs3a: NUM_PT * PT_FIELDS + 8,
	cs3m: NUM_PT * PT_FIELDS + 9,
	pu3a: NUM_PT * PT_FIELDS + 10,
	pu3m: NUM_PT * PT_FIELDS + 11,
	// Defense: shots he was the closest defender on (2PT, 3PT: attempts, makes), shots at the rim with him as the rim protector, contests
	// (closest defender outside transition), opponents' rim attempts while he was on the floor
	dfga2: NUM_PT * PT_FIELDS + 12,
	dfgm2: NUM_PT * PT_FIELDS + 13,
	dfga3: NUM_PT * PT_FIELDS + 14,
	dfgm3: NUM_PT * PT_FIELDS + 15,
	rimDfga: NUM_PT * PT_FIELDS + 16,
	rimDfgm: NUM_PT * PT_FIELDS + 17,
	con2: NUM_PT * PT_FIELDS + 18,
	con3: NUM_PT * PT_FIELDS + 19,
	oppRimOn: NUM_PT * PT_FIELDS + 20,
	// On/off: possessions and points while he was on the floor (for, against), and his team's totals in the games he played
	possFor: NUM_PT * PT_FIELDS + 21,
	possAgainst: NUM_PT * PT_FIELDS + 22,
	ptsFor: NUM_PT * PT_FIELDS + 23,
	ptsAgainst: NUM_PT * PT_FIELDS + 24,
	tmPossFor: NUM_PT * PT_FIELDS + 25,
	tmPossAgainst: NUM_PT * PT_FIELDS + 26,
	tmPtsFor: NUM_PT * PT_FIELDS + 27,
	tmPtsAgainst: NUM_PT * PT_FIELDS + 28,
	tmOppRim: NUM_PT * PT_FIELDS + 29,
	// Clutch (last 5 minutes of the final period or overtime, margin within 5): games, seconds, his stats, plus/minus and his team's
	// shots, free throws and turnovers while he was on the floor (for usage)
	clGp: NUM_PT * PT_FIELDS + 30,
	clSec: NUM_PT * PT_FIELDS + 31,
	clPts: NUM_PT * PT_FIELDS + 32,
	clFga: NUM_PT * PT_FIELDS + 33,
	clFg: NUM_PT * PT_FIELDS + 34,
	clTpa: NUM_PT * PT_FIELDS + 35,
	clTp: NUM_PT * PT_FIELDS + 36,
	clFta: NUM_PT * PT_FIELDS + 37,
	clFt: NUM_PT * PT_FIELDS + 38,
	clTov: NUM_PT * PT_FIELDS + 39,
	clPm: NUM_PT * PT_FIELDS + 40,
	clTmFga: NUM_PT * PT_FIELDS + 41,
	clTmFta: NUM_PT * PT_FIELDS + 42,
	clTmTov: NUM_PT * PT_FIELDS + 43,
	// Opponents' expected rim attempts while he was on the floor: each opposing player's rim attempts per possession against the
	// rest of his team's lineups (in that game) times the possessions they shared with him, so rimDeter compares like with like
	oppRimExp: NUM_PT * PT_FIELDS + 44,
	// Shot Share Model, his shot diet: where his shots came from (each shot counted once, in this order of priority: a putback, a kick-out
	// from a double team, a late shot clock bailout, the hot hand, a mismatch he was hunted for, a shot he created himself, the normal
	// draw), how many of them came from the shooter draw (sdDraws), and for those, the sum of 1000 × how much each modifier moved his share
	// of the draw (1000 = no change): the coach's system, fatigue, shot discipline, defensive attention and double teams, his game plan, and
	// his role in the five
	sdNormal: NUM_PT * PT_FIELDS + 45,
	sdCreated: NUM_PT * PT_FIELDS + 46,
	sdPutback: NUM_PT * PT_FIELDS + 47,
	sdLate: NUM_PT * PT_FIELDS + 48,
	sdHot: NUM_PT * PT_FIELDS + 49,
	sdKick: NUM_PT * PT_FIELDS + 50,
	sdHunt: NUM_PT * PT_FIELDS + 51,
	sdDraws: NUM_PT * PT_FIELDS + 52,
	smCoach: NUM_PT * PT_FIELDS + 53,
	smFatigue: NUM_PT * PT_FIELDS + 54,
	smDiscipline: NUM_PT * PT_FIELDS + 55,
	smAttention: NUM_PT * PT_FIELDS + 56,
	smPlan: NUM_PT * PT_FIELDS + 57,
	smRole: NUM_PT * PT_FIELDS + 58,
	// Shot Zones (League extras): attempts and makes by sub-zone (SHOT_ZONES order, szFga + i and szFgm + i), the sum of 1000 × each
	// attempt's expected FG% (xFG) and the attempts that have one
	szFga: NUM_PT * PT_FIELDS + 59,
	szFgm: NUM_PT * PT_FIELDS + 59 + 9,
	szXfg: NUM_PT * PT_FIELDS + 59 + 18,
	szN: NUM_PT * PT_FIELDS + 59 + 19,
} as const;

export const ADV_LEN = NUM_PT * PT_FIELDS + 59 + 20;

// Shot Zones: the sub-zones (index order is the storage order, append-only), their coarse group and points
export const SHOT_ZONES = [
	{ key: "dunk", name: "Dunk", group: "rim", pts: 2 },
	{ key: "layup", name: "Layup", group: "rim", pts: 2 },
	{ key: "cut", name: "Cut / lob", group: "rim", pts: 2 },
	{ key: "putback", name: "Putback / tip", group: "rim", pts: 2 },
	{ key: "post", name: "Post-up", group: "paint", pts: 2 },
	{ key: "short", name: "Short mid / floater", group: "paint", pts: 2 },
	{ key: "long", name: "Long two", group: "long", pts: 2 },
	{ key: "corner3", name: "Corner three", group: "corner3", pts: 3 },
	{ key: "ab3", name: "Above-the-break three", group: "ab3", pts: 3 },
] as const;
export type ShotZoneKey = (typeof SHOT_ZONES)[number]["key"];
export const SHOT_ZONE_INDEX = Object.fromEntries(
	SHOT_ZONES.map((z, i) => [z.key, i]),
) as Record<ShotZoneKey, number>;

// Shot Zones: a player's (or a group's) zone table from an adv array, undefined without any zone recorded
export const shotZones = (adv: readonly number[] | undefined) => {
	if (!adv) {
		return undefined;
	}
	let fga = 0;
	let fgm = 0;
	const zones = SHOT_ZONES.map((z, i) => {
		const a = adv[ADV.szFga + i] ?? 0;
		const m = adv[ADV.szFgm + i] ?? 0;
		fga += a;
		fgm += m;
		return { ...z, fga: a, fgm: m };
	});
	if (fga <= 0) {
		return undefined;
	}
	const n = adv[ADV.szN] ?? 0;
	return {
		fga,
		fgm,
		fgp: fgm / fga,
		// Expected FG% of his shots (shot quality) vs his actual FG% on them
		xfgp: n > 0 ? (adv[ADV.szXfg] ?? 0) / (1000 * n) : undefined,
		zones: zones.map((z) => ({
			...z,
			freq: z.fga / fga,
			fgp: z.fga > 0 ? z.fgm / z.fga : undefined,
		})),
	};
};

// Shot Share Model: the shot diet's sources and modifiers (keys of ADV), with their labels
export const SHOT_DIET_SOURCES = [
	{ key: "sdNormal", name: "Normal draw" },
	{ key: "sdCreated", name: "Self-created" },
	{ key: "sdPutback", name: "Putbacks" },
	{ key: "sdLate", name: "Late clock" },
	{ key: "sdHot", name: "Hot hand" },
	{ key: "sdKick", name: "Double-team kick-outs" },
	{ key: "sdHunt", name: "Mismatch hunting" },
] as const;
export const SHOT_DIET_MODIFIERS = [
	{ key: "smCoach", name: "Coach system" },
	{ key: "smFatigue", name: "Fatigue" },
	{ key: "smDiscipline", name: "Shot discipline" },
	{ key: "smAttention", name: "Defensive attention" },
	{ key: "smPlan", name: "Game plan" },
	{ key: "smRole", name: "Role" },
] as const;

// Shot Share Model: a game's shot diet as stored in the box score (sd: the source counts, in SHOT_DIET_SOURCES order), and its text
export const shotDietOfGame = (adv: readonly number[]) =>
	SHOT_DIET_SOURCES.map((s) => adv[ADV[s.key]] ?? 0);
export const shotDietText = (sd: readonly number[] | undefined) => {
	if (!sd) {
		return undefined;
	}
	const parts = [];
	for (const [i, s] of SHOT_DIET_SOURCES.entries()) {
		const count = sd[i] ?? 0;
		if (count > 0) {
			parts.push(`${count} ${s.name.toLowerCase()}`);
		}
	}
	return parts.length > 0 ? `Shot diet: ${parts.join(", ")}` : undefined;
};

// Shot Share Model: a shot diet from an adv array (undefined without any shot recorded): each source's count and share of his shots, and
// each modifier's average effect on his share of the draw (1 = none)
export const shotDiet = (adv: readonly number[] | undefined) => {
	if (!adv) {
		return undefined;
	}
	let total = 0;
	for (const s of SHOT_DIET_SOURCES) {
		total += adv[ADV[s.key]] ?? 0;
	}
	if (total <= 0) {
		return undefined;
	}
	const draws = adv[ADV.sdDraws] ?? 0;
	return {
		total,
		draws,
		sources: SHOT_DIET_SOURCES.map((s) => {
			const count = adv[ADV[s.key]] ?? 0;
			return { ...s, count, pct: count / total };
		}),
		modifiers: SHOT_DIET_MODIFIERS.map((m) => ({
			...m,
			mult: draws > 0 ? (adv[ADV[m.key]] ?? 0) / (1000 * draws) : 1,
		})),
	};
};

export const ptIndex = (pt: number, field: number) => pt * PT_FIELDS + field;

// (a packed array: pushed, not filled, so element access stays fast in the game sim)
export const newAdv = () => {
	const a: number[] = [];
	for (let i = 0; i < ADV_LEN; i++) {
		a.push(0);
	}
	return a;
};

// Adds b into a (both player arrays), in place. a may be shorter (an older layout)
export const addAdv = (a: number[], b: readonly number[]) => {
	for (let i = 0; i < b.length; i++) {
		a[i] = (a[i] ?? 0) + (b[i] ?? 0);
	}
	return a;
};

// Sum of the adv arrays of some stats rows (undefined if none has one)
export const sumAdv = (rows: readonly { adv?: number[] }[]) => {
	let out: number[] | undefined;
	for (const row of rows) {
		if (row.adv) {
			out ??= newAdv();
			addAdv(out, row.adv);
		}
	}
	return out;
};

// A retired player's tracking folded into one career total (League Extras "Keep Career Tracking for Retired Players", see
// worker/core/player/advStatsStorage.ts): the sums of every stats row's adv, regular season (rs) and playoffs (po), and the first and
// last season folded. The rows lose their adv when folded, so a career is always advCareer + the adv still on rows (a comeback's new
// seasons), and folding again never counts a row twice. The arrays use the same append-only layout as a row's adv.
export type AdvCareer = {
	rs?: number[];
	po?: number[];
	from: number;
	to: number;
};

// Folds the adv of the rows that pass `include` into career (in place, or a new one), and deletes it from those rows. Undefined if
// there was nothing to fold and no career before.
export const foldAdvRows = (
	career: AdvCareer | undefined,
	rows: { adv?: number[]; playoffs: boolean; season: number }[],
	include: (row: { season: number; tid?: number }) => boolean = () => true,
) => {
	let out = career;
	for (const row of rows) {
		if (!row.adv || !include(row)) {
			continue;
		}
		out ??= { from: row.season, to: row.season };
		const key = row.playoffs ? "po" : "rs";
		out[key] = addAdv(out[key] ?? newAdv(), row.adv);
		out.from = Math.min(out.from, row.season);
		out.to = Math.max(out.to, row.season);
		delete row.adv;
	}
	return out;
};

// How a career total over some of a player's rows should use his folded career: "add" it (every folded season is in the rows asked
// for), "hide" the tracking (some folded seasons are asked for but not all of them, or only one team's part, which the career total
// can't split), or "none" (no folded season is asked for)
export const advCareerUse = (
	career: AdvCareer | undefined,
	{
		tid,
		seasonRange,
		rows,
	}: {
		tid?: number;
		seasonRange?: [number, number];
		rows: readonly { season?: number }[];
	},
): "add" | "hide" | "none" => {
	if (!career) {
		return "none";
	}
	const overlaps = seasonRange
		? seasonRange[0] <= career.to && seasonRange[1] >= career.from
		: true;
	if (!overlaps) {
		return "none";
	}
	const covers = seasonRange
		? seasonRange[0] <= career.from && seasonRange[1] >= career.to
		: true;
	if (tid === undefined && covers) {
		return "add";
	}
	// A team's rows (or a part of the folded seasons): hidden if any of the rows asked for is a folded season
	return rows.some(
		(row) =>
			row.season !== undefined &&
			row.season >= career.from &&
			row.season <= career.to,
	)
		? "hide"
		: "none";
};

// The folded career for a season type, combined = regular season + playoffs. Undefined if there is none.
export const advCareerFor = (
	career: AdvCareer | undefined,
	seasonType: "regularSeason" | "playoffs" | "combined",
) => {
	if (!career) {
		return undefined;
	}
	const parts =
		seasonType === "regularSeason"
			? [career.rs]
			: seasonType === "playoffs"
				? [career.po]
				: [career.rs, career.po];
	let out: number[] | undefined;
	for (const part of parts) {
		if (part) {
			out ??= newAdv();
			addAdv(out, part);
		}
	}
	return out;
};

// A whole career: the folded total plus the rows' adv (undefined if neither)
export const careerAdv = (
	career: AdvCareer | undefined,
	rows: readonly { adv?: number[] }[],
	seasonType: "regularSeason" | "playoffs" | "combined",
) => {
	const folded = advCareerFor(career, seasonType);
	const fromRows = sumAdv(rows);
	if (folded && fromRows) {
		return addAdv(folded, fromRows);
	}
	return folded ?? fromRows;
};

// Team: [possFor, possAgainst, clutch seconds, clutch points for, clutch points against, clutch possessions for, clutch possessions
// against], and lineups: [...pids (sorted), seconds, points for, points against, possessions for, possessions against]
export type TeamAdv = {
	t: number[];
	lu: number[][];
};
export const TEAM_ADV = {
	possFor: 0,
	possAgainst: 1,
	clSec: 2,
	clPtsFor: 3,
	clPtsAgainst: 4,
	clPossFor: 5,
	clPossAgainst: 6,
};
export const TEAM_ADV_LEN = 7;
// Lineup fields after the pids
export const LU = {
	sec: 0,
	ptsFor: 1,
	ptsAgainst: 2,
	possFor: 3,
	possAgainst: 4,
};
export const LU_FIELDS = 5;
// Lineups kept per team-season: pruned to LINEUPS_KEEP by minutes whenever there are more than LINEUPS_MAX (during the season), and to
// LINEUPS_FINAL after the playoffs
export const LINEUPS_KEEP = 60;
export const LINEUPS_MAX = 150;
export const LINEUPS_FINAL = 40;

export const pruneLineups = (
	lu: number[][],
	numPlayers: number,
	keep: number,
) => {
	if (lu.length <= keep) {
		return lu;
	}
	return lu
		.toSorted((a, b) => (b[numPlayers] ?? 0) - (a[numPlayers] ?? 0))
		.slice(0, keep);
};

// Lineup row index by a hash of its pids, for each season's lineup array (rebuilt only when the array is replaced, like after a prune)
const lineupIndexes = new WeakMap<number[][], Map<number, number[]>>();
const lineupHash = (row: readonly number[], numPlayers: number) => {
	let h = 0;
	for (let i = 0; i < numPlayers; i++) {
		h = (Math.imul(h, 1000003) + row[i]!) | 0;
	}
	return h;
};
const samePids = (a: readonly number[], b: readonly number[], n: number) => {
	for (let i = 0; i < n; i++) {
		if (a[i] !== b[i]) {
			return false;
		}
	}
	return true;
};

// Adds a game's team adv into a season's, in place
export const addTeamAdv = (
	a: TeamAdv,
	b: TeamAdv,
	numPlayers: number,
): TeamAdv => {
	for (let i = 0; i < b.t.length; i++) {
		a.t[i] = (a.t[i] ?? 0) + (b.t[i] ?? 0);
	}
	let byHash = lineupIndexes.get(a.lu);
	if (!byHash) {
		byHash = new Map();
		for (const row of a.lu) {
			byHash.set(lineupHash(row, numPlayers), row);
		}
		lineupIndexes.set(a.lu, byHash);
	}
	for (const row of b.lu) {
		const h = lineupHash(row, numPlayers);
		let existing = byHash.get(h);
		if (existing && !samePids(existing, row, numPlayers)) {
			// (a hash collision)
			existing = a.lu.find((row2) => samePids(row2, row, numPlayers));
		}
		if (existing) {
			for (let i = numPlayers; i < row.length; i++) {
				existing[i] = (existing[i] ?? 0) + row[i]!;
			}
		} else {
			const copy = [...row];
			a.lu.push(copy);
			if (!byHash.has(h)) {
				byHash.set(h, copy);
			}
		}
	}
	if (a.lu.length > LINEUPS_MAX) {
		a.lu = pruneLineups(a.lu, numPlayers, LINEUPS_KEEP);
	}
	return a;
};

const ratio = (num: number, den: number) => (den > 0 ? num / den : undefined);
const pct = (num: number, den: number) =>
	den > 0 ? (100 * num) / den : undefined;
const per100 = (num: number, den: number) =>
	den > 0 ? (100 * num) / den : undefined;
const sub = (a: number | undefined, b: number | undefined) =>
	a === undefined || b === undefined ? undefined : a - b;

const at = (adv: readonly number[], i: number) => adv[i] ?? 0;

export const ptPoss = (adv: readonly number[]) => {
	let total = 0;
	for (let i = 0; i < NUM_PT; i++) {
		total += at(adv, ptIndex(i, PT_POSS));
	}
	return total;
};

// One play type's numbers
export const playTypeLine = (adv: readonly number[], i: number) => {
	const total = ptPoss(adv);
	const poss = at(adv, ptIndex(i, PT_POSS));
	const pts = at(adv, ptIndex(i, PT_PTS));
	const fga = at(adv, ptIndex(i, PT_FGA));
	const fgm = at(adv, ptIndex(i, PT_FGM));
	const tov = at(adv, ptIndex(i, PT_TOV));
	return {
		key: PLAY_TYPES[i]!.key,
		name: PLAY_TYPES[i]!.name,
		poss,
		pts,
		fga,
		fgm,
		tov,
		ppp: ratio(pts, poss),
		freq: pct(poss, total),
		fgp: pct(fgm, fga),
		tovp: pct(tov, poss),
	};
};

// A player's play-type profile (for archetypes and the player page): each play type's share of his possessions and its points per
// possession, from an adv array (season or summed)
export const playTypeProfile = (adv: readonly number[] | undefined) => {
	if (!adv) {
		return undefined;
	}
	const total = ptPoss(adv);
	if (total === 0) {
		return undefined;
	}
	const types = PLAY_TYPES.map((_pt, i) => playTypeLine(adv, i));
	return { poss: total, types };
};

const upper = (key: string) => key.charAt(0).toUpperCase() + key.slice(1);

// Derived stats (the columns of the Player Stats tabs, the player page, awards and the GOAT lab). Each reads a player's summed adv array
// (undefined when there is none)
const ADV_STAT_FUNCTIONS: Record<
	string,
	(adv: readonly number[]) => number | undefined
> = {
	ptPoss: (adv) => ptPoss(adv),
};
for (let i = 0; i < NUM_PT; i++) {
	const k = upper(PLAY_TYPES[i]!.key);
	ADV_STAT_FUNCTIONS[`pt${k}Poss`] = (adv) => at(adv, ptIndex(i, PT_POSS));
	ADV_STAT_FUNCTIONS[`pt${k}Freq`] = (adv) => playTypeLine(adv, i).freq;
	ADV_STAT_FUNCTIONS[`pt${k}Ppp`] = (adv) => playTypeLine(adv, i).ppp;
	ADV_STAT_FUNCTIONS[`pt${k}Fgp`] = (adv) => playTypeLine(adv, i).fgp;
	ADV_STAT_FUNCTIONS[`pt${k}Tovp`] = (adv) => playTypeLine(adv, i).tovp;
}
const zones = [
	["Rim", ADV.astRim, ADV.unRim],
	["Short", ADV.astShort, ADV.unShort],
	["Long", ADV.astLong, ADV.unLong],
	["3", ADV.ast3, ADV.un3],
] as const;
for (const [name, a, u] of zones) {
	ADV_STAT_FUNCTIONS[`ast${name}`] = (adv) => at(adv, a);
	ADV_STAT_FUNCTIONS[`unast${name}`] = (adv) => at(adv, u);
	ADV_STAT_FUNCTIONS[`astp${name}`] = (adv) =>
		pct(at(adv, a), at(adv, a) + at(adv, u));
}
Object.assign(ADV_STAT_FUNCTIONS, {
	cs3a: (adv) => at(adv, ADV.cs3a),
	cs3p: (adv) => pct(at(adv, ADV.cs3m), at(adv, ADV.cs3a)),
	pu3a: (adv) => at(adv, ADV.pu3a),
	pu3p: (adv) => pct(at(adv, ADV.pu3m), at(adv, ADV.pu3a)),
	cs3r: (adv) => pct(at(adv, ADV.cs3a), at(adv, ADV.cs3a) + at(adv, ADV.pu3a)),

	dfga: (adv) => at(adv, ADV.dfga2) + at(adv, ADV.dfga3),
	dfgm: (adv) => at(adv, ADV.dfgm2) + at(adv, ADV.dfgm3),
	dfgp: (adv) =>
		pct(
			at(adv, ADV.dfgm2) + at(adv, ADV.dfgm3),
			at(adv, ADV.dfga2) + at(adv, ADV.dfga3),
		),
	dfga2: (adv) => at(adv, ADV.dfga2),
	dfga3: (adv) => at(adv, ADV.dfga3),
	dfgp2: (adv) => pct(at(adv, ADV.dfgm2), at(adv, ADV.dfga2)),
	dfgp3: (adv) => pct(at(adv, ADV.dfgm3), at(adv, ADV.dfga3)),
	rimDfga: (adv) => at(adv, ADV.rimDfga),
	rimDfgp: (adv) => pct(at(adv, ADV.rimDfgm), at(adv, ADV.rimDfga)),
	con2: (adv) => at(adv, ADV.con2),
	con3: (adv) => at(adv, ADV.con3),
	// Opponents' rim attempts per 100 of their possessions with him on the floor, minus what those same opponents attempted against the
	// rest of his team (negative: he deters drives). Plain on minus off (older records) mostly measured who he played against: starters
	// face starters, who attack the rim more
	rimDeter: (adv) =>
		adv.length > ADV.oppRimExp
			? per100(
					at(adv, ADV.oppRimOn) - at(adv, ADV.oppRimExp),
					at(adv, ADV.possAgainst),
				)
			: sub(
					per100(at(adv, ADV.oppRimOn), at(adv, ADV.possAgainst)),
					per100(
						at(adv, ADV.tmOppRim) - at(adv, ADV.oppRimOn),
						at(adv, ADV.tmPossAgainst) - at(adv, ADV.possAgainst),
					),
				),

	onOrtg: (adv) => per100(at(adv, ADV.ptsFor), at(adv, ADV.possFor)),
	onDrtg: (adv) => per100(at(adv, ADV.ptsAgainst), at(adv, ADV.possAgainst)),
	onNet: (adv) => onNet(adv),
	onPoss: (adv) => (at(adv, ADV.possFor) + at(adv, ADV.possAgainst)) / 2,
	onOffOrtg: (adv) =>
		sub(
			per100(at(adv, ADV.ptsFor), at(adv, ADV.possFor)),
			per100(
				at(adv, ADV.tmPtsFor) - at(adv, ADV.ptsFor),
				at(adv, ADV.tmPossFor) - at(adv, ADV.possFor),
			),
		),
	onOffDrtg: (adv) =>
		sub(
			per100(at(adv, ADV.ptsAgainst), at(adv, ADV.possAgainst)),
			per100(
				at(adv, ADV.tmPtsAgainst) - at(adv, ADV.ptsAgainst),
				at(adv, ADV.tmPossAgainst) - at(adv, ADV.possAgainst),
			),
		),
	offNet: (adv) => offNet(adv),
	onOffNet: (adv) => sub(onNet(adv), offNet(adv)),

	clGp: (adv) => at(adv, ADV.clGp),
	clMin: (adv) => at(adv, ADV.clSec) / 60,
	clPts: (adv) => at(adv, ADV.clPts),
	clFg: (adv) => at(adv, ADV.clFg),
	clFga: (adv) => at(adv, ADV.clFga),
	clFgp: (adv) => pct(at(adv, ADV.clFg), at(adv, ADV.clFga)),
	clTpp: (adv) => pct(at(adv, ADV.clTp), at(adv, ADV.clTpa)),
	clFtp: (adv) => pct(at(adv, ADV.clFt), at(adv, ADV.clFta)),
	clTov: (adv) => at(adv, ADV.clTov),
	clPm: (adv) => at(adv, ADV.clPm),
	clUsgp: (adv) =>
		pct(
			at(adv, ADV.clFga) + 0.44 * at(adv, ADV.clFta) + at(adv, ADV.clTov),
			at(adv, ADV.clTmFga) + 0.44 * at(adv, ADV.clTmFta) + at(adv, ADV.clTmTov),
		),
} satisfies Record<string, (adv: readonly number[]) => number | undefined>);

function onNet(adv: readonly number[]) {
	return sub(
		per100(at(adv, ADV.ptsFor), at(adv, ADV.possFor)),
		per100(at(adv, ADV.ptsAgainst), at(adv, ADV.possAgainst)),
	);
}

function offNet(adv: readonly number[]) {
	return sub(
		per100(
			at(adv, ADV.tmPtsFor) - at(adv, ADV.ptsFor),
			at(adv, ADV.tmPossFor) - at(adv, ADV.possFor),
		),
		per100(
			at(adv, ADV.tmPtsAgainst) - at(adv, ADV.ptsAgainst),
			at(adv, ADV.tmPossAgainst) - at(adv, ADV.possAgainst),
		),
	);
}

type Zone = "Rim" | "Short" | "Long" | "3";
export type AdvStatKey =
	| "ptPoss"
	| `pt${Capitalize<PlayTypeKey>}${"Poss" | "Freq" | "Ppp" | "Fgp" | "Tovp"}`
	| `${"ast" | "unast" | "astp"}${Zone}`
	| "cs3a"
	| "cs3p"
	| "pu3a"
	| "pu3p"
	| "cs3r"
	| "dfga"
	| "dfgm"
	| "dfgp"
	| "dfga2"
	| "dfga3"
	| "dfgp2"
	| "dfgp3"
	| "rimDfga"
	| "rimDfgp"
	| "con2"
	| "con3"
	| "rimDeter"
	| "onOrtg"
	| "onDrtg"
	| "onNet"
	| "onPoss"
	| "onOffOrtg"
	| "onOffDrtg"
	| "offNet"
	| "onOffNet"
	| "clGp"
	| "clMin"
	| "clPts"
	| "clFg"
	| "clFga"
	| "clFgp"
	| "clTpp"
	| "clFtp"
	| "clTov"
	| "clPm"
	| "clUsgp";

export const ADV_STAT_KEYS = Object.keys(ADV_STAT_FUNCTIONS) as AdvStatKey[];
const ADV_STAT_KEY_SET: ReadonlySet<string> = new Set(ADV_STAT_KEYS);
export const isAdvStat = (key: string) => ADV_STAT_KEY_SET.has(key);

export const advStat = (
	adv: readonly number[] | undefined,
	key: string,
): number | undefined => {
	if (!adv) {
		return undefined;
	}
	const fn = ADV_STAT_FUNCTIONS[key];
	return fn ? fn(adv) : undefined;
};

// Lineup row → its numbers
export const lineupLine = (row: readonly number[], numPlayers: number) => {
	const f = (i: number) => row[numPlayers + i] ?? 0;
	const sec = f(LU.sec);
	const ortg = per100(f(LU.ptsFor), f(LU.possFor));
	const drtg = per100(f(LU.ptsAgainst), f(LU.possAgainst));
	return {
		pids: row.slice(0, numPlayers),
		min: sec / 60,
		ptsFor: f(LU.ptsFor),
		ptsAgainst: f(LU.ptsAgainst),
		possFor: f(LU.possFor),
		possAgainst: f(LU.possAgainst),
		pm: f(LU.ptsFor) - f(LU.ptsAgainst),
		ortg,
		drtg,
		net: sub(ortg, drtg),
	};
};

// Column titles, descriptions and number formats of the derived stats (getCols, roundStat)
export type AdvFormat = "count" | "pct" | "ppp" | "pm" | "pmInt" | "rating";
export const ADV_STAT_META: Record<
	AdvStatKey,
	{ title: string; desc: string; format: AdvFormat }
> = (() => {
	const meta: Record<
		string,
		{ title: string; desc: string; format: AdvFormat }
	> = {
		ptPoss: {
			title: "Poss",
			desc: "Play-type possessions (shots, shooting fouls and turnovers)",
			format: "count",
		},
	};
	for (const pt of PLAY_TYPES) {
		const k = upper(pt.key);
		meta[`pt${k}Poss`] = {
			title: "Poss",
			desc: `${pt.name} possessions`,
			format: "count",
		};
		meta[`pt${k}Freq`] = {
			title: "Freq",
			desc: `${pt.name} frequency (% of his play-type possessions)`,
			format: "pct",
		};
		meta[`pt${k}Ppp`] = {
			title: "PPP",
			desc: `${pt.name} points per possession`,
			format: "ppp",
		};
		meta[`pt${k}Fgp`] = {
			title: "FG%",
			desc: `${pt.name} field goal percentage`,
			format: "pct",
		};
		meta[`pt${k}Tovp`] = {
			title: "TOV%",
			desc: `${pt.name} turnovers per possession (%)`,
			format: "pct",
		};
	}
	const zoneNames = {
		Rim: "at the rim",
		Short: "short mid-range (post-ups and short shots)",
		Long: "long mid-range",
		"3": "from three",
	};
	for (const [zone, name] of Object.entries(zoneNames)) {
		meta[`ast${zone}`] = {
			title: "Ast",
			desc: `Assisted makes ${name}`,
			format: "count",
		};
		meta[`unast${zone}`] = {
			title: "Unast",
			desc: `Unassisted makes ${name}`,
			format: "count",
		};
		meta[`astp${zone}`] = {
			title: "%Ast",
			desc: `Share of makes ${name} that were assisted`,
			format: "pct",
		};
	}
	Object.assign(meta, {
		cs3a: {
			title: "3PA",
			desc: "Catch-and-shoot three-point attempts",
			format: "count",
		},
		cs3p: {
			title: "3P%",
			desc: "Catch-and-shoot three-point percentage",
			format: "pct",
		},
		pu3a: {
			title: "3PA",
			desc: "Pull-up three-point attempts",
			format: "count",
		},
		pu3p: {
			title: "3P%",
			desc: "Pull-up three-point percentage",
			format: "pct",
		},
		cs3r: {
			title: "C&S%",
			desc: "Share of three-point attempts that were catch-and-shoot",
			format: "pct",
		},
		dfga: {
			title: "DFGA",
			desc: "Opponents' field goal attempts with him as the closest defender",
			format: "count",
		},
		dfgm: {
			title: "DFGM",
			desc: "Opponents' field goals made with him as the closest defender",
			format: "count",
		},
		dfgp: {
			title: "DFG%",
			desc: "Defended field goal percentage (opponents' FG% with him as the closest defender)",
			format: "pct",
		},
		dfga2: {
			title: "D2PA",
			desc: "Opponents' two-point attempts with him as the closest defender",
			format: "count",
		},
		dfga3: {
			title: "D3PA",
			desc: "Opponents' three-point attempts with him as the closest defender",
			format: "count",
		},
		dfgp2: {
			title: "D2P%",
			desc: "Defended two-point percentage",
			format: "pct",
		},
		dfgp3: {
			title: "D3P%",
			desc: "Defended three-point percentage",
			format: "pct",
		},
		rimDfga: {
			title: "RimDFGA",
			desc: "Opponents' shots at the rim with him as the rim protector (the best shot blocker on the floor)",
			format: "count",
		},
		rimDfgp: {
			title: "RimDFG%",
			desc: "Opponents' FG% at the rim with him as the rim protector",
			format: "pct",
		},
		con2: {
			title: "2PT",
			desc: "Two-point shots contested (closest defender, not in transition)",
			format: "count",
		},
		con3: {
			title: "3PT",
			desc: "Three-point shots contested (closest defender, not in transition)",
			format: "count",
		},
		rimDeter: {
			title: "Deter",
			desc: "Shots deterred: opponents' rim attempts per 100 possessions with him on the floor minus what the same opponents attempted against his teammates (negative is better)",
			format: "pm",
		},
		onOrtg: {
			title: "On ORtg",
			desc: "Team points per 100 possessions with him on the floor",
			format: "rating",
		},
		onDrtg: {
			title: "On DRtg",
			desc: "Opponents' points per 100 possessions with him on the floor",
			format: "rating",
		},
		onNet: {
			title: "On Net",
			desc: "Team net rating with him on the floor",
			format: "pm",
		},
		onPoss: {
			title: "On Poss",
			desc: "Possessions he was on the floor for (average of offense and defense)",
			format: "count",
		},
		onOffOrtg: {
			title: "On-Off ORtg",
			desc: "Team offensive rating with him on the floor minus off",
			format: "pm",
		},
		onOffDrtg: {
			title: "On-Off DRtg",
			desc: "Opponents' offensive rating with him on the floor minus off (negative is better)",
			format: "pm",
		},
		offNet: {
			title: "Off Net",
			desc: "Team net rating with him off the floor (in the games he played)",
			format: "pm",
		},
		onOffNet: {
			title: "On-Off",
			desc: "Net rating on minus off",
			format: "pm",
		},
		clGp: {
			title: "CG",
			desc: "Games with clutch minutes (last 5 minutes of the 4th quarter or overtime, margin within 5)",
			format: "count",
		},
		clMin: { title: "MP", desc: "Clutch minutes", format: "rating" },
		clPts: { title: "PTS", desc: "Clutch points", format: "count" },
		clFg: { title: "FG", desc: "Clutch field goals made", format: "count" },
		clFga: {
			title: "FGA",
			desc: "Clutch field goal attempts",
			format: "count",
		},
		clFgp: {
			title: "FG%",
			desc: "Clutch field goal percentage",
			format: "pct",
		},
		clTpp: {
			title: "3P%",
			desc: "Clutch three-point percentage",
			format: "pct",
		},
		clFtp: {
			title: "FT%",
			desc: "Clutch free throw percentage",
			format: "pct",
		},
		clTov: { title: "TOV", desc: "Clutch turnovers", format: "count" },
		clPm: { title: "+/-", desc: "Clutch plus/minus", format: "pmInt" },
		clUsgp: {
			title: "USG%",
			desc: "Clutch usage rate (his shots, free throws and turnovers, as a share of his team's while he was on the floor)",
			format: "pct",
		},
	});
	return meta as Record<
		AdvStatKey,
		{ title: string; desc: string; format: AdvFormat }
	>;
})();

// Player Stats tabs (and player page tables) of this feature
export const ADV_STAT_TYPES = [
	"playTypes",
	"shootingSplits",
	"trackingDefense",
	"onOff",
	"clutch",
] as const;
