// Owner mood baselines shared by the end-of-season evaluation (worker/core/season/updateOwnerMood), the Owner's Office budget meeting
// and the evaluation breakdown (worker/views/message). One copy, so the numbers can't drift apart.

import { bySport } from "./sportFunctions.ts";
import type { OwnerMood } from "./types.ts";

// The sport's default salary cap, frozen in time because otherwise the owner mood coefficients would need to be updated when it changes
const FROZEN_SALARY_CAP = () =>
	bySport({
		baseball: 175000,
		basketball: 90000,
		football: 200000,
		hockey: 80000,
	});

// salaryCap / the sport's frozen default cap
export const getSalaryCapScale = (salaryCap: number) =>
	salaryCap / FROZEN_SALARY_CAP();

// The profit (millions of dollars) the owner expects every season. Owner mood money moves by (profit - expected) / (100 * scale)
export const getExpectedProfit = (salaryCap: number) =>
	15 * getSalaryCapScale(salaryCap);

const isOwnerMood = (x: unknown): x is OwnerMood =>
	typeof x === "object" &&
	x !== null &&
	typeof (x as OwnerMood).money === "number" &&
	typeof (x as OwnerMood).playoffs === "number" &&
	typeof (x as OwnerMood).wins === "number";

// Very old leagues stored owner mood as a game attribute (g.ownerMood) rather than on teamSeason. Returns a copy, or undefined
export const getLegacyOwnerMood = (
	gameAttributes: object,
): OwnerMood | undefined => {
	const mood: unknown = (gameAttributes as { ownerMood?: unknown }).ownerMood;
	return isOwnerMood(mood)
		? { money: mood.money, playoffs: mood.playoffs, wins: mood.wins }
		: undefined;
};

// A new owner (Commercial Deals & Ownership sale) doesn't hold his predecessor's grudges: negative parts of the mood are forgiven and
// the positive ones count half, so a brand-new owner can't fire the GM over the old owner's losses
export const honeymoonOwnerMood = (mood: OwnerMood): OwnerMood => ({
	money: mood.money < 0 ? 0 : mood.money / 2,
	playoffs: mood.playoffs < 0 ? 0 : mood.playoffs / 2,
	wins: mood.wins < 0 ? 0 : mood.wins / 2,
});
