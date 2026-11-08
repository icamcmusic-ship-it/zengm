import { PHASE } from "../../../common/constants.ts";
import type { Phase } from "../../../common/types.ts";

// Pure logic for need-driven AI-to-AI trades, kept separate from the database code in betweenAiTeams.ts so it can be tested directly

export type NeedTradeKind = "deadlineBuy" | "rebuildSell" | "salaryDump";

export type TeamNeedInfo = {
	tid: number;
	strategy: "contending" | "rebuilding";

	// Thousands of dollars
	payroll: number;

	// Current season winning percentage, or undefined if no games played
	winp: number | undefined;
};

export type NeedContext = {
	phase: Phase;

	// 0 to 1, how much of the regular season has been played
	seasonProgress: number;

	// Fraction of the season when the trade deadline happens, or >= 1 for no deadline
	tradeDeadline: number;

	salaryCap: number;
	luxuryPayroll: number;
	salaryCapType: "hard" | "soft" | "none";
};

// "At the deadline" is the stretch of the regular season leading up to the trade deadline. With no deadline, it's the second half of the season
export const isDeadlineWindow = (ctx: NeedContext) => {
	if (ctx.phase !== PHASE.REGULAR_SEASON) {
		return false;
	}
	if (ctx.tradeDeadline < 1) {
		return ctx.seasonProgress >= Math.max(0, ctx.tradeDeadline - 0.25);
	}
	return ctx.seasonProgress >= 0.5;
};

// Contenders that are actually winning are buyers. Rebuilding teams, or bad teams late in the season, are sellers
export const isBuyer = (t: TeamNeedInfo) =>
	t.strategy === "contending" && (t.winp === undefined || t.winp >= 0.45);
export const isSeller = (t: TeamNeedInfo, ctx: NeedContext) =>
	t.strategy === "rebuilding" ||
	(isDeadlineWindow(ctx) && t.winp !== undefined && t.winp < 0.4);

// A team wants to dump salary if it pays luxury tax, or (with a hard cap) is near the cap
export const wantsToDumpSalary = (t: TeamNeedInfo, ctx: NeedContext) => {
	if (ctx.salaryCapType === "none") {
		return t.payroll > ctx.luxuryPayroll;
	}
	if (ctx.salaryCapType === "hard") {
		return t.payroll > 0.97 * ctx.salaryCap;
	}
	return t.payroll > ctx.luxuryPayroll;
};

export const capSpace = (t: TeamNeedInfo, ctx: NeedContext) =>
	ctx.salaryCapType === "none"
		? ctx.luxuryPayroll - t.payroll
		: ctx.salaryCap - t.payroll;

// Relative weights of each kind of need-driven trade, given the time of year. Kinds that no team needs get 0.
export const getKindWeights = (
	teams: TeamNeedInfo[],
	ctx: NeedContext,
): Record<NeedTradeKind, number> => {
	const buyers = teams.filter((t) => isBuyer(t));
	const sellers = teams.filter((t) => isSeller(t, ctx));
	const dumpers = teams.filter((t) => wantsToDumpSalary(t, ctx));
	const capTeams = teams.filter((t) => capSpace(t, ctx) > 0);

	const deadline = isDeadlineWindow(ctx);
	const regularSeason = ctx.phase === PHASE.REGULAR_SEASON;

	const canBuySell = buyers.length > 0 && sellers.length > 0;

	return {
		deadlineBuy: deadline && canBuySell ? 4 : 0,
		rebuildSell: canBuySell ? (regularSeason ? 1 : 1.5) : 0,
		salaryDump:
			dumpers.length > 0 && capTeams.length > 0 ? (regularSeason ? 1 : 2) : 0,
	};
};

export const pickKind = (
	weights: Record<NeedTradeKind, number>,
	r: number,
): NeedTradeKind | undefined => {
	const entries = Object.entries(weights) as [NeedTradeKind, number][];
	const total = entries.reduce((memo, [, w]) => memo + w, 0);
	if (total <= 0) {
		return;
	}
	let cumsum = 0;
	for (const [kind, w] of entries) {
		cumsum += w / total;
		if (r < cumsum) {
			return kind;
		}
	}
	return entries.findLast(([, w]) => w > 0)?.[0];
};

export type CandidatePlayer = {
	pid: number;
	age: number;
	value: number;

	// Thousands of dollars per year
	contractAmount: number;
	contractExp: number;
};

export const VETERAN_AGE = 28;

// Veterans worth trading for: older, and actually good relative to the rest of their team
export const getVeteranCandidates = (
	players: CandidatePlayer[],
): CandidatePlayer[] => {
	if (players.length === 0) {
		return [];
	}
	const values = players.map((p) => p.value).sort((a, b) => b - a);
	const cutoff = values[Math.min(values.length - 1, 4)]!;
	return players.filter((p) => p.age >= VETERAN_AGE && p.value >= cutoff);
};

// The contracts a team would most like to get rid of: multiple years left, lots of money, not much value. Sorted from worst contract to best
export const getSalaryDumpCandidates = (
	players: CandidatePlayer[],
	season: number,
	minContract: number,
	maxContract: number,
): CandidatePlayer[] => {
	const score = (p: CandidatePlayer) => {
		const moneyScore =
			(p.contractAmount - minContract) / (maxContract - minContract);
		return moneyScore - p.value / 100;
	};
	return players
		.filter(
			(p) =>
				p.contractExp > season &&
				p.contractAmount > minContract + 0.15 * (maxContract - minContract),
		)
		.sort((a, b) => score(b) - score(a));
};

// Players a buyer would rather keep: its best players and its veterans. A contender pays with picks, prospects and depth
export const getBuyerProtected = (players: CandidatePlayer[]) => {
	const sorted = [...players].sort((a, b) => b.value - a.value);
	const protectedPids = new Set(sorted.slice(0, 5).map((p) => p.pid));
	for (const p of players) {
		if (p.age >= 30) {
			protectedPids.add(p.pid);
		}
	}
	return protectedPids;
};

const listNames = (names: string[]) => {
	if (names.length <= 1) {
		return names[0] ?? "";
	}
	return `${names.slice(0, -1).join(", ")} and ${names.at(-1)}`;
};

export type ReturnDescription = {
	numPlayers: number;
	numYoungPlayers: number;
	numPicks: number;
};

const describeReturn = ({
	numPlayers,
	numYoungPlayers,
	numPicks,
}: ReturnDescription) => {
	const parts = [];
	if (numYoungPlayers > 0) {
		parts.push(numYoungPlayers === 1 ? "a young player" : "young players");
	}
	if (numPlayers - numYoungPlayers > 0) {
		parts.push(numPlayers - numYoungPlayers === 1 ? "a veteran" : "veterans");
	}
	if (numPicks > 0) {
		parts.push(numPicks === 1 ? "a draft pick" : "draft picks");
	}
	return parts.length > 0 ? listNames(parts) : "nothing";
};

// Text for the trade event explaining why it happened
export const getRationale = ({
	kind,
	mainTeam,
	otherTeam,
	playerNames,
	returnTo,
	salary,
}: {
	kind: NeedTradeKind;

	// Seller for deadlineBuy/rebuildSell, dumping team for salaryDump
	mainTeam: string;

	// Buyer, or team with cap space
	otherTeam: string;

	playerNames: string[];
	returnTo: ReturnDescription;

	// Thousands of dollars per year, for salary dumps
	salary?: number;
}) => {
	const players = listNames(playerNames);
	if (kind === "deadlineBuy") {
		return `Deadline deal: the contending ${otherTeam} add ${players} for the stretch run, and the ${mainTeam} get ${describeReturn(returnTo)} for the future.`;
	}
	if (kind === "rebuildSell") {
		return `The rebuilding ${mainTeam} sell veteran ${players} for ${describeReturn(returnTo)}, and the contending ${otherTeam} load up.`;
	}
	const amount =
		salary !== undefined ? ` $${(salary / 1000).toFixed(1)}M a year` : "";
	const sweetener =
		returnTo.numPlayers + returnTo.numPicks > 0
			? `, getting ${describeReturn(returnTo)} for their trouble`
			: "";
	return `Salary dump: the ${mainTeam} clear${amount} by sending ${players} to the ${otherTeam}, who use their cap space${sweetener}.`;
};
