import { g } from "../../util/index.ts";
import { REPEATER_TAX_FACTOR } from "../../../common/capExceptions.ts";

// repeater: the team pays the higher repeater rate (Repeater Luxury Tax setting, see isRepeaterTaxTeam)
const getLuxuryTaxAmount = (payroll: number, repeater: boolean = false) => {
	// Only apply luxury tax if hard cap is disabled!
	if (payroll > g.get("luxuryPayroll") && g.get("salaryCapType") !== "hard") {
		const amount = g.get("luxuryTax") * (payroll - g.get("luxuryPayroll"));
		return repeater ? REPEATER_TAX_FACTOR * amount : amount;
	}

	return 0;
};

export default getLuxuryTaxAmount;
