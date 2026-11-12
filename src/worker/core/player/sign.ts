import { PHASE } from "../../../common/constants.ts";
import { g, helpers, local, logEvent } from "../../util/index.ts";
import { pickAiContractTerms } from "../contract/options.ts";
import type { Phase, Player, FlatContractInfo } from "../../../common/types.ts";
import genJerseyNumber from "./genJerseyNumber.ts";
import setJerseyNumber from "./setJerseyNumber.ts";
import { addContract, createContract } from "../contract/index.ts";
import { getProStats } from "../../../common/preDraft.ts";
import type { CapExceptionType } from "../../../common/capExceptions.ts";
import { featureOn } from "../../util/nativeFeatures.ts";

const sign = async (
	p: Player,
	tid: number,
	contractInput: FlatContractInfo,
	phase: Phase,
	// Salary cap exception this signing uses (League Extras: Salary Cap Exceptions), for the transaction text and the contract
	exception?: CapExceptionType,
) => {
	const isRookie =
		getProStats(p).length === 0 &&
		p.draft.year === g.get("season") &&
		p.draft.tid === tid;

	p.tid = tid;
	p.numDaysFreeAgent = 0;
	p.gamesUntilTradable = isRookie ? 0 : Math.round(0.17 * g.get("numGames")); // 14 for basketball, 3 for football
	delete p.numPlayersTradedAwayNormalized;

	// Handle stats if the season is in progress. Otherwise, not needed until next season.
	if (phase <= PHASE.PLAYOFFS) {
		setJerseyNumber(p, await genJerseyNumber(p));
	}

	let score = p.valueFuzz - 45;
	if (__SPORT === "football") {
		score -= 7;
	}
	score = Math.round(helpers.bound(score, 0, Infinity));

	// Copy so later changes to the contract demand don't affect this
	const contractSummary: FlatContractInfo = {
		amount: contractInput.amount,
		exp: contractInput.exp,
	};
	if (contractInput.rookie) {
		contractSummary.rookie = true;
	}
	if (featureOn("contractOptions") && !contractSummary.rookie) {
		const aiTeam =
			!g.get("userTids").includes(tid) ||
			!!local.autoPlayUntil ||
			g.get("spectator");
		const terms =
			contractInput.terms ??
			(aiTeam ? pickAiContractTerms(p, contractSummary) : undefined);
		if (terms) {
			contractSummary.terms = { ...terms };
		}
	}

	// Sigh, don't know why this is needed, but people tell me that sometimes the #1 pick has a massively negative contract
	if (contractSummary.amount < 0) {
		contractSummary.amount = g.get("minContract");
	}

	const resigning =
		phase === PHASE.RESIGN_PLAYERS && p.draft.year !== g.get("season");

	const eventType = resigning ? "reSigned" : "freeAgent";
	const eid = await logEvent({
		type: eventType,
		showNotification: false,
		pids: [p.pid],
		tids: [p.tid],
		score,
		contract: contractSummary,
		...(exception ? { exception } : undefined),
	});

	const contract = createContract({
		contract: contractSummary,
		eid,
		type: contractSummary.rookie
			? "rookie"
			: resigning
				? "reSign"
				: "freeAgent",
	});
	if (exception) {
		contract.exception = exception;
	}
	addContract(p, contract);

	const freeAgent = !resigning && !isRookie;
	if (freeAgent) {
		if (!p.transactions) {
			p.transactions = [];
		}
		p.transactions.push({
			season: g.get("season"),
			phase: g.get("phase"),
			tid: p.tid,
			type: "freeAgent",
			eid,
		});
	}

	return eid;
};

export default sign;
