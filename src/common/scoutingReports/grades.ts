// Letter grades for scouting reports: A+ ... F, from a percentile among the player's peers. Pure.

export const GRADE_LETTERS = [
	"F",
	"D-",
	"D",
	"D+",
	"C-",
	"C",
	"C+",
	"B-",
	"B",
	"B+",
	"A-",
	"A",
	"A+",
] as const;

export type GradeLetter = (typeof GRADE_LETTERS)[number];

// Lowest percentile (0-100) for each grade, F first. Roughly a bell: C is the middle of the peer group, A+ the top 3%, F the bottom 4%
export const GRADE_FLOORS = [0, 4, 9, 16, 25, 35, 46, 57, 67, 77, 85, 92, 97];

export const MAX_GRADE = GRADE_LETTERS.length - 1;

export const gradeFromPercentile = (pct: number) => {
	let out = 0;
	for (let i = 0; i < GRADE_FLOORS.length; i++) {
		if (pct >= GRADE_FLOORS[i]!) {
			out = i;
		}
	}
	return out;
};

export const gradeLetter = (grade: number) =>
	GRADE_LETTERS[Math.max(0, Math.min(MAX_GRADE, Math.round(grade)))]!;

// "B+" or, when the scouts are not sure, "B to A-"
export const formatGradeRange = (lo: number, hi: number) =>
	lo === hi ? gradeLetter(lo) : `${gradeLetter(lo)} to ${gradeLetter(hi)}`;

// Percentile (0-100) of x in an ascending list. Ties count half. Empty list: 50
export const percentileOf = (sorted: readonly number[], x: number) => {
	const n = sorted.length;
	if (n === 0) {
		return 50;
	}
	let lo = 0;
	let hi = n;
	while (lo < hi) {
		const mid = (lo + hi) >> 1;
		if (sorted[mid]! < x) {
			lo = mid + 1;
		} else {
			hi = mid;
		}
	}
	const below = lo;
	let eq = 0;
	while (below + eq < n && sorted[below + eq] === x) {
		eq += 1;
	}
	return (100 * (below + 0.5 * eq)) / n;
};

// Grades in a stored snapshot, one character each ("a" = F ... "m" = A+)
export const encodeGrades = (grades: readonly number[]) =>
	grades
		.map((x) =>
			String.fromCharCode(97 + Math.max(0, Math.min(MAX_GRADE, Math.round(x)))),
		)
		.join("");

export const decodeGrades = (code: string) =>
	[...code].map((c) => Math.max(0, Math.min(MAX_GRADE, c.charCodeAt(0) - 97)));

// A color class for a grade (Bootstrap text utilities)
export const gradeClass = (grade: number) =>
	grade >= 10
		? "text-success"
		: grade >= 7
			? "text-success-emphasis"
			: grade >= 4
				? "text-body"
				: grade >= 2
					? "text-warning-emphasis"
					: "text-danger";

// Hex colors for charts and the PDF, F (red) to A+ (green)
export const gradeColor = (grade: number) => {
	const t = Math.max(0, Math.min(1, grade / MAX_GRADE));
	const stops = [
		[198, 40, 40],
		[239, 160, 40],
		[200, 190, 60],
		[85, 139, 47],
		[46, 125, 50],
	];
	const pos = t * (stops.length - 1);
	const i = Math.min(stops.length - 2, Math.floor(pos));
	const f = pos - i;
	const c = stops[i]!.map((v, k) => Math.round(v + (stops[i + 1]![k]! - v) * f));
	return `#${c.map((v) => v.toString(16).padStart(2, "0")).join("")}`;
};
