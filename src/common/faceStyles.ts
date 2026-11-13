// Generation rules for the fork's face styles (League Extras "New Face Styles", key featureForkFaces): after facesjs picks a male
// face, its hair, facial hair and hair colour are re-picked from a catalogue that fits his hair texture (from his skin colour,
// facesjs' race palette), his age and a rarity tier, and the fork's other parts (eyes, noses, ears, lines, ...) are mixed in.
//
// Seeded from the face facesjs made (itself random), so this draws no random numbers of its own: no Math.random, no game
// randomness. Style frequency doesn't depend on the league's season. User choices are never touched: this runs only when a
// face is generated.
import type { FaceConfig } from "facesjs";
import { seededRandom, type FaceWithExtra } from "./faceAging.ts";
import { addRandomForkParts, type FacePart } from "./faceParts.ts";

export type Rarity = "common" | "uncommon" | "rare";
export type Texture = "coily" | "curly" | "straight";
// young: mostly players under 27; mature: more likely after 30
type AgeFit = "young" | "mature" | "any";

type HairStyle = {
	id: string;
	textures: readonly Texture[];
	rarity: Rarity;
	age?: AgeFit;
	// Drawn behind the head with it (long locs, braids, long hair)
	hairBg?: string;
};

export const RARITY_WEIGHT: Record<Rarity, number> = {
	common: 6,
	uncommon: 2,
	rare: 0.45,
};

const C: Texture[] = ["coily"];
const CU: Texture[] = ["curly"];
const S: Texture[] = ["straight"];
const SC: Texture[] = ["straight", "curly"];
const ALL: Texture[] = ["coily", "curly", "straight"];

// Hair (facesjs ids and the fork's). Receding / thinning hair is left to face aging.
export const HAIR_STYLES: readonly HairStyle[] = [
	// Short and faded, every texture
	{ id: "short-fade", textures: ALL, rarity: "common" },
	{ id: "short-fade-2", textures: ALL, rarity: "common" },
	{ id: "fork-buzz", textures: ALL, rarity: "uncommon" },
	{ id: "fork-low-fade", textures: ALL, rarity: "common" },
	{ id: "fork-high-fade", textures: ALL, rarity: "common" },
	{
		id: "fork-skin-fade-part",
		textures: ALL,
		rarity: "uncommon",
		age: "young",
	},
	{ id: "fork-high-tight", textures: ALL, rarity: "uncommon" },
	{ id: "fork-line-up", textures: C, rarity: "common" },
	{ id: "fork-line-up", textures: SC, rarity: "uncommon" },
	{ id: "bald", textures: ALL, rarity: "uncommon", age: "mature" },
	{ id: "fork-shaved-part", textures: C, rarity: "uncommon", age: "young" },
	{ id: "fork-shaved-part", textures: SC, rarity: "rare", age: "young" },
	{ id: "fork-side-design", textures: ALL, rarity: "rare", age: "young" },
	{ id: "fork-dyed-top", textures: C, rarity: "rare", age: "young" },
	{ id: "fork-grey-streak", textures: ALL, rarity: "rare" },
	// Coily
	{ id: "fork-waves-fade", textures: C, rarity: "common" },
	{ id: "fork-waves", textures: C, rarity: "uncommon" },
	{ id: "curlyFade1", textures: C, rarity: "common" },
	{ id: "curlyFade2", textures: C, rarity: "common" },
	{ id: "tall-fade", textures: C, rarity: "uncommon" },
	{ id: "high", textures: C, rarity: "rare", age: "young" },
	{ id: "fork-flat-top", textures: C, rarity: "rare" },
	{ id: "blowoutFade", textures: C, rarity: "uncommon", age: "young" },
	{ id: "fork-afro-small", textures: C, rarity: "uncommon" },
	{ id: "afro", textures: C, rarity: "uncommon" },
	{ id: "afro2", textures: C, rarity: "rare" },
	{ id: "fork-twists", textures: C, rarity: "uncommon", age: "young" },
	{ id: "fork-twists-fade", textures: C, rarity: "common", age: "young" },
	{ id: "fork-twists-medium", textures: C, rarity: "uncommon", age: "young" },
	{ id: "fork-starter-locs", textures: C, rarity: "common", age: "young" },
	{ id: "fork-locs-dyed", textures: C, rarity: "rare", age: "young" },
	{
		id: "fork-locs-top",
		textures: C,
		rarity: "uncommon",
		hairBg: "fork-locs-long",
	},
	{
		id: "fork-locs-top",
		textures: C,
		rarity: "rare",
		hairBg: "fork-locs-long-dyed",
		age: "young",
	},
	{
		id: "fork-locs-back",
		textures: C,
		rarity: "uncommon",
		hairBg: "fork-locs-long",
	},
	{
		id: "fork-locs-back",
		textures: C,
		rarity: "rare",
		hairBg: "fork-low-ponytail",
	},
	{ id: "dreads", textures: C, rarity: "uncommon" },
	{ id: "cornrows", textures: C, rarity: "uncommon" },
	{ id: "fork-cornrows-zigzag", textures: C, rarity: "rare", age: "young" },
	{ id: "fork-box-braids", textures: C, rarity: "uncommon", age: "young" },
	{
		id: "fork-box-braids",
		textures: C,
		rarity: "uncommon",
		age: "young",
		hairBg: "fork-box-braids-long",
	},
	{ id: "fork-braids-bun", textures: C, rarity: "rare", age: "young" },
	{ id: "fork-bantu-knots", textures: C, rarity: "rare", age: "young" },
	// Curly
	{ id: "curly", textures: CU, rarity: "common" },
	{ id: "curly2", textures: CU, rarity: "common" },
	{ id: "curly3", textures: CU, rarity: "common" },
	{ id: "curlyFade1", textures: CU, rarity: "common" },
	{ id: "curlyFade2", textures: CU, rarity: "uncommon" },
	{ id: "fork-afro-small", textures: CU, rarity: "uncommon" },
	// Straight / wavy
	{ id: "short", textures: S, rarity: "common" },
	{ id: "short2", textures: S, rarity: "common" },
	{ id: "short3", textures: SC, rarity: "common" },
	{ id: "crop", textures: S, rarity: "common" },
	{ id: "crop-fade", textures: SC, rarity: "common" },
	{ id: "crop-fade2", textures: SC, rarity: "common" },
	{ id: "fork-edgar", textures: SC, rarity: "uncommon", age: "young" },
	{ id: "parted", textures: S, rarity: "common", age: "mature" },
	{ id: "fork-side-part", textures: S, rarity: "uncommon", age: "mature" },
	{ id: "hair", textures: S, rarity: "common" },
	{ id: "messy-short", textures: SC, rarity: "common" },
	{ id: "messy", textures: SC, rarity: "uncommon" },
	{ id: "juice", textures: S, rarity: "uncommon" },
	{ id: "faux-hawk", textures: S, rarity: "uncommon", age: "young" },
	{ id: "fauxhawk-fade", textures: SC, rarity: "uncommon", age: "young" },
	{ id: "fork-undercut", textures: S, rarity: "uncommon", age: "young" },
	{ id: "spike", textures: S, rarity: "uncommon", age: "young" },
	{ id: "spike2", textures: S, rarity: "uncommon", age: "young" },
	{ id: "spike3", textures: SC, rarity: "rare", age: "young" },
	{ id: "spike4", textures: S, rarity: "rare", age: "young" },
	{ id: "middle-part", textures: S, rarity: "uncommon" },
	{ id: "shaggy1", textures: S, rarity: "uncommon", age: "young" },
	{ id: "shaggy2", textures: S, rarity: "rare", age: "young" },
	{ id: "emo", textures: S, rarity: "rare", age: "young" },
	{ id: "fork-frosted-tips", textures: S, rarity: "rare", age: "young" },
	{ id: "fork-top-knot", textures: S, rarity: "rare", age: "young" },
	{ id: "fork-mohawk", textures: S, rarity: "rare", age: "young" },
	{ id: "fork-slick-back", textures: S, rarity: "uncommon", age: "mature" },
	{ id: "fork-pompadour", textures: S, rarity: "uncommon" },
	{ id: "fork-wolf-cut", textures: SC, rarity: "rare", age: "young" },
	{
		id: "fork-half-up-bun",
		textures: S,
		rarity: "rare",
		age: "young",
		hairBg: "fork-shoulder-length",
	},
	{
		id: "fork-middle-part-long",
		textures: SC,
		rarity: "rare",
		hairBg: "fork-long-wavy",
	},
	{
		id: "fork-slick-back",
		textures: S,
		rarity: "rare",
		hairBg: "fork-slick-back-long",
	},
	{ id: "short3", textures: SC, rarity: "rare", hairBg: "fork-mullet" },
	{ id: "longHair", textures: S, rarity: "rare", hairBg: "longHair" },
	{ id: "shaggy1", textures: S, rarity: "rare", hairBg: "shaggy" },
	{
		id: "middle-part",
		textures: S,
		rarity: "rare",
		hairBg: "fork-shoulder-length",
	},
];

// Facial hair rarity (ids not listed are uncommon; "none" is left to facesjs' own 50/50)
const FACIAL_COMMON = [
	"beard1",
	"beard2",
	"goatee1",
	"goatee1-stache",
	"goatee4-stache",
	"chin-strap",
	"chin-strapStache",
	"fullgoatee",
	"fullgoatee2",
	"mustache1",
	"soul-stache",
	"loganGoatee2Stache",
	"fork-stubble",
	"fork-heavy-stubble",
	"fork-boxed-beard",
	"fork-lineup-beard",
	"fork-full-beard",
];
const FACIAL_RARE = [
	"fork-huge-beard",
	"fork-handlebar",
	"fork-walrus",
	"fork-horseshoe",
	"neckbeard",
	"neckbeard2",
	"neckbeard2SB1",
	"neckbeard2SB2",
	"neckbeardSB1",
	"neckbeardSB2",
	"honest-abe",
	"honest-abe-stache",
	"beard5",
	"beard6",
	"wilt",
	"wilt-sideburns-long",
	"wilt-sideburns-short",
	"mustache-thin",
	"harly3",
	"harly3-sb-1",
	"harly3-sb-2",
];
// Beards and stubble that are the fork's own; facesjs' facial hair ids come from its index
const FORK_FACIAL = [
	"fork-stubble",
	"fork-heavy-stubble",
	"fork-patchy-stubble",
	"fork-chin-stubble",
	"fork-boxed-beard",
	"fork-lineup-beard",
	"fork-beard-line",
	"fork-full-beard",
	"fork-huge-beard",
	"fork-anchor",
	"fork-handlebar",
	"fork-walrus",
	"fork-mustache",
	"fork-horseshoe",
	"fork-chin-patch",
];

export const facialHairRarity = (id: string): Rarity =>
	FACIAL_COMMON.includes(id)
		? "common"
		: FACIAL_RARE.includes(id)
			? "rare"
			: "uncommon";

// facesjs' race palettes (skin colours), to tell a face's hair texture
const SKIN_BLACK = ["#ad6453", "#74453d", "#5c3937"];
const SKIN_BROWN = ["#bb876f", "#aa816f", "#a67358"];
const SKIN_ASIAN = ["#fedac7", "#f0c5a3", "#eab687"];

export const hairTexture = (face: FaceConfig, u: number): Texture => {
	const skin = face.body.color;
	if (SKIN_BLACK.includes(skin)) {
		return "coily";
	}
	if (SKIN_ASIAN.includes(skin)) {
		return "straight";
	}
	if (SKIN_BROWN.includes(skin)) {
		return u < 0.25 ? "curly" : "straight";
	}
	return u < 0.15 ? "curly" : "straight";
};

const ageWeight = (fit: AgeFit | undefined, age: number | undefined) => {
	if (age === undefined || fit === undefined || fit === "any") {
		return 1;
	}
	if (fit === "young") {
		return age <= 26 ? 1.3 : age <= 31 ? 0.6 : 0.15;
	}
	return age >= 30 ? 1.8 : age <= 24 ? 0.5 : 1;
};

const pickWeighted = <T>(
	items: readonly T[],
	weight: (item: T) => number,
	u: number,
): T | undefined => {
	let total = 0;
	for (const item of items) {
		total += weight(item);
	}
	let x = u * total;
	for (const item of items) {
		x -= weight(item);
		if (x < 0) {
			return item;
		}
	}
	return items.at(-1);
};

export const hairStylesFor = (texture: Texture) =>
	HAIR_STYLES.filter((style) => style.textures.includes(texture));

const GLASSES = [
	"glasses1-primary",
	"glasses2-black",
	"fork-glasses-round",
	"fork-glasses-rect",
];

// Natural hair colours stay facesjs'; a small share is bleached or dyed (younger players)
const DYED = ["#e9d9a6", "#d8c38a", "#b5452f", "#f2efe6"];

export const styleFace = (
	face: FaceConfig,
	{
		age,
		facialHairIds,
	}: {
		age?: number;
		// facesjs' facial hair ids (the index), to pick from with the fork's
		facialHairIds: readonly string[];
	},
	exclude: (part: FacePart) => boolean = () => false,
) => {
	const random = seededRandom("faceStyle", JSON.stringify(face));
	const texture = hairTexture(face, random());

	// Hair (and what's drawn behind the head with it)
	const style = pickWeighted(
		hairStylesFor(texture),
		(s) => RARITY_WEIGHT[s.rarity] * ageWeight(s.age, age),
		random(),
	);
	if (style) {
		face.hair.id = style.id;
		face.hairBg.id = style.hairBg ?? "none";
	}

	// Facial hair: whether he has any stays facesjs' call; which one is by rarity
	if (face.facialHair.id !== "none") {
		const ids = [
			...facialHairIds.filter((id) => id !== "none"),
			...FORK_FACIAL,
		];
		const id = pickWeighted(
			ids,
			(id) => RARITY_WEIGHT[facialHairRarity(id)],
			random(),
		);
		if (id !== undefined) {
			face.facialHair.id = id;
		}
	}

	// A few dyed or bleached heads, mostly young
	const dyeChance = age === undefined || age <= 27 ? 0.035 : 0.01;
	if (
		random() < dyeChance &&
		!["bald", "short-fade", "short-fade-2"].includes(face.hair.id)
	) {
		// Hair only (drawn by faceRender.ts), the brows keep his natural colour
		const extra = face as FaceWithExtra;
		extra.fork = {
			...extra.fork,
			hair: DYED[Math.floor(random() * DYED.length)]!,
		};
	}

	// Skin: some young players have a little acne (face aging takes it away in their 20s along with their teen look)
	if (
		age !== undefined &&
		age <= 21 &&
		face.miscLine.id === "none" &&
		random() < 0.12
	) {
		face.miscLine.id = "fork-acne";
	}

	// Glasses: rare on players (goggles), common enough on older coaches and GMs
	if (
		age !== undefined &&
		age >= 40 &&
		face.glasses.id === "none" &&
		random() < 0.3
	) {
		face.glasses.id = GLASSES[Math.floor(random() * GLASSES.length)]!;
	}

	// The fork's other parts (heads, eyes, brows, noses, mouths, ears, lines, glasses, accessories), as before
	addRandomForkParts(
		face,
		random,
		(part) =>
			exclude(part) ||
			part.feature === "hair" ||
			part.feature === "hairBg" ||
			part.feature === "facialHair",
	);
	return face;
};
