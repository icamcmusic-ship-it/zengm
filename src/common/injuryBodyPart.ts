// Body part for an injury name, used for injury history and for re-injuries of the same body part (injuryDepth setting). Custom injury names that match nothing get "Other".

const BODY_PARTS: [string, RegExp][] = [
	["Knee", /\b(acl|mcl|pcl|knee|kneecap|meniscus|patellar)\b/i],
	["Ankle", /\b(ankle|achilles|peroneal)\b/i],
	["Foot", /\b(foot|toe|plantar)\b/i],
	["Leg", /\b(leg|calf|hamstring|quadriceps|shin)\b/i],
	["Hip/Groin", /\b(hip|groin|tailbone|flexor)\b/i],
	["Back", /\b(back|disc|spine)\b/i],
	["Torso", /\b(rib|ribs|abdomen|oblique|esh?ophagus|chest|heart)\b/i],
	["Shoulder", /\b(shoulder|collarbone|rotator)\b/i],
	["Arm", /\b(arm|bicep|tricep|elbow)\b/i],
	["Hand", /\b(hand|wrist|finger|thumb)\b/i],
	[
		"Head",
		/\b(head|concussion|neck|whiplash|face|facial|eye|eyelid|orbital|nose|jaw|cheekbone|tooth|throat|seizure)\b/i,
	],
];

export const injuryBodyPart = (type: string): string => {
	for (const [part, regex] of BODY_PARTS) {
		if (regex.test(type)) {
			return part;
		}
	}
	return "Other";
};
