// What each grade measures: a 0-100 score (rating scale) from the ratings the user sees, blended with production when there is a real
// sample. The grade itself is the score's percentile among the player's peers (see grades.ts and report.ts). Pure.
import type {
	GradeKey,
	PeerGroup,
	ScoutProduction,
	ScoutRatings,
	ScoutTraitReading,
} from "./types.ts";

export const GRADE_LABELS: Record<GradeKey, string> = {
	shoot: "Shooting",
	cs: "Catch-and-shoot",
	od: "Off the dribble",
	ft: "Free throws",
	fin: "Finishing",
	pm: "Playmaking",
	bs: "Ball security",
	reb: "Rebounding",
	pd: "Perimeter defense",
	id: "Interior defense",
	ath: "Athleticism",
	size: "Size/length",
	iq: "Basketball IQ",
	motor: "Motor/intangibles",
};

export const SHORT_LABELS: Record<GradeKey, string> = {
	shoot: "SHT",
	cs: "C&S",
	od: "OTD",
	ft: "FT",
	fin: "FIN",
	pm: "PLY",
	bs: "BSC",
	reb: "REB",
	pd: "PDF",
	id: "IDF",
	ath: "ATH",
	size: "SIZ",
	iq: "IQ",
	motor: "MTR",
};

export const SUB_KEYS: ReadonlySet<GradeKey> = new Set(["cs", "od", "ft"]);

// Keys on the radar chart
export const RADAR_KEYS: GradeKey[] = [
	"shoot",
	"fin",
	"pm",
	"reb",
	"pd",
	"id",
	"ath",
	"iq",
];

export const peerGroupOf = (pos: string): PeerGroup =>
	pos.includes("C") || pos === "PF" || pos === "FC"
		? "big"
		: pos === "PG" || pos === "SG" || pos === "G"
			? "guard"
			: "wing";

export const GROUP_NOUN: Record<PeerGroup, string> = {
	guard: "guard",
	wing: "wing",
	big: "big",
};

// How much each grade counts for an overall grade
export const OVERALL_WEIGHTS: Record<PeerGroup, Record<GradeKey, number>> = {
	guard: {
		shoot: 1.4,
		cs: 0,
		od: 0,
		ft: 0,
		fin: 0.8,
		pm: 1.3,
		bs: 0.6,
		reb: 0.3,
		pd: 0.9,
		id: 0.2,
		ath: 0.9,
		size: 0.5,
		iq: 1,
		motor: 0.5,
	},
	wing: {
		shoot: 1.3,
		cs: 0,
		od: 0,
		ft: 0,
		fin: 1,
		pm: 0.7,
		bs: 0.4,
		reb: 0.6,
		pd: 1,
		id: 0.5,
		ath: 1,
		size: 0.7,
		iq: 1,
		motor: 0.5,
	},
	big: {
		shoot: 0.6,
		cs: 0,
		od: 0,
		ft: 0,
		fin: 1.3,
		pm: 0.4,
		bs: 0.3,
		reb: 1.3,
		pd: 0.5,
		id: 1.4,
		ath: 0.8,
		size: 1.1,
		iq: 0.9,
		motor: 0.6,
	},
};

const clamp = (x: number, lo = 0, hi = 100) => Math.max(lo, Math.min(hi, x));

const traitScore = (traits: ScoutTraitReading[] | undefined, key: string) => {
	const t = traits?.find((x) => x.key === key && !x.hidden);
	return t ? t.estimate : undefined;
};

// How much production counts, 0 to 0.4: real minutes, and less for lower levels of competition
export const productionWeight = (s: ScoutProduction | undefined) => {
	if (!s || s.gp <= 0) {
		return 0;
	}
	const minutes = s.gp * s.min;
	const sample = Math.min(1, minutes / 1400);
	const level =
		s.level === "pro"
			? 1
			: s.level === "college"
				? 0.7
				: s.level === "overseas"
					? 0.75
					: 0.45;
	return 0.4 * sample * level;
};

const per36 = (s: ScoutProduction, x: number) =>
	s.min > 0 ? (x * 36) / s.min : 0;

// Production on the rating scale (50 = typical rotation player). Undefined when that stat says nothing (no attempts)
const productionScores = (
	s: ScoutProduction,
	group: PeerGroup,
): Partial<Record<GradeKey, number>> => {
	const out: Partial<Record<GradeKey, number>> = {};
	const tpa36 = per36(s, s.tpa);
	if (s.gp * s.tpa >= 25) {
		// Accuracy, with a little credit for volume
		out.cs = clamp(50 + 2.2 * (s.tpPct - 35) + 1.2 * (tpa36 - 4));
	}
	if (s.gp * s.fta >= 20) {
		out.ft = clamp(50 + 1.25 * (s.ftPct - 75));
	}
	if (s.midA !== undefined && s.midPct !== undefined && s.gp * s.midA >= 25) {
		out.od = clamp(50 + 1.6 * (s.midPct - 40) + 1.5 * (per36(s, s.midA) - 3));
	}
	if (s.rimA !== undefined && s.rimPct !== undefined && s.gp * s.rimA >= 25) {
		out.fin = clamp(50 + 1.4 * (s.rimPct - 62) + 1.5 * (per36(s, s.rimA) - 4));
	} else if (s.gp * s.fga >= 60) {
		out.fin = clamp(50 + 1.2 * (s.fgPct - 46) + 0.8 * (per36(s, s.fta) - 3));
	}
	const ast36 = per36(s, s.ast);
	out.pm = clamp(50 + 4.5 * (ast36 - (group === "guard" ? 5 : group === "wing" ? 2.8 : 2.2)));
	const tov36 = per36(s, s.tov);
	if (ast36 + tov36 > 0.5) {
		// Turnovers against how much he has the ball
		const load = per36(s, s.fga + 0.44 * s.fta + s.ast);
		out.bs = clamp(50 - 9 * (tov36 - (0.08 * load + 0.6)));
	}
	const trb36 = per36(s, s.trb);
	out.reb = clamp(50 + 3.2 * (trb36 - (group === "big" ? 10 : group === "wing" ? 6.5 : 4.5)));
	const stl36 = per36(s, s.stl);
	const blk36 = per36(s, s.blk);
	out.pd = clamp(50 + 14 * (stl36 - 1.2));
	out.id = clamp(50 + 9 * (blk36 - (group === "big" ? 1.5 : 0.5)));
	if (s.per !== undefined && s.level === "pro") {
		out.iq = clamp(50 + 1.6 * (s.per - 14));
	}
	return out;
};

export type CategoryScores = Record<GradeKey, number>;

/**
 * The 0-100 score of each category. ratings: as the user sees them (undefined when hidden: production only, centered at 50). traits: the
 * user's readings (hidden traits are never used here, only visible ones). productionMult scales how much production counts (scout biases).
 */
export const categoryScores = ({
	ratings: r,
	production,
	group,
	traits,
	productionMult = 1,
}: {
	ratings: ScoutRatings | undefined;
	production: ScoutProduction | undefined;
	group: PeerGroup;
	traits?: ScoutTraitReading[];
	productionMult?: number;
}): CategoryScores => {
	const base: CategoryScores = r
		? {
				shoot: 0,
				cs: r.csh ?? 0.6 * r.tp + 0.4 * r.fg,
				od: r.dsh ?? 0.5 * r.fg + 0.3 * r.tp + 0.2 * r.drb,
				ft: r.ft,
				fin: 0.38 * r.ins + 0.32 * r.dnk + 0.12 * r.hgt + 0.1 * r.jmp + 0.08 * r.stre,
				pm: 0.55 * r.pss + 0.25 * r.drb + 0.2 * r.oiq,
				bs: r.bsc ?? 0.5 * r.drb + 0.3 * r.oiq + 0.2 * r.pss,
				reb:
					r.oreb !== undefined && r.dreb !== undefined
						? 0.4 * r.oreb + 0.6 * r.dreb
						: r.reb,
				pd: r.pdef ?? 0.45 * r.diq + 0.35 * r.spd + 0.2 * r.jmp,
				id: r.idef ?? 0.4 * r.diq + 0.35 * r.hgt + 0.15 * r.jmp + 0.1 * r.stre,
				ath: 0.42 * r.spd + 0.42 * r.jmp + 0.16 * r.endu,
				size: 0.55 * r.hgt + 0.3 * (r.wng ?? r.hgt) + 0.15 * r.stre,
				iq: 0.5 * r.oiq + 0.5 * r.diq,
				motor: r.endu,
			}
		: {
				shoot: 0,
				cs: 50,
				od: 50,
				ft: 50,
				fin: 50,
				pm: 50,
				bs: 50,
				reb: 50,
				pd: 50,
				id: 50,
				ath: 50,
				size: 50,
				iq: 50,
				motor: 50,
			};

	// Motor: conditioning plus the visible effort traits (hustle, motor) when there is a reading
	const hustle = traitScore(traits, "hustle");
	const motorTrait = traitScore(traits, "motor");
	const effort = [hustle, motorTrait].filter((x) => x !== undefined);
	if (effort.length > 0) {
		const avg = effort.reduce((a, b) => a + b, 0) / effort.length;
		base.motor = 0.45 * base.motor + 0.55 * avg;
	}

	const w = Math.min(0.6, productionWeight(production) * productionMult) * (r ? 1 : 2.2);
	if (production && w > 0) {
		const prod = productionScores(production, group);
		for (const [key, value] of Object.entries(prod) as [GradeKey, number][]) {
			// Without ratings, production is all there is
			const ww = r ? w : Math.min(0.85, w);
			base[key] = (1 - ww) * base[key] + ww * value;
		}
	}

	base.shoot = 0.45 * base.cs + 0.35 * base.od + 0.2 * base.ft;
	return base;
};
