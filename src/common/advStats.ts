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
} as const;

export const ADV_LEN = NUM_PT * PT_FIELDS + 44;

export const ptIndex = (pt: number, field: number) => pt * PT_FIELDS + field;

export const newAdv = () => new Array<number>(ADV_LEN).fill(0);

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

// Adds a game's team adv into a season's, in place
export const addTeamAdv = (
	a: TeamAdv,
	b: TeamAdv,
	numPlayers: number,
): TeamAdv => {
	for (let i = 0; i < b.t.length; i++) {
		a.t[i] = (a.t[i] ?? 0) + (b.t[i] ?? 0);
	}
	const byKey = new Map<string, number[]>();
	for (const row of a.lu) {
		byKey.set(row.slice(0, numPlayers).join(","), row);
	}
	for (const row of b.lu) {
		const key = row.slice(0, numPlayers).join(",");
		const existing = byKey.get(key);
		if (existing) {
			for (let i = numPlayers; i < row.length; i++) {
				existing[i] = (existing[i] ?? 0) + row[i]!;
			}
		} else {
			const copy = [...row];
			a.lu.push(copy);
			byKey.set(key, copy);
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
	dfgp2: (adv) => pct(at(adv, ADV.dfgm2), at(adv, ADV.dfga2)),
	dfgp3: (adv) => pct(at(adv, ADV.dfgm3), at(adv, ADV.dfga3)),
	rimDfga: (adv) => at(adv, ADV.rimDfga),
	rimDfgp: (adv) => pct(at(adv, ADV.rimDfgm), at(adv, ADV.rimDfga)),
	con2: (adv) => at(adv, ADV.con2),
	con3: (adv) => at(adv, ADV.con3),
	// Opponents' rim attempts per 100 of their possessions, with him on the floor minus with him off (negative: he deters drives)
	rimDeter: (adv) =>
		sub(
			per100(at(adv, ADV.oppRimOn), at(adv, ADV.possAgainst)),
			per100(
				at(adv, ADV.tmOppRim) - at(adv, ADV.oppRimOn),
				at(adv, ADV.tmPossAgainst) - at(adv, ADV.possAgainst),
			),
		),

	onOrtg: (adv) => per100(at(adv, ADV.ptsFor), at(adv, ADV.possFor)),
	onDrtg: (adv) => per100(at(adv, ADV.ptsAgainst), at(adv, ADV.possAgainst)),
	onNet: (adv) => onNet(adv),
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
			desc: "Shots deterred: opponents' rim attempts per 100 possessions with him on the floor minus off (negative is better)",
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
			title: "G",
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
