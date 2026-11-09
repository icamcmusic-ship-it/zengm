// Simulated media voting for awards that BBGM decides by formula (basketball first). A ballot box of N voters (100 by
// default), each re-scoring the candidates with the award's own score plus voter noise and the voter's taste for
// narratives (team success, scoring, availability, voter fatigue for the defending winner). Ballots use the NBA points:
// MVP 10-7-5-3-1, other player awards 5-3-1, team awards (All-League, All-Defensive, ...) 5/3/1 for a 1st/2nd/3rd team
// vote with 5 x numTeams players a ballot. Deterministic: seeded by season and award, never Math.random.
//
// Ported from League Explorer's awardvote.js (simplified: no per-term formula split). Pure, so the UI, the worker and
// tests share it.

export type VoteCandidate = {
	pid: number;
	tid: number;
	name: string;
	// The award's formula score (higher is better)
	score: number;
	// Narrative inputs, all optional
	teamWinp?: number;
	pts?: number;
	gpFrac?: number;
	defending?: boolean;
};

export type VoteAwardInput = {
	shortName: string;
	name: string;
	// "mvp" for MVP-like awards (10-7-5-3-1), "player" for other individual awards (5-3-1), "team" for team awards
	kind: "mvp" | "player" | "team";
	numTeams?: number;
	teamSize?: number;
	candidates: VoteCandidate[];
	// Order the vote must agree with (stored winners: individual = ranked pids, team = pids per team). The tally is
	// nudged until the winner (individual) or every team's members (team) match. Omit for a free vote.
	respect?: number[] | number[][];
};

export type VoteRow = {
	pid: number;
	tid: number;
	name: string;
	rank: number;
	// Votes per place (individual) or per team (team awards)
	votes: number[];
	first: number;
	pts: number;
	// pts / (voters x top points on a ballot)
	share: number;
	// Narrative tags that helped (+) or hurt (-) on average
	narratives: string[];
	// Team awards: team made (1 = first team), 0 = none
	tm?: number;
};

export type SimVote = {
	shortName: string;
	name: string;
	kind: VoteAwardInput["kind"];
	voters: number;
	points: number[];
	places: string[];
	rows: VoteRow[];
};

export const NUM_VOTERS = 100;

const POINTS = {
	mvp: [10, 7, 5, 3, 1],
	player: [5, 3, 1],
	team: [5, 3, 1],
};

// Noise as a fraction of the spread of the candidates' scores
const NOISE = { mvp: 0.6, player: 0.7, team: 0.5 };

const hashString = (s: string) => {
	let h = 2166136261;
	for (let i = 0; i < s.length; i++) {
		h ^= s.charCodeAt(i);
		h = Math.imul(h, 16777619);
	}
	return h >>> 0;
};

// mulberry32
export const seededRandom = (seed: number) => {
	let a = seed >>> 0;
	return () => {
		a = (a + 0x6d2b79f5) >>> 0;
		let t = a;
		t = Math.imul(t ^ (t >>> 15), t | 1);
		t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
		return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
	};
};

const gauss = (rand: () => number) => {
	const u = Math.max(1e-12, rand());
	const v = rand();
	return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
};

const sd = (xs: number[]) => {
	if (xs.length < 2) {
		return 1;
	}
	const m = xs.reduce((a, b) => a + b, 0) / xs.length;
	const v = xs.reduce((a, b) => a + (b - m) ** 2, 0) / (xs.length - 1);
	return Math.sqrt(v) || 1;
};

const zOf = (xs: (number | undefined)[]) => {
	const known = xs.filter((x): x is number => x !== undefined);
	if (known.length < 2) {
		return xs.map(() => 0);
	}
	const m = known.reduce((a, b) => a + b, 0) / known.length;
	const s = sd(known);
	return xs.map((x) => (x === undefined ? 0 : (x - m) / s));
};

type Narrative = {
	label: string;
	// Weight of the narrative for this award kind, in score standard deviations per z of the input
	weight: number;
	z: number[];
};

const narrativesFor = (
	input: VoteAwardInput,
	cands: VoteCandidate[],
): Narrative[] => {
	const isMvp = input.kind === "mvp";
	const out: Narrative[] = [
		{
			label: "Team success",
			weight: isMvp ? 0.35 : input.kind === "team" ? 0.12 : 0.08,
			z: zOf(cands.map((c) => c.teamWinp)),
		},
		{
			label: "Scoring buzz",
			weight: input.kind === "player" ? 0.15 : 0.2,
			z: zOf(cands.map((c) => c.pts)),
		},
		{
			label: "Availability",
			weight: 0.15,
			z: zOf(cands.map((c) => c.gpFrac)),
		},
		{
			label: "Voter fatigue",
			weight: isMvp ? 0.3 : 0.15,
			z: cands.map((c) => (c.defending ? -1 : 0)),
		},
	];
	return out;
};

const tally = (
	input: VoteAwardInput,
	cands: VoteCandidate[],
	voters: number,
	shift: number[],
	seed: number,
) => {
	const rand = seededRandom(seed);
	const kind = input.kind;
	const scores = cands.map((c) => c.score);
	const spread = sd(scores.slice(0, 10));
	const noise = NOISE[kind] * spread;
	const narr = narrativesFor(input, cands);
	const pointsBase = POINTS[kind];
	const numTeams = kind === "team" ? Math.max(1, input.numTeams ?? 1) : 0;
	const teamSize = kind === "team" ? Math.max(1, input.teamSize ?? 5) : 0;
	const numPlaces = kind === "team" ? numTeams : pointsBase.length;
	const votes = cands.map(() => new Array<number>(numPlaces).fill(0));
	const pts = cands.map(() => 0);
	const narrSum = cands.map(() => narr.map(() => 0));
	const teamPoints = pointsBase.slice(0, numTeams);
	if (kind === "team" && numTeams > teamPoints.length) {
		while (teamPoints.length < numTeams) {
			teamPoints.push(1);
		}
	}
	for (let v = 0; v < voters; v++) {
		// Each voter's taste for each narrative, around 1
		const taste = narr.map(() => Math.max(0, 1 + 0.6 * gauss(rand)));
		const util = cands.map((c, i) => {
			let u = c.score + shift[i]! + noise * gauss(rand);
			for (let k = 0; k < narr.length; k++) {
				const n = narr[k]!;
				const d = n.weight * taste[k]! * n.z[i]! * spread;
				u += d;
				narrSum[i]![k]! += d;
			}
			return u;
		});
		const order = cands
			.map((_, i) => i)
			.sort((a, b) => util[b]! - util[a]! || a - b);
		if (kind === "team") {
			for (let t = 0; t < numTeams; t++) {
				for (let j = 0; j < teamSize; j++) {
					const i = order[t * teamSize + j];
					if (i === undefined) {
						break;
					}
					votes[i]![t]! += 1;
					pts[i]! += teamPoints[t]!;
				}
			}
		} else {
			for (let place = 0; place < numPlaces; place++) {
				const i = order[place];
				if (i === undefined) {
					break;
				}
				votes[i]![place]! += 1;
				pts[i]! += pointsBase[place]!;
			}
		}
	}
	return {
		votes,
		pts,
		narrSum,
		narr,
		points: kind === "team" ? teamPoints : pointsBase,
	};
};

const ordinal = (n: number) =>
	`${n}${n % 10 === 1 && n !== 11 ? "st" : n % 10 === 2 && n !== 12 ? "nd" : n % 10 === 3 && n !== 13 ? "rd" : "th"}`;

const rankRows = (cands: VoteCandidate[], pts: number[], votes: number[][]) =>
	cands
		.map((_, i) => i)
		.sort(
			(a, b) =>
				pts[b]! - pts[a]! ||
				votes[b]![0]! - votes[a]![0]! ||
				cands[b]!.score - cands[a]!.score ||
				a - b,
		);

// Whether the tally agrees with the order it must respect; returns the indexes that need a boost
const disagreements = (
	input: VoteAwardInput,
	cands: VoteCandidate[],
	order: number[],
): number[] => {
	const respect = input.respect;
	if (!respect || respect.length === 0) {
		return [];
	}
	const idx = new Map(cands.map((c, i) => [c.pid, i]));
	if (input.kind === "team") {
		const teamSize = Math.max(1, input.teamSize ?? 5);
		const bad: number[] = [];
		(respect as number[][]).forEach((team, t) => {
			const slots = new Set(order.slice(t * teamSize, (t + 1) * teamSize));
			for (const pid of team) {
				const i = idx.get(pid);
				if (i !== undefined && !slots.has(i)) {
					bad.push(i);
				}
			}
		});
		return bad;
	}
	const winner = idx.get((respect as number[])[0]!);
	return winner !== undefined && order[0] !== winner ? [winner] : [];
};

export const simulateVote = (
	input: VoteAwardInput,
	{ voters = NUM_VOTERS, seed = 0 }: { voters?: number; seed?: number } = {},
): SimVote | undefined => {
	const cands = input.candidates.filter((c) => Number.isFinite(c.score));
	if (cands.length === 0) {
		return undefined;
	}
	const fullSeed = hashString(`${seed}|${input.shortName}`);
	const spread = sd(cands.map((c) => c.score).slice(0, 10));
	const shift = cands.map(() => 0);
	let res = tally(input, cands, voters, shift, fullSeed);
	let order = rankRows(cands, res.pts, res.votes);
	for (let iter = 0; iter < 40; iter++) {
		const bad = disagreements(input, cands, order);
		if (bad.length === 0) {
			break;
		}
		for (const i of bad) {
			shift[i]! += 0.15 * spread;
		}
		res = tally(input, cands, voters, shift, fullSeed);
		order = rankRows(cands, res.pts, res.votes);
	}

	const max = voters * res.points[0]!;
	const teamSize = Math.max(1, input.teamSize ?? 5);
	const numTeams = Math.max(1, input.numTeams ?? 1);
	const rows: VoteRow[] = order
		.filter((i) => res.pts[i]! > 0)
		.map((i, r) => {
			const c = cands[i]!;
			const narratives: string[] = [];
			res.narr.forEach((n, k) => {
				const avg = res.narrSum[i]![k]! / voters / spread;
				if (avg >= 0.08) {
					narratives.push(`+${n.label}`);
				} else if (avg <= -0.08) {
					narratives.push(`-${n.label}`);
				}
			});
			const row: VoteRow = {
				pid: c.pid,
				tid: c.tid,
				name: c.name,
				rank: r + 1,
				votes: res.votes[i]!,
				first: res.votes[i]![0]!,
				pts: res.pts[i]!,
				share: max > 0 ? res.pts[i]! / max : 0,
				narratives,
			};
			if (input.kind === "team") {
				row.tm = r < teamSize * numTeams ? Math.floor(r / teamSize) + 1 : 0;
			}
			return row;
		});

	return {
		shortName: input.shortName,
		name: input.name,
		kind: input.kind,
		voters,
		points: res.points,
		places:
			input.kind === "team"
				? res.points.map((_, t) => `${ordinal(t + 1)} team`)
				: res.points.map((_, p) => ordinal(p + 1)),
		rows,
	};
};
