// Face styles groundwork: a thin wrapper around facesjs (Apache-2.0, see node_modules/facesjs/LICENSE) that lets this fork add
// extra SVG part options (hair, eyes, facial hair, accessories, ...) without touching existing faces.
//
// facesjs draws a feature by looking its id up in the exported `svgs` object, and lists the ids in `svgsIndex`. Registering a
// part appends an id to both. It is append-only: an id facesjs (or an earlier registration) already has is never replaced, so
// every existing face renders exactly as before. Registered parts are never picked by facesjs' generate(): its random picks
// filter ids by a gender table that is internal to facesjs, and appended ids have no entry there. So a fork part only shows
// on a face whose config names it (set by hand, or by future fork code).
//
// Fork ids are prefixed "fork-" so they can't clash with future facesjs ids.
import { svgs, svgsIndex } from "facesjs";

export type FacePartFeature =
	| "accessories"
	| "eye"
	| "eyebrow"
	| "facialHair"
	| "glasses"
	| "hair"
	| "hairBg"
	| "head"
	| "mouth"
	| "nose";

export type FacePart = {
	feature: FacePartFeature;
	id: string;
	// SVG markup in facesjs' 400x600 face coordinates, with its placeholders ($[hairColor], $[skinColor], $[primary], ...)
	svg: string;
};

export const FORK_PART_PREFIX = "fork-";

const svgsTable = svgs as unknown as Record<string, Record<string, string>>;
const indexTable = svgsIndex as unknown as Record<string, string[]>;

const registered = new Map<string, FacePart>();

// Ids facesjs ships with, recorded before anything is registered (for the gallery and the append-only check)
const BUILTIN_IDS: Record<string, readonly string[]> = Object.fromEntries(
	Object.entries(indexTable).map(([feature, ids]) => [feature, [...ids]]),
);

export const builtinFacePartIds = (feature: FacePartFeature) =>
	BUILTIN_IDS[feature] ?? [];

export const registerFacePart = (part: FacePart) => {
	if (!part.id.startsWith(FORK_PART_PREFIX)) {
		throw new Error(`Fork face part ids start with "${FORK_PART_PREFIX}"`);
	}
	const table = svgsTable[part.feature];
	const index = indexTable[part.feature];
	if (!table || !index) {
		throw new Error(`Unknown face feature "${part.feature}"`);
	}
	if (BUILTIN_IDS[part.feature]?.includes(part.id)) {
		throw new Error(`"${part.id}" is a facesjs ${part.feature} id`);
	}
	const key = `${part.feature}/${part.id}`;
	if (registered.has(key)) {
		// Append-only: the first registration wins
		return false;
	}
	registered.set(key, part);
	table[part.id] = part.svg;
	if (!index.includes(part.id)) {
		index.push(part.id);
	}
	return true;
};

export const isFacePartRegistered = (feature: FacePartFeature, id: string) =>
	registered.has(`${feature}/${id}`);

export const registeredFaceParts = () => [...registered.values()];

// Example parts (proof of the registry): simple hair styles, drawn like facesjs' "short" (fill $[hairColor], black outline)
export const FORK_FACE_PARTS: readonly FacePart[] = [
	{
		feature: "hair",
		id: "fork-flat-top",
		svg: '<path fill="$[hairColor]" stroke="#000" stroke-width="4" d="M60 310H50V150c0-30 20-55 55-58l45-4h100l45 4c35 3 55 28 55 58v160h-10v-20c0-5-10-20-15-25s-5-50-15-60c-20-15-60-20-110-20s-90 5-110 20c-10 10-10 55-15 60s-15 20-15 25z"/>',
	},
	{
		feature: "hair",
		id: "fork-mohawk",
		svg: '<path fill="$[hairColor]" stroke="#000" stroke-width="4" d="M172 205c-4-40-6-80 4-108 6-18 14-26 24-30 10 4 18 12 24 30 10 28 8 68 4 108-10-4-18-5-28-5s-18 1-28 5z"/>',
	},
	{
		feature: "hair",
		id: "fork-buzz",
		svg: '<path fill="$[hairColor]" fill-opacity=".55" d="M60 300v-10c0-5 10-20 15-25s5-55 15-65c25-30 60-40 110-40s85 10 110 40c10 10 10 60 15 65s15 20 15 25v10h-6c-2-30-14-120-134-120S68 270 66 300z"/>',
	},
];

export const registerForkFaceParts = () => {
	for (const part of FORK_FACE_PARTS) {
		registerFacePart(part);
	}
};

// Browser setting (UI only, default off): whether the fork's example parts are registered in this browser at startup, so faces
// that name them render them. The Face style gallery shows them either way.
export const FORK_FACE_PARTS_SETTING = "forkFaceParts";
