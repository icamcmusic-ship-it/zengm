// Whether the expandedRatings setting is on, readable from anywhere without importing g (ovr and skills are imported very early, and g
// pulls in the whole worker). g.ts registers the getter when it loads.
let getter: () => boolean = () => false;

export const setExpandedRatingsGetter = (fn: () => boolean) => {
	getter = fn;
};

// Hot path (ovr, monteCarloPot), so a plain game attribute read rather than the registry lookup. Missing attribute = off, the registry
// default for existing leagues.
export const expandedRatingsOn = (): boolean => {
	if (__SPORT !== "basketball") {
		return false;
	}
	try {
		return getter();
	} catch {
		return false;
	}
};
