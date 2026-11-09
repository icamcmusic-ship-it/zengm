import useTitleBar from "../hooks/useTitleBar.tsx";
import type { View } from "../../common/types.ts";
import SettingsForm from "./Settings/SettingsForm.tsx";
import { showNotification } from "../util/showNotification.ts";
import { toWorker } from "../util/toWorker.ts";
import { useBlocker } from "../hooks/useBlocker.ts";
import {
	nativeFeatureKeysOtherSports,
	NATIVE_FEATURE_SETTING_KEYS,
} from "../../common/nativeFeatures.ts";
import type { Category, Key } from "./Settings/types.ts";

const otherSports = new Set<string>(nativeFeatureKeysOtherSports());
const shown = NATIVE_FEATURE_SETTING_KEYS.filter(
	(key) => !otherSports.has(key),
) as Key[];

// "League extras: Players" -> "Players", since the whole tab is League extras
const categoryTitle = (name: Category) =>
	name === "League extras" ? "General" : name.replace(/^League extras: /, "");

// The League Extras tab of League Settings (the League Settings tab leaves these settings out)
const LeagueExtras = ({ initialSettings }: View<"leagueExtras">) => {
	useTitleBar({ title: "League Settings" });

	const { setDirty } = useBlocker();

	return (
		<>
			<p>
				Turn this fork's extra features on or off for this league. A feature
				that is off disappears from the menus, links and dashboard, and its
				background work stops.
			</p>
			<SettingsForm
				initialSettings={initialSettings}
				settingsShown={shown}
				hideShortcuts
				hideGodModeToggle
				categoryTitle={categoryTitle}
				onUpdateExtra={() => {
					setDirty(true);
				}}
				onSave={async (settings) => {
					// Only the League extras keys: the form leaves the other settings out, and
					// updateGameAttributesGodMode would read missing ones (like repeatSeason) as changes
					const gameAttributes: Record<string, unknown> = {};
					for (const key of shown) {
						if (Object.hasOwn(settings, key)) {
							gameAttributes[key] = settings[key as keyof typeof settings];
						}
					}
					await toWorker("main", "updateGameAttributes", gameAttributes);

					setDirty(false);

					showNotification({
						type: "success",
						text: "League extras successfully updated.",
					});
				}}
			/>
		</>
	);
};

export default LeagueExtras;
