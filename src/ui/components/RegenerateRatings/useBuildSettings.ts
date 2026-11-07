import { useCallback } from "react";
import useLocalStorageState from "use-local-storage-state";
import {
	DEFAULT_SETTINGS,
	normalizeSettings,
	type BuildSettings,
} from "../../../common/ratingsBuilds/settings.ts";

export const mintSeed = () => Math.random().toString(36).slice(2, 8);

// Minted once, so a first visit opens on a seed of its own rather than the same one for everybody
const FIRST_SEED = mintSeed();

// The settings are remembered between visits, like every other preference in the game (the seed too, so the page opens on
// the class you were looking at)
export const useBuildSettings = (storageKey: string) => {
	const [stored, setStored] = useLocalStorageState<Partial<BuildSettings>>(
		storageKey,
		{
			defaultValue: { ...DEFAULT_SETTINGS, seed: FIRST_SEED },
		},
	);

	const settings = normalizeSettings(stored);

	const update = useCallback(
		(patch: Partial<BuildSettings>) => {
			setStored((prev) => normalizeSettings({ ...prev, ...patch }));
		},
		[setStored],
	);

	const reset = useCallback(() => {
		setStored(normalizeSettings({ seed: mintSeed() }));
	}, [setStored]);

	return { settings, update, reset };
};
