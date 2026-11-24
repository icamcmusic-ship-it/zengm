// Draft History: how often each part of the draft has produced a Hall of Famer (and an All-Star) over the league's history. Pure;
// the worker (api getDraftSlotHof) passes every drafted player of the classes old enough to judge.
//
// - Overall pick: (round - 1) * picks in that class's first round + pick.
// - Only classes drafted at least `mature` seasons ago count, so careers have had time to end and the waiting period to pass:
//   the most of HOF_MATURE_STEPS that still leaves 3 classes. Classes before the league's first season are left out (their
//   players' careers before it are not in the league's records).

export type DraftSlotPlayer = {
	year: number;
	round: number;
	pick: number;
	hof: boolean;
	allStar: boolean;
};

export const HOF_MATURE_STEPS = [15, 12, 10];
export const HOF_MIN_CLASSES = 3;

export const HOF_SLOT_BANDS: [number, number][] = [
	[1, 1],
	[2, 3],
	[4, 5],
	[6, 10],
	[11, 14],
	[15, 20],
	[21, 30],
	[31, 45],
	[46, 60],
	[61, Infinity],
];

export type DraftSlotBand = {
	label: string;
	lo: number;
	hi: number;
	n: number;
	hof: number;
	allStar: number;
};

export type DraftSlotHof = {
	from: number;
	to: number;
	classes: number;
	mature: number;
	numPlayers: number;
	numHof: number;
	bands: DraftSlotBand[];
};

export const overallPickOf = (
	p: Pick<DraftSlotPlayer, "round" | "pick">,
	perRound: number,
) => (p.round - 1) * perRound + p.pick;

// The most seasons back (HOF_MATURE_STEPS) that still leaves HOF_MIN_CLASSES classes between startingSeason and that, or undefined
export const matureClassYears = (
	startingSeason: number,
	lastSeason: number,
): { mature: number; from: number; to: number } | undefined => {
	for (const mature of HOF_MATURE_STEPS) {
		const to = lastSeason - mature;
		if (to - startingSeason + 1 >= HOF_MIN_CLASSES) {
			return { mature, from: startingSeason, to };
		}
	}
	return undefined;
};

export const buildDraftSlotHof = (
	players: DraftSlotPlayer[],
	{ from, to, mature }: { from: number; to: number; mature: number },
): DraftSlotHof | undefined => {
	const drafted = players.filter(
		(p) => p.round > 0 && p.pick > 0 && p.year >= from && p.year <= to,
	);
	if (drafted.length === 0) {
		return undefined;
	}
	const perRound = new Map<number, number>();
	for (const p of drafted) {
		if (p.round === 1) {
			perRound.set(p.year, Math.max(perRound.get(p.year) ?? 0, p.pick));
		}
	}
	const classes = new Set(drafted.map((p) => p.year));
	const picks = drafted.map((p) => ({
		...p,
		overall: overallPickOf(p, perRound.get(p.year) ?? 1),
	}));
	const maxPick = Math.max(...picks.map((p) => p.overall));
	const bands: DraftSlotBand[] = [];
	for (const [lo, hi] of HOF_SLOT_BANDS) {
		if (lo > maxPick) {
			break;
		}
		const top = Math.min(hi, maxPick);
		const inBand = picks.filter((p) => p.overall >= lo && p.overall <= hi);
		bands.push({
			label: lo === top ? `${lo}` : `${lo}-${top}`,
			lo,
			hi: top,
			n: inBand.length,
			hof: inBand.filter((p) => p.hof).length,
			allStar: inBand.filter((p) => p.allStar).length,
		});
	}
	return {
		from: Math.min(...classes),
		to: Math.max(...classes),
		classes: classes.size,
		mature,
		numPlayers: picks.length,
		numHof: picks.filter((p) => p.hof).length,
		bands,
	};
};
