// Worker API for the Milestones dashboard card (League extras, basketball)
import { featureOn } from "../util/nativeFeatures.ts";
import { getMilestoneCard } from "../util/recordsBookData.ts";

const milestoneCard = async () => {
	if (__SPORT !== "basketball" || !featureOn("milestones")) {
		return undefined;
	}
	return await getMilestoneCard();
};

export default { milestoneCard };
