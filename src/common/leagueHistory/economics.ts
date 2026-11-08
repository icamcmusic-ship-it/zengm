// League economics: payroll inequality by season, luxury tax bills, payroll growth and whether money buys titles.
//
// Payrolls are the end of season payrolls the game stores on each team season once its regular season and playoffs are over (thousands of dollars). Before that (and in leagues imported without them) they are missing, which is unknown, never $0. A season counts only if at least three quarters of its teams have one. Luxury tax bills are the team seasons' luxury tax expense.

import { gini, mean, quantile } from "./util.ts";

export type EcoTeamSeason = {
	tid: number;
	season: number;
	// End of season payroll, or anything <= 0 if unknown
	payroll: number;
	luxuryTax: number;
	playoffRoundsWon: number;
};

export type EcoInput = {
	teamSeasons: EcoTeamSeason[];
	// Rounds in each season's playoffs, to find the champion
	numPlayoffRounds: Record<number, number>;
	// Seasons whose playoffs are over
	completeSeasons: Set<number>;
};

export type EcoPayroll = { tid: number; payroll: number };

export type EcoSeason = {
	season: number;
	n: number;
	teams: number;
	payrolls: EcoPayroll[];
	mean: number;
	median: number;
	min: number;
	max: number;
	spread: number;
	ratio: number | null;
	gini: number | null;
	cv: number | null;
	top: EcoPayroll;
	bottom: EcoPayroll;
	taxPayers: number;
	taxTotal: number;
	// Average payroll change per season since the previous season with payrolls
	growth: number | null;
};

export type EcoChampion = {
	season: number;
	tid: number;
	payroll: number;
	// 1 = biggest payroll
	rank: number;
	of: number;
	// Payroll / season average
	rel: number;
};

export type EcoTax = {
	tid: number;
	season: number;
	amount: number;
	payroll: number | null;
};

export type EcoTaxTeam = {
	tid: number;
	times: number;
	total: number;
	last: number;
};

export type Economics = {
	seasons: EcoSeason[];
	unknownSeasons: number[];
	taxes: EcoTax[];
	taxByTeam: EcoTaxTeam[];
	champions: EcoChampion[];
	summary: {
		from: number;
		to: number;
		n: number;
		// Compound annual growth of the average payroll
		cagr: number | null;
		topPaidWon: number;
		top3Won: number;
		decided: number;
		meanRank: number | null;
	} | null;
	cheapestChampions: EcoChampion[];
};

export const buildEconomics = (input: EcoInput): Economics => {
	const bySeason = new Map<number, EcoTeamSeason[]>();
	for (const ts of input.teamSeasons) {
		let list = bySeason.get(ts.season);
		if (!list) {
			list = [];
			bySeason.set(ts.season, list);
		}
		list.push(ts);
	}

	const taxes: EcoTax[] = [];
	for (const ts of input.teamSeasons) {
		if (ts.luxuryTax > 0) {
			taxes.push({
				tid: ts.tid,
				season: ts.season,
				amount: ts.luxuryTax,
				payroll: ts.payroll > 0 ? ts.payroll : null,
			});
		}
	}
	taxes.sort((a, b) => b.amount - a.amount || b.season - a.season);

	const seasons: EcoSeason[] = [];
	const unknownSeasons: number[] = [];
	const champions: EcoChampion[] = [];
	let prev: EcoSeason | undefined;
	for (const season of [...bySeason.keys()].sort((a, b) => a - b)) {
		const rows = bySeason.get(season)!;
		const known = rows.filter((r) => r.payroll > 0);
		if (known.length < Math.max(2, 0.75 * rows.length)) {
			unknownSeasons.push(season);
			continue;
		}
		const payrolls = known
			.map((r) => ({ tid: r.tid, payroll: r.payroll }))
			.sort((a, b) => b.payroll - a.payroll || a.tid - b.tid);
		const v = payrolls.map((x) => x.payroll);
		const asc = [...v].reverse();
		const m = mean(v)!;
		const sd = Math.sqrt(v.reduce((a, x) => a + (x - m) ** 2, 0) / v.length);
		const tx = rows.filter((r) => r.luxuryTax > 0);
		const S: EcoSeason = {
			season,
			n: payrolls.length,
			teams: rows.length,
			payrolls,
			mean: m,
			median: quantile(asc, 0.5)!,
			min: asc[0]!,
			max: v[0]!,
			spread: v[0]! - asc[0]!,
			ratio: asc[0]! > 0 ? v[0]! / asc[0]! : null,
			gini: gini(v),
			cv: m > 0 ? sd / m : null,
			top: payrolls[0]!,
			bottom: payrolls.at(-1)!,
			taxPayers: tx.length,
			taxTotal: tx.reduce((a, r) => a + r.luxuryTax, 0),
			growth: prev
				? (m - prev.mean) / prev.mean / (season - prev.season)
				: null,
		};
		seasons.push(S);
		prev = S;

		const rounds = input.numPlayoffRounds[season];
		if (
			input.completeSeasons.has(season) &&
			rounds !== undefined &&
			rounds > 0
		) {
			const champ = rows.find((r) => r.playoffRoundsWon === rounds);
			if (champ) {
				const i = payrolls.findIndex((x) => x.tid === champ.tid);
				if (i >= 0) {
					champions.push({
						season,
						tid: champ.tid,
						payroll: payrolls[i]!.payroll,
						rank: i + 1,
						of: payrolls.length,
						rel: payrolls[i]!.payroll / m,
					});
				}
			}
		}
	}

	const byTeam = new Map<number, EcoTaxTeam>();
	for (const t of taxes) {
		let e = byTeam.get(t.tid);
		if (!e) {
			e = { tid: t.tid, times: 0, total: 0, last: t.season };
			byTeam.set(t.tid, e);
		}
		e.times += 1;
		e.total += t.amount;
		e.last = Math.max(e.last, t.season);
	}

	let summary: Economics["summary"] = null;
	const a = seasons[0];
	const b = seasons.at(-1);
	if (a && b) {
		const years = b.season - a.season;
		summary = {
			from: a.season,
			to: b.season,
			n: seasons.length,
			cagr:
				years > 0 && a.mean > 0 ? (b.mean / a.mean) ** (1 / years) - 1 : null,
			topPaidWon: champions.filter((c) => c.rank === 1).length,
			top3Won: champions.filter((c) => c.rank <= 3).length,
			decided: champions.length,
			meanRank: mean(champions.map((c) => c.rank)),
		};
	}

	return {
		seasons,
		unknownSeasons,
		taxes,
		taxByTeam: [...byTeam.values()].sort(
			(x, y) => y.total - x.total || y.times - x.times || x.tid - y.tid,
		),
		champions,
		summary,
		cheapestChampions: [...champions].sort(
			(x, y) => x.rel - y.rel || x.season - y.season,
		),
	};
};
