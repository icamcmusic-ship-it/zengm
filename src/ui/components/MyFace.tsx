import type { FaceConfig } from "facesjs";
import { Face } from "facesjs/react";
import { useMemo } from "react";
import { prepareFaceForDisplay } from "../../common/faceRender.ts";
import { DEFAULT_JERSEY, DEFAULT_TEAM_COLORS } from "../../common/constants.ts";
import { useFeatureOn } from "../util/nativeFeatures.ts";

const isChristmas = () => {
	const now = new Date();
	return now.getMonth() === 11 && now.getDate() === 25;
};

export const MyFace = ({
	colors = DEFAULT_TEAM_COLORS,
	face,
	jersey = DEFAULT_JERSEY,
	lazy,
}: {
	colors?: [string, string, string];
	face: FaceConfig;
	jersey?: string;
	lazy?: boolean;
}) => {
	let overrides;
	if (__SPORT === "baseball") {
		const [jerseyId, accessoryId] = jersey.split(":");
		overrides = {
			teamColors: colors,
			jersey: {
				id: jerseyId!,
			},
			accessories: {
				id: accessoryId!,
			},
		};
	} else {
		overrides = {
			teamColors: colors,
			jersey: {
				id: jersey,
			},
		};
	}

	if (isChristmas()) {
		overrides.accessories = { id: "santa-hat" };
	}

	// Facial hair fitted to the head's jaw (common/faceFit.ts) with League Extras "New Face Styles" or "Face Aging" on
	const forkFacesOn = useFeatureOn("forkFaces");
	const faceAgingOn = useFeatureOn("faceAging");
	const fitFacialHair = forkFacesOn || faceAgingOn;
	const displayFace = useMemo(
		() => prepareFaceForDisplay(face, { fitFacialHair }),
		[face, fitFacialHair],
	);

	return (
		<Face
			face={displayFace}
			ignoreDisplayErrors
			lazy={lazy}
			overrides={overrides}
			style={{
				aspectRatio: "2/3",
			}}
		/>
	);
};
