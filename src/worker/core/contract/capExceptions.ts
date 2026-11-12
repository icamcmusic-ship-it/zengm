// Salary cap exceptions (League Extras: Salary Cap Exceptions). With a soft cap, a team over the cap can sign one free agent a season with each exception it has: the mid-level exception (a smaller one for teams near or over the luxury tax), the bi-annual exception (every other season), or, for teams that used cap space, the room exception. They're applied automatically when a signing only fits that way. With the setting off (or a hard cap or no cap) nothing here does anything.
import { PHASE } from "../../../common/constants.ts";
import {
	CAP_EXCEPTIONS,
	FIRST_APRON_FACTOR,
	REPEATER_TAX_MIN_SEASONS,
	REPEATER_TAX_SEASONS,
	SECOND_APRON_FACTOR,
	type CapExceptionType,
	type CapExceptionUse,
} from "../../../common/capExceptions.ts";
import type { GmWeights } from "../../../common/gmPersonality.ts";
import type { Contract, Player, Team } from "../../../common/types.ts";
import { idb } from "../../db/index.ts";
import { g, helpers } from "../../util/index.ts";
import { getContractStartSeason } from "../../util/getContractStartSeason.ts";
import { featureOn, featureOption } from "../../util/nativeFeatures.ts";

export const capExceptionsEnabled = () =>
	featureOn("capExceptions") && g.get("salaryCapType") === "soft";

export const repeaterTaxEnabled = () =>
	featureOption<boolean>("capExceptionsRepeaterTax") &&
	g.get("salaryCapType") !== "hard";

export const stretchProvisionEnabled = () =>
	featureOption<boolean>("capExceptionsStretch");

// Exceptions are once per league year, which starts with free agency: it's the first season of a contract signed now
export const getLeagueYear = () => getContractStartSeason();

export const getCapExceptionAmount = (type: CapExceptionType) => {
	const minContract = g.get("minContract");
	return helpers.bound(
		helpers.roundContract(
			CAP_EXCEPTIONS[type].capFraction * g.get("salaryCap"),
		),
		minContract,
		Math.max(minContract, g.get("maxContract")),
	);
};

export const getCapExceptionMaxYears = (type: CapExceptionType) =>
	Math.max(
		g.get("minContractLength"),
		Math.min(CAP_EXCEPTIONS[type].maxYears, g.get("maxContractLength")),
	);

const getAprons = () => {
	// In a league where the luxury tax line is set below the cap, the aprons are relative to the cap
	const base = Math.max(g.get("luxuryPayroll"), g.get("salaryCap"));
	return {
		first: FIRST_APRON_FACTOR * base,
		second: SECOND_APRON_FACTOR * base,
	};
};

type TeamExceptions = Pick<Team, "capExceptions">;

const usesThisYear = (t: TeamExceptions, leagueYear: number) =>
	(t.capExceptions?.uses ?? []).filter((use) => use.season === leagueYear);

export type AvailableCapException = {
	type: CapExceptionType;
	// Largest salary that can be signed with it right now, which is less than the full exception for a team close to the apron
	amount: number;
	fullAmount: number;
	maxYears: number;
};

// Exceptions a team could use right now, each with the largest salary it allows given the payroll. payrollCeiling is an extra limit on payroll after the signing, for AI teams that won't go into the luxury tax.
export const getAvailableCapExceptions = (
	t: TeamExceptions,
	payroll: number,
	payrollCeiling: number = Infinity,
): AvailableCapException[] => {
	if (!capExceptionsEnabled()) {
		return [];
	}

	const leagueYear = getLeagueYear();
	const used = new Set(usesThisYear(t, leagueYear).map((use) => use.type));
	const usedCapSpace = t.capExceptions?.capSpaceSeason === leagueYear;
	const aprons = getAprons();
	const minContract = g.get("minContract");

	const types: { type: CapExceptionType; ceiling: number }[] = [];
	if (usedCapSpace) {
		// A team that used cap space this league year gave up its other exceptions
		if (used.size === 0) {
			types.push({ type: "room", ceiling: Infinity });
		}
	} else if (!used.has("room")) {
		if (!used.has("nonTaxpayerMle") && !used.has("taxpayerMle")) {
			types.push(
				{ type: "nonTaxpayerMle", ceiling: aprons.first },
				{ type: "taxpayerMle", ceiling: aprons.second },
			);
		}
		const usedBiAnnualRecently = (t.capExceptions?.uses ?? []).some(
			(use) => use.type === "biAnnual" && use.season >= leagueYear - 1,
		);
		if (!usedBiAnnualRecently && !used.has("taxpayerMle")) {
			types.push({ type: "biAnnual", ceiling: aprons.first });
		}
	}

	const available: AvailableCapException[] = [];
	for (const { type, ceiling } of types) {
		const fullAmount = getCapExceptionAmount(type);
		const amount = Math.min(
			fullAmount,
			Math.floor(Math.min(ceiling, payrollCeiling) - payroll),
		);
		if (amount > minContract) {
			available.push({
				type,
				amount,
				fullAmount,
				maxYears: getCapExceptionMaxYears(type),
			});
		}
	}
	return available;
};

// The exception to use for a signing that doesn't fit under the cap: the smallest one that covers it, so the bigger ones are kept for later
export const pickCapException = (
	available: AvailableCapException[],
	amount: number,
	years: number,
) => {
	let best: AvailableCapException | undefined;
	for (const exception of available) {
		if (amount <= exception.amount && years <= exception.maxYears) {
			if (!best || exception.fullAmount < best.fullAmount) {
				best = exception;
			}
		}
	}
	return best;
};

// Why a signing over the cap can't use an exception, for the user
export const explainNoCapException = (
	t: TeamExceptions,
	payroll: number,
	amount: number,
	years: number,
) => {
	const available = getAvailableCapExceptions(t, payroll);
	if (available.length === 0) {
		const leagueYear = getLeagueYear();
		if (usesThisYear(t, leagueYear).length > 0) {
			return "You already used your salary cap exceptions this season.";
		}
		return "Your payroll is too high to use a salary cap exception.";
	}
	const bigEnough = available.filter((exception) => amount <= exception.amount);
	if (bigEnough.length > 0) {
		const maxYears = Math.max(
			...bigEnough.map((exception) => exception.maxYears),
		);
		return `With your ${CAP_EXCEPTIONS[bigEnough[0]!.type].name} you can only offer up to ${maxYears} ${helpers.plural("year", maxYears)}.`;
	}
	const biggest = available.reduce((a, b) => (b.amount > a.amount ? b : a));
	return `Your biggest salary cap exception (${CAP_EXCEPTIONS[biggest.type].name}) only allows up to ${helpers.formatCurrency(biggest.amount / 1000, "M")}/year.`;
};

const prune = (t: TeamExceptions, leagueYear: number) => {
	if (t.capExceptions) {
		// The bi-annual exception needs last year's uses, nothing needs older ones
		t.capExceptions.uses = t.capExceptions.uses.filter(
			(use) => use.season >= leagueYear - 1,
		);
	}
};

// Record a free agent signing (not a re-signing) for more than the minimum: with an exception, or with cap space (which leaves the team with only the room exception this league year)
export const recordCapExceptionSigning = async (
	tid: number,
	{
		pid,
		amount,
		exception,
		payroll,
	}: {
		pid: number;
		amount: number;
		exception: CapExceptionType | undefined;
		// Before the signing
		payroll: number;
	},
) => {
	if (!capExceptionsEnabled() || amount <= g.get("minContract")) {
		return;
	}
	const t = await idb.cache.teams.get(tid);
	if (!t) {
		return;
	}
	if (
		!exception &&
		g.get("salaryCap") - payroll <= getCapExceptionAmount("nonTaxpayerMle")
	) {
		// A team with less cap space than the mid-level exception is treated like a team over the cap: filling that bit of space doesn't cost it its exceptions
		return;
	}
	const leagueYear = getLeagueYear();
	const previous = helpers.deepCopy(t.capExceptions);
	t.capExceptions ??= { uses: [] };
	prune(t, leagueYear);
	if (exception) {
		t.capExceptions.uses.push({
			season: leagueYear,
			type: exception,
			pid,
			amount,
		});
	} else {
		t.capExceptions.capSpaceSeason = leagueYear;
	}
	await idb.cache.teams.put(t);

	// For undoing a signing
	return async () => {
		const t = await idb.cache.teams.get(tid);
		if (t) {
			if (previous) {
				t.capExceptions = previous;
			} else {
				delete t.capExceptions;
			}
			await idb.cache.teams.put(t);
		}
	};
};

// How a free agent signing for more than the minimum would be done: under the cap, with an exception, or not at all. undefined when exceptions don't apply (setting off, not a soft cap), so callers keep their old rules.
export const getSigningCapInfo = (
	t: TeamExceptions,
	payroll: number,
	amount: number,
	years: number,
):
	| undefined
	| { type: "capSpace" }
	| { type: "exception"; exception: AvailableCapException }
	| { type: "none"; reason: string } => {
	if (!capExceptionsEnabled()) {
		return;
	}
	if (payroll + amount - 1 <= g.get("salaryCap")) {
		return { type: "capSpace" };
	}
	const exception = pickCapException(
		getAvailableCapExceptions(t, payroll),
		amount,
		years,
	);
	if (exception) {
		return { type: "exception", exception };
	}
	return {
		type: "none",
		reason: explainNoCapException(t, payroll, amount, years),
	};
};

// For the Free Agents page's Sign button, which signs a free agent for what he asks: the length he asks for may be longer than any
// exception that covers the amount allows (5 years on the 4-year mid-level). Then the longest contract an exception allows, at the
// price he asks for that length (more per year for fewer years, like in the negotiation), or why there is none. undefined when the
// asking contract is fine as it is (or exceptions don't apply), so the button keeps its old rules. Amounts in thousands.
export type SigningAdvice =
	| {
			type: "shorter";
			exception: CapExceptionType;
			askedYears: number;
			maxYears: number;
			amount: number;
			exp: number;
	  }
	| { type: "tooLong"; reason: string };

export const getSigningAdvice = (
	t: TeamExceptions,
	payroll: number,
	{
		amount,
		exp,
		amountForYears,
	}: {
		amount: number;
		exp: number;
		// His price per year for another length, in thousands
		amountForYears: (years: number) => number;
	},
): SigningAdvice | undefined => {
	if (!capExceptionsEnabled() || amount - 1 <= g.get("minContract")) {
		return;
	}
	if (payroll + amount - 1 <= g.get("salaryCap")) {
		return;
	}
	const startSeason = getContractStartSeason();
	const askedYears = exp - startSeason + 1;
	const available = getAvailableCapExceptions(t, payroll);
	if (pickCapException(available, amount, askedYears)) {
		return;
	}
	// Only when the length is the problem: an exception big enough for what he asks, but too short
	const coversAmount = available.filter(
		(exception) => amount <= exception.amount,
	);
	if (
		coversAmount.length === 0 ||
		coversAmount.every((exception) => exception.maxYears >= askedYears)
	) {
		return;
	}
	let best: SigningAdvice | undefined;
	for (const exception of available) {
		const years = Math.min(exception.maxYears, askedYears);
		const price = amountForYears(years);
		if (
			price <= exception.amount &&
			price <= g.get("maxContract") &&
			(best?.type !== "shorter" ||
				years > best.maxYears ||
				(years === best.maxYears && price < best.amount))
		) {
			best = {
				type: "shorter",
				// The one the signing will actually use
				exception:
					pickCapException(available, price, years)?.type ?? exception.type,
				askedYears,
				maxYears: years,
				amount: price,
				exp: startSeason + years - 1,
			};
		}
	}
	if (best) {
		return best;
	}
	const maxYears = Math.max(
		...coversAmount.map((exception) => exception.maxYears),
	);
	return {
		type: "tooLong",
		reason: `He wants ${askedYears} years, but your ${CAP_EXCEPTIONS[coversAmount[0]!.type].name} only allows up to ${maxYears}, and he asks more per year for a shorter deal than it covers.`,
	};
};

// How far down the roster (by value, 0 = best) a free agent can be for an AI team to use an exception on him, and to go into the luxury tax for him
const AI_MAX_RANK = 10;
const AI_MAX_RANK_INTO_TAX = 8;
const AI_REBUILDING_MAX_AGE = 27;

// Will this AI team go into the luxury tax to add a free agent with an exception? Only contenders, and not tax-averse GMs (AI GM personalities).
const aiGoesIntoTax = (
	t: Pick<Team, "strategy">,
	gm: Pick<GmWeights, "avoidTaxRankShift"> | undefined,
) => t.strategy === "contending" && (gm?.avoidTaxRankShift ?? 0) >= 0;

// The most an AI team could pay a free agent with an exception right now, 0 if none. For the free agent demand market.
export const getAiCapExceptionCapacity = (
	t: Pick<Team, "capExceptions" | "strategy">,
	payroll: number,
	gm: Pick<GmWeights, "avoidTaxRankShift"> | undefined,
) => {
	const available = getAvailableCapExceptions(
		t,
		payroll,
		aiGoesIntoTax(t, gm) ? Infinity : g.get("luxuryPayroll"),
	);
	return Math.max(0, ...available.map((exception) => exception.amount));
};

// For getBest: which exception, if any, an AI team would use to sign a free agent who doesn't fit under its cap. A player has to be good enough for the team's rotation, rebuilding teams only use exceptions on young players, and only contenders whose GM doesn't mind the tax go into the luxury tax, for a player who'd be one of their best.
export const makeAiCapExceptionPicker = ({
	t,
	roster,
	payroll,
	gm,
}: {
	t: Pick<Team, "capExceptions" | "strategy">;
	roster: Pick<Player, "value">[];
	payroll: number;
	gm: Pick<GmWeights, "avoidTaxRankShift"> | undefined;
}) => {
	if (!capExceptionsEnabled()) {
		return;
	}
	const noTax = getAvailableCapExceptions(t, payroll, g.get("luxuryPayroll"));
	const intoTax = aiGoesIntoTax(t, gm)
		? getAvailableCapExceptions(t, payroll)
		: [];
	if (noTax.length === 0 && intoTax.length === 0) {
		return;
	}
	const maxContractExp = (years: number) =>
		getContractStartSeason() + years - 1;
	const season = g.get("season");

	return (
		p: Pick<Player, "value" | "born">,
		contract: { amount: number; exp: number },
	) => {
		const rank = roster.filter((p2) => p2.value > p.value).length;
		if (rank >= AI_MAX_RANK) {
			return;
		}
		if (
			t.strategy === "rebuilding" &&
			season - p.born.year > AI_REBUILDING_MAX_AGE
		) {
			return;
		}

		// AI teams shorten the contract to what the exception allows, so only the amount has to fit
		let exception = pickCapException(noTax, contract.amount, 0);
		if (
			!exception &&
			rank < AI_MAX_RANK_INTO_TAX + 2 * (gm?.avoidTaxRankShift ?? 0)
		) {
			exception = pickCapException(intoTax, contract.amount, 0);
		}
		if (!exception) {
			return;
		}
		return {
			exception,
			exp: Math.min(contract.exp, maxContractExp(exception.maxYears)),
		};
	};
};

export type AiCapExceptionPicker = NonNullable<
	ReturnType<typeof makeAiCapExceptionPicker>
>;

// For the UI: the exceptions of a team this league year, with what's left
export const getCapExceptionsSummary = async (tid: number, payroll: number) => {
	if (!capExceptionsEnabled()) {
		return;
	}
	const t = await idb.cache.teams.get(tid);
	if (!t) {
		return;
	}
	const leagueYear = getLeagueYear();
	const available = getAvailableCapExceptions(t, payroll);
	const used: (CapExceptionUse & { name: string })[] = [];
	for (const use of usesThisYear(t, leagueYear)) {
		const p = await idb.cache.players.get(use.pid);
		used.push({
			...use,
			amount: use.amount / 1000,
			name: p ? `${p.firstName} ${p.lastName}` : "???",
		});
	}

	// The two mid-level exceptions are one slot, so show the one that allows more
	const rows = available.filter((exception) => {
		if (exception.type === "taxpayerMle") {
			return !available.some(
				(other) =>
					other.type === "nonTaxpayerMle" && other.amount >= exception.amount,
			);
		}
		if (exception.type === "nonTaxpayerMle") {
			return !available.some(
				(other) =>
					other.type === "taxpayerMle" && other.amount > exception.amount,
			);
		}
		return true;
	});

	return {
		leagueYear,
		usedCapSpace: t.capExceptions?.capSpaceSeason === leagueYear,
		available: rows.map((exception) => ({
			type: exception.type,
			amount: exception.amount / 1000,
			fullAmount: exception.fullAmount / 1000,
			maxYears: exception.maxYears,
		})),
		used,
		// Largest salary that can be signed over the cap, in millions (0 if none)
		maxAmount:
			Math.max(0, ...available.map((exception) => exception.amount)) / 1000,
	};
};

export type CapExceptionsSummary = NonNullable<
	Awaited<ReturnType<typeof getCapExceptionsSummary>>
>;

// Repeater tax (sub-setting): a team that paid the luxury tax in at least 3 of the previous 4 seasons pays a higher rate
export const isRepeaterTaxTeam = async (
	tid: number,
	season: number = g.get("season"),
) => {
	if (!repeaterTaxEnabled()) {
		return false;
	}
	const teamSeasons = await idb.merged.teamSeasons.getAll({
		tid,
		seasons: [season - REPEATER_TAX_SEASONS, season - 1],
	});
	const numTaxed = teamSeasons.filter(
		(teamSeason) => (teamSeason.expenses.luxuryTax ?? 0) > 0,
	).length;
	return numTaxed >= REPEATER_TAX_MIN_SEASONS;
};

// Stretch provision (sub-setting): what a team owes a released player after the season being paid now is spread evenly over twice the remaining seasons plus one. Call after the guarantees were applied to the released contract. Returns false if there is nothing to stretch.
export const getStretchFirstSeason = () => {
	// In the regular season the current season stays as it is (it's already partly paid). Before it starts, or after it, everything left is stretched.
	const phase = g.get("phase");
	const start = getContractStartSeason();
	return phase === PHASE.REGULAR_SEASON || phase === PHASE.AFTER_TRADE_DEADLINE
		? start + 1
		: start;
};

export const getStretchedAmounts = (
	contract: Pick<Contract, "amounts" | "start">,
	firstSeason: number = getStretchFirstSeason(),
) => {
	const index = Math.max(0, firstSeason - contract.start);
	const remaining = contract.amounts.slice(index);
	const total = remaining.reduce((sum, amount) => sum + amount, 0);
	if (remaining.length === 0 || total <= 0) {
		return;
	}
	const numSeasons = 2 * remaining.length + 1;
	const amount = Math.round(total / numSeasons);
	return {
		amounts: [
			...contract.amounts.slice(0, index),
			...Array<number>(numSeasons).fill(amount),
		],
		amount,
		numSeasons,
		total,
		firstSeason: contract.start + index,
		exp: contract.start + index + numSeasons - 1,
	};
};

export const applyStretchProvision = (contract: Contract) => {
	const stretched = getStretchedAmounts(contract);
	if (!stretched) {
		return false;
	}
	contract.amounts = stretched.amounts;
	// What's left is all owed, there's nothing more to guarantee or decide
	delete contract.guaranteed;
	if (contract.option && contract.option.decision === undefined) {
		contract.option.decision = "exercised";
	}
	contract.stretched = true;
	return true;
};
