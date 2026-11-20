// Range checks for the game simulation settings (Tendencies and Game Simulation), shared by the settings form and the worker, so a
// value that would break the sim (NaN clocks, every miss an offensive rebound, injuries times 10,000) can't be saved

// Settings that multiply a baseline rate: finite and >= 0
export const GAME_FACTOR_KEYS = new Set([
	"threePointTendencyFactor",
	"threePointAccuracyFactor",
	"twoPointAccuracyFactor",
	"ftAccuracyFactor",
	"blockFactor",
	"stealFactor",
	"turnoverFactor",
	"orbFactor",
	"foulRateFactor",
	"assistFactor",
	"passFactor",
	"rushYdsFactor",
	"passYdsFactor",
	"completionFactor",
	"scrambleFactor",
	"sackFactor",
	"fumbleFactor",
	"intFactor",
	"fgAccuracyFactor",
	"fourthDownFactor",
	"onsideFactor",
	"onsideRecoveryFactor",
	"foulFactor",
	"groundFactor",
	"lineFactor",
	"flyFactor",
	"powerFactor",
	"throwOutFactor",
	"strikeFactor",
	"balkFactor",
	"wildPitchFactor",
	"passedBallFactor",
	"hitByPitchFactor",
	"swingFactor",
	"contactFactor",
	"errorFactor",
	"deflectionFactor",
	"saveFactor",
	"hitFactor",
	"giveawayFactor",
	"takeawayFactor",
]);

export const PACE_MAX = 500;
export const HOME_COURT_MIN = -50;
export const HOME_COURT_MAX = 100;

// Throws an Error with a message for the settings form if the value is out of range. Keys it doesn't know, and non-numbers, pass
export const validateGameSimSetting = (key: string, value: unknown) => {
	if (typeof value !== "number") {
		return;
	}
	if (GAME_FACTOR_KEYS.has(key)) {
		if (!Number.isFinite(value) || value < 0) {
			throw new Error("Must be a number greater than or equal to 0");
		}
	} else if (key === "quarterLength") {
		if (!Number.isFinite(value) || value <= 0) {
			throw new Error("Value must be greater than 0");
		}
	} else if (key === "pace") {
		if (!Number.isFinite(value) || value <= 0 || value > PACE_MAX) {
			throw new Error(`Must be greater than 0 and at most ${PACE_MAX}`);
		}
	} else if (key === "homeCourtAdvantage") {
		if (
			!Number.isFinite(value) ||
			value < HOME_COURT_MIN ||
			value > HOME_COURT_MAX
		) {
			throw new Error(
				`Must be between ${HOME_COURT_MIN}% and ${HOME_COURT_MAX}%`,
			);
		}
	}
};

// Every game sim setting in a settings object (the worker's check before saving)
export const validateGameSimSettings = (settings: Record<string, unknown>) => {
	for (const [key, value] of Object.entries(settings)) {
		validateGameSimSetting(key, value);
	}
};
