// A coach's or general manager's face: the stored facesjs face, dressed in a suit instead of the team's jersey when it is drawn
// (common/faceParts.suits.ts), so staff saved before suits existed get one too. Players keep MyFace / PlayerPicture.
import type { FaceConfig } from "facesjs";
import { Face } from "facesjs/react";
import { useMemo } from "react";
import { staffFaceOverrides } from "../../common/faceParts.suits.ts";
import {
	agedFields,
	applyAgingFields,
	extractAgingFields,
	type FaceAgingOptions,
} from "../../common/faceAging.ts";
import { prepareFaceForDisplay } from "../../common/faceRender.ts";
import { useFeatureOn, useFeatureOption } from "../util/nativeFeatures.ts";

export const StaffFace = ({
	age,
	colors,
	face,
	lazy,
	seed,
}: {
	age?: number;
	// The team's colours, for the tie / pin. Leave out for staff without a team
	colors?: [string, string, string];
	face: FaceConfig;
	lazy?: boolean;
	// Something stable for the person (cid, gmid, name), so he always wears the same suit
	seed?: number | string;
}) => {
	const [c0, c1, c2] = colors ?? [];

	// League Extras "Face Aging": staff age the same way as players (hairline, grey, lines), worked out when drawn from
	// their age, so nothing is stored. Their beard style is left alone.
	const agingOn = useFeatureOn("faceAging");
	const speed = useFeatureOption<FaceAgingOptions["speed"]>("faceAgingSpeed");
	const hairLoss = useFeatureOption<boolean>("faceAgingHairLoss");
	const graying = useFeatureOption<boolean>("faceAgingGraying");
	const aged = agingOn && age !== undefined && seed !== undefined;
	const drawnFace = useMemo(
		() =>
			prepareFaceForDisplay(
				aged
					? applyAgingFields(
							face,
							agedFields(
								extractAgingFields(face),
								{ seed: `staff|${seed}`, age, born: 0, staff: true },
								{ speed, hairLoss, graying },
							),
						)
					: face,
			),
		[aged, age, face, graying, hairLoss, seed, speed],
	);

	const overrides = staffFaceOverrides(face, {
		// Greyed above when aging is on
		age: aged ? undefined : age,
		colors:
			c0 !== undefined && c1 !== undefined && c2 !== undefined
				? [c0, c1, c2]
				: undefined,
		seed,
	});

	return (
		<Face
			face={drawnFace}
			ignoreDisplayErrors
			lazy={lazy}
			overrides={overrides}
			style={{
				aspectRatio: "2/3",
			}}
		/>
	);
};
