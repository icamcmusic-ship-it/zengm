// Real-player comps for draft prospects (League Extras "Real Player Comps", basketball): the real NBA players whose real young seasons
// look most like a prospect's ratings as the user's scouts see them. Only real players' real seasons are used: rows of the real players
// data file for a season he was on an NBA team, before the data's last season (still being played, so a rookie's row there is a
// projection, not his real season). Pure: the worker loads the data (core/draft/realComps.ts) and passes it in.

// The 15 base ratings, in the order of the index rows (RATINGS in constants.basketball.ts)
export const COMP_RATINGS = [
	"hgt",
	"stre",
	"spd",
	"jmp",
	"endu",
	"ins",
	"dnk",
	"ft",
	"fg",
	"tp",
	"oiq",
	"diq",
	"drb",
	"pss",
	"reb",
] as const;
const NUM = COMP_RATINGS.length;

// Weights of the ratings other than height in the shape and level terms. Endurance says little about what kind of player he is.
export const COMP_WEIGHTS: Record<(typeof COMP_RATINGS)[number], number> = {
	hgt: 0,
	stre: 1,
	spd: 1,
	jmp: 1,
	endu: 0.5,
	ins: 1,
	dnk: 1,
	ft: 1,
	fg: 1,
	tp: 1,
	oiq: 1,
	diq: 1,
	drb: 1,
	pss: 1,
	reb: 1,
};
// Height counts as much as this many other ratings
export const HEIGHT_WEIGHT = 4;
// Added to the distance per year between his age and the real player's age in that season
export const AGE_PENALTY = 1.5;
// Real seasons at this age or younger are candidates; a player who first played later counts with his first season only
export const MAX_YOUNG_AGE = 23;

// Real seasons from the first with a three-point line (1979-80): before it, the three-point rating says nothing about the player
export const FIRST_SEASON = 1980;

// Position on a guard-to-center line; a comp is at most this far away (a point guard never gets a power forward or a center)
const POS_INDEX: Record<string, number> = {
	PG: 1,
	G: 1.5,
	SG: 2,
	GF: 2.5,
	SF: 3,
	F: 3.5,
	PF: 4,
	FC: 4.5,
	C: 5,
};
const MAX_POS_GAP = 1.5;

export const positionsCompatible = (a: string, b: string) => {
	const ia = POS_INDEX[a];
	const ib = POS_INDEX[b];
	if (ia === undefined || ib === undefined) {
		return true;
	}
	return Math.abs(ia - ib) <= MAX_POS_GAP;
};

// What the index needs from the real players data file (loadData.basketball.ts)
export type RealCompSource = {
	ratings: ({ slug: string; season: number } & Record<
		(typeof COMP_RATINGS)[number],
		number
	>)[];
	bios: Record<string, { name: string; bornYear: number; pos: string }>;
	teams: Record<string, { season: number; abbrev: string | number }[]>;
	awards: Record<
		string,
		{ season: number; type?: string; shortName?: string; rank?: number }[]
	>;
};

export type RealCompIndex = {
	// One entry per real player with at least one candidate season
	slugs: string[];
	names: string[];
	pos: string[];
	// His real seasons (all of them, for his peak and career length): ratings rows of NUM numbers
	allRatings: Uint8Array[];
	allSeasons: number[][];
	allStar: number[];
	mvp: boolean[];
	// Still on a team in the data's last season
	active: boolean[];
	// Candidate (young) seasons, flat
	rowPlayer: Int32Array;
	rowSeason: Int16Array;
	rowAge: Int8Array;
	rowRatings: Uint8Array;
	lastSeason: number;
};

export const buildRealCompIndex = (data: RealCompSource): RealCompIndex => {
	// Seasons he was on an NBA team
	let lastSeason = -Infinity;
	const onTeam = new Map<string, Set<number>>();
	for (const [slug, rows] of Object.entries(data.teams)) {
		const set = new Set<number>();
		for (const row of rows) {
			if (typeof row.abbrev === "string") {
				set.add(row.season);
				if (row.season > lastSeason) {
					lastSeason = row.season;
				}
			}
		}
		onTeam.set(slug, set);
	}

	const bySlug = new Map<string, RealCompSource["ratings"]>();
	for (const r of data.ratings) {
		if (r.season >= lastSeason || !onTeam.get(r.slug)?.has(r.season)) {
			continue;
		}
		const bio = data.bios[r.slug];
		if (!bio || !(bio.bornYear > 0)) {
			continue;
		}
		let list = bySlug.get(r.slug);
		if (!list) {
			list = [];
			bySlug.set(r.slug, list);
		}
		list.push(r);
	}

	const index: Omit<
		RealCompIndex,
		"rowPlayer" | "rowSeason" | "rowAge" | "rowRatings"
	> = {
		slugs: [],
		names: [],
		pos: [],
		allRatings: [],
		allSeasons: [],
		allStar: [],
		mvp: [],
		active: [],
		lastSeason,
	};
	const rowPlayer: number[] = [];
	const rowSeason: number[] = [];
	const rowAge: number[] = [];
	const rowRatings: number[] = [];

	// Sorted so the index (and ties) never depend on the file's order
	for (const slug of [...bySlug.keys()].sort()) {
		const rows = bySlug.get(slug)!.sort((a, b) => a.season - b.season);
		const bio = data.bios[slug]!;
		// Young seasons in the three-point era, or his first season if he came later
		const candidate = rows.map(
			(r, j) =>
				r.season >= FIRST_SEASON &&
				(r.season - bio.bornYear <= MAX_YOUNG_AGE || j === 0),
		);
		if (!candidate.includes(true)) {
			continue;
		}
		const i = index.slugs.length;
		index.slugs.push(slug);
		index.names.push(bio.name);
		index.pos.push(bio.pos);
		const all = new Uint8Array(rows.length * NUM);
		rows.forEach((r, j) => {
			COMP_RATINGS.forEach((key, k) => {
				all[j * NUM + k] = r[key];
			});
		});
		index.allRatings.push(all);
		index.allSeasons.push(rows.map((r) => r.season));
		const awards = data.awards[slug] ?? [];
		index.allStar.push(
			new Set(
				awards
					.filter((a) => a.type === "All-Star" || a.shortName === "ALL")
					.map((a) => a.season),
			).size,
		);
		index.mvp.push(
			awards.some(
				(a) => a.shortName === "MVP" && (a.rank === undefined || a.rank === 1),
			),
		);
		index.active.push(onTeam.get(slug)!.has(lastSeason));

		rows.forEach((r, j) => {
			if (candidate[j]) {
				rowPlayer.push(i);
				rowSeason.push(r.season);
				rowAge.push(r.season - bio.bornYear);
				for (let k = 0; k < NUM; k++) {
					rowRatings.push(all[j * NUM + k]!);
				}
			}
		});
	}

	return {
		...index,
		rowPlayer: Int32Array.from(rowPlayer),
		rowSeason: Int16Array.from(rowSeason),
		rowAge: Int8Array.from(rowAge),
		rowRatings: Uint8Array.from(rowRatings),
	};
};

export type CompProspect = {
	// The 15 base ratings, as the user sees them
	ratings: Record<(typeof COMP_RATINGS)[number], number>;
	age: number;
	pos: string;
	// A real player in a real players league is never his own comp
	srID?: string;
};

export type RealCompMatch = {
	player: number;
	slug: string;
	name: string;
	season: number;
	age: number;
	distance: number;
};

const WEIGHTS = COMP_RATINGS.map((key) => COMP_WEIGHTS[key]);
const WEIGHT_SUM = WEIGHTS.reduce((a, b) => a + b, 0);

// Distance between two rating rows, in rating points: the shape (how far apart the ratings are after the level difference is taken out)
// and the level (the weighted mean difference), with height counting HEIGHT_WEIGHT times a single rating
export const ratingsDistance = (
	a: ArrayLike<number>,
	b: ArrayLike<number>,
	bOffset = 0,
) => {
	let level = 0;
	for (let k = 1; k < NUM; k++) {
		level += WEIGHTS[k]! * (a[k]! - b[bOffset + k]!);
	}
	level /= WEIGHT_SUM;
	let shape = 0;
	for (let k = 1; k < NUM; k++) {
		const d = a[k]! - b[bOffset + k]! - level;
		shape += WEIGHTS[k]! * d * d;
	}
	const dh = a[0]! - b[bOffset]!;
	shape = (shape + HEIGHT_WEIGHT * dh * dh) / (WEIGHT_SUM + HEIGHT_WEIGHT);
	return Math.sqrt(shape + level * level);
};

// The closest real players (one season each, the closest of his young seasons), best first. Ties go by slug, so the same prospect always
// gets the same comps.
export const findRealComps = (
	index: RealCompIndex,
	prospect: CompProspect,
	count = 3,
): RealCompMatch[] => {
	const a = COMP_RATINGS.map((key) => prospect.ratings[key]);
	const numPlayers = index.slugs.length;
	const posOk = index.pos.map((pos) => positionsCompatible(prospect.pos, pos));
	const bestD = new Float64Array(numPlayers).fill(Infinity);
	const bestRow = new Int32Array(numPlayers);
	const n = index.rowPlayer.length;
	for (let row = 0; row < n; row++) {
		const i = index.rowPlayer[row]!;
		if (!posOk[i]) {
			continue;
		}
		const d =
			ratingsDistance(a, index.rowRatings, row * NUM) +
			AGE_PENALTY * Math.abs(index.rowAge[row]! - prospect.age);
		if (d < bestD[i]!) {
			bestD[i] = d;
			bestRow[i] = row;
		}
	}

	// The best few, in order (players are sorted by slug, so a tie goes to the first slug)
	const out: RealCompMatch[] = [];
	const taken = new Set<number>();
	for (let c = 0; c < count; c++) {
		let pick = -1;
		for (let i = 0; i < numPlayers; i++) {
			if (
				bestD[i]! < Infinity &&
				!taken.has(i) &&
				index.slugs[i] !== prospect.srID &&
				(pick < 0 || bestD[i]! < bestD[pick]!)
			) {
				pick = i;
			}
		}
		if (pick < 0) {
			break;
		}
		taken.add(pick);
		const row = bestRow[pick]!;
		out.push({
			player: pick,
			slug: index.slugs[pick]!,
			name: index.names[pick]!,
			season: index.rowSeason[row]!,
			age: index.rowAge[row]!,
			distance: Math.round(bestD[pick]! * 10) / 10,
		});
	}
	return out;
};

export type RealComp = {
	name: string;
	// "2003-04"
	season: string;
	age: number;
	// "very close", "close", "fair", "loose"
	similarity: string;
	distance: number;
	// What he became in his real career: "MVP", "All-Star", "starter", "role player", "bench player"
	became: string;
	allStar: number;
	seasons: number;
	active: boolean;
};

// Plain words for a distance. Top comps of generated draft classes: about 7% very close, 18% close, 40% fair, 35% loose (weak
// prospects are far from every real NBA player's young seasons)
export const SIMILARITY_LEVELS = [
	[5, "very close"],
	[7, "close"],
	[9.5, "fair"],
	[Infinity, "loose"],
] as const;

export const similarityLabel = (distance: number) =>
	SIMILARITY_LEVELS.find(([max]) => distance <= max)![1];

// "All-Star (6 seasons)", "starter", "role player so far" (still playing)
export const becameText = (comp: RealComp) => {
	const label =
		comp.became === "All-Star" && comp.allStar > 1
			? `All-Star (${comp.allStar} seasons)`
			: comp.became;
	return comp.active ? `${label} so far` : label;
};

// "Name (2003-04, age 20)"
export const compText = (comp: RealComp) =>
	`${comp.name} (${comp.season}, age ${comp.age})`;

// "2003-04" for the real 2004 season
export const realSeasonText = (season: number) =>
	`${season - 1}-${String(season % 100).padStart(2, "0")}`;

// What he became, from his real awards and his real peak ovr (ovr is the league's formula)
export const OUTCOME_OVRS = { starter: 56, rolePlayer: 48 };
export const realOutcome = (
	index: RealCompIndex,
	i: number,
	ovr: (ratings: Record<(typeof COMP_RATINGS)[number], number>) => number,
) => {
	const all = index.allRatings[i]!;
	let peak = 0;
	for (let j = 0; j * NUM < all.length; j++) {
		const r = Object.fromEntries(
			COMP_RATINGS.map((key, k) => [key, all[j * NUM + k]!]),
		) as Record<(typeof COMP_RATINGS)[number], number>;
		peak = Math.max(peak, ovr(r));
	}
	const allStar = index.allStar[i]!;
	const label = index.mvp[i]
		? "MVP"
		: allStar > 0
			? "All-Star"
			: peak >= OUTCOME_OVRS.starter
				? "starter"
				: peak >= OUTCOME_OVRS.rolePlayer
					? "role player"
					: "bench player";
	return {
		label,
		allStar,
		peakOvr: peak,
		seasons: index.allSeasons[i]!.length,
		active: index.active[i]!,
	};
};
