import { buildBaseNorms, probit } from "./norms.ts";
import { archetypePrior, isPos, positionOf } from "./position.ts";
import { gateFactor, prepare, rawMatch } from "./score.ts";
import type { Archetype, ArchetypeRatings, Norms } from "./types.ts";

// Standard normal quantile grid the match tables are stored on
export const MATCH_Z: number[] = Array.from(
	{ length: 61 },
	(_, i) => Math.round((-2.5 + i * 0.1) * 10) / 10,
);

const phi = (x: number) => {
	// Abramowitz-Stegun erf
	const t = 1 / (1 + (0.3275911 * Math.abs(x)) / Math.SQRT2);
	const y =
		1 -
		((((1.061405429 * t - 1.453152027) * t + 1.421413741) * t - 0.284496736) *
			t +
			0.254829592) *
			t *
			Math.exp(-(x * x) / 2);
	return 0.5 * (1 + (x < 0 ? -y : y));
};

// Where a raw match sits in an archetype's table, as a standard-normal z (clamped to the grid, extended by a little)
export const matchZ = (table: number[], score: number) => {
	const n = table.length;
	if (score <= table[0]!) {
		return MATCH_Z[0]! - Math.min(1, (table[0]! - score) * 8);
	}
	if (score >= table[n - 1]!) {
		return MATCH_Z[n - 1]! + Math.min(1, (score - table[n - 1]!) * 8);
	}
	let lo = 0;
	let hi = n - 1;
	while (hi - lo > 1) {
		const mid = (lo + hi) >> 1;
		if (table[mid]! <= score) {
			lo = mid;
		} else {
			hi = mid;
		}
	}
	const span = table[hi]! - table[lo]!;
	const f = span > 0 ? (score - table[lo]!) / span : 0;
	return MATCH_Z[lo]! + f * (MATCH_Z[hi]! - MATCH_Z[lo]!);
};

// A reference league's norms: dimension quantiles, height correlations, ovr quantiles and every archetype's match table
export const buildNorms = (
	// pos: his position as the game shows it (else BBGM's formula)
	rows: { ratings: ArchetypeRatings; ovr?: number; pos?: string }[],
	archetypes: Archetype[],
	// Tables to use for archetypes with too few peers in this league (the built-in reference league)
	fallback?: Norms,
	// Quantiles to read the rows against (default: their own)
	baseNorms?: Omit<Norms, "match">,
): Norms => {
	const base = baseNorms ?? buildBaseNorms(rows);
	const prepared = rows.map((r) => ({
		...prepare(r.ratings, { ...base, match: {} }),
		pos: isPos(r.pos) ? r.pos : positionOf(r.ratings),
	}));
	const match: Norms["match"] = {};
	for (const a of archetypes) {
		// Raw prospects and veterans are scarce in any one league (prospects are not even in it): always read against the
		// reference league's tables, which were built with them in
		if ((a.level || a.age) && fallback?.match[a.id]) {
			match[a.id] = fallback.match[a.id]!;
			continue;
		}
		const inGate = prepared
			// His peers: players inside the height gate at positions the archetype allows
			.filter(
				(p) =>
					gateFactor(p.hgt, a.hgt) >= 0.9 &&
					(archetypePrior(a, p.pos) ?? -Infinity) > -1,
			)
			.map((p) => rawMatch(a, p.z, p.hgt, p.skills, p.level, p.expanded))
			.sort((x, y) => x - y);
		// Too few peers (a small league, or a very rare body type): reuse the reference league's table rather than read him
		// against everyone, which would make any player look like an exceptional fit for an archetype nobody in the league has
		if (inGate.length < 40 && fallback?.match[a.id]) {
			match[a.id] = fallback.match[a.id]!;
			continue;
		}
		const vals =
			inGate.length >= 8
				? inGate
				: prepared
						.map((p) => rawMatch(a, p.z, p.hgt, p.skills, p.level, p.expanded))
						.sort((x, y) => x - y);
		match[a.id] = MATCH_Z.map((z) => {
			const pos = Math.min(1, Math.max(0, phi(z))) * (vals.length - 1);
			const lo = Math.floor(pos);
			const hi = Math.ceil(pos);
			return (
				Math.round(
					(vals[lo]! + (vals[hi]! - vals[lo]!) * (pos - lo)) * 100000,
				) / 100000
			);
		});
	}
	void probit;
	return { ...base, match };
};
