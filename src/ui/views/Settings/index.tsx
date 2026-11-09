import useTitleBar from "../../hooks/useTitleBar.tsx";
import type { View } from "../../../common/types.ts";
import SettingsForm from "./SettingsForm.tsx";
import { showNotification } from "../../util/showNotification.ts";
import { toWorker } from "../../util/toWorker.ts";
import { useBlocker } from "../../hooks/useBlocker.ts";
import { NATIVE_FEATURE_SETTING_KEYS } from "../../../common/nativeFeatures.ts";
import { settings as allSettings } from "./settings.tsx";
import type { Key } from "./types.ts";

// League extras switches have their own tab (League Extras, views/LeagueExtras.tsx), so they're left out here. Only
// the shown keys are saved, so the other tab's settings are untouched.
const nativeKeys = new Set<string>(NATIVE_FEATURE_SETTING_KEYS);
const shown: Key[] = allSettings
	.map((setting) => setting.key)
	.filter((key) => !nativeKeys.has(key));

const Settings = ({ initialSettings }: View<"settings">) => {
	useTitleBar({ title: "League Settings" });

	const { setDirty } = useBlocker();

	return (
		<SettingsForm
			initialSettings={initialSettings}
			settingsShown={shown}
			onUpdateExtra={() => {
				setDirty(true);
			}}
			onSave={async (settings) => {
				await toWorker("main", "updateGameAttributesGodMode", settings);

				setDirty(false);

				showNotification({
					type: "success",
					text: "League settings successfully updated.",
				});
			}}
		/>
	);
};

export default Settings;
