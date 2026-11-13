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
import { textureOf } from "../../common/faceEvents.ts";
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
	// their id and age, so nothing is stored and a coach looks the same every time he's drawn in a season, and older the next.
	// Coaches and GMs are their own people (not former players), so this is their whole history. With "Style Events", now
	// and then a new hairstyle or beard and, with the years, glasses (common/faceEvents.ts); the per-age draws are keyed by
	// age (born 0), so they don't depend on the season.
	const agingOn = useFeatureOn("faceAging");
	const speed = useFeatureOption<FaceAgingOptions["speed"]>("faceAgingSpeed");
	const hairLoss = useFeatureOption<boolean>("faceAgingHairLoss");
	const graying = useFeatureOption<boolean>("faceAgingGraying");
	const styleEvents = useFeatureOption<boolean>("faceAgingStyleEvents");
	const aged = agingOn && age !== undefined && seed !== undefined;
	const drawnFace = useMemo(
		() =>
			prepareFaceForDisplay(
				aged
					? applyAgingFields(
							face,
							agedFields(
								extractAgingFields(face),
								{
									seed: `staff|${seed}`,
									age,
									born: 0,
									staff: true,
									texture: textureOf(
										face.body?.color,
										face.hair.id,
										face.hairBg?.id,
									),
								},
								{ speed, hairLoss, graying, styleEvents },
							),
						)
					: face,
			),
		[aged, age, face, graying, hairLoss, seed, speed, styleEvents],
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
