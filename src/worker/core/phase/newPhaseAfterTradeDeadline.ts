import type { PhaseReturn } from "../../../common/types.ts";
import * as college from "../college/index.ts";
import { hotSeatNews } from "../gm/index.ts";
import { onTradeDeadline as onOwnerTradeDeadline } from "../ownerOffice/owner.ts";

const newPhaseAfterTradeDeadline = async (): Promise<PhaseReturn> => {
	// College mode: this phase is the conference tournaments
	if (college.isCollege()) {
		return college.newPhaseConfTournaments();
	}

	// AI GMs on the hot seat, a background extra: a bug in it must not stop the season
	try {
		await hotSeatNews();
	} catch (error) {
		console.error(error);
	}

	// Owner's Office: the owner's "cut payroll by the deadline" request comes due
	await onOwnerTradeDeadline();

	return {};
};

export default newPhaseAfterTradeDeadline;
