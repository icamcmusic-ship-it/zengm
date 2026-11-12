import type { PhaseReturn } from "../../../common/types.ts";
import * as college from "../college/index.ts";

const newPhaseAfterTradeDeadline = async (): Promise<PhaseReturn> => {
	// College mode: this phase is the conference tournaments
	if (college.isCollege()) {
		return college.newPhaseConfTournaments();
	}

	return {};
};

export default newPhaseAfterTradeDeadline;
