import { Rng } from "./collegeStats/rng.ts";

/**
 * Draft class shapes (basketball, the League Extras setting "Draft Class Shapes"): each draft class the game generates from scratch draws a shape from its seed, which reshapes the class within realistic bounds — how talent is spread over the top of the board, the positions, the ages and where the prospects come from. Only the top of the class (the prospects who get drafted) is touched, and the shapes are balanced against each other so the average class is as good as before.
 *
 * Pure: the worker (core/draft/classShape.ts) turns a plan into ratings, heights, ages and origins.
 */

export const DRAFT_CLASS_SHAPES = {
	typical: {
		name: "A typical class",
		descriptions: [
			"Nothing unusual: the talent is spread the way it usually is, a few good players at the top and useful pieces after that.",
			"A normal year on the board: a handful of likely starters at the top, rotation players through the middle of the first round.",
			"Scouts call it an ordinary class, which is not an insult: good players at the top, the usual mix after them.",
		],
		weight: 20,
	},
	deep: {
		name: "A deep class",
		descriptions: [
			"No superstar at the top, but real rotation players are still on the board deep into the first round and early in the second.",
			"The talent runs long: teams picking in the 20s will like who is left.",
			"Not much separates the 8th prospect from the 28th, and that is good news for everybody picking late.",
		],
		weight: 6,
	},
	topHeavy: {
		name: "A top-heavy class",
		descriptions: [
			"Two or three franchise talents, then a cliff. Where you pick matters more than usual.",
			"The lottery winners hit the jackpot; after the first few names the board thins out fast.",
			"A few prospects every team wants, and a long drop after them.",
		],
		weight: 5,
	},
	weak: {
		name: "A weak class",
		descriptions: [
			"Few sure things anywhere on the board. Teams at the top may look to trade down or out.",
			"Scouts are struggling to find a future All-Star anywhere in this group.",
			"A thin year: even the top of the board comes with real questions.",
		],
		weight: 6,
	},
	generational: {
		name: "A generational talent",
		descriptions: [
			"One prospect the scouts have been waiting years for, and the rest of the class a step below usual.",
			"Every bad team in the league is playing for one name at the top of this board.",
			"There is the No. 1 pick, and then there is everybody else.",
		],
		weight: 2,
	},
	noClearTop: {
		name: "No clear No. 1",
		descriptions: [
			"A cluster of good prospects at the top and nobody separating from it: the first pick is anybody's guess.",
			"Ask five scouts for the top pick and get five answers.",
			"The top of the board is a coin flip between several good players, none of them a sure thing.",
		],
		weight: 5,
	},
	guards: {
		name: "A guard-heavy class",
		descriptions: [
			"Ball handlers and shooters everywhere at the top of the board; size is hard to find.",
			"Backcourt players dominate the board. Teams that need a big man may have to reach.",
			"If you need a guard, this is your year.",
		],
		weight: 4,
	},
	bigs: {
		name: "A big man class",
		descriptions: [
			"Size up front: more centers and power forwards than usual among the best prospects.",
			"The best prospects play near the basket this year.",
			"A throwback class: size and strength at the top of the board.",
		],
		weight: 4,
	},
	wings: {
		name: "A wing class",
		descriptions: [
			"Long, versatile forwards who can guard several positions dominate the top of the board.",
			"The board is full of 6'7\" forwards who can do a bit of everything.",
			"Positionless basketball has arrived at the draft: wings everywhere.",
		],
		weight: 4,
	},
	international: {
		name: "An international class",
		descriptions: [
			"More of the best prospects than usual come from overseas pro leagues instead of college.",
			"Scouts are logging more air miles than usual: the top of this board is full of prospects playing in Europe and beyond.",
			"Many of the best prospects have been playing against grown men in pro leagues overseas.",
		],
		weight: 4,
	},
	seniors: {
		name: "A college-senior class",
		descriptions: [
			"Experienced players who stayed in school: polished and older, with less room to grow.",
			"Four-year players are back in fashion: older, steadier, with lower ceilings.",
			"A class of upperclassmen who know how to play, if not how much better they will get.",
		],
		weight: 3,
	},
	raw: {
		name: "A high-upside class",
		descriptions: [
			"Young, raw prospects with big ceilings who will take years to be ready.",
			"Lots of projects: the payoff could be big, but not soon.",
			"A class to dream on, and to be patient with.",
		],
		weight: 4,
	},
	readyNow: {
		name: "A ready-now class",
		descriptions: [
			"Older, polished prospects who can help right away, with lower ceilings.",
			"Contenders picking late can find players who will help this season.",
			"Few projects, many finished products.",
		],
		weight: 4,
	},
	shooters: {
		name: "A shooters' class",
		descriptions: [
			"Shooting everywhere you look: the best prospects can space the floor from day one.",
			"If you need a three-point shooter, you can find one at almost any pick.",
			"Scouts keep coming back from workouts talking about jump shots.",
		],
		weight: 4,
	},
	defenders: {
		name: "A defensive class",
		descriptions: [
			"Stoppers, not scorers: the top of the board can guard, but who will score?",
			"A class built on effort and length. The offense is a work in progress.",
			"Defense travels, and this class has plenty of it.",
		],
		weight: 3,
	},
	athletes: {
		name: "Athletic freaks",
		descriptions: [
			"Explosive athletes everywhere, many of them still learning the game.",
			"The combine will be a show: jumps, speed and raw tools, with the skills still to come.",
			"Teams that think they can coach skill will love this group of athletes.",
		],
		weight: 4,
	},
	pointGuards: {
		name: "A point guard class",
		descriptions: [
			"Floor generals at the top of the board: passers and ball handlers who run an offense.",
			"Lead guards everywhere, from the lottery to the second round.",
			"If your team needs somebody to run the show, this is the draft for it.",
		],
		weight: 3,
	},
	stretchBigs: {
		name: "A stretch-big class",
		descriptions: [
			"Big men who shoot: the bigs at the top of the board can play away from the basket.",
			"Size and shooting together, the combination every front office wants.",
			"Bigs who space the floor are the story of this class.",
		],
		weight: 3,
	},
	twoWayWings: {
		name: "A two-way wing class",
		descriptions: [
			"Wings who guard and shoot: the most valuable kind of role player is everywhere on this board.",
			"Long forwards who can defend and make an open three, from the lottery on down.",
			"3-and-D wings as far as the eye can see.",
		],
		weight: 3,
	},
	oneAndDone: {
		name: "A one-and-done class",
		descriptions: [
			"Freshmen everywhere at the top: young, talented and a year out of high school.",
			"A teenage class: most of the top prospects played a single college season.",
			"The one-and-done kids run this board.",
		],
		weight: 4,
	},
	lateBloomers: {
		name: "A class of late bloomers",
		descriptions: [
			"Upperclassmen who made a late leap: older than usual, and far better than they were a year ago.",
			"Several prospects nobody talked about a year ago are now near the top of the board.",
			"Patience paid off: the riser stories of this class are older players who finally broke out.",
		],
		weight: 3,
	},
	intlBigs: {
		name: "International bigs",
		descriptions: [
			"Tall prospects from overseas pro leagues dominate the frontcourt part of the board.",
			"The best big men in this class are playing in Europe and beyond.",
			"If you want size, you will be scouting overseas.",
		],
		weight: 2,
	},
	midMajor: {
		name: "Mid-major gems",
		descriptions: [
			"The talent is spread out: many of the best prospects come from small schools, not the blue bloods.",
			"Scouts are spending their winters in small gyms: the mid-majors produced a lot of this class.",
			"Not a blue-blood class. Many of the best prospects come from schools you rarely see on TV.",
		],
		weight: 3,
	},
	boomOrBust: {
		name: "A boom-or-bust class",
		descriptions: [
			"Wildly uneven: some prospects have All-Star ceilings, others look like misses, and they are hard to tell apart.",
			"Huge swings on every board. Teams will disagree about this class more than usual.",
			"High risk, high reward, from the top of the lottery on down.",
		],
		weight: 3,
	},
	polished: {
		name: "Polished, low ceilings",
		descriptions: [
			"Smart, skilled players who know how to play, and not many who will get much better.",
			"High floors, low ceilings: few busts, few stars.",
			"The basketball IQ is high and the athleticism is ordinary.",
		],
		weight: 3,
	},
	coHeadliners: {
		name: "Two franchise prospects",
		descriptions: [
			"Two franchise-level talents at the top, and the debate over which one goes first will last all year.",
			"Two prospects are a class above everybody else; the teams picking first and second both win.",
			"A two-man race for the No. 1 pick, then the rest of the class.",
		],
		weight: 2,
	},
	countrySpike: {
		name: "A home-country spike",
		descriptions: [
			"One country produced an unusual number of the best prospects this year.",
			"A golden generation from one country is arriving all at once.",
			"Scouts from every team are booking flights to the same country.",
		],
		weight: 2,
	},
	injuryRiddled: {
		name: "An injury-riddled class",
		descriptions: [
			"Medical reports matter more than usual: several top prospects are coming off injuries.",
			"Lots of talent, lots of question marks from the training room.",
			"Teams will lean on their doctors as much as their scouts with this class.",
		],
		weight: 3,
	},
} as const;
export type DraftClassShape = keyof typeof DRAFT_CLASS_SHAPES;

/**
 * Version of the shapes a class was given, stored on its prospects (p.draftClassShapeV). Missing: 1, the first 13 shapes with a single description each, kept word for word. 2: all the shapes, a wording drawn from the class's seed, and the injury-riddled class's injury marks.
 */
export const DRAFT_CLASS_SHAPE_VERSION = 2;

// The description of a class: version 1 classes keep the one they always had, later ones a wording picked by the class's seed
export const describeDraftClassShape = (
	shape: DraftClassShape,
	version: number,
	seed: string,
) => {
	const { descriptions } = DRAFT_CLASS_SHAPES[shape];
	if (version < 2) {
		return descriptions[0];
	}
	const rng = new Rng(`${seed}|wording`);
	return descriptions[Math.floor(rng.random() * descriptions.length)]!;
};

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

export type NudgeKind = keyof typeof NUDGES | "wing";

export type ShapeChange = {
	key: string;
	// Ovr points to add (the ratings are shifted to get there)
	ovr: number;
	// Changes to his build or skills, in order (his ovr is kept: only ovr above moves it)
	nudges?: NudgeKind[];
	// Years to add to his age in the draft year
	age: number;
	// Make him an international prospect (from this country, else one drawn from SHAPE_COUNTRIES)
	international?: boolean;
	country?: string;
	// Move him to a school outside the power conferences
	midMajor?: boolean;
	// He comes into the draft off an injury (his college story, and a little less durable with player traits on)
	injury?: boolean;
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
	const some = (
		fraction: number,
		filter: (p: ShapeProspect, i: number) => boolean,
	) =>
		pool
			.map((p, i) => ({ p, i, r: rng.random() }))
			.filter(({ p, i, r }) => filter(p, i) && r < fraction)
			.map(({ i }) => i);
	const setAge = (i: number, delta: number) => {
		const age = pool[i]!.age;
		const target = Math.min(ages[1], Math.max(ages[0], age + delta));
		changes[i]!.age = target - age;
	};
	const nudge = (i: number, ...kinds: NudgeKind[]) => {
		changes[i]!.nudges = [...(changes[i]!.nudges ?? []), ...kinds];
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
				nudge(i, "guard");
			}
			break;
		case "bigs":
			for (const i of some(0.5, (p) => !BIGS.has(p.pos))) {
				nudge(i, "big");
			}
			break;
		case "wings":
			for (const i of some(0.6, (p) => GUARDS.has(p.pos) || BIGS.has(p.pos))) {
				nudge(i, "wing");
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
		case "shooters":
			for (const i of some(0.55, () => true)) {
				nudge(i, "shooter");
			}
			break;
		case "defenders":
			for (const i of some(0.55, () => true)) {
				nudge(i, "defender");
			}
			break;
		case "athletes":
			for (const i of some(0.55, () => true)) {
				nudge(i, "athlete");
				if (pool[i]!.age > ages[0] && rng.random() < 0.5) {
					setAge(i, -1);
					changes[i]!.ovr -= 1.5;
				}
			}
			break;
		case "pointGuards": {
			const toGuard = new Set(some(0.3, (p) => !GUARDS.has(p.pos)));
			for (const i of some(
				0.7,
				(p, j) => GUARDS.has(p.pos) || toGuard.has(j),
			)) {
				if (toGuard.has(i)) {
					nudge(i, "guard");
				}
				nudge(i, "playmaker");
			}
			break;
		}
		case "stretchBigs": {
			const toBig = new Set(some(0.35, (p) => !BIGS.has(p.pos)));
			for (const i of some(0.7, (p, j) => BIGS.has(p.pos) || toBig.has(j))) {
				if (toBig.has(i)) {
					nudge(i, "big");
				}
				nudge(i, "stretch");
			}
			break;
		}
		case "twoWayWings": {
			const toWing = new Set(
				some(0.7, (p) => GUARDS.has(p.pos) || BIGS.has(p.pos)),
			);
			for (const i of some(
				0.75,
				(p, j) => (!GUARDS.has(p.pos) && !BIGS.has(p.pos)) || toWing.has(j),
			)) {
				if (toWing.has(i)) {
					nudge(i, "wing");
				}
				nudge(i, "twoWay");
			}
			break;
		}
		case "oneAndDone":
			for (const i of some(0.7, (p) => p.age > ages[0])) {
				setAge(i, ages[0] - pool[i]!.age);
				changes[i]!.ovr -= 1.4 * -changes[i]!.age;
			}
			break;
		case "lateBloomers":
			// Older, and so much better than a year ago that their ceilings went up too
			range(0, SHAPE_POOL, -0.9);
			for (const i of some(0.35, (p) => p.age < ages[1])) {
				setAge(i, 1);
				changes[i]!.ovr += 4.5;
			}
			break;
		case "intlBigs": {
			for (const i of some(0.35, (p) => !p.international)) {
				changes[i]!.international = true;
				if (!BIGS.has(pool[i]!.pos) && rng.random() < 0.7) {
					nudge(i, "big");
				}
			}
			for (const i of some(0.4, (p) => p.international && !BIGS.has(p.pos))) {
				nudge(i, "big");
			}
			break;
		}
		case "midMajor":
			range(0, 8, -1);
			range(15, 45, 0.6);
			for (const i of some(0.45, (p, j) => !p.international && j < 45)) {
				changes[i]!.midMajor = true;
			}
			break;
		case "boomOrBust": {
			// Pairs of neighbors on the board: one goes up, one goes down, so the class as a whole is as good as before
			const top = Math.min(40, pool.length);
			for (let i = 0; i + 1 < top; i += 2) {
				const swing = 3 + 3 * rng.random();
				const up = rng.random() < 0.5 ? i : i + 1;
				changes[up]!.ovr += swing;
				changes[up === i ? i + 1 : i]!.ovr -= swing;
			}
			for (const i of some(0.5, (p, j) => p.age > ages[0] && j < top)) {
				setAge(i, -1);
				changes[i]!.ovr -= 1.4;
			}
			break;
		}
		case "polished":
			for (const i of some(0.6, () => true)) {
				nudge(i, "polished");
				if (pool[i]!.age < ages[1] && rng.random() < 0.5) {
					setAge(i, 1);
				}
			}
			range(0, SHAPE_POOL, 0.6);
			break;
		case "coHeadliners": {
			if (pool.length >= 2) {
				const target = Math.max(pool[0]!.ovr, pool[1]!.ovr) + 4;
				changes[0]!.ovr += target - pool[0]!.ovr;
				changes[1]!.ovr += target - 0.5 - pool[1]!.ovr;
			}
			range(2, 35, -0.9);
			break;
		}
		case "countrySpike": {
			const country =
				SPIKE_COUNTRIES[Math.floor(rng.random() * SPIKE_COUNTRIES.length)]!;
			for (const i of some(0.2, (_p, j) => j < 45)) {
				changes[i]!.international = true;
				changes[i]!.country = country;
			}
			break;
		}
		case "injuryRiddled":
			range(0, SHAPE_POOL, 0.5);
			for (const i of some(0.3, (_p, j) => j < 40)) {
				changes[i]!.injury = true;
				changes[i]!.ovr -= 1.7;
			}
			break;
		default:
	}
	return changes.filter(
		(c) =>
			c.ovr !== 0 ||
			c.age !== 0 ||
			c.nudges ||
			c.international ||
			c.midMajor ||
			c.injury,
	);
};

// What a nudge does to the expanded ratings: wingspan, and the splits of diq (pdef - idef), reb (oreb - dreb) and fg + tp (csh - dsh), and ball security
export type ExpandedTilt = {
	wng?: number;
	def?: number;
	reb?: number;
	shoot?: number;
	bsc?: number;
};

// Rating changes for a nudge (before the ratings are shifted back to the same ovr), inches of height and pounds, and the expanded ratings tilt
export const NUDGES: Record<
	| "guard"
	| "big"
	| "shooter"
	| "defender"
	| "athlete"
	| "playmaker"
	| "stretch"
	| "twoWay"
	| "polished",
	{
		ratings: Partial<Record<string, number>>;
		inches: number;
		weight: number;
		tilt: ExpandedTilt;
	}
> = {
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
		tilt: { reb: -2, shoot: -2 },
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
		tilt: { reb: 2, shoot: 2 },
	},
	shooter: {
		ratings: {
			tp: 9,
			fg: 5,
			ft: 7,
			oiq: 1,
			ins: -4,
			dnk: -4,
			reb: -3,
			stre: -3,
		},
		inches: 0,
		weight: -3,
		tilt: { shoot: 4 },
	},
	defender: {
		ratings: {
			diq: 8,
			stre: 2,
			spd: 2,
			endu: 2,
			oiq: -4,
			tp: -5,
			fg: -4,
			ft: -4,
			drb: -2,
		},
		inches: 0,
		weight: 3,
		tilt: { wng: 3 },
	},
	athlete: {
		ratings: {
			spd: 7,
			jmp: 9,
			endu: 4,
			stre: 3,
			dnk: 5,
			oiq: -6,
			fg: -5,
			tp: -5,
			ft: -6,
			pss: -3,
		},
		inches: 0,
		weight: 3,
		tilt: { wng: 2, reb: 4 },
	},
	playmaker: {
		ratings: {
			hgt: -3,
			pss: 10,
			drb: 7,
			oiq: 4,
			ins: -4,
			reb: -5,
			dnk: -3,
			stre: -3,
		},
		inches: -2,
		weight: -8,
		tilt: { bsc: 5, shoot: -4 },
	},
	stretch: {
		ratings: {
			tp: 10,
			fg: 4,
			ft: 5,
			ins: -5,
			dnk: -2,
			reb: -2,
		},
		inches: 0,
		weight: -5,
		tilt: { shoot: 4, reb: -4 },
	},
	twoWay: {
		ratings: {
			diq: 5,
			tp: 4,
			oiq: -3,
			ins: -3,
			pss: -2,
			dnk: -1,
		},
		inches: 0,
		weight: 0,
		tilt: { wng: 3, def: 4 },
	},
	polished: {
		ratings: {
			oiq: 6,
			diq: 4,
			ft: 4,
			pss: 3,
			spd: -4,
			jmp: -5,
			endu: -2,
		},
		inches: 0,
		weight: 2,
		tilt: { bsc: 4 },
	},
};

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

// Countries that could have a golden generation (the home-country spike)
export const SPIKE_COUNTRIES = [
	"France",
	"Serbia",
	"Spain",
	"Lithuania",
	"Germany",
	"Australia",
	"Greece",
	"Canada",
	"Nigeria",
	"Croatia",
	"Turkey",
	"Argentina",
];
