// Which players AI teams are willing to move, and roughly what they'd ask for. Pure logic, used by the tradeMarket view

export type AvailabilityInput = {
	strategy: "contending" | "rebuilding";
	age: number;

	// 0 for the team's most valuable player, 1 for the next, etc.
	valueRank: number;

	rosterSize: number;

	// Player value (like p.value) and contract
	value: number;
	contractAmount: number;
	contractExp: number;

	season: number;
	minContract: number;
	maxContract: number;

	// Untradable or just acquired/drafted, never available
	untradable: boolean;
};

export type Availability = {
	// 0 to 100, how willing the team is to trade this player
	score: number;
	reasons: string[];
};

// How much a player at this value "should" be paid, on a 0-1 scale between min and max contract. Very rough, just for spotting overpaid players
const expectedPayFraction = (value: number) =>
	Math.min(1, Math.max(0, (value - 40) / 35));

export const getAvailability = (input: AvailabilityInput): Availability => {
	if (input.untradable) {
		return { score: 0, reasons: [] };
	}

	let score = 20;
	const reasons: string[] = [];

	const payFraction =
		(input.contractAmount - input.minContract) /
		Math.max(1, input.maxContract - input.minContract);
	const overpaid = payFraction - expectedPayFraction(input.value);
	const yearsLeft = input.contractExp - input.season;

	if (input.strategy === "rebuilding") {
		if (input.age >= 30) {
			score += 40;
			reasons.push("Veteran on a rebuilding team");
		} else if (input.age >= 27) {
			score += 25;
			reasons.push("In his prime, but the team is rebuilding");
		} else if (input.age <= 24) {
			score -= 25;
		}
		if (overpaid > 0.15 && yearsLeft >= 1) {
			score += 20;
			reasons.push("Contract they'd like to shed");
		}
	} else {
		if (input.valueRank < 5) {
			score -= 30;
		} else if (input.valueRank >= 8) {
			score += 25;
			reasons.push("Depth piece on a contender");
		}
		if (input.age <= 23 && input.valueRank >= 5) {
			score += 15;
			reasons.push("Prospect a contender would flip for help now");
		}
		if (overpaid > 0.2 && yearsLeft >= 1) {
			score += 15;
			reasons.push("Overpaid for his role");
		}
	}

	if (yearsLeft === 0 && input.age >= 26) {
		score += 10;
		reasons.push("Expiring contract");
	}

	// Stars are almost never available
	if (input.valueRank === 0) {
		score -= 30;
	} else if (input.valueRank === 1) {
		score -= 15;
	}

	// Teams with big rosters need to move someone
	if (input.rosterSize > 15 && input.valueRank >= 10) {
		score += 10;
		reasons.push("Roster crunch");
	}

	return {
		score: Math.max(0, Math.min(100, Math.round(score))),
		reasons,
	};
};

export const AVAILABLE_THRESHOLD = 45;

export type AskingPrice = {
	tier: "low" | "medium" | "high" | "veryHigh";
	text: string;
};

// lossValue is how much value the team loses by trading the player, and pickValue is how much it loses by trading its own next first round pick, both from ValueChangeCalculator, so the ratio says how many first round picks the player is worth to them
export const getAskingPrice = (
	lossValue: number,
	pickValue: number,
	strategy: "contending" | "rebuilding",
): AskingPrice => {
	const ratio = pickValue > 0 ? lossValue / pickValue : lossValue;
	const wants =
		strategy === "rebuilding"
			? "picks or young players"
			: "players who help now";
	if (ratio < 0.4) {
		return {
			tier: "low",
			text: `Low: a second round pick or salary filler`,
		};
	}
	if (ratio < 1.3) {
		return {
			tier: "medium",
			text: `Medium: about a first round pick's worth of ${wants}`,
		};
	}
	if (ratio < 2.5) {
		return {
			tier: "high",
			text: `High: about two first round picks' worth of ${wants}`,
		};
	}
	return {
		tier: "veryHigh",
		text: `Very high: a haul of ${wants}`,
	};
};
