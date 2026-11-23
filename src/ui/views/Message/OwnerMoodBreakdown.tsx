import { helpers } from "../../util/helpers.ts";
import type { View } from "../../../common/types.ts";

type OwnerMoods = NonNullable<
	NonNullable<View<"message">["message"]>["ownerMoods"]
>;

const Delta = ({ value }: { value: number | undefined }) => {
	if (value === undefined) {
		return <span className="text-body-secondary">?</span>;
	}
	const rounded = Math.round(value * 100) / 100;
	return (
		<span
			className={
				rounded > 0 ? "text-success" : rounded < 0 ? "text-danger" : undefined
			}
		>
			{rounded > 0 ? "+" : ""}
			{rounded.toFixed(2)}
		</span>
	);
};

// Explains what drove owner mood each season: the change in each component, and the result behind it compared to what the owner expects
const OwnerMoodBreakdown = ({ ownerMoods }: { ownerMoods: OwnerMoods }) => {
	const rows = ownerMoods.toReversed();

	return (
		<details className="mt-3" style={{ maxWidth: 700 }}>
			<summary className="fw-bold">Why does the owner feel this way?</summary>
			<p className="mt-2 mb-2">
				Each season, the owner's mood changes based on three things:{" "}
				<b>regular season</b> (winning percentage compared to .500),{" "}
				<b>playoffs</b> (missing them hurts, each round won helps, a title helps
				the most), and <b>finances</b> (profit compared to what the owner
				expects). Each component is capped at +1 in total, and changes are not
				counted before the owner starts judging you. With the Owner's Office,
				the owner's mid-season requests and ultimatums add their stakes, and his
				patience sets the firing line.
			</p>
			<div className="table-responsive">
				<table className="table table-sm table-striped mb-0">
					<thead>
						<tr>
							<th>Season</th>
							<th>Regular season</th>
							<th>Playoffs</th>
							<th>Finances</th>
							<th>Total</th>
						</tr>
					</thead>
					<tbody>
						{rows.map((row) => {
							const info = row.seasonInfo;
							const gp = info
								? info.won + info.lost + (info.tied ?? 0) + (info.otl ?? 0)
								: 0;
							const winPct =
								info && gp > 0
									? (info.won + 0.5 * (info.tied ?? 0)) / gp
									: undefined;
							const totalDelta = row.deltas
								? row.deltas.wins + row.deltas.playoffs + row.deltas.money
								: undefined;

							return (
								<tr key={row.season}>
									<td>{row.season}</td>
									<td>
										<Delta value={row.deltas?.wins} />
										{info ? (
											<div className="small text-body-secondary">
												{helpers.formatRecord(info)}
												{winPct !== undefined
													? `, ${helpers.roundWinp(winPct)} vs .500`
													: null}
											</div>
										) : null}
									</td>
									<td>
										<Delta value={row.deltas?.playoffs} />
										{info ? (
											<div className="small text-body-secondary">
												{info.roundsWonText}
												{info.playoffRoundsWon >= 0
													? ` (${info.playoffRoundsWon}/${info.numPlayoffRounds} rounds)`
													: null}
											</div>
										) : null}
									</td>
									<td>
										<Delta value={row.deltas?.money} />
										{info ? (
											<div className="small text-body-secondary">
												{helpers.formatCurrency(info.profit, "M")} profit vs{" "}
												{helpers.formatCurrency(info.expectedProfit, "M")}{" "}
												expected
												{info.projectExpenses > 0
													? ` (not counting ${helpers.formatCurrency(info.projectExpenses, "M")} of owner-approved project payments)`
													: null}
												{info.profitTarget !== undefined
													? `, ${helpers.formatCurrency(info.profitTarget, "M")} budget meeting target`
													: null}
											</div>
										) : null}
									</td>
									<td>
										<Delta value={totalDelta} />
										<div className="small text-body-secondary">
											Overall: {row.total.toFixed(2)}
											{info?.firingLine !== undefined
												? ` (fired at ${info.firingLine.toFixed(2)})`
												: null}
										</div>
										{info && info.adjustments.length > 0 ? (
											<div className="small text-body-secondary">
												Includes the owner's requests:{" "}
												{info.adjustments
													.map(
														(a) =>
															`${a.text} ${a.delta >= 0 ? "+" : ""}${a.delta.toFixed(2)}`,
													)
													.join("; ")}
											</div>
										) : null}
									</td>
								</tr>
							);
						})}
					</tbody>
				</table>
			</div>
		</details>
	);
};

export default OwnerMoodBreakdown;
