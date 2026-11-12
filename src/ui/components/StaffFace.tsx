// A coach's or general manager's face: the stored facesjs face, dressed in a suit instead of the team's jersey when it is drawn
// (common/faceParts.suits.ts), so staff saved before suits existed get one too. Players keep MyFace / PlayerPicture.
import type { FaceConfig } from "facesjs";
import { Face } from "facesjs/react";
import { staffFaceOverrides } from "../../common/faceParts.suits.ts";

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
	const overrides = staffFaceOverrides(face, {
		age,
		colors:
			c0 !== undefined && c1 !== undefined && c2 !== undefined
				? [c0, c1, c2]
				: undefined,
		seed,
	});

	return (
		<Face
			face={face}
			ignoreDisplayErrors
			lazy={lazy}
			overrides={overrides}
			style={{
				aspectRatio: "2/3",
			}}
		/>
	);
};
