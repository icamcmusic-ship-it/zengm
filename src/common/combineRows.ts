// The draft combine results as the College/Overseas page shows them (also the Export profile)
import type { CombineResults } from "./collegeStats/profile.ts";

export const inches = (x: number) => {
	const ft = Math.floor(x / 12);
	const rest = x - 12 * ft;
	return `${ft}' ${Number.isInteger(rest) ? rest : rest.toFixed(2).replace(/0$/, "")}"`;
};

export const COMBINE_ROWS: {
	key: keyof CombineResults;
	name: string;
	format: (x: number) => string;
}[] = [
	{ key: "heightNoShoes", name: "Height without shoes", format: inches },
	{ key: "heightShoes", name: "Height with shoes", format: inches },
	{ key: "weight", name: "Weight", format: (x) => `${x} lbs` },
	{ key: "wingspan", name: "Wingspan", format: inches },
	{ key: "standingReach", name: "Standing reach", format: inches },
	{ key: "standingVert", name: "Standing vertical", format: (x) => `${x}"` },
	{ key: "maxVert", name: "Max vertical", format: (x) => `${x}"` },
	{
		key: "laneAgility",
		name: "Lane agility",
		format: (x) => `${x.toFixed(2)} s`,
	},
	{ key: "shuttle", name: "Shuttle run", format: (x) => `${x.toFixed(2)} s` },
	{
		key: "sprint",
		name: "3/4 court sprint",
		format: (x) => `${x.toFixed(2)} s`,
	},
	{ key: "bench", name: "Bench press (185 lbs)", format: (x) => `${x} reps` },
];
