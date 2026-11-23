import { g } from "../../util/index.ts";
import { featureOn } from "../../util/nativeFeatures.ts";

export const ownerOfficeEnabled = () =>
	__SPORT === "basketball" && featureOn("ownerOffice") && !!g.get("budget");
