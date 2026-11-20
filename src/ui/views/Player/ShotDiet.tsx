import { useState } from "react";
import HideableSection from "../../components/HideableSection.tsx";
import { shotDiet } from "../../../common/advStats.ts";

// Shot Share Model: where a player's shots came from (normal draw, self-created, putbacks, late clock, hot hand, double-team kick-outs,
// mismatch hunting) and what moved his share of his team's shots (coach system, fatigue, shot discipline, defensive attention, game plan,
// role), for one regular season or his career. Recorded by Advanced Tracking Stats, so only seasons played with the model on have it.

type AdvSeason = { season: number | "career"; adv: number[] };

const pct = (x: number) => `${(100 * x).toFixed(1)}%`;

const effect = (mult: number) => {
	const change = 100 * (mult - 1);
	if (Math.abs(change) < 0.05) {
		return "—";
	}
	return `${change > 0 ? "+" : ""}${change.toFixed(1)}%`;
};

export const ShotDiet = ({
	advSeasons,
}: {
	advSeasons: AdvSeason[] | undefined;
}) => {
	const seasons = (advSeasons ?? []).filter(
		(row) => shotDiet(row.adv) !== undefined,
	);
	const defaultIndex = Math.max(0, seasons.length - 2);
	const [index, setIndex] = useState<number | undefined>();
	if (seasons.length === 0) {
		return null;
	}
	const selected = seasons[index ?? defaultIndex] ?? seasons[0]!;
	const diet = shotDiet(selected.adv)!;
	const maxPct = Math.max(0.01, ...diet.sources.map((s) => s.pct));

	return (
		<HideableSection
			title="Shot diet"
			description="Where his shots came from and what moved his share of his team's shots (regular season, every shot counted once)."
		>
			<div className="mb-2">
				<select
					aria-label="Season"
					className="form-select form-select-sm d-inline-block w-auto"
					value={index ?? defaultIndex}
					onChange={(event) => {
						setIndex(Number(event.target.value));
					}}
				>
					{seasons.map((row, i) => (
						<option key={String(row.season)} value={i}>
							{row.season === "career" ? "Career" : row.season}
						</option>
					))}
				</select>
			</div>
			<div className="row">
				<div className="col-12 col-md-6 mb-3" style={{ maxWidth: 480 }}>
					<table className="table table-sm table-striped mb-0">
						<thead>
							<tr>
								<th>Source</th>
								<th className="text-end">Shots</th>
								<th style={{ minWidth: 140 }}>Share</th>
							</tr>
						</thead>
						<tbody>
							{diet.sources.map((s) => (
								<tr key={s.key}>
									<td className="text-nowrap">{s.name}</td>
									<td className="text-end">{s.count}</td>
									<td>
										<div className="d-flex align-items-center">
											<div
												className="bg-primary rounded-1 me-2"
												style={{
													height: 10,
													width: `${(70 * s.pct) / maxPct}%`,
													minWidth: 2,
												}}
											/>
											<span className="small text-nowrap">{pct(s.pct)}</span>
										</div>
									</td>
								</tr>
							))}
						</tbody>
					</table>
				</div>
				<div className="col-12 col-md-6 mb-3" style={{ maxWidth: 360 }}>
					<table className="table table-sm table-striped mb-0">
						<thead>
							<tr>
								<th>Modifier</th>
								<th
									className="text-end"
									title="Average change to his share of the shooter draw, over the shots he got from it"
								>
									His share
								</th>
							</tr>
						</thead>
						<tbody>
							{diet.modifiers.map((m) => (
								<tr key={m.key}>
									<td className="text-nowrap">{m.name}</td>
									<td className="text-end">{effect(m.mult)}</td>
								</tr>
							))}
						</tbody>
					</table>
				</div>
			</div>
		</HideableSection>
	);
};
