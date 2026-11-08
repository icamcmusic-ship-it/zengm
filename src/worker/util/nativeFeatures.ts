// Worker side of the League extras toggles (registry: common/nativeFeatures.ts)
import g from "./g.ts";
import {
	getNativeFeature,
	nativeFeatureAvailableInSport,
	nativeFeatureEnabled,
	nativeFeatureOption,
	type NativeFeatureId,
	type NativeFeatureOptionKey,
} from "../../common/nativeFeatures.ts";

const get = (key: string) => {
	try {
		return g.get(key as any);
	} catch {
		// No league loaded (or the attribute is missing): fall back to the registry default
		return undefined;
	}
};

export const featureOn = (id: NativeFeatureId) => nativeFeatureEnabled(id, get);

export const featureOption = <T extends boolean | number | string>(
	key: NativeFeatureOptionKey,
) => nativeFeatureOption<T>(key, get);

// For views of League extras pages: an error page while the feature is off, else undefined
export const featureOffError = (id: NativeFeatureId) => {
	if (featureOn(id)) {
		return undefined;
	}
	const f = getNativeFeature(id);
	return {
		errorMessage: nativeFeatureAvailableInSport(f, __SPORT)
			? `${f.name} is turned off for this league. You can turn it on in League Extras (Tools menu).`
			: `${f.name} is not available in this sport.`,
	};
};
