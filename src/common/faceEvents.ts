// Style and life events for League Extras "Face Aging" (option "Style Events", faceAgingStyleEvents): hairstyle and beard
// changes, headbands, goggles after an eye injury, glasses after retirement. A pure function of the player's signature look
// (his generated face), a seed and his age, so it is deterministic: every draw is keyed by (seed, season) through
// common/faceSeed.ts, never Math.random or the game's random stream. Called from common/faceAging.ts agedFields, which then
// applies the hairline (a thinning player's style is cut back to what his hair allows).
import { seededUniform } from "./faceSeed.ts";

// Facial hair fullness: 0 none, 1 stubble / thin, 2 mustache / goatee / chin strap, 3 short beards, 4 full beards
export const facialHairTier = (id: string): number => {
	if (id === "none" || id === "") {
		return 0;
	}
	if (
		/stubble|shadow/.test(id) ||
		[
			"mustache-thin",
			"goatee-thin",
			"soul",
			"fork-chin-patch",
			"fork-chin-stubble",
		].includes(id)
	) {
		return 1;
	}
	if (
		/^(beard2|beard3|beard5|beard6|beard-point|honest-abe)/.test(id) ||
		[
			"fork-full-beard",
			"fork-huge-beard",
			"fork-boxed-beard",
			"fork-lineup-beard",
			"fork-beard-line",
		].includes(id)
	) {
		return 4;
	}
	if (
		/^(beard1|beard4|fullgoatee|logan|mutton|harley|harly|wilt|neckbeard)/.test(
			id,
		)
	) {
		return 3;
	}
	return 2;
};

export const LIGHT_STUBBLE = "fork-stubble";
// Beards a player may switch to now and then, by fullness
export const STYLE_CHANGES: Record<number, readonly string[]> = {
	1: ["fork-stubble", "fork-heavy-stubble", "fork-chin-stubble", "soul"],
	2: [
		"goatee1",
		"goatee2",
		"goatee4-stache",
		"chin-strapStache",
		"soul-stache",
		"mustache1",
		"fork-anchor",
	],
	3: [
		"beard1",
		"fullgoatee",
		"fullgoatee2",
		"loganGoatee2Stache",
		"fork-boxed-beard",
	],
	4: [
		"beard2",
		"beard3",
		"fork-full-beard",
		"fork-lineup-beard",
		"fork-boxed-beard",
	],
};

// ---------------------------------------------------------------------------------------------------------------------
// Hairstyles and their neighbours

export type HairTexture = "coily" | "curly" | "straight";

// Textures a style suits: c coily, u curly, s straight
type StyleNode = { t: string; near: readonly string[] };

// A style is "<hair id>" or "<hair id>+<hair behind the head>". Nearby styles are what a barber visit or a few years of growth
// turn it into: fades and line-ups trade places, twists grow into locs, braids and cornrows swap, long hair gets tied up.
export const HAIR_NEIGHBOURS: Record<string, StyleNode> = {
	// Short and faded, every texture
	"short-fade": {
		t: "cus",
		near: [
			"short-fade-2",
			"fork-low-fade",
			"fork-buzz",
			"fork-high-fade",
			"crop-fade",
		],
	},
	"short-fade-2": {
		t: "cus",
		near: ["short-fade", "fork-low-fade", "fork-high-fade"],
	},
	"fork-buzz": {
		t: "cus",
		near: ["short-fade", "short-fade-2", "fork-high-tight"],
	},
	"fork-low-fade": {
		t: "cus",
		near: [
			"fork-high-fade",
			"short-fade",
			"fork-line-up",
			"fork-waves-fade",
			"crop-fade",
			"curlyFade1",
			"fork-skin-fade-part",
		],
	},
	"fork-high-fade": {
		t: "cus",
		near: [
			"fork-low-fade",
			"fork-high-tight",
			"tall-fade",
			"fork-skin-fade-part",
			"fauxhawk-fade",
		],
	},
	"fork-high-tight": {
		t: "cus",
		near: ["fork-high-fade", "fork-buzz", "short-fade"],
	},
	"fork-skin-fade-part": {
		t: "cus",
		near: ["fork-low-fade", "fork-high-fade", "fork-shaved-part"],
	},
	"fork-shaved-part": {
		t: "cus",
		near: ["fork-skin-fade-part", "fork-low-fade", "fork-side-design"],
	},
	"fork-side-design": { t: "cus", near: ["fork-shaved-part", "fork-low-fade"] },
	"fork-grey-streak": { t: "cus", near: [] },
	bald: { t: "cus", near: ["fork-buzz", "short-fade"] },
	"fork-line-up": {
		t: "cus",
		near: ["fork-low-fade", "fork-waves-fade", "fork-high-fade", "curlyFade1"],
	},
	// Coily
	"fork-waves-fade": {
		t: "c",
		near: ["fork-waves", "fork-line-up", "fork-low-fade"],
	},
	"fork-waves": { t: "c", near: ["fork-waves-fade", "fork-line-up"] },
	curlyFade1: {
		t: "cu",
		near: ["curlyFade2", "fork-low-fade", "fork-line-up", "fork-afro-small"],
	},
	curlyFade2: { t: "cu", near: ["curlyFade1", "fork-afro-small", "curly"] },
	"tall-fade": {
		t: "c",
		near: ["fork-high-fade", "high", "fork-flat-top", "blowoutFade"],
	},
	high: { t: "c", near: ["tall-fade", "fork-flat-top"] },
	"fork-flat-top": { t: "c", near: ["tall-fade", "high"] },
	blowoutFade: { t: "c", near: ["tall-fade", "fork-afro-small", "curlyFade2"] },
	"fork-afro-small": {
		t: "cu",
		near: ["afro", "curlyFade2", "blowoutFade", "fork-twists-fade"],
	},
	afro: { t: "c", near: ["fork-afro-small", "afro2", "fork-twists"] },
	afro2: { t: "c", near: ["afro"] },
	"fork-dyed-top": { t: "c", near: ["fork-high-fade", "fork-twists-fade"] },
	// Twists grow into locs over the years (rarely the other way: locs are cut, see big changes)
	"fork-twists-fade": {
		t: "c",
		near: ["fork-twists", "fork-high-fade", "fork-twists-medium"],
	},
	"fork-twists": {
		t: "c",
		near: ["fork-twists-medium", "fork-twists-fade", "fork-starter-locs"],
	},
	"fork-twists-medium": { t: "c", near: ["fork-starter-locs", "fork-twists"] },
	"fork-bantu-knots": { t: "c", near: ["fork-twists", "fork-twists-fade"] },
	"fork-starter-locs": {
		t: "c",
		near: ["fork-locs-dyed", "fork-locs-top+fork-locs-long", "dreads"],
	},
	"fork-locs-dyed": {
		t: "c",
		near: ["fork-starter-locs", "fork-locs-top+fork-locs-long"],
	},
	"fork-locs-top+fork-locs-long": {
		t: "c",
		near: ["fork-locs-back+fork-locs-long", "dreads"],
	},
	"fork-locs-top+fork-locs-long-dyed": {
		t: "c",
		near: ["fork-locs-top+fork-locs-long"],
	},
	"fork-locs-back+fork-locs-long": {
		t: "c",
		near: ["fork-locs-top+fork-locs-long", "fork-locs-back+fork-low-ponytail"],
	},
	"fork-locs-back+fork-low-ponytail": {
		t: "c",
		near: ["fork-locs-back+fork-locs-long"],
	},
	dreads: {
		t: "c",
		near: ["fork-locs-top+fork-locs-long", "fork-starter-locs"],
	},
	// Braids and cornrows
	cornrows: {
		t: "c",
		near: ["fork-box-braids", "fork-cornrows-zigzag", "fork-braids-bun"],
	},
	"fork-cornrows-zigzag": { t: "c", near: ["cornrows", "fork-box-braids"] },
	"fork-box-braids": {
		t: "c",
		near: [
			"cornrows",
			"fork-box-braids+fork-box-braids-long",
			"fork-braids-bun",
		],
	},
	"fork-box-braids+fork-box-braids-long": {
		t: "c",
		near: ["fork-box-braids", "fork-braids-bun"],
	},
	"fork-braids-bun": { t: "c", near: ["fork-box-braids", "cornrows"] },
	// Curly
	curly: { t: "u", near: ["curly2", "curly3", "curlyFade1"] },
	curly2: { t: "u", near: ["curly", "curly3"] },
	curly3: { t: "u", near: ["curly", "curly2", "curlyFade2"] },
	// Straight and wavy
	short: { t: "s", near: ["short2", "crop", "hair"] },
	short2: { t: "s", near: ["short", "short3", "crop"] },
	short3: { t: "su", near: ["short2", "messy-short", "crop-fade"] },
	crop: { t: "s", near: ["crop-fade", "short", "fork-edgar"] },
	"crop-fade": {
		t: "su",
		near: ["crop", "crop-fade2", "fork-low-fade", "fork-edgar"],
	},
	"crop-fade2": { t: "su", near: ["crop-fade", "fork-edgar"] },
	"fork-edgar": { t: "su", near: ["crop-fade", "crop-fade2"] },
	parted: { t: "s", near: ["fork-side-part", "fork-slick-back", "short"] },
	"fork-side-part": {
		t: "s",
		near: ["parted", "fork-slick-back", "fork-pompadour"],
	},
	hair: { t: "s", near: ["short", "messy-short", "parted"] },
	"messy-short": { t: "su", near: ["messy", "short3", "hair"] },
	messy: { t: "su", near: ["messy-short", "shaggy1"] },
	juice: { t: "s", near: ["fork-pompadour", "faux-hawk", "spike"] },
	"faux-hawk": { t: "s", near: ["fauxhawk-fade", "juice", "fork-undercut"] },
	"fauxhawk-fade": { t: "su", near: ["faux-hawk", "fork-high-fade"] },
	"fork-undercut": {
		t: "s",
		near: ["faux-hawk", "fork-slick-back", "fork-top-knot"],
	},
	spike: { t: "s", near: ["spike2", "juice"] },
	spike2: { t: "s", near: ["spike", "spike4"] },
	spike3: { t: "su", near: ["spike", "messy-short"] },
	spike4: { t: "s", near: ["spike2"] },
	"fork-frosted-tips": { t: "s", near: ["spike", "short"] },
	"fork-mohawk": { t: "s", near: ["faux-hawk", "fork-undercut"] },
	"fork-slick-back": {
		t: "s",
		near: ["fork-pompadour", "fork-side-part", "fork-undercut"],
	},
	"fork-pompadour": {
		t: "s",
		near: ["fork-slick-back", "juice", "fork-side-part"],
	},
	"fork-wolf-cut": {
		t: "su",
		near: ["messy", "shaggy1", "short3+fork-mullet"],
	},
	"short3+fork-mullet": { t: "su", near: ["short3", "fork-wolf-cut"] },
	emo: { t: "s", near: ["shaggy1"] },
	shaggy1: { t: "s", near: ["messy", "shaggy2", "shaggy1+shaggy"] },
	shaggy2: { t: "s", near: ["shaggy1"] },
	// Long hair: tied up, let down, grown out
	"fork-top-knot": {
		t: "s",
		near: ["fork-undercut", "fork-half-up-bun+fork-shoulder-length"],
	},
	"middle-part": {
		t: "s",
		near: ["middle-part+fork-shoulder-length", "messy", "hair"],
	},
	"middle-part+fork-shoulder-length": {
		t: "s",
		near: [
			"middle-part",
			"fork-half-up-bun+fork-shoulder-length",
			"fork-middle-part-long+fork-long-wavy",
		],
	},
	"fork-half-up-bun+fork-shoulder-length": {
		t: "s",
		near: ["fork-top-knot", "middle-part+fork-shoulder-length"],
	},
	"fork-middle-part-long+fork-long-wavy": {
		t: "su",
		near: [
			"middle-part+fork-shoulder-length",
			"fork-half-up-bun+fork-shoulder-length",
		],
	},
	"fork-slick-back+fork-slick-back-long": {
		t: "s",
		near: ["fork-slick-back", "fork-half-up-bun+fork-shoulder-length"],
	},
	"longHair+longHair": {
		t: "s",
		near: ["fork-middle-part-long+fork-long-wavy", "shaggy1+shaggy"],
	},
	"shaggy1+shaggy": { t: "s", near: ["shaggy1", "longHair+longHair"] },
};

// What a thinning player may still switch to: cutting it short, never growing it back
const THINNING_STYLES = ["fork-buzz", "short-fade", "bald"];

export const styleKey = (hi: string, hb: string | undefined) =>
	hb === undefined || hb === "none" ? hi : `${hi}+${hb}`;

export const splitStyleKey = (key: string) => {
	const i = key.indexOf("+");
	return i < 0
		? { hi: key, hb: "none" }
		: { hi: key.slice(0, i), hb: key.slice(i + 1) };
};

const TEXTURE_LETTER: Record<HairTexture, string> = {
	coily: "c",
	curly: "u",
	straight: "s",
};

// facesjs' black skin palette, the coily hair texture (as common/faceStyles.ts hairTexture)
export const SKIN_BLACK = ["#ad6453", "#74453d", "#5c3937"];

// His hair texture: from a style that fits only one, else from his skin colour (straight unless the style says curly)
export const textureOf = (
	skin: string | undefined,
	hi: string,
	hb?: string,
): HairTexture => {
	const node = HAIR_NEIGHBOURS[styleKey(hi, hb)] ?? HAIR_NEIGHBOURS[hi];
	if (node && node.t.length === 1) {
		return node.t === "c" ? "coily" : node.t === "u" ? "curly" : "straight";
	}
	if (skin !== undefined && SKIN_BLACK.includes(skin)) {
		return "coily";
	}
	return node?.t === "cu" || node?.t === "u" ? "curly" : "straight";
};

// Styles within a few steps of his signature look: he wanders among these and no further, so he stays recognisable. Twists
// reach further, so they can grow all the way into locs over the years.
export const nearSignature = (signature: string) => {
	const depth = signature.includes("twists") ? 3 : 2;
	const seen = new Set([signature]);
	let frontier = [signature];
	for (let d = 0; d < depth; d++) {
		const next: string[] = [];
		for (const key of frontier) {
			for (const near of HAIR_NEIGHBOURS[key]?.near ?? []) {
				if (!seen.has(near)) {
					seen.add(near);
					next.push(near);
				}
			}
		}
		frontier = next;
	}
	return seen;
};

const suits = (key: string, texture: HairTexture) =>
	HAIR_NEIGHBOURS[key]?.t.includes(TEXTURE_LETTER[texture]) ?? false;

// ---------------------------------------------------------------------------------------------------------------------
// Accessories

export const HEADBANDS = [
	"headband",
	"headband-high",
	"fork-thin-headband",
	"fork-tied-headband",
];
// On-court accessories, taken off when he retires
const ON_COURT = new Set([...HEADBANDS, "fork-bandana", "eye-black"]);
export const GOGGLES = ["fork-goggles", "fork-goggles-modern"];
// Everyday glasses (not team-coloured frames)
export const EVERYDAY_GLASSES = [
	"glasses2-black",
	"fork-glasses-round",
	"fork-glasses-rect",
];

// A retired player's face today: on-court accessories (headbands, bandana, eye black) and goggles come off. Everyday or
// team-coloured glasses he was generated with stay.
export const offCourtFace = <
	T extends { accessories: { id: string }; glasses: { id: string } },
>(
	face: T,
): T => ({
	...face,
	accessories: ON_COURT.has(face.accessories.id)
		? { ...face.accessories, id: "none" }
		: face.accessories,
	glasses: GOGGLES.includes(face.glasses.id)
		? { ...face.glasses, id: "none" }
		: face.glasses,
});

// Eye injuries in the injury system (worker/util/defaultInjuries.ts): goggles afterwards
export const EYE_INJURIES = new Set([
	"Bruised Eye",
	"Fractured Orbital Socket",
	"Lacerated Eyelid",
]);

// ---------------------------------------------------------------------------------------------------------------------
// Rates (docs/native-features.md "Faces")

export const STYLE_EVENT_RATES = {
	// Chance of a style event per season, and the fewest seasons between two
	hairActive: 0.2,
	hairRetired: 0.08,
	hairStaff: 0.1,
	minGap: 2,
	// Share of events that change the beard rather than the hair
	beardShare: 0.3,
	// Off his signature look: chance an event takes him back to it
	backToSignature: 0.55,
	// Big change (shaves his head)
	big: 0.07,
	// Headbands, per season (sticky)
	headbandAdopt: 0.06,
	headbandDrop: 0.25,
	// When his signature look has a headband
	headbandReadopt: 0.3,
	headbandDropSignature: 0.1,
	// Goggles after an eye injury: for the rest of his career, else 1-2 seasons
	gogglesForGood: 0.35,
	// Veterans who wear goggles from 33-36 anyway
	gogglesVeteran: 0.04,
	// First season events can happen at
	startAge: 21,
} as const;

// Chance of everyday glasses at an age, retired players and staff (monotone, so once on they stay on)
export const glassesChance = (age: number) =>
	Math.min(0.55, Math.max(0.1, 0.1 + 0.015 * (age - 35)));

// ---------------------------------------------------------------------------------------------------------------------
// The events

export type StyleEventInput = {
	seed: number | string;
	born: number;
	age: number;
	// His signature look (the generated face)
	hi: string;
	hb?: string;
	// His beard at an age without events (face aging's own beard path)
	beardAt: (age: number) => string;
	ac?: string;
	gl?: string;
	texture: HairTexture;
	// First age his hairline thins (Infinity: it doesn't)
	thinningAge: number;
	// Season he retired (seasons after it are retired seasons)
	retiredYear?: number;
	staff?: boolean;
	// Seasons with an eye injury
	eyeInjurySeasons?: readonly number[];
};

export type StyleEvent = {
	season: number;
	kind: "hair" | "beard" | "signature" | "shave" | "headband" | "goggles";
	to: string;
};

export type StyleEventResult = {
	hi: string;
	hb: string;
	fh: string;
	ac?: string;
	gl?: string;
	// Head shaved by choice (draw a stubble shadow)
	shaved: boolean;
	events: StyleEvent[];
};

const pick = <T>(list: readonly T[], u: number) =>
	list[Math.floor(u * list.length) % list.length]!;

export const styleEventsAt = (input: StyleEventInput): StyleEventResult => {
	const { seed, born, age, texture, staff } = input;
	const R = STYLE_EVENT_RATES;
	const signature = styleKey(input.hi, input.hb);
	const retiredAt = (a: number) =>
		input.retiredYear !== undefined && born + a > input.retiredYear;
	const events: StyleEvent[] = [];

	// Hair and beard
	const reach = nearSignature(signature);
	let style = signature;
	let beard: string | undefined;
	let last = -Infinity;
	for (let a = R.startAge; a <= age; a++) {
		const season = born + a;
		if (a - last < R.minGap) {
			continue;
		}
		const p = staff ? R.hairStaff : retiredAt(a) ? R.hairRetired : R.hairActive;
		if (seededUniform("styleEvent", seed, season) >= p) {
			continue;
		}
		const u = seededUniform("styleKind", seed, season);
		const v = seededUniform("stylePick", seed, season);
		const thinning = a >= input.thinningAge;

		if (u < R.beardShare && a >= 24) {
			// Beard: back to his own, or a nearby fullness
			if (beard !== undefined && v < R.backToSignature) {
				beard = undefined;
				events.push({ season, kind: "beard", to: input.beardAt(a) });
			} else {
				const tier = facialHairTier(beard ?? input.beardAt(a));
				const w = seededUniform("beardDir", seed, season);
				const t = Math.min(
					4,
					Math.max(1, tier + (w < 0.3 ? -1 : w < 0.8 ? 0 : 1)),
				);
				beard = pick(STYLE_CHANGES[t]!, v);
				events.push({ season, kind: "beard", to: beard });
			}
			last = a;
			continue;
		}

		let next: string | undefined;
		let kind: StyleEvent["kind"] = "hair";
		if (thinning) {
			// A thinning player only cuts it shorter
			const options = THINNING_STYLES.filter(
				(key) =>
					key !== style &&
					THINNING_STYLES.indexOf(key) >= THINNING_STYLES.indexOf(style),
			);
			if (options.length > 0) {
				next = pick(options, v);
			}
		} else if (style !== signature && v < R.backToSignature) {
			next = signature;
			kind = "signature";
		} else if (u > 1 - R.big) {
			next = "bald";
			kind = "shave";
		} else {
			const near = (HAIR_NEIGHBOURS[style]?.near ?? []).filter(
				(key) => suits(key, texture) && reach.has(key),
			);
			if (near.length > 0) {
				next = pick(near, seededUniform("styleNear", seed, season));
			}
		}
		if (next !== undefined && next !== style) {
			style = next;
			events.push({ season, kind, to: style });
			last = a;
		}
	}

	// Accessories: headbands (sticky), goggles after an eye injury, glasses with age once retired (and staff)
	let ac = input.ac;
	let gl = input.gl;
	if (!staff && ac !== undefined && (ac === "none" || HEADBANDS.includes(ac))) {
		const signatureBand = HEADBANDS.includes(ac) ? ac : undefined;
		const band =
			signatureBand ?? pick(HEADBANDS, seededUniform("headbandStyle", seed));
		let wearing = signatureBand !== undefined;
		for (let a = R.startAge; a <= age && !retiredAt(a); a++) {
			const season = born + a;
			const u = seededUniform("headband", seed, season);
			const change = wearing
				? u < (signatureBand ? R.headbandDropSignature : R.headbandDrop)
				: u < (signatureBand ? R.headbandReadopt : R.headbandAdopt);
			if (change) {
				wearing = !wearing;
				events.push({ season, kind: "headband", to: wearing ? band : "none" });
			}
		}
		ac = wearing ? band : "none";
	}
	if (ac !== undefined && retiredAt(age) && ON_COURT.has(ac)) {
		ac = "none";
	}

	if (gl !== undefined && (gl === "none" || GOGGLES.includes(gl))) {
		const goggles = GOGGLES.includes(gl)
			? gl
			: pick(GOGGLES, seededUniform("gogglesStyle", seed));
		let wear = GOGGLES.includes(gl);
		if (!staff && !retiredAt(age)) {
			const season = born + age;
			for (const injured of input.eyeInjurySeasons ?? []) {
				if (injured >= season) {
					continue;
				}
				const u = seededUniform("goggles", seed, injured);
				const years =
					1 + Math.floor(seededUniform("gogglesYears", seed, injured) * 2);
				if (u < R.gogglesForGood || season - injured <= years) {
					wear = true;
				}
			}
			const vet = seededUniform("gogglesVet", seed);
			if (
				vet < R.gogglesVeteran &&
				age >= 33 + Math.floor((vet / R.gogglesVeteran) * 4)
			) {
				wear = true;
			}
		} else {
			wear = false;
		}
		gl = wear ? goggles : "none";
	}
	// Everyday glasses with age once his playing days are over
	if (
		gl !== undefined &&
		gl === "none" &&
		(staff || retiredAt(age)) &&
		seededUniform("glassesGene", seed) < glassesChance(age)
	) {
		gl = pick(EVERYDAY_GLASSES, seededUniform("glassesStyle", seed));
	}

	const { hi, hb } = splitStyleKey(style);
	return {
		hi,
		hb,
		fh: beard ?? input.beardAt(age),
		ac,
		gl,
		shaved: hi === "bald" && input.hi !== "bald",
		events,
	};
};
