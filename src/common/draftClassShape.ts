import { Rng } from "./collegeStats/rng.ts";

/**
 * Draft class shapes (basketball, the League Extras setting "Draft Class Shapes"): each draft class the game generates from scratch draws a shape from its seed, which reshapes the class within realistic bounds — how talent is spread over the top of the board, the positions, the ages and where the prospects come from. Only the top of the class (the prospects who get drafted) is touched, and the shapes are balanced against each other so the average class is as good as before.
 *
 * Pure: the worker (core/draft/classShape.ts) turns a plan into ratings, heights, ages and origins.
 */

export const DRAFT_CLASS_SHAPES = {
	typical: {
		name: "A typical class",
		description:
			"Nothing unusual: the talent is spread the way it usually is, a few good players at the top and useful pieces after that.",
		weight: 14,
	},
	deep: {
		name: "A deep class",
		description:
			"No superstar at the top, but real rotation players are still on the board deep into the first round and early in the second.",
		weight: 8,
	},
	topHeavy: {
		name: "A top-heavy class",
		description:
			"Two or three franchise talents, then a cliff. Where you pick matters more than usual.",
		weight: 7,
	},
	weak: {
		name: "A weak class",
		description:
			"Few sure things anywhere on the board. Teams at the top may look to trade down or out.",
		weight: 8,
	},
	generational: {
		name: "A generational talent",
		description:
			"One prospect the scouts have been waiting years for, and the rest of the class a step below usual.",
		weight: 3,
	},
	noClearTop: {
		name: "No clear No. 1",
		description:
			"A cluster of good prospects at the top and nobody separating from it: the first pick is anybody's guess.",
		weight: 6,
	},
	guards: {
		name: "A guard-heavy class",
		description:
			"Ball handlers and shooters everywhere at the top of the board; size is hard to find.",
		weight: 6,
	},
	bigs: {
		name: "A big man class",
		description:
			"Size up front: more centers and power forwards than usual among the best prospects.",
		weight: 6,
	},
	wings: {
		name: "A wing class",
		description:
			"Long, versatile forwards who can guard several positions dominate the top of the board.",
		weight: 6,
	},
	international: {
		name: "An international class",
		description:
			"More of the best prospects than usual come from overseas pro leagues instead of college.",
		weight: 5,
	},
	seniors: {
		name: "A college-senior class",
		description:
			"Experienced players who stayed in school: polished and older, with less room to grow.",
		weight: 5,
	},
	raw: {
		name: "A high-upside class",
		description:
			"Young, raw prospects with big ceilings who will take years to be ready.",
		weight: 6,
	},
	readyNow: {
		name: "A ready-now class",
		description:
			"Older, polished prospects who can help right away, with lower ceilings.",
		weight: 6,
	},
} as const;
export type DraftClassShape = keyof typeof DRAFT_CLASS_SHAPES;

export const isDraftClassShape = (key: unknown): key is DraftClassShape =>
	typeof key === "string" && Object.hasOwn(DRAFT_CLASS_SHAPES, key);

// How many prospects at the top of the class (by value) a shape works on: about the drafted ones
export const SHAPE_POOL = 60;

export const drawDraftClassShape = (seed: string): DraftClassShape => {
	const rng = new Rng(`${seed}|shape`);
	const keys = Object.keys(DRAFT_CLASS_SHAPES) as DraftClassShape[];
	const total = keys.reduce((sum, k) => sum + DRAFT_CLASS_SHAPES[k].weight, 0);
	let x = rng.random() * total;
	for (const k of keys) {
		x -= DRAFT_CLASS_SHAPES[k].weight;
		if (x < 0) {
			return k;
		}
	}
	return "typical";
};

export type ShapeProspect = {
	key: string;
	// Ovr now
	ovr: number;
	// Age in the draft year
	age: number;
	pos: string;
	// Born outside the US/Canada
	international: boolean;
};

export type ShapeChange = {
	key: string;
	// Ovr points to add (the ratings are shifted to get there)
	ovr: number;
	// Change his build toward a guard, a wing or a big man
	nudge?: "guard" | "wing" | "big";
	// Years to add to his age in the draft year
	age: number;
	// Make him an international prospect
	international?: boolean;
};

const GUARDS = new Set(["PG", "SG", "G"]);
const BIGS = new Set(["C", "FC", "PF"]);

/**
 * What a shape does to each prospect. prospects are in board order (best first); only the first SHAPE_POOL can change. ages: the league's draft ages, which ages are kept within.
 */
export const planDraftClassShape = (
	shape: DraftClassShape,
	seed: string,
	prospects: ShapeProspect[],
	ages: [number, number],
): ShapeChange[] => {
	const rng = new Rng(`${seed}|plan|${shape}`);
	const pool = prospects.slice(0, SHAPE_POOL);
	const changes: ShapeChange[] = pool.map((p) => ({
		key: p.key,
		ovr: 0,
		age: 0,
	}));
	const range = (from: number, to: number, ovr: number) => {
		for (let i = from; i < Math.min(to, changes.length); i++) {
			changes[i]!.ovr += ovr;
		}
	};
	// Some of the pool, picked at random among those that pass the filter
	const some = (fraction: number, filter: (p: ShapeProspect) => boolean) =>
		pool
			.map((p, i) => ({ p, i, r: rng.random() }))
			.filter(({ p, r }) => filter(p) && r < fraction)
			.map(({ i }) => i);
	const setAge = (i: number, delta: number) => {
		const age = pool[i]!.age;
		const target = Math.min(ages[1], Math.max(ages[0], age + delta));
		changes[i]!.age = target - age;
	};

	switch (shape) {
		case "deep":
			range(5, 45, 2.2);
			break;
		case "topHeavy": {
			const k = rng.random() < 0.5 ? 2 : 3;
			range(0, k, 5);
			range(k, 35, -2);
			break;
		}
		case "weak":
			range(0, 40, -2.5);
			break;
		case "generational":
			range(0, 1, 6.5);
			range(1, 30, -0.5);
			break;
		case "noClearTop": {
			const pivot = pool[5]?.ovr;
			if (pivot !== undefined) {
				for (let i = 0; i < 5; i++) {
					changes[i]!.ovr -= 0.5 * Math.max(0, pool[i]!.ovr - pivot);
				}
			}
			range(5, 15, 1);
			break;
		}
		case "guards":
			for (const i of some(0.5, (p) => !GUARDS.has(p.pos))) {
				changes[i]!.nudge = "guard";
			}
			break;
		case "bigs":
			for (const i of some(0.5, (p) => !BIGS.has(p.pos))) {
				changes[i]!.nudge = "big";
			}
			break;
		case "wings":
			for (const i of some(0.6, (p) => GUARDS.has(p.pos) || BIGS.has(p.pos))) {
				changes[i]!.nudge = "wing";
			}
			break;
		case "international":
			for (const i of some(0.3, (p) => !p.international)) {
				changes[i]!.international = true;
			}
			break;
		case "seniors":
			for (const i of some(0.4, (p) => p.age < ages[1])) {
				setAge(i, ages[1] - pool[i]!.age);
				changes[i]!.ovr += 1;
			}
			break;
		case "raw":
			range(0, SHAPE_POOL, -1.5);
			for (const i of some(0.8, (p) => p.age > ages[0])) {
				setAge(i, -1);
			}
			break;
		case "readyNow":
			range(0, SHAPE_POOL, 1.5);
			for (const i of some(0.6, (p) => p.age < ages[1])) {
				setAge(i, 1);
			}
			break;
		default:
	}
	return changes.filter(
		(c) => c.ovr !== 0 || c.age !== 0 || c.nudge || c.international,
	);
};

// Rating changes for a nudge (before the ratings are shifted back to the same ovr), and inches of height
export const NUDGES = {
	guard: {
		ratings: {
			hgt: -5,
			stre: -4,
			spd: 5,
			jmp: 2,
			ins: -5,
			dnk: -3,
			tp: 4,
			drb: 7,
			pss: 6,
			reb: -6,
		},
		inches: -3,
		weight: -15,
	},
	big: {
		ratings: {
			hgt: 5,
			stre: 5,
			spd: -4,
			ins: 6,
			dnk: 4,
			tp: -4,
			drb: -6,
			pss: -5,
			reb: 7,
		},
		inches: 3,
		weight: 20,
	},
} as const;

// Countries international prospects come from, roughly by how many good ones each produces
export const SHAPE_COUNTRIES = [
	"France",
	"France",
	"Serbia",
	"Spain",
	"Lithuania",
	"Germany",
	"Australia",
	"Australia",
	"Greece",
	"Slovenia",
	"Croatia",
	"Turkey",
	"Latvia",
	"Italy",
	"Nigeria",
	"Cameroon",
	"Senegal",
	"Argentina",
	"Brazil",
	"Israel",
];
