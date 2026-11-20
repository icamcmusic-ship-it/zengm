import { defaultGameAttributes } from "../../common/defaultGameAttributes.ts";
import type { GameAttributesLeague } from "../../common/types.ts";
import { getAwardCandidates as getAwardCandidatesRaw } from "../core/awards/getAwardCandidates.ts";
import {
	AWARD_STATS_ALL,
	PLAYOFF_SERIES_AWARD_STATS_ALL,
} from "../core/awards/getPlayers.ts";
import g from "../util/g.ts";
import {
	COACH_EXEC_AWARD_NAMES,
	COACH_EXEC_VARIABLE_DOCS,
	COY_VARIABLES,
	EOY_VARIABLES,
	type CoachExecAwardFormulas,
} from "../../common/coachExecAwards.ts";
import {
	coyAvailable,
	defaultFormula,
	eoyAvailable,
	getCoachExecFormula,
	getCoachExecRaces,
	validateCoachExecFormula,
} from "../core/awards/coachExecAwards.ts";
import { league } from "../core/index.ts";
import {
	advStatsOn,
	isTrackingAwardVar,
	trackingVariableDocs,
} from "../core/awards/trackingAwards.ts";

export const getAwardCandidates = async (
	info:
		| {
				type: "season";
				season: number;
		  }
		| {
				type: "default";
				season: number;
		  }
		| {
				type: "custom";
				season: number;
				awards: GameAttributesLeague["awards"];
		  },
) => {
	const season = info.season;
	const awards =
		info.type === "season"
			? g.get("awards")
			: info.type === "default"
				? defaultGameAttributes.awards
				: info.awards;
	return await getAwardCandidatesRaw(season, awards);
};

export const getVariables = () => {
	// Advanced Tracking Stats variables are listed on their own, grouped
	const normalSet = new Set(
		AWARD_STATS_ALL.filter((key) => !isTrackingAwardVar(key)),
	);
	const playoffSeriesSet = new Set(
		PLAYOFF_SERIES_AWARD_STATS_ALL.filter((key) => !isTrackingAwardVar(key)),
	);

	const common = Array.from(normalSet.intersection(playoffSeriesSet));
	const normalOnly = Array.from(normalSet.difference(playoffSeriesSet));
	const playoffSeriesOnly = Array.from(playoffSeriesSet.difference(normalSet));

	const tracking =
		__SPORT === "basketball" ? trackingVariableDocs() : undefined;

	return {
		common,
		normalOnly,
		playoffSeriesOnly,
		tracking,
		advStatsOn: advStatsOn(),
	};
};

// Coach of the Year and Executive of the Year (built in): their formulas, a preview of each race with formulas being edited, and
// errors for invalid ones
export const getCoachExecAwardSettings = async ({
	season,
	formulas,
}: {
	season: number;
	formulas?: CoachExecAwardFormulas;
}) => {
	const errors: CoachExecAwardFormulas = {};
	const valid: CoachExecAwardFormulas = {};
	for (const kind of ["coy", "eoy"] as const) {
		const formula = formulas?.[kind];
		if (formula !== undefined) {
			const error = validateCoachExecFormula(kind, formula);
			if (error !== undefined) {
				errors[kind] = error;
			} else {
				valid[kind] = formula;
			}
		}
	}
	const races = await getCoachExecRaces(season, {
		formulas: valid,
		limit: 5,
	});
	return {
		available: { coy: coyAvailable(), eoy: eoyAvailable() },
		defaults: { coy: defaultFormula("coy"), eoy: defaultFormula("eoy") },
		formulas: {
			coy: getCoachExecFormula("coy"),
			eoy: getCoachExecFormula("eoy"),
		},
		errors,
		races,
		variables: { coy: [...COY_VARIABLES], eoy: [...EOY_VARIABLES] },
		variableDocs: COACH_EXEC_VARIABLE_DOCS,
	};
};

// Save the formulas (a default one is saved as undefined, so it follows future changes to the default)
export const saveCoachExecAwardFormulas = async (
	formulas: CoachExecAwardFormulas,
) => {
	const toSave: CoachExecAwardFormulas = {};
	for (const kind of ["coy", "eoy"] as const) {
		const formula = formulas[kind]?.trim();
		if (formula === undefined || formula === "") {
			continue;
		}
		const error = validateCoachExecFormula(kind, formula);
		if (error !== undefined) {
			throw new Error(`${COACH_EXEC_AWARD_NAMES[kind]}: ${error}`);
		}
		if (formula !== defaultFormula(kind)) {
			toSave[kind] = formula;
		}
	}
	await league.setGameAttributes({
		coachExecAwardFormulas:
			toSave.coy !== undefined || toSave.eoy !== undefined ? toSave : undefined,
	});
};
