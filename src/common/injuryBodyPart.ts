// Body part for an injury name, used for injury history and for re-injuries of the same body part (injuryDepth setting). Custom injury names that match nothing get "Other".

// Stock names, plus common synonyms and plurals so a league's custom injury names ("Torn Quad", "Broken Toes", "Sore Lower Back") find
// their body part too
const BODY_PARTS: [string, RegExp][] = [
	["Knee", /\b(acl|mcl|pcl|lcl|knees?|kneecaps?|meniscus|patellar?)\b/i],
	["Ankle", /\b(ankles?|achilles|peroneal)\b/i],
	["Foot", /\b(foot|feet|toes?|plantar|heels?|metatarsals?|arch)\b/i],
	[
		"Leg",
		/\b(legs?|calf|calves|hamstrings?|quadriceps|quads?|shins?|thighs?|femur|tibia|fibula)\b/i,
	],
	["Hip/Groin", /\b(hips?|groin|tailbone|flexor|pelvis|adductor)\b/i],
	["Back", /\b(back|disc|spine|spinal|lumbar|vertebrae?)\b/i],
	[
		"Torso",
		/\b(rib|ribs|abdomen|abdominal|oblique|esh?ophagus|chest|heart|sternum|pectoral|pec)\b/i,
	],
	["Shoulder", /\b(shoulders?|collarbone|clavicle|rotator|labrum)\b/i],
	["Arm", /\b(arms?|biceps?|triceps?|elbows?|forearms?)\b/i],
	["Hand", /\b(hands?|wrists?|fingers?|thumbs?|knuckles?|metacarpals?)\b/i],
	[
		"Head",
		/\b(head|concussion|neck|whiplash|face|facial|eyes?|eyelid|orbital|nose|jaw|cheekbone|tooth|teeth|throat|seizure|skull|ear|lip)\b/i,
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
