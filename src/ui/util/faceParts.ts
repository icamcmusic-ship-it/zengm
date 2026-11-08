// UI side of the fork's face parts (common/faceParts.ts): the browser setting that registers the example parts at startup.
import {
	FORK_FACE_PARTS_SETTING,
	registerForkFaceParts,
} from "../../common/faceParts.ts";
import { safeLocalStorage } from "./safeLocalStorage.ts";

export const getForkFacePartsSetting = () => {
	try {
		return safeLocalStorage.getItem(FORK_FACE_PARTS_SETTING) === "1";
	} catch {
		return false;
	}
};

export const setForkFacePartsSetting = (on: boolean) => {
	try {
		if (on) {
			safeLocalStorage.setItem(FORK_FACE_PARTS_SETTING, "1");
		} else {
			safeLocalStorage.removeItem(FORK_FACE_PARTS_SETTING);
		}
	} catch {}
	if (on) {
		registerForkFaceParts();
	}
};

export const initForkFaceParts = () => {
	if (getForkFacePartsSetting()) {
		registerForkFaceParts();
	}
};
