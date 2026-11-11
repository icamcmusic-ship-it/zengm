// Whether the ovrV2 (Sim-Calibrated Ovr) and realisticAging settings are on, readable from anywhere without importing g (ovr and
// developSeason are imported very early, and g pulls in the whole worker). g.ts registers the getters when it loads. Like
// expandedRatingsSwitch.ts: a plain game attribute read (hot path: ovr, monteCarloPot), missing attribute = off.
let ovrV2Getter: () => boolean = () => false;
let realisticAgingGetter: () => boolean = () => false;

export const setRatingsModelGetters = (fns: {
	ovrV2: () => boolean;
	realisticAging: () => boolean;
}) => {
	ovrV2Getter = fns.ovrV2;
	realisticAgingGetter = fns.realisticAging;
};

const read = (getter: () => boolean) => {
	if (__SPORT !== "basketball") {
		return false;
	}
	try {
		return getter();
	} catch {
		return false;
	}
};

export const ovrV2On = (): boolean => read(ovrV2Getter);

export const realisticAgingOn = (): boolean => read(realisticAgingGetter);
