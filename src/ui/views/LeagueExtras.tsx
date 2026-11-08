import useTitleBar from "../hooks/useTitleBar.tsx";
import type { View } from "../../common/types.ts";
import SettingsForm from "./Settings/SettingsForm.tsx";
import { showNotification } from "../util/showNotification.ts";
import { toWorker } from "../util/toWorker.ts";
import { useBlocker } from "../hooks/useBlocker.ts";
import { helpers } from "../util/helpers.ts";
import {
	nativeFeatureKeysOtherSports,
	NATIVE_FEATURE_SETTING_KEYS,
} from "../../common/nativeFeatures.ts";
import type { Key } from "./Settings/types.ts";

const otherSports = new Set<string>(nativeFeatureKeysOtherSports());
const shown = NATIVE_FEATURE_SETTING_KEYS.filter(
	(key) => !otherSports.has(key),
) as Key[];

// The League extras category of League Settings on its own page
const LeagueExtras = ({ initialSettings }: View<"leagueExtras">) => {
	useTitleBar({ title: "League Extras" });

	const { setDirty } = useBlocker();

	return (
		<>
			<p>
				Turn this fork's extra features on or off for this league. A feature
				that is off disappears from the menus, links and dashboard, and its
				background work stops. These are also in{" "}
				<a href={helpers.leagueUrl(["settings"])}>League Settings</a>.
			</p>
			<SettingsForm
				initialSettings={initialSettings}
				settingsShown={shown}
				hideShortcuts
				hideGodModeToggle
				onUpdateExtra={() => {
					setDirty(true);
				}}
				onSave={async (settings) => {
					await toWorker("main", "updateGameAttributesGodMode", settings);

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
