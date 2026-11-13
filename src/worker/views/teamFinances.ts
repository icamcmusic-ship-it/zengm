import { getContractAmount } from "../../common/contracts.ts";
import { finances, team } from "../core/index.ts";
import { idb } from "../db/index.ts";
import { g, helpers } from "../util/index.ts";
import type { TeamSeason } from "../../common/types.ts";
import { defineView } from "../util/defineView.ts";
import {
	getCapExceptionsSummary,
	isRepeaterTaxTeam,
} from "../core/contract/capExceptions.ts";
import { getPayrollSeason } from "../util/getPayrollSeason.ts";
import { getAutoTicketPriceByTid } from "../core/game/attendance.ts";
import addFirstNameShort from "../util/addFirstNameShort.ts";
import {
	getSkillBadgesForRow,
	prepareSkillBadges,
} from "../core/player/format.ts";
import type { RouteParams } from "../../ui/router/types.ts";
import { validateOption, validateTeam } from "../util/processInputs.ts";
import { dropdownKeys } from "../../common/dropdownKeys.ts";
import {
	frontOfficeEnabled,
	getFinancesInfo,
} from "../core/frontOffice/index.ts";
import { departmentSize } from "../../common/scoutingReports/scouts.ts";
import { featureOn } from "../util/nativeFeatures.ts";

const processInputs = (params: RouteParams<"teamFinances">) => {
	const show = validateOption(params.show, dropdownKeys.shows, "10");
	const tid = validateTeam(params.team);
	return { show, tid };
};

export default defineView({
	id: "teamFinances",
	processInputs,
	load: async ({ inputs, updateEvents, prevInputs }) => {
		if (
			updateEvents.has("firstRun") ||
			updateEvents.has("gameSim") ||
			updateEvents.has("playerMovement") ||
			updateEvents.has("teamFinances") ||
			inputs.tid !== prevInputs?.tid ||
			inputs.show !== prevInputs?.show
		) {
			const contractsRaw = await team.getContracts(inputs.tid);
			let payroll = await team.getPayroll(contractsRaw);
			// Repeater Luxury Tax and Salary Cap Exceptions (settings), false/undefined when off
			const repeaterTax = await isRepeaterTaxTeam(inputs.tid);
			const capExceptions = await getCapExceptionsSummary(inputs.tid, payroll);
			const luxuryTaxAmount =
				finances.getLuxuryTaxAmount(payroll, repeaterTax) / 1000;
			const minPayrollAmount = finances.getMinPayrollAmount(payroll) / 1000;
			payroll /= 1000;

			let showInt;

			if (inputs.show === "all") {
				showInt = g.get("season") - g.get("startingSeason") + 1;
			} else {
				showInt = Number.parseInt(inputs.show);
			}

			// Same season as payroll, so seasons that are already paid are not shown
			const season = getPayrollSeason();

			// How many seasons into the future are contracts?
			let maxContractExp = -Infinity;
			for (const contract of contractsRaw) {
				if (contract.exp > maxContractExp) {
					maxContractExp = contract.exp;
				}
			}
			const numSeasons = Math.max(
				g.get("maxContractLength"),
				maxContractExp - season + 1,
			);

			// Extended skill badges, shown with the skills (League Extras switch)
			await prepareSkillBadges();
			const badgesByPid = new Map<number, string[] | undefined>();
			for (const contract of contractsRaw) {
				const p = await idb.cache.players.get(contract.pid);
				if (p) {
					badgesByPid.set(p.pid, getSkillBadgesForRow(p, p.ratings.at(-1)!));
				}
			}

			// Convert contract objects into table rows
			const contractTotals = Array(numSeasons).fill(0);
			const contracts = addFirstNameShort(
				contractsRaw.map((contract) => {
					const amounts: number[] = [];

					for (let i = season; i <= contract.exp; i++) {
						const amount = (getContractAmount(contract, i) ?? 0) / 1000;
						amounts.push(amount);
						if (contractTotals[i - season] !== undefined) {
							contractTotals[i - season] += amount;
						}
					}

					return {
						pid: contract.pid,
						firstName: contract.firstName,
						lastName: contract.lastName,
						skills: contract.skills,
						badges: badgesByPid.get(contract.pid),
						pos: contract.pos,
						injury: contract.injury,
						jerseyNumber: contract.jerseyNumber,
						watch: contract.watch,
						released: contract.released,
						amounts,
						capPct: (100 * contract.amount) / g.get("salaryCap"),
					};
				}),
			);

			const salariesSeasons = [];
			for (let i = 0; i < numSeasons; i++) {
				salariesSeasons.push(season + i);
			}

			const teamSeasons = (
				await idb.merged.teamSeasons.getAll({ tid: inputs.tid })
			)
				.reverse() // Most recent season first
				.map((teamSeason) => {
					// Add in luxuryTaxShare if it's missing
					return {
						...teamSeason,
						revenues: {
							...teamSeason.revenues,
							luxuryTaxShare: teamSeason.revenues.luxuryTaxShare ?? 0,
						},
					};
				});

			const formatRevenueExpenses = (teamSeason: TeamSeason) => {
				const output = {} as Record<
					| `expenses${Capitalize<keyof TeamSeason["expenses"]>}`
					| `revenues${Capitalize<keyof TeamSeason["revenues"]>}`,
					number
				>;
				for (const [key, value] of helpers.entries(teamSeason.revenues)) {
					const outputKey = `revenues${helpers.upperCaseFirstLetter(
						key,
					)}` as const;
					output[outputKey] = value;
				}
				for (const [key, value] of helpers.entries(teamSeason.expenses)) {
					const outputKey = `expenses${helpers.upperCaseFirstLetter(
						key,
					)}` as const;
					output[outputKey] = value;
				}
				return output;
			};

			const barData = teamSeasons.slice(0, showInt).map((teamSeason) => {
				// (0 before the first home game, not 0 / 0)
				const att =
					teamSeason.gpHome > 0 ? teamSeason.att / teamSeason.gpHome : 0;

				const numPlayoffRounds = g.get(
					"numGamesPlayoffSeries",
					teamSeason.season,
				).length;

				const champ = teamSeason.playoffRoundsWon === numPlayoffRounds;

				const row = {
					season: teamSeason.season,
					champ,
					att,
					cash: teamSeason.cash / 1000, // convert to millions
					won: teamSeason.won,
					hype: teamSeason.hype,
					pop: teamSeason.pop,
					...formatRevenueExpenses(teamSeason),
				};

				return row;
			});

			// Pad with 0s
			while (barData.length > 0 && barData.length < showInt) {
				const row = helpers.deepCopy(barData.at(-1)!);
				row.season -= 1;
				for (const key of helpers.keys(row)) {
					if (key !== "season" && key !== "champ") {
						row[key] = 0;
					}
				}
				barData.push(row);
			}

			// Get stuff for the finances form
			const tTemp = await team.getFormatted({
				attrs: ["budget", "adjustForInflation", "autoTicketPrice"],
				seasonAttrs: ["expenses"],
				season: g.get("season"),
				tid: inputs.tid,
				addDummySeason: true,
			});

			if (!tTemp) {
				throw new Error("Team not found");
			}

			const t = tTemp as typeof tTemp & {
				autoTicketPrice: boolean;
				expenseLevelsLastThree: TeamSeason["expenseLevels"];
			};

			// undefined is true (for upgrades), and AI teams are always true
			t.autoTicketPrice =
				t.autoTicketPrice !== false || !g.get("userTids").includes(inputs.tid);

			// Undo reverse from above
			const teamSeasonsLastThree = teamSeasons.slice(0, 3).reverse();
			t.expenseLevelsLastThree = {
				coaching: await finances.getLevelLastThree("coaching", {
					tid: inputs.tid,
					teamSeasons: teamSeasonsLastThree,
				}),
				facilities: await finances.getLevelLastThree("facilities", {
					tid: inputs.tid,
					teamSeasons: teamSeasonsLastThree,
				}),
				health: await finances.getLevelLastThree("health", {
					tid: inputs.tid,
					teamSeasons: teamSeasonsLastThree,
				}),
				scouting: await finances.getLevelLastThree("scouting", {
					tid: inputs.tid,
					teamSeasons: teamSeasonsLastThree,
				}),
			};

			const maxStadiumCapacity = teamSeasons.reduce((max, teamSeason) => {
				if (teamSeason.stadiumCapacity > max) {
					return teamSeason.stadiumCapacity;
				}

				return max;
			}, 0);

			const autoTicketPrice = await getAutoTicketPriceByTid(inputs.tid);

			const otherTeamTicketPrices = [];
			const teams = await idb.cache.teams.getAll();
			for (const t of teams) {
				if (!t.disabled && t.tid !== inputs.tid) {
					if (t.autoTicketPrice) {
						otherTeamTicketPrices.push(await getAutoTicketPriceByTid(t.tid));
					} else {
						otherTeamTicketPrices.push(t.budget.ticketPrice);
					}
				}
			}
			otherTeamTicketPrices.sort((a, b) => b - a);

			// Front Office Budget (setting): the departments, the owner's envelope and the season review. Undefined when off
			const frontOfficeInfo = frontOfficeEnabled()
				? await getFinancesInfo(inputs.tid)
				: undefined;
			const frontOffice = frontOfficeInfo
				? {
						...frontOfficeInfo,
						scouts: departmentSize(t.expenseLevelsLastThree.scouting),
						scheduleLoad: featureOn("scheduleLoad"),
						combine: featureOn("lotteryNight"),
						injuryDepth: !!g.get("injuryDepth"),
						coachSystems: featureOn("coachSystems") && !!g.get("coachingStaff"),
					}
				: undefined;

			return {
				frontOffice,
				autoTicketPrice,
				tid: inputs.tid,
				show: inputs.show,
				minPayrollAmount,
				luxuryTaxAmount,
				repeaterTax,
				capExceptions,
				maxStadiumCapacity,
				t,
				barData,
				payroll,
				contracts,
				contractTotals,
				salariesSeasons,
				otherTeamTicketPrices,
				coachingStaff: __SPORT === "basketball" && !!g.get("coachingStaff"),
			};
		}
	},
});
