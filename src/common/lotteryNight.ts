// Draft lottery night (Draft Lottery Night & Combine setting): the presentation of a lottery that has already been run. The reveal
// order, jumps and falls, the recap and the team reactions are all derived from the saved result, without random numbers (the
// reactions pick their wording from a hash of the season and team).
import { hashString } from "./collegeStats/rng.ts";
import { helpers } from "./helpers.ts";

export type LotteryNightRow = {
	// Index in the lottery result (its pre-lottery order, worst team first)
	index: number;
	tid: number;
	originalTid: number;
	// Pre-lottery slot (1 = worst record / most chances)
	slot: number;
	pick: number;
	// Positive = moved up
	move: number;
	// Chance of landing exactly this pick and of the No. 1 pick, going in (undefined without odds)
	oddsPick?: number;
	oddsFirst?: number;
};

export const getLotteryNightRows = (
	result: { tid: number; originalTid: number; pick?: number }[],
	probs?: (number | undefined)[][],
): LotteryNightRow[] => {
	const rows: LotteryNightRow[] = [];
	for (const [index, row] of result.entries()) {
		if (row.pick === undefined) {
			continue;
		}
		rows.push({
			index,
			tid: row.tid,
			originalTid: row.originalTid,
			slot: index + 1,
			pick: row.pick,
			move: index + 1 - row.pick,
			oddsPick: probs?.[index]?.[row.pick - 1],
			oddsFirst: probs?.[index]?.[0],
		});
	}
	return rows;
};

// Reveal order: the last lottery pick first, No. 1 last. Values are indexes of the lottery result
export const lotteryRevealOrder = (result: { pick?: number }[]): number[] => {
	const out: number[] = [];
	for (const [i, row] of result.entries()) {
		if (row.pick !== undefined) {
			out[row.pick - 1] = i;
		}
	}
	return out.filter((x) => x !== undefined).reverse();
};

export const moveText = (row: Pick<LotteryNightRow, "move" | "slot">) => {
	if (row.move > 0) {
		return `Moved up from ${helpers.ordinal(row.slot)}!`;
	}
	if (row.move < 0) {
		return `Fell from ${helpers.ordinal(row.slot)}`;
	}
	return `Stayed at ${helpers.ordinal(row.slot)}`;
};

export const formatOdds = (x: number | undefined) =>
	x === undefined
		? undefined
		: x >= 0.995
			? "100%"
			: x < 0.001
				? "<0.1%"
				: `${(100 * x).toFixed(x < 0.1 ? 1 : 0)}%`;

export type LotteryRecap = {
	winners: LotteryNightRow[];
	losers: LotteryNightRow[];
	// Lowest odds of the pick they landed among the teams that moved up
	longestShot?: LotteryNightRow;
	summary: string;
};

export const lotteryRecap = (
	rows: LotteryNightRow[],
	teamName: (tid: number) => string,
): LotteryRecap => {
	const winners = rows
		.filter((r) => r.move > 0)
		.sort((a, b) => b.move - a.move || a.pick - b.pick);
	const losers = rows
		.filter((r) => r.move < 0)
		.sort((a, b) => a.move - b.move || a.pick - b.pick);
	const longestShot = winners
		.filter((r) => r.oddsPick !== undefined)
		.sort((a, b) => a.oddsPick! - b.oddsPick!)[0];
	const first = rows.find((r) => r.pick === 1);

	const parts: string[] = [];
	if (first) {
		parts.push(
			first.move > 0
				? `The ${teamName(first.tid)} jumped from ${helpers.ordinal(first.slot)} to win the No. 1 pick${first.oddsFirst !== undefined ? ` with ${formatOdds(first.oddsFirst)} odds` : ""}.`
				: `The ${teamName(first.tid)} held on to the No. 1 pick.`,
		);
	}
	const bigJump = winners.find((r) => r.pick !== 1);
	if (bigJump) {
		parts.push(
			`The ${teamName(bigJump.tid)} climbed ${bigJump.move} spot${bigJump.move === 1 ? "" : "s"} to No. ${bigJump.pick}.`,
		);
	}
	const bigFall = losers[0];
	if (bigFall) {
		parts.push(
			`The ${teamName(bigFall.tid)} had the worst night, sliding from ${helpers.ordinal(bigFall.slot)} to ${helpers.ordinal(bigFall.pick)}.`,
		);
	}
	if (parts.length === 0) {
		parts.push("Chalk: every team picks where it was slotted.");
	}

	return { winners, losers, longestShot, summary: parts.join(" ") };
};

export type LotteryReactionTeam = {
	// Team season hype, 0 to 1
	hype?: number;
	// AI GM (setting), undefined for the user's team or without GMs
	gm?: {
		name: string;
		// -1 win-now, 1 patient
		patience: number;
		// -1 ready-now prospects, 1 upside swings
		draftUpside: number;
	};
};

const pickOne = (options: string[], seed: string) =>
	options[hashString(seed) % options.length]!;

/**
 * One line of GM or fan reaction for a team's lottery result. Deterministic: same season, team and result, same line.
 */
export const lotteryReaction = ({
	row,
	team,
	season,
	user,
}: {
	row: LotteryNightRow;
	team: LotteryReactionTeam;
	season: number;
	user: boolean;
}) => {
	const seed = `${season}|${row.tid}|${row.pick}`;
	const hype = team.hype ?? 0.5;
	const gm = team.gm;
	const fans = hype >= 0.6 ? "loud" : hype <= 0.3 ? "weary" : "normal";

	if (row.pick === 1) {
		if (user) {
			return pickOne(
				[
					"The No. 1 pick is yours. The whole draft runs through you now.",
					"You won the lottery. Time to start working the phones, or not.",
				],
				seed,
			);
		}
		if (gm) {
			return gm.draftUpside > 0.3
				? `GM ${gm.name}: "We'll take the biggest swing in the class."`
				: gm.patience > 0.3
					? `GM ${gm.name}: "This is what the plan was built for."`
					: `GM ${gm.name}: "We're going to win with this pick, and soon."`;
		}
		return fans === "weary"
			? pickOne(
					[
						"Years of losing finally pay off. The fan base dares to hope again.",
						"After the long rebuild, the ping-pong balls finally bounce their way.",
					],
					seed,
				)
			: pickOne(
					[
						"The watch party erupts: the No. 1 pick is theirs.",
						"Jerseys of the top prospect are already selling out.",
					],
					seed,
				);
	}

	if (row.move > 0) {
		if (user) {
			return `Up ${row.move} spot${row.move === 1 ? "" : "s"}: a better shot at your guy.`;
		}
		if (gm) {
			return gm.patience > 0.3
				? `GM ${gm.name} can't hide the grin: the rebuild just got ahead of schedule.`
				: `GM ${gm.name}: "A top pick is a trade chip too. Our phones are on."`;
		}
		return pickOne(
			[
				"A jump nobody saw coming. The fans will take it.",
				"Luck finally on their side: the war room is all smiles.",
				`Fans are already mocking prospects at No. ${row.pick}.`,
			],
			seed,
		);
	}

	if (row.move < 0) {
		if (user) {
			return `Down ${-row.move} spot${row.move === -1 ? "" : "s"}. The scouting staff has work to do.`;
		}
		if (gm) {
			return gm.patience > 0.3
				? `GM ${gm.name}: "We'll find our guy at No. ${row.pick}. The plan doesn't change."`
				: `GM ${gm.name} looks ready to shop the pick for a veteran.`;
		}
		return fans === "loud"
			? pickOne(
					[
						"Boos at the watch party as the balls refuse to cooperate.",
						"The fan base is not taking this one well.",
					],
					seed,
				)
			: pickOne(
					[
						"A tough night. Another season of the long rebuild.",
						"The ping-pong balls cost them, and the front office knows it.",
					],
					seed,
				);
	}

	if (user) {
		return "Right where you were slotted.";
	}
	return gm
		? `GM ${gm.name}: "No surprises. We know our board at No. ${row.pick}."`
		: pickOne(
				["Right where they expected to be.", "No drama, no surprises."],
				seed,
			);
};
