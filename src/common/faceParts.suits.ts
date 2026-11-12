// Staff clothing: coaches and general managers wear a suit instead of the team's jersey. These are facesjs "jersey" parts (drawn
// over the body, under the head), original SVG drawn for this fork in facesjs' 400x600 face box, registered through
// common/faceParts.ts. They are never picked for players (they are not in FORK_FACE_PARTS, which random generation and the
// face editor use): staffFaceOverrides below puts one on a coach's or GM's face when it is drawn, so saved staff switch to
// suits without any change to the stored faces.
//
// Colour placeholders: $[primary] is the tie / pullover, $[secondary] the pin, pocket square and trim, $[accent] small details.
// Every part is symmetric about x = 200 in its outline (facesjs scales the jersey with the body about its bounding box centre).
import type { FaceConfig } from "facesjs";
import type { FacePart } from "./faceParts.ts";

const OUT = 'stroke="#000" stroke-linejoin="round"';

// Jacket: padded shoulders that cover every facesjs / fork body shape, with a V opening down to y = 596
const jacket = (color: string) =>
	`<path fill="${color}" ${OUT} stroke-width="6" d="M-14 614C-14 562 2 534 40 516L130 470 200 596 270 470 360 516C398 534 414 562 414 614Z"/>`;

// Shirt in the V, leaving the throat open down to (200, bottom)
const shirt = (color: string, bottom = 528) =>
	`<path fill="${color}" d="M128 468 150 474 200 ${bottom} 250 474 272 468 200 598Z"/>`;

// Collar flaps
const collar = (color: string, bottom = 528) =>
	`<path fill="${color}" ${OUT} stroke-width="3" d="M143 462 200 ${bottom} 177 ${bottom + 30} 124 484ZM257 462 200 ${bottom} 223 ${bottom + 30} 276 484Z"/>`;

const tie = (extra = "") =>
	`<path fill="$[primary]" ${OUT} stroke-width="3" d="M191 552 209 552 219 612 181 612Z"/>${extra}<path fill="$[primary]" ${OUT} stroke-width="3" d="M185 527 215 527 209 553 191 553Z"/>`;

// Lapels over the shirt's edges, with a notch
const lapels = (color: string) =>
	`<path fill="${color}" ${OUT} stroke-width="3" d="M130 470 98 512 126 528 112 542 184 614 204 614 200 596ZM270 470 302 512 274 528 288 542 216 614 196 614 200 596Z"/>`;

const pin = (x = 118, y = 548) =>
	`<circle cx="${x}" cy="${y}" r="7" fill="$[primary]" stroke="$[secondary]" stroke-width="3"/>`;

const pocketSquare =
	'<path fill="$[secondary]" stroke="#000" stroke-width="2" stroke-linejoin="round" d="M276 580 286 566 294 578 304 568 310 584Z"/>';

export const STAFF_SUIT_PARTS: readonly FacePart[] = [
	{
		// Charcoal suit, white shirt, team-colour tie
		feature: "jersey",
		id: "fork-suit-charcoal",
		svg: `${jacket("#34383f")}${shirt("#fff")}${tie()}${collar("#fff")}${lapels("#3d424a")}`,
	},
	{
		// Navy suit, light blue shirt, striped team-colour tie, lapel pin
		feature: "jersey",
		id: "fork-suit-navy",
		svg: `${jacket("#1d2942")}${shirt("#dbe7f6")}${tie('<path fill="none" stroke="$[secondary]" stroke-width="4" d="M190 566 211 574M187 584 214 594M185 602 216 612"/>')}${collar("#dbe7f6")}${lapels("#24324f")}${pin()}`,
	},
	{
		// Light grey suit, white shirt, team-colour tie, pocket square
		feature: "jersey",
		id: "fork-suit-grey",
		svg: `${jacket("#8d939c")}${shirt("#fff")}${tie()}${collar("#fff")}${lapels("#989ea7")}${pocketSquare}`,
	},
	{
		// Black suit, open collar, no tie, team-colour lapel pin
		feature: "jersey",
		id: "fork-suit-open",
		svg: `${jacket("#1b1c20")}${shirt("#fff", 556)}<path fill="none" stroke="#b9bec6" stroke-width="2" d="M200 558V598"/>${collar("#fff", 556)}${lapels("#25262b")}${pin()}`,
	},
	{
		// Tan blazer over a team-colour knit, no tie
		feature: "jersey",
		id: "fork-suit-blazer",
		svg: `${jacket("#8a6f4d")}<path fill="$[primary]" d="M128 468 200 598 272 468 250 474C236 506 164 506 150 474Z"/><path fill="none" ${OUT} stroke-width="3" d="M150 474C164 506 236 506 250 474"/><path fill="none" stroke="$[secondary]" stroke-width="4" d="M153 482C168 513 232 513 247 482"/>${lapels("#96795a")}`,
	},
	{
		// Team-colour quarter-zip pullover
		feature: "jersey",
		id: "fork-quarter-zip",
		svg: `<path fill="$[primary]" ${OUT} stroke-width="6" d="M-14 614C-14 562 2 536 40 520L132 474 200 520 268 474 360 520C398 536 414 562 414 614Z"/><path fill="none" stroke="#000" stroke-opacity=".35" stroke-width="3" d="M52 614C54 580 62 560 76 548M348 614C346 580 338 560 324 548"/><path fill="none" stroke="#000" stroke-width="7" d="M200 520V590"/><path fill="none" stroke="$[accent]" stroke-width="3" stroke-dasharray="5 4" d="M200 522V588"/><path fill="$[secondary]" stroke="#000" stroke-width="2" d="M195 588H205V604H195Z"/><path fill="$[primary]" ${OUT} stroke-width="4" d="M140 458 200 520 178 548 120 486ZM260 458 200 520 222 548 280 486Z"/><path fill="none" stroke="$[secondary]" stroke-width="4" d="M127 487 178 541M273 487 222 541"/>`,
	},
];

export const STAFF_SUIT_IDS = STAFF_SUIT_PARTS.map((part) => part.id);

// Neutral colours for staff without a team (free agents, retired)
export const STAFF_NEUTRAL_COLORS: [string, string, string] = [
	"#7b2233",
	"#c9a44c",
	"#d7dbe0",
];

const hash = (s: string) => {
	let h = 2166136261;
	for (let i = 0; i < s.length; i++) {
		h ^= s.charCodeAt(i);
		h = Math.imul(h, 16777619);
	}
	return h >>> 0;
};

const parseHex = (color: string) => {
	const m = /^#?([\da-f]{6}|[\da-f]{3})$/i.exec(color.trim());
	if (!m) {
		return undefined;
	}
	let hex = m[1]!;
	if (hex.length === 3) {
		hex = [...hex].map((ch) => ch + ch).join("");
	}
	const n = Number.parseInt(hex, 16);
	return [(n >> 16) & 255, (n >> 8) & 255, n & 255] as const;
};

const toHex = (rgb: readonly number[]) =>
	`#${rgb
		.map((x) =>
			Math.round(Math.min(255, Math.max(0, x)))
				.toString(16)
				.padStart(2, "0"),
		)
		.join("")}`;

const luminance = (color: string) => {
	const rgb = parseHex(color);
	return rgb ? (0.299 * rgb[0] + 0.587 * rgb[1] + 0.114 * rgb[2]) / 255 : 0.5;
};

// Mix a hair colour toward grey (t 0 none ... 1 fully grey)
export const greyHair = (color: string, t: number) => {
	const rgb = parseHex(color);
	if (!rgb || t <= 0) {
		return color;
	}
	const grey = [196, 198, 202];
	return toHex(rgb.map((x, i) => x + (grey[i]! - x) * Math.min(1, t)));
};

// How grey a man's hair is at an age: starts somewhere in his 40s (it varies by person), mostly grey by his mid 60s
export const greyAmount = (age: number, seed: number) => {
	const start = 44 + (seed % 14);
	return Math.min(0.9, Math.max(0, (age - start) / 20));
};

/**
 * facesjs overrides that dress a coach or GM: a suit instead of the jersey (the same one every time for the same face), the team's colours
 * on the tie / pin (reordered so the tie is never white on a white shirt), no headband, and hair that greys with age.
 */
export const staffFaceOverrides = (
	face: FaceConfig,
	{
		age,
		colors,
		seed,
	}: {
		age?: number;
		colors?: [string, string, string];
		// Anything stable for the person (cid, name); defaults to the face itself
		seed?: number | string;
	} = {},
) => {
	const h = hash(
		seed !== undefined
			? String(seed)
			: `${face.fatness}|${face.hair?.id}|${face.eye?.id}|${face.nose?.id}|${face.mouth?.id}|${face.body?.color}`,
	);
	const id = STAFF_SUIT_IDS[h % STAFF_SUIT_IDS.length]!;

	const base = colors ?? STAFF_NEUTRAL_COLORS;
	// The tie / pullover colour: the first team colour that is neither near white nor near black
	const ok = (c: string) => luminance(c) < 0.82 && luminance(c) > 0.1;
	const first = base.findIndex(ok);
	const teamColors: [string, string, string] =
		first <= 0
			? [base[0], base[1], base[2]]
			: first === 1
				? [base[1], base[0], base[2]]
				: [base[2], base[0], base[1]];

	const overrides: {
		teamColors: [string, string, string];
		jersey: { id: string };
		accessories?: { id: string };
		hair?: { color: string };
	} = {
		teamColors,
		jersey: { id },
	};
	// No headbands, hats or eye black with a suit
	if (face.accessories?.id && face.accessories.id !== "none") {
		overrides.accessories = { id: "none" };
	}
	if (age !== undefined && face.hair?.color) {
		const t = greyAmount(age, h >>> 8);
		if (t > 0) {
			overrides.hair = { color: greyHair(face.hair.color, t) };
		}
	}
	return overrides;
};
