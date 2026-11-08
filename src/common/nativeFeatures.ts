// League extras registry, bound to the current sport. The registry itself is in common/nativeFeatures.ts (root).
import {
	nativeFeatureEnabledForSport,
	nativeFeatureKeysOtherSportsFor,
	nativeFeatureOptionForSport,
	type NativeFeatureId,
	type NativeFeatureOptionKey,
} from "../../common/nativeFeatures.ts";

export * from "../../common/nativeFeatures.ts";

export const nativeFeatureKeysOtherSports = () =>
	nativeFeatureKeysOtherSportsFor(__SPORT);

export const nativeFeatureEnabled = (
	id: NativeFeatureId,
	get: (key: string) => unknown,
) => nativeFeatureEnabledForSport(id, get, __SPORT);

export const nativeFeatureOption = <T extends boolean | number>(
	key: NativeFeatureOptionKey,
	get: (key: string) => unknown,
) => nativeFeatureOptionForSport<T>(key, get, __SPORT);
