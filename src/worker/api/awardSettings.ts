import { defaultGameAttributes } from "../../common/defaultGameAttributes.ts";
import {
	awardSettingsSchema,
	type GameAttributesLeague,
} from "../../common/types.ts";
import { MAX_STAT_COLS } from "../core/awards/keyStats.ts";
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
	validCoachExecStatCols,
	type CoachExecAwardFormulas,
} from "../../common/coachExecAwards.ts";
import {
	coachExecStatCols,
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
	return await getAwardCandidatesRaw(season, awards, { pickerStats: true });
};

// The Columns menu of Award Races and Award History: save the stat columns chosen for one award into its award setting (statCols),
// the same setting Award Settings edits. undefined or empty goes back to the automatic choice. Keys are kept as given (strings,
// no duplicates, at most MAX_STAT_COLS) and validated against the award's stats when shown, so a key the award can't show is just
// skipped. Returns false if the award is not in the league's award settings (like an award removed since)
export const saveAwardStatCols = async ({
	shortName,
	statCols,
}: {
	shortName: string;
	statCols: string[] | undefined;
}) => {
	const awards = g.get("awards");
	const index = awards.findIndex((award) => award.shortName === shortName);
	if (index < 0) {
		return false;
	}

	const cleaned = Array.from(
		new Set(
			(statCols ?? []).filter(
				(stat): stat is string => typeof stat === "string" && stat !== "",
			),
		),
	).slice(0, MAX_STAT_COLS);

	const award = { ...awards[index]! };
	if (cleaned.length > 0) {
		award.statCols = cleaned;
	} else {
		delete award.statCols;
	}

	const newAwards = awards.with(index, award);
	const result = awardSettingsSchema.safeParse(newAwards);
	if (!result.success) {
		throw new Error(result.error.message);
	}

	await league.setGameAttributes({ awards: result.data });
	return true;
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

const COACH_EXEC_KINDS = ["coy", "eoy"] as const;

// The saved column choices of Coach/Executive of the Year, validated (undefined: all variables)
const savedCoachExecStatCols = () => {
	const statCols: NonNullable<CoachExecAwardFormulas["statCols"]> = {};
	for (const kind of COACH_EXEC_KINDS) {
		const valid = coachExecStatCols(kind);
		if (valid) {
			statCols[kind] = valid;
		}
	}
	return Object.keys(statCols).length > 0 ? statCols : undefined;
};

// Coach of the Year and Executive of the Year (built in): their formulas, a preview of each race with formulas (and columns) being
// edited, and errors for invalid ones
export const getCoachExecAwardSettings = async ({
	season,
	formulas,
}: {
	season: number;
	formulas?: CoachExecAwardFormulas;
}) => {
	const errors: CoachExecAwardFormulas = {};
	const valid: CoachExecAwardFormulas = {};
	for (const kind of COACH_EXEC_KINDS) {
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
		statCols: formulas ? (formulas.statCols ?? {}) : undefined,
	});
	return {
		available: { coy: coyAvailable(), eoy: eoyAvailable() },
		defaults: { coy: defaultFormula("coy"), eoy: defaultFormula("eoy") },
		formulas: {
			coy: getCoachExecFormula("coy"),
			eoy: getCoachExecFormula("eoy"),
			statCols: savedCoachExecStatCols(),
		},
		errors,
		races,
		variables: { coy: [...COY_VARIABLES], eoy: [...EOY_VARIABLES] },
		variableDocs: COACH_EXEC_VARIABLE_DOCS,
	};
};

const saveCoachExec = async (toSave: CoachExecAwardFormulas) => {
	await league.setGameAttributes({
		coachExecAwardFormulas:
			toSave.coy !== undefined ||
			toSave.eoy !== undefined ||
			toSave.statCols !== undefined
				? toSave
				: undefined,
	});
};

// Save the formulas (a default one is saved as undefined, so it follows future changes to the default), and the columns (statCols,
// kept as saved when not given)
export const saveCoachExecAwardFormulas = async (
	formulas: CoachExecAwardFormulas,
) => {
	const toSave: CoachExecAwardFormulas = {};
	for (const kind of COACH_EXEC_KINDS) {
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

	const statCols: NonNullable<CoachExecAwardFormulas["statCols"]> = {};
	for (const kind of COACH_EXEC_KINDS) {
		const valid =
			"statCols" in formulas
				? validCoachExecStatCols(kind, formulas.statCols?.[kind])
				: coachExecStatCols(kind);
		if (valid) {
			statCols[kind] = valid;
		}
	}
	if (Object.keys(statCols).length > 0) {
		toSave.statCols = statCols;
	}

	await saveCoachExec(toSave);
};

// The Columns menu of Coach/Executive of the Year on Award Races: save its columns only (undefined or empty: all variables)
export const saveCoachExecStatCols = async ({
	kind,
	statCols,
}: {
	kind: "coy" | "eoy";
	statCols: string[] | undefined;
}) => {
	const current: CoachExecAwardFormulas = {
		...g.get("coachExecAwardFormulas"),
	};
	const all = { ...savedCoachExecStatCols() };
	const valid = validCoachExecStatCols(kind, statCols);
	if (valid) {
		all[kind] = valid;
	} else {
		delete all[kind];
	}
	if (Object.keys(all).length > 0) {
		current.statCols = all;
	} else {
		delete current.statCols;
	}
	await saveCoachExec(current);
};
