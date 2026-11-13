import { team } from "../index.ts";
import { idb } from "../../db/index.ts";
import { g, helpers, local, logEvent } from "../../util/index.ts";
import { featureOn } from "../../util/nativeFeatures.ts";
import { ownerDistribution } from "./ownerDistribution.ts";
import getLuxuryTaxAmount from "./getLuxuryTaxAmount.ts";
import getMinPayrollAmount from "./getMinPayrollAmount.ts";
import { isRepeaterTaxTeam } from "../contract/capExceptions.ts";

const rosterLink = (tid: number) =>
	`<a href="${helpers.leagueUrl([
		"roster",
		`${g.get("teamInfoCache")[tid]?.abbrev}_${tid}`,
		g.get("season"),
	])}">${g.get("teamInfoCache")[tid]?.name}</a>`;

/**
 * Assess the payroll and apply minimum and luxury taxes.
 * Distribute half of the collected luxury taxes to teams under the salary cap.
 *
 * @memberOf core.finances
 * @return {Promise}
 */
const assessPayrollMinLuxury = async () => {
	let collectedTax = 0;
	const payrolls = await team.getPayrolls();
	const teamSeasons = await idb.cache.teamSeasons.indexGetAll(
		"teamSeasonsBySeasonTid",
		[[g.get("season")], [g.get("season"), "Z"]],
	);

	for (const teamSeason of teamSeasons) {
		const tid = teamSeason.tid;
		const payroll = payrolls[tid];
		if (payroll === undefined) {
			throw new Error(`No payroll found for team ${tid}`);
		}

		// Store payroll
		teamSeason.payrollEndOfSeason = payroll;

		// Repeater Luxury Tax (setting): a higher rate for teams that paid the tax in 3 of the previous 4 seasons. Always false with the setting off.
		const repeater =
			payroll > g.get("luxuryPayroll") && (await isRepeaterTaxTeam(tid));
		const luxuryTaxAmount = getLuxuryTaxAmount(payroll, repeater);
		const minPayrollAmount = getMinPayrollAmount(payroll);

		if (minPayrollAmount > 0) {
			teamSeason.expenses.minTax = minPayrollAmount;
			teamSeason.cash -= minPayrollAmount;

			logEvent({
				type: "minPayroll",
				text: `The ${rosterLink(
					tid,
				)} paid a minimum payroll penalty of ${helpers.formatCurrency(
					minPayrollAmount / 1000,
					"M",
				)} for having a payroll under ${helpers.formatCurrency(
					g.get("minPayroll") / 1000,
					"M",
				)}.`,
				tids: [tid],
				showNotification: tid === g.get("userTid"),
				score: 10,
			});
		}

		if (luxuryTaxAmount > 0) {
			collectedTax += luxuryTaxAmount;
			teamSeason.expenses.luxuryTax = luxuryTaxAmount;
			teamSeason.cash -= teamSeason.expenses.luxuryTax;

			logEvent({
				type: "luxuryTax",
				text: `The ${rosterLink(
					tid,
				)} paid a luxury tax of ${helpers.formatCurrency(
					luxuryTaxAmount / 1000,
					"M",
				)}${repeater ? " (at the repeater rate)" : ""} for having a payroll above ${helpers.formatCurrency(
					g.get("luxuryPayroll") / 1000,
					"M",
				)}.`,
				tids: [tid],
				showNotification: tid === g.get("userTid"),
				score: 10,
			});
		}
	}

	const payrollCutoff =
		g.get("salaryCapType") === "none"
			? g.get("luxuryPayroll")
			: g.get("salaryCap");

	const payteams = Object.values(payrolls).filter(
		(x) => x !== undefined && x <= payrollCutoff,
	);

	if (payteams.length > 0 && collectedTax > 0) {
		const distribute = (collectedTax * 0.5) / payteams.length;

		for (const teamSeason of teamSeasons) {
			const tid = teamSeason.tid;
			const payroll = payrolls[tid];
			if (payroll === undefined) {
				throw new Error(`No payroll found for team ${tid}`);
			}

			if (payroll <= payrollCutoff) {
				teamSeason.revenues.luxuryTaxShare = distribute;
				teamSeason.cash += distribute;

				logEvent({
					type: "luxuryTaxDist",
					text: `The ${rosterLink(
						tid,
					)} received a luxury tax distribution of ${helpers.formatCurrency(
						distribute / 1000,
						"M",
					)} for having a payroll under ${helpers.formatCurrency(
						payrollCutoff / 1000,
						"M",
					)}.`,
					tids: [tid],
					showNotification: tid === g.get("userTid"),
					score: 10,
				});
			} else {
				teamSeason.revenues.luxuryTaxShare = 0;
			}
		}
	}

	// Realistic AI Economy: AI owners take out most of the cash above a reserve, so it doesn't grow without bound
	if (featureOn("realisticEconomy")) {
		const userTids =
			g.get("spectator") || local.autoPlayUntil
				? new Set<number>()
				: new Set(g.get("userTids"));
		for (const teamSeason of teamSeasons) {
			if (userTids.has(teamSeason.tid)) {
				continue;
			}
			const amount = ownerDistribution(teamSeason.cash, g.get("salaryCap"));
			if (amount > 0) {
				teamSeason.cash -= amount;
				logEvent({
					type: "ownerDistribution",
					text: `The owner of the ${rosterLink(
						teamSeason.tid,
					)} took a distribution of ${helpers.formatCurrency(
						amount / 1000,
						"M",
					)} from the team's cash reserves.`,
					tids: [teamSeason.tid],
					showNotification: false,
					score: 0,
				});
			}
		}
	}

	await idb.cache.teamSeasons.putAll(teamSeasons);
};

export default assessPayrollMinLuxury;
