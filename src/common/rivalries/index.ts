// Rivalry score between two franchises, ported from League Explorer (rivalries.js, finals-rivals.js, rival-timeline.js).
// Pure (no DB): the worker gathers the inputs, this weighs them. One score is used everywhere a rivalry shows up: the
// Rivalries tab of Head-to-Head, the rivals card on team pages, the "rivalry" reason of the hype score and the "Playoff
// rivalry" storyline.

export type RivalSeries = {
	season: number;
	// 0-based round, numRounds rounds in that season's bracket
	round: number;
	numRounds: number;
	winner: number;
	loser: number;
	wWon: number;
	wLost: number;
	wSeed?: number;
	lSeed?: number;
};

export type RivalRsSeason = {
	season: number;
	// Regular season games won by a and by b
	aW: number;
	bW: number;
	tied: number;
};

export type RivalInput = {
	a: number;
	b: number;
	// The season the score is measured at (older history decays)
	season: number;
	series: RivalSeries[];
	rs: RivalRsSeason[];
	// Games of the pair decided by 3 points or fewer, or in overtime (stored box scores only)
	closeGames?: { season: number }[];
	sameDiv?: boolean;
	sameConf?: boolean;
	// Seasons of playoff meetings where both sides had an All-League player
	starDuels?: number[];
};

export type RivalryParts = {
	playoffs: number;
	regularSeason: number;
	close: number;
	geography: number;
	stars: number;
	recent: number;
};

export type RivalryScore = {
	score: number;
	parts: RivalryParts;
	tier: "Bitter" | "Heated" | "Simmering" | "Mild" | "None";
};

// Half-life of a rivalry's history, in seasons
export const RIVALRY_HALF_LIFE = 6;

export const rivalryDecay = (age: number) =>
	age < 0 ? 0 : 0.5 ** (age / RIVALRY_HALF_LIFE);

export const isFinals = (s: Pick<RivalSeries, "round" | "numRounds">) =>
	s.round === s.numRounds - 1;

// A series that went the distance (4-3, 3-2, 2-1)
export const wentDistance = (s: Pick<RivalSeries, "wWon" | "wLost">) =>
	s.wWon >= 2 && s.wLost === s.wWon - 1;

// One playoff meeting's weight before decay: later rounds weigh more, the Finals most, long series and upsets add
export const seriesWeight = (s: RivalSeries) => {
	const depth = s.numRounds > 1 ? s.round / (s.numRounds - 1) : 1;
	let w = 4 + 4 * depth + (isFinals(s) ? 4 : 0);
	w += 0.75 * s.wLost;
	if (wentDistance(s)) {
		w += 2;
	}
	if (s.wSeed !== undefined && s.lSeed !== undefined && s.wSeed > s.lSeed) {
		w += 1.5;
	}
	return w;
};

const round1 = (x: number) => Math.round(x * 10) / 10;

export const rivalryTier = (score: number): RivalryScore["tier"] =>
	score >= 40
		? "Bitter"
		: score >= 22
			? "Heated"
			: score >= 10
				? "Simmering"
				: score > 0
					? "Mild"
					: "None";

export const rivalryScore = (input: RivalInput): RivalryScore => {
	const age = (s: number) => input.season - s;
	let playoffs = 0;
	for (const s of input.series) {
		playoffs += seriesWeight(s) * rivalryDecay(age(s.season));
	}

	let regularSeason = 0;
	for (const r of input.rs) {
		const g = r.aW + r.bW + r.tied;
		if (g === 0) {
			continue;
		}
		const even = 1 - Math.abs(r.aW - r.bW) / g;
		regularSeason += 0.25 * g * even * rivalryDecay(age(r.season));
	}

	let close = 0;
	for (const c of input.closeGames ?? []) {
		close += 0.6 * rivalryDecay(age(c.season));
	}

	const geography = input.sameDiv ? 3 : input.sameConf ? 1 : 0;

	let stars = 0;
	for (const s of input.starDuels ?? []) {
		stars += 2 * rivalryDecay(age(s));
	}

	let recent = 0;
	const last = input.series.at(-1);
	if (last && age(last.season) <= 1 && age(last.season) >= 0) {
		recent += 3;
		if (input.series.length >= 2 && age(input.series.at(-2)!.season) <= 3) {
			recent += 2;
		}
	}

	const parts = {
		playoffs: round1(playoffs),
		regularSeason: round1(regularSeason),
		close: round1(close),
		geography,
		stars: round1(stars),
		recent,
	};
	const score = round1(
		playoffs + regularSeason + close + geography + stars + recent,
	);
	return { score, parts, tier: rivalryTier(score) };
};

// The hype score's "rivalry" points for a game between two teams with these past playoff meetings (and division),
// read from the same rivalry score as everywhere else, capped like the other hype reasons
export const hypeRivalryPoints = (
	series: RivalSeries[],
	season: number,
	inPlayoffs: boolean,
) => {
	if (series.length === 0) {
		return 0;
	}
	const { parts } = rivalryScore({
		a: -1,
		b: -1,
		season,
		series,
		rs: [],
	});
	let pts = Math.min(18, Math.round(0.6 * parts.playoffs + parts.recent));
	if (inPlayoffs && series.some((x) => x.season >= season - 3)) {
		pts += 3;
	}
	return Math.max(1, pts);
};

export type RivalTimelineRow = {
	season: number;
	aW: number;
	bW: number;
	tied: number;
	// a's running all-time regular season edge
	cum: number;
	series: RivalSeries | null;
	// The rivalry score as of the end of that season
	score: number;
};

// Season by season history of a pair: record, running edge, playoff series and how the rivalry score rose and fell
export const rivalryTimeline = (input: RivalInput): RivalTimelineRow[] => {
	const seasons = new Set<number>();
	for (const r of input.rs) {
		seasons.add(r.season);
	}
	for (const s of input.series) {
		seasons.add(s.season);
	}
	const sorted = [...seasons].sort((x, y) => x - y);
	let cum = 0;
	return sorted.map((season) => {
		const r = input.rs.find((x) => x.season === season);
		const aW = r?.aW ?? 0;
		const bW = r?.bW ?? 0;
		cum += aW - bW;
		const upTo = <T extends { season: number }>(list: T[] | undefined) =>
			(list ?? []).filter((x) => x.season <= season);
		const score = rivalryScore({
			...input,
			season,
			series: upTo(input.series),
			rs: upTo(input.rs),
			closeGames: upTo(input.closeGames),
			starDuels: (input.starDuels ?? []).filter((s) => s <= season),
		}).score;
		return {
			season,
			aW,
			bW,
			tied: r?.tied ?? 0,
			cum,
			series: input.series.find((x) => x.season === season) ?? null,
			score,
		};
	});
};

const times = (n: number) =>
	n === 1 ? "once" : n === 2 ? "twice" : `${n} times`;

// Generated sentences about a pair, every one read from the inputs. names: tid -> team name.
export const rivalryLines = (
	input: RivalInput,
	name: (tid: number) => string,
): string[] => {
	const out: string[] = [];
	const { a, b, series } = input;
	const A = name(a);
	const B = name(b);
	if (series.length > 0) {
		const finals = series.filter(isFinals);
		const first = series[0]!.season;
		const last = series.at(-1)!;
		out.push(
			`The ${A} and ${B} have met ${times(series.length)} in the playoffs${series.length > 1 ? `, from ${first} to ${last.season}` : `, in ${first}`}${finals.length > 0 ? (finals.length === series.length ? (series.length === 1 ? ", in the Finals" : ", every one of them in the Finals") : `, including ${times(finals.length)} in the Finals`) : ""}.`,
		);
		const sA = series.filter((s) => s.winner === a).length;
		const sB = series.length - sA;
		if (series.length > 1) {
			if (sA === 0 || sB === 0) {
				out.push(`The ${sA ? A : B} have won all ${series.length}.`);
			} else if (sA === sB) {
				out.push(`The series stands even at ${sA}-${sB}.`);
			} else {
				out.push(
					`The ${sA > sB ? A : B} lead ${Math.max(sA, sB)}-${Math.min(sA, sB)} in series.`,
				);
			}
		}
		out.push(
			`${series.length > 1 ? "Most recently, the" : "The"} ${name(last.winner)} beat the ${name(last.loser)} ${last.wWon}-${last.wLost} in ${last.season}${isFinals(last) ? " to win the title" : ""}.`,
		);
		const g7 = series.filter(wentDistance).length;
		if (g7 >= 2) {
			out.push(`${g7} of their series went the distance.`);
		}
		// revenge cycle: the loser of one series won the next, three times running
		let alt = 0;
		let bestAlt = 0;
		for (let i = 1; i < series.length; i++) {
			if (series[i]!.winner !== series[i - 1]!.winner) {
				alt += 1;
				bestAlt = Math.max(bestAlt, alt);
			} else {
				alt = 0;
			}
		}
		if (bestAlt >= 3) {
			out.push(
				`For ${bestAlt + 1} straight meetings the team that lost the last series won the next one.`,
			);
		}
	} else {
		out.push(`The ${A} and ${B} have never met in the playoffs.`);
	}
	let aW = 0;
	let bW = 0;
	for (const r of input.rs) {
		aW += r.aW;
		bW += r.bW;
	}
	if (aW + bW > 0) {
		const since = Math.min(...input.rs.map((r) => r.season));
		out.push(
			aW === bW
				? `In the regular season since ${since} they are dead even at ${aW}-${bW}.`
				: `In the regular season since ${since}, the ${aW > bW ? A : B} hold the edge, ${Math.max(aW, bW)}-${Math.min(aW, bW)}.`,
		);
	}
	if ((input.starDuels ?? []).length >= 2) {
		out.push(
			`Stars on both sides in ${input.starDuels!.length} of their playoff meetings.`,
		);
	}
	if (input.sameDiv) {
		out.push("Division rivals.");
	}
	return out;
};
