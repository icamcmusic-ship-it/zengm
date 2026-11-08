// Draft lottery what-if simulator (Draft Lottery page): take the current lottery teams, optionally in a different order and/or with a
// different lottery format, and get the exact pick probabilities plus a Monte Carlo check and a sample draw.

import type { DraftType } from "../../../common/types.ts";
import { getDraftLotteryProbs, simLottery } from "./draftLottery.ts";
import { getLotteryInfo } from "./genOrder.ts";

export const WHAT_IF_DRAFT_TYPES = [
	"nba2019",
	"nba1994",
	"nba1990",
	"nhl2021",
	"nhl2017",
	"mlb2022",
	"randomLottery",
	"randomLotteryFirst3",
	"coinFlip",
] as const satisfies DraftType[];

export type WhatIfDraftType = (typeof WHAT_IF_DRAFT_TYPES)[number] | "current";

export const getWhatIfChances = ({
	draftType,
	numLotteryTeams,
	currentChances,
	currentDraftType,
	currentNumToPick,
	numPlayInTeams,
}: {
	draftType: WhatIfDraftType;
	numLotteryTeams: number;
	// The lottery as it is now, used for "current"
	currentChances: number[];
	currentDraftType: DraftType;
	currentNumToPick: number;
	numPlayInTeams: number;
}): { draftType: DraftType; chances: number[]; numToPick: number } => {
	if (draftType === "current") {
		return {
			draftType: currentDraftType,
			chances: currentChances,
			numToPick: currentNumToPick,
		};
	}

	const info = getLotteryInfo(draftType, numLotteryTeams, numPlayInTeams);
	return {
		draftType,
		chances: Array.from(
			{ length: numLotteryTeams },
			(_row, i) => info.chances[Math.min(i, info.chances.length - 1)] ?? 0,
		),
		numToPick: Math.min(info.numToPick, numLotteryTeams),
	};
};

// Exact (or estimated if too slow) probabilities and a Monte Carlo run. probs[i][j] is the chance that rows[i] gets pick j + 1.
export const lotteryWhatIfProbs = ({
	draftType,
	chances,
	numToPick,
	numSims,
}: {
	draftType: DraftType;
	chances: number[];
	numToPick: number;
	numSims: number;
}) => {
	const result = chances.map((c, i) => ({
		tid: i,
		originalTid: i,
		chances: c,
		pick: undefined,
		dpid: i,
	}));
	const exact = getDraftLotteryProbs(
		{ season: 0, draftType: draftType as any, result },
		draftType,
		numToPick,
	);

	const n = chances.length;
	const counts = Array.from({ length: n }, () => new Array<number>(n).fill(0));
	let sample: number[] = [];
	for (let i = 0; i < numSims; i++) {
		const order = simLottery(
			draftType,
			chances,
			numToPick,
			undefined,
			undefined,
		);
		if (i === 0) {
			sample = order;
		}
		for (const [pick, index] of order.entries()) {
			counts[index]![pick]! += 1;
		}
	}
	const monteCarlo = counts.map((row) => row.map((x) => x / numSims));

	return {
		probs: exact.probs,
		tooSlow: exact.tooSlow,
		monteCarlo,
		sample,
	};
};
