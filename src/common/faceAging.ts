// Face aging (League Extras "Face Aging"): generated faces change with a player's age, once a season at the preseason.
//
// Everything here is a pure function of the player's "base" face fields (the face as generated, which stands for how he looks as
// a young adult), a per-player seed (pid) and his age, so it is deterministic and never touches Math.random or the game's random
// stream. Per-year draws are keyed by (pid, season), so the same player looks the same in every replay of a league.
//
// Only a few face fields change with age (see FaceAgingFields). The player keeps p.faceAging:
// - b: those fields as generated (or as the user last edited them), the input of every aging step
// - ba: his age when b was set by an edit (then aging only adds what happens after that age, and never restyles his beard)
// - h: per-season snapshots of the fields that changed that preseason, first entry complete, so a past season's face can be
//   rebuilt (faceForSeason) without storing whole faces
// - s: last season aged; e: face edited by the user (locked from aging unless a: "allow aging" ticked)
import type { FaceConfig } from "facesjs";

export type FaceAgingFields = {
	// hair id, hair colour
	hi: string;
	hc: string;
	// facial hair id, facial hair colour (undefined: same as the hair)
	fh: string;
	bc?: string;
	// eye line, smile line (+ size), misc line (forehead)
	el: string;
	sl: string;
	ss: number;
	ml: string;
	// fatness, head shave (stubble shadow on a shaved head)
	ft: number;
	sh: string;
};

export type FaceAging = {
	b: FaceAgingFields;
	ba?: number;
	h: Record<number, Partial<FaceAgingFields>>;
	s?: number;
	e?: 1;
	a?: 1;
};

export type FaceAgingOptions = {
	speed: "subtle" | "normal" | "strong";
	hairLoss: boolean;
	graying: boolean;
};

export const DEFAULT_FACE_AGING_OPTIONS: FaceAgingOptions = {
	speed: "normal",
	hairLoss: true,
	graying: true,
};

// The fork's extension of a stored face: a facial hair colour of its own (beards grey on their own schedule). Drawn by
// common/faceRender.ts; facesjs ignores the extra key.
export type ForkFaceExtra = {
	beard?: string;
};
export type FaceWithExtra = FaceConfig & { fork?: ForkFaceExtra };

// ---------------------------------------------------------------------------------------------------------------------
// Seeded random numbers (never Math.random)

const hashString = (s: string) => {
	let h1 = 0xdeadbeef;
	let h2 = 0x41c6ce57;
	for (let i = 0; i < s.length; i++) {
		const ch = s.charCodeAt(i);
		h1 = Math.imul(h1 ^ ch, 2654435761);
		h2 = Math.imul(h2 ^ ch, 1597334677);
	}
	h1 =
		Math.imul(h1 ^ (h1 >>> 16), 2246822507) ^
		Math.imul(h2 ^ (h2 >>> 13), 3266489909);
	h2 =
		Math.imul(h2 ^ (h2 >>> 16), 2246822507) ^
		Math.imul(h1 ^ (h1 >>> 13), 3266489909);
	return (h1 ^ h2) >>> 0;
};

// One uniform number in [0, 1) for a key
export const seededUniform = (...key: (string | number)[]) =>
	hashString(key.join("|")) / 4294967296;

// A seeded generator for several numbers
export const seededRandom = (...key: (string | number)[]) => {
	let a = hashString(key.join("|"));
	return () => {
		a = (a + 0x6d2b79f5) | 0;
		let t = Math.imul(a ^ (a >>> 15), 1 | a);
		t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
		return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
	};
};

const clamp = (x: number, a: number, b: number) => Math.min(b, Math.max(a, x));
const round2 = (x: number) => Math.round(x * 100) / 100;

// ---------------------------------------------------------------------------------------------------------------------
// Colours

const parseHex = (color: string) => {
	const m = /^#([\da-f]{3}|[\da-f]{6})$/i.exec(color.trim());
	if (!m) {
		return undefined;
	}
	let hex = m[1]!;
	if (hex.length === 3) {
		hex = [...hex].map((ch) => ch + ch).join("");
	}
	const n = Number.parseInt(hex, 16);
	return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
};

const toHex = (rgb: readonly number[]) =>
	`#${rgb
		.map((x) =>
			Math.round(clamp(x, 0, 255))
				.toString(16)
				.padStart(2, "0"),
		)
		.join("")}`;

// Mix a hair colour toward grey/white (t 0 none ... 1 fully grey)
export const greyColor = (color: string, t: number) => {
	const rgb = parseHex(color);
	if (!rgb || t <= 0) {
		return color;
	}
	const grey = [198, 199, 202];
	return toHex(rgb.map((x, i) => x + (grey[i]! - x) * Math.min(1, t)));
};

// ---------------------------------------------------------------------------------------------------------------------
// Style families

// Hair loss stages after the player's own style: 1 light recession (or a widow's peak), 2 receding temples, 3 high hairline,
// 4 thinning crown, 5 horseshoe or a shaved head
export const HAIR_LOSS_IDS = {
	light: "fork-recede-light",
	peak: "fork-widows-peak",
	medium: "fork-recede-medium",
	strong: "fork-receding",
	crown: "fork-thinning-crown",
	horseshoe: "short-bald",
	shaved: "bald",
} as const;

const HAIR_LOSS_STAGE: Record<string, number> = {
	[HAIR_LOSS_IDS.light]: 1,
	[HAIR_LOSS_IDS.peak]: 1,
	[HAIR_LOSS_IDS.medium]: 2,
	[HAIR_LOSS_IDS.strong]: 3,
	[HAIR_LOSS_IDS.crown]: 4,
	[HAIR_LOSS_IDS.horseshoe]: 5,
	"fork-comb-over": 4,
	bald: 5,
};

// Already (almost) shaved: hair loss only shows as the head going bald in the end
const BUZZED = new Set([
	"short-fade",
	"short-fade-2",
	"fork-buzz",
	"fork-high-tight",
]);

export const hairLossStageOf = (id: string) => HAIR_LOSS_STAGE[id] ?? 0;

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

const LIGHT_STUBBLE = "fork-stubble";
// Beards a player may switch to now and then, by fullness
const STYLE_CHANGES: Record<number, readonly string[]> = {
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

const isForeheadLine = (id: string) =>
	id.startsWith("forehead") || id === "fork-forehead-lines";

const EYE_LINES = ["line1", "line2", "line3", "line4", "line5", "line6"];
const SMILE_LINES = ["line1", "line2", "line3", "line4"];

// ---------------------------------------------------------------------------------------------------------------------
// Fields

export const extractAgingFields = (face: FaceConfig): FaceAgingFields => {
	const extra = (face as FaceWithExtra).fork;
	const fields: FaceAgingFields = {
		hi: face.hair.id,
		hc: face.hair.color,
		fh: face.facialHair.id,
		el: face.eyeLine.id,
		sl: face.smileLine.id,
		ss: face.smileLine.size,
		ml: face.miscLine.id,
		ft: face.fatness,
		sh: face.head.shave,
	};
	if (extra?.beard !== undefined) {
		fields.bc = extra.beard;
	}
	return fields;
};

export const applyAgingFields = <T extends FaceConfig>(
	face: T,
	fields: Partial<FaceAgingFields>,
): T => {
	const out = {
		...face,
		hair: { ...face.hair },
		facialHair: { ...face.facialHair },
		eyeLine: { ...face.eyeLine },
		smileLine: { ...face.smileLine },
		miscLine: { ...face.miscLine },
		head: { ...face.head },
	} as T & { fork?: ForkFaceExtra };
	if (fields.hi !== undefined) {
		out.hair.id = fields.hi;
	}
	if (fields.hc !== undefined) {
		out.hair.color = fields.hc;
	}
	if (fields.fh !== undefined) {
		out.facialHair.id = fields.fh;
	}
	if (fields.el !== undefined) {
		out.eyeLine.id = fields.el;
	}
	if (fields.sl !== undefined) {
		out.smileLine.id = fields.sl;
	}
	if (fields.ss !== undefined) {
		out.smileLine.size = fields.ss;
	}
	if (fields.ml !== undefined) {
		out.miscLine.id = fields.ml;
	}
	if (fields.ft !== undefined) {
		out.fatness = fields.ft;
	}
	if (fields.sh !== undefined) {
		out.head.shave = fields.sh;
	}
	if ("bc" in fields) {
		const fork = { ...out.fork };
		if (fields.bc === undefined || fields.bc === fields.hc) {
			delete fork.beard;
		} else {
			fork.beard = fields.bc;
		}
		if (Object.keys(fork).length > 0) {
			out.fork = fork;
		} else {
			delete out.fork;
		}
	}
	return out;
};

const FIELD_KEYS: (keyof FaceAgingFields)[] = [
	"hi",
	"hc",
	"fh",
	"bc",
	"el",
	"sl",
	"ss",
	"ml",
	"ft",
	"sh",
];

export const diffAgingFields = (
	before: FaceAgingFields,
	after: FaceAgingFields,
): Partial<FaceAgingFields> => {
	const diff: Partial<FaceAgingFields> = {};
	for (const key of FIELD_KEYS) {
		if (before[key] !== after[key]) {
			(diff as any)[key] = after[key];
		}
	}
	// bc undefined means "same as the hair": keep the key so applying the diff clears it
	if (before.bc !== after.bc && after.bc === undefined) {
		diff.bc = undefined;
	}
	return diff;
};

// ---------------------------------------------------------------------------------------------------------------------
// Per-player tendencies, from the seed alone

export type FaceGenes = {
	// Hair loss: tendency (0 keeps his hair), onset age, ends shaved (else horseshoe), widow's peak first, shaves once it thins
	hairLoss: number;
	hairLossOnset: number;
	shaveFinal: boolean;
	widowsPeak: boolean;
	// Greying: start age, years from first grey to mostly grey, beard greys this many years earlier
	greyStart: number;
	greySpan: number;
	beardLead: number;
	// Lines: years added to the usual onsets
	linesShift: number;
	eyeLine: string;
	smileLine: string;
	forehead: string;
	// Facial hair: how much he likes a beard (0..1); fills out (fatness) with age
	beardy: number;
	fatGain: number;
};

export const faceGenes = (seed: number | string): FaceGenes => {
	const r = seededRandom("faceGenes", seed);
	const u1 = r();
	// About 40% keep a full head of hair, the rest lose some, a few a lot
	const hairLoss = u1 < 0.4 ? 0 : (u1 - 0.4) / 0.6;
	return {
		hairLoss,
		hairLossOnset: 26 + Math.floor(r() * 10),
		shaveFinal: r() < 0.6,
		widowsPeak: r() < 0.3,
		greyStart: 32 + Math.floor(r() * 12),
		greySpan: 16 + Math.floor(r() * 14),
		beardLead: Math.floor(r() * 5),
		linesShift: Math.floor(r() * 7) - 2,
		eyeLine: EYE_LINES[Math.floor(r() * EYE_LINES.length)]!,
		smileLine: SMILE_LINES[Math.floor(r() * SMILE_LINES.length)]!,
		forehead: ["forehead1", "forehead2", "forehead3", "forehead4"][
			Math.floor(r() * 4)
		]!,
		beardy: r(),
		fatGain: r(),
	};
};

const speedFactor = (speed: FaceAgingOptions["speed"]) =>
	speed === "subtle" ? 0.6 : speed === "strong" ? 1.5 : 1;

// ---------------------------------------------------------------------------------------------------------------------
// The aging step

export type AgeContext = {
	seed: number | string;
	age: number;
	// Birth year, for the per-season draws (season = born + age)
	born: number;
	// Age when the base was set by a user edit (aging only adds what happens after it, and keeps his beard style)
	baseAge?: number;
	// Career minutes, so heavy-minute players line sooner
	minutes?: number;
	// Weight in pounds, heavier players fill out a little more
	weight?: number;
	// Staff (coaches, GMs): adults with their own styles, no rookie look
	staff?: boolean;
};

// Number of hair loss steps by an age (each year after the onset, a seeded draw)
const hairLossSteps = (
	genes: FaceGenes,
	ctx: AgeContext,
	age: number,
	factor: number,
) => {
	if (genes.hairLoss <= 0) {
		return 0;
	}
	const p = clamp(genes.hairLoss * 0.42 * factor, 0, 0.9);
	let steps = 0;
	for (let a = genes.hairLossOnset; a <= age; a++) {
		if (seededUniform("hairLoss", ctx.seed, ctx.born + a) < p) {
			steps += 1;
		}
	}
	return Math.min(5, steps);
};

const greyAt = (genes: FaceGenes, age: number, factor: number, lead = 0) =>
	clamp(((age - (genes.greyStart - lead)) / genes.greySpan) * factor, 0, 0.92);

// How deep a kind of line is at an age: 0 none, 1, 2, 3
const lineLevel = (age: number, onset: number, factor: number) => {
	if (age < onset) {
		return 0;
	}
	const years = (age - onset) * factor;
	return years >= 12 ? 3 : years >= 6 ? 2 : 1;
};

const hairLossId = (
	base: string,
	stage: number,
	genes: FaceGenes,
): { id: string; shaved: boolean } => {
	const baseStage = hairLossStageOf(base);
	if (stage <= baseStage || stage <= 0) {
		return { id: base, shaved: false };
	}
	if (BUZZED.has(base) || base === "bald") {
		return stage >= 3
			? { id: HAIR_LOSS_IDS.shaved, shaved: true }
			: { id: base, shaved: false };
	}
	// Once it's clearly going, some men shave it all off
	if (genes.shaveFinal && stage >= 4) {
		return { id: HAIR_LOSS_IDS.shaved, shaved: true };
	}
	switch (stage) {
		case 1:
			return {
				id: genes.widowsPeak ? HAIR_LOSS_IDS.peak : HAIR_LOSS_IDS.light,
				shaved: false,
			};
		case 2:
			return { id: HAIR_LOSS_IDS.medium, shaved: false };
		case 3:
			return { id: HAIR_LOSS_IDS.strong, shaved: false };
		case 4:
			return { id: HAIR_LOSS_IDS.crown, shaved: false };
		default:
			return genes.shaveFinal
				? { id: HAIR_LOSS_IDS.shaved, shaved: true }
				: { id: HAIR_LOSS_IDS.horseshoe, shaved: false };
	}
};

// His facial hair at an age, from the style he was generated with (his adult preference). Changes are sticky: a style lasts
// until the next change, so a face doesn't flip back and forth from one season to the next.
const facialHairAt = (
	base: string,
	genes: FaceGenes,
	ctx: AgeContext,
	age: number,
) => {
	if (ctx.staff) {
		return base;
	}
	const tier = facialHairTier(base);

	// Youth: clean or light stubble (one look for his teens), until his own style grows in somewhere from 20 to 25
	const growAge = 20 + Math.floor(seededUniform("fhGrowAge", ctx.seed) * 6);
	if (age < growAge) {
		const u = seededUniform("fhYoung", ctx.seed);
		if (age <= 20 || tier === 0) {
			return u < 0.62 ? "none" : u < 0.95 || tier === 0 ? LIGHT_STUBBLE : base;
		}
		// Growing in: a lighter version of his style
		return tier >= 3 ? "fork-heavy-stubble" : u < 0.5 ? "none" : LIGHT_STUBBLE;
	}

	// Adult: his own style, now and then a change of about the same fullness, every few years at most
	let style = base;
	let styleTier = tier;
	let vetDone = false;
	for (let a = growAge + 3; a <= age; a += 3) {
		const u = seededUniform("fhChange", ctx.seed, a);
		if (!vetDone && a >= 31) {
			vetDone = true;
			// Veterans: some grow it fuller, some go clean shaven
			const v = seededUniform("fhVet", ctx.seed);
			if (styleTier >= 2 && v < 0.3 * (0.4 + genes.beardy)) {
				const list = STYLE_CHANGES[4]!;
				style =
					list[Math.floor(seededUniform("fhVetPick", ctx.seed) * list.length)]!;
				styleTier = 4;
				continue;
			}
			if (styleTier >= 1 && v > 0.9) {
				style = "none";
				styleTier = 0;
				continue;
			}
		}
		if (u < 0.12) {
			if (styleTier === 0) {
				if (genes.beardy > 0.75) {
					style = LIGHT_STUBBLE;
					styleTier = 1;
				}
				continue;
			}
			const t = clamp(
				styleTier + (seededUniform("fhDir", ctx.seed, a) < 0.6 ? 0 : 1),
				1,
				4,
			);
			const list = STYLE_CHANGES[t]!;
			style =
				list[Math.floor(seededUniform("fhPick", ctx.seed, a) * list.length)]!;
			styleTier = t;
		}
	}
	return style;
};

/**
 * The aging fields of a face at an age. base: the fields as generated (or as last edited, then ctx.baseAge is set).
 */
export const agedFields = (
	base: FaceAgingFields,
	ctx: AgeContext,
	options: FaceAgingOptions = DEFAULT_FACE_AGING_OPTIONS,
): FaceAgingFields => {
	const genes = faceGenes(ctx.seed);
	const factor = speedFactor(options.speed);
	const age = ctx.age;
	const edited = ctx.baseAge !== undefined;
	const from = ctx.baseAge ?? 0;
	const out: FaceAgingFields = { ...base };

	// 1. Hairline: steps since the base (all of them for a generated face)
	if (options.hairLoss) {
		const steps =
			hairLossSteps(genes, ctx, age, factor) -
			(edited ? hairLossSteps(genes, ctx, from, factor) : 0);
		const stage = Math.min(5, hairLossStageOf(base.hi) + Math.max(0, steps));
		const { id, shaved } = hairLossId(base.hi, stage, genes);
		out.hi = id;
		if (shaved && id !== base.hi) {
			// A shaved head shows a little stubble shadow
			out.sh = `rgba(0,0,0,${round2(0.08 + 0.1 * seededUniform("shave", ctx.seed))})`;
		}
	}

	// 2. Greying, hair and beard on their own schedules
	if (options.graying) {
		const t =
			greyAt(genes, age, factor) - (edited ? greyAt(genes, from, factor) : 0);
		const tb =
			greyAt(genes, age, factor, genes.beardLead) -
			(edited ? greyAt(genes, from, factor, genes.beardLead) : 0);
		const baseBeard = base.bc ?? base.hc;
		out.hc = greyColor(base.hc, t);
		const beard = greyColor(baseBeard, tb);
		out.bc = beard === out.hc ? undefined : beard;
	}

	// 3. Lines: smile lines, then crow's feet, then the forehead, sooner with heavy minutes
	const wear = clamp((ctx.minutes ?? 0) / 12000, 0, 3);
	const shift = genes.linesShift - wear - (factor - 1) * 4;
	const smile = lineLevel(age, 28 + shift, factor);
	const eye = lineLevel(age, 31 + shift, factor);
	const forehead = lineLevel(age, 33 + shift, factor);
	if (!edited || base.sl === "none") {
		out.sl =
			smile === 0
				? "none"
				: smile === 3
					? "fork-smile-deep"
					: base.sl !== "none" && !base.sl.startsWith("fork-")
						? base.sl
						: genes.smileLine;
		out.ss =
			smile === 0
				? base.ss
				: round2(clamp(0.5 + 0.3 * smile + 0.2 * (base.ss - 1), 0.4, 1.8));
	}
	if (!edited || base.el === "none") {
		out.el =
			eye === 0
				? "none"
				: eye === 3
					? "fork-crows-feet"
					: base.el !== "none" && !base.el.startsWith("fork-")
						? base.el
						: genes.eyeLine;
	}
	if (base.ml === "none" || isForeheadLine(base.ml)) {
		if (!edited || base.ml === "none") {
			out.ml =
				forehead === 0
					? "none"
					: forehead === 3
						? "fork-forehead-lines"
						: forehead === 2
							? "forehead5"
							: genes.forehead;
		}
	}

	// 4. Fullness: a little leaner as a teenager, filling out a little after about 28
	const young = age <= 21 ? -0.06 * (22 - age) * 0.5 : 0;
	const heavy = clamp(((ctx.weight ?? 215) - 200) / 100, 0, 0.6);
	const gain = (a: number) =>
		Math.min(
			0.22,
			Math.max(0, a - 28) * 0.012 * (genes.fatGain + heavy) * factor,
		);
	out.ft = round2(
		clamp(
			base.ft + (edited ? gain(age) - gain(from) : gain(age) + young),
			0,
			1,
		),
	);

	// 5/6. Facial hair over a career (a generated face only; an edited beard is the user's choice)
	if (!edited) {
		out.fh = facialHairAt(base.fh, genes, ctx, age);
	}
	if (out.fh === "none") {
		delete out.bc;
	}

	return out;
};

// ---------------------------------------------------------------------------------------------------------------------
// Player state

export const faceAgingLocked = (aging: FaceAging | undefined) =>
	aging?.e === 1 && aging.a !== 1;

/**
 * Age a face to a season. Returns the new face and aging state, or undefined when nothing applies (locked, already done).
 */
export const ageFaceForSeason = (
	face: FaceConfig,
	aging: FaceAging | undefined,
	ctx: Omit<AgeContext, "baseAge" | "age"> & { season: number },
	options: FaceAgingOptions,
): { face: FaceConfig; aging: FaceAging } | undefined => {
	if (faceAgingLocked(aging) || aging?.s === ctx.season) {
		return undefined;
	}
	const current = extractAgingFields(face);
	const state: FaceAging = aging
		? { ...aging, h: { ...aging.h } }
		: { b: current, h: {} };
	const fields = agedFields(
		state.b,
		{ ...ctx, age: ctx.season - ctx.born, baseAge: state.ba },
		options,
	);
	const first = Object.keys(state.h).length === 0;
	const diff = first ? { ...fields } : diffAgingFields(current, fields);
	if (first || Object.keys(diff).length > 0) {
		state.h[ctx.season] = diff;
	}
	state.s = ctx.season;
	return { face: applyAgingFields(face, fields), aging: state };
};

// After a user edit of the face: lock it (unless allowed) and age on from the edited face
export const faceAgingAfterEdit = (
	aging: FaceAging | undefined,
	face: FaceConfig,
	age: number,
	allow: boolean,
): FaceAging => {
	const out: FaceAging = {
		b: extractAgingFields(face),
		ba: age,
		h: aging?.h ?? {},
		e: 1,
	};
	if (aging?.s !== undefined) {
		out.s = aging.s;
	}
	if (allow) {
		out.a = 1;
	}
	return out;
};

const historySeasons = (aging: FaceAging) =>
	Object.keys(aging.h)
		.map(Number)
		.sort((a, b) => a - b);

// His face in a past season, rebuilt from the snapshots (the current face for anything aging doesn't touch)
export const faceForSeason = (
	face: FaceConfig,
	aging: FaceAging | undefined,
	season: number,
): FaceConfig => {
	if (!aging) {
		return face;
	}
	const seasons = historySeasons(aging);
	if (seasons.length === 0 || season >= seasons.at(-1)!) {
		return face;
	}
	let fields: Partial<FaceAgingFields> = {};
	for (const s of seasons) {
		if (s > season && Object.keys(fields).length > 0) {
			break;
		}
		fields = { ...fields, ...aging.h[s] };
	}
	return applyAgingFields(face, fields);
};

// Seasons whose snapshot changed something, with the face then (for the player page)
export const faceHistory = (face: FaceConfig, aging: FaceAging | undefined) => {
	if (!aging) {
		return [];
	}
	return historySeasons(aging).map((season) => ({
		season,
		face: faceForSeason(face, aging, season),
	}));
};
