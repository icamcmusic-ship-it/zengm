// Draft outlook for a prospect's pro projection: a tier from his projected peak ovr (more tiers than the old star /
// starter / rotation / fringe / bust scale), worded by where he is picked. A second-round pick is never a "bust": little is
// expected of him, so a low projection reads as a long shot, not a failure. A slot tag compares his projected peak with
// what a pick at that slot usually becomes (steal / value / fair / reach).

export type OutlookKind = "elite" | "good" | "neutral" | "low" | "bad";

export type DraftOutlook = {
	label: string;
	kind: OutlookKind;
	// Compared with a typical pick at that slot (undefined without a pick)
	slot?: { label: string; kind: OutlookKind; expected: number };
};

const TIERS: readonly (readonly [number, string, OutlookKind])[] = [
	[72, "Franchise player", "elite"],
	[65, "Star", "elite"],
	[61, "Quality starter", "good"],
	[58, "Starter", "good"],
	[54, "Sixth man", "neutral"],
	[50, "Rotation player", "neutral"],
	[45, "Bench depth", "low"],
];

// What a pick usually becomes (projected peak ovr), from about 66 at #1 down to about 46 at the last pick of round 2
export const expectedPeakAtPick = (overallPick: number, numTeams: number) => {
	const n = Math.max(2, 2 * Math.max(1, numTeams));
	const x = Math.min(1, Math.max(0, (overallPick - 1) / (n - 1)));
	return 66 - 20 * Math.sqrt(x);
};

export const draftOutlook = (
	peak: number,
	overallPick: number | undefined,
	numTeams: number,
): DraftOutlook => {
	const tier = TIERS.find(([min]) => peak >= min);
	let label: string;
	let kind: OutlookKind;
	if (tier) {
		label = tier[1];
		kind = tier[2];
	} else {
		const round =
			overallPick === undefined ? undefined : overallPick <= numTeams ? 1 : 2;
		if (round === 1 && overallPick! <= Math.ceil(numTeams / 2)) {
			// A lottery pick who projects out of the rotation
			label = "Bust risk";
			kind = "bad";
		} else if (round === 1) {
			label = peak >= 42 ? "Developmental pick" : "Bust risk";
			kind = peak >= 42 ? "low" : "bad";
		} else {
			// Second round, or no pick yet: never a bust
			label = peak >= 42 ? "Long shot" : "Camp invite";
			kind = "low";
		}
	}

	let slot: DraftOutlook["slot"];
	if (overallPick !== undefined) {
		const expected = expectedPeakAtPick(overallPick, numTeams);
		const diff = peak - expected;
		const secondRound = overallPick > numTeams;
		slot =
			diff >= 5
				? { label: "Steal", kind: "elite", expected }
				: diff >= 2
					? { label: "Value pick", kind: "good", expected }
					: diff > -3 || secondRound
						? // (a second-round pick is never a reach: it costs little)
							{ label: "Fair value", kind: "neutral", expected }
						: diff > -6
							? { label: "Slight reach", kind: "low", expected }
							: { label: "Reach", kind: "bad", expected };
	}
	return { label, kind, slot };
};

export const outlookClass = (kind: OutlookKind | undefined) =>
	kind === "elite"
		? "text-success fw-bold"
		: kind === "good"
			? "text-success"
			: kind === "bad"
				? "text-danger"
				: kind === "low"
					? "text-warning-emphasis"
					: undefined;
