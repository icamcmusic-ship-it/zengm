import { useState } from "react";
import { toWorker } from "../util/toWorker.ts";

type Data = Awaited<ReturnType<typeof load>>;

const load = () => toWorker("main", "getDraftSlotHof", undefined);

const pct = (k: number, n: number) =>
	n > 0 ? `${((100 * k) / n).toFixed(1)}%` : "-";

/**
 * Hall of Fame (and All-Star) rate by draft slot over the league's history, under the Draft History table. Read when opened: it
 * looks at every class old enough to judge.
 */
export const HofBySlot = () => {
	const [open, setOpen] = useState(false);
	const [data, setData] = useState<Data | undefined>();

	const toggle = async () => {
		const next = !open;
		setOpen(next);
		if (next && !data) {
			setData(await load());
		}
	};

	let body = null;
	if (open) {
		if (!data) {
			body = <p>Loading...</p>;
		} else if (!data.result) {
			body = (
				<p className="text-body-secondary">
					No draft class is old enough yet: a class counts once it was drafted
					at least 10 seasons ago, and there need to be 3 of them.
				</p>
			);
		} else {
			const r = data.result;
			const maxRate = Math.max(
				...r.bands.map((b) => (b.n > 0 ? b.hof / b.n : 0)),
			);
			body = (
				<>
					<p className="text-body-secondary">
						The {r.classes} classes from {r.from} to {r.to} (drafted at least{" "}
						{r.mature} seasons ago): {r.numHof} Hall of Famers out of{" "}
						{r.numPlayers} picks. Overall pick, so later rounds continue the
						count.
					</p>
					<div className="table-responsive" style={{ maxWidth: 560 }}>
						<table
							className="table table-sm table-striped table-hover"
							data-csv-table="Hall of Fame rate by draft slot"
						>
							<thead>
								<tr>
									<th>Picks</th>
									<th className="text-end">Players</th>
									<th className="text-end">HOF</th>
									<th className="text-end">HOF %</th>
									<th style={{ width: 120 }} />
									<th className="text-end">All-Star %</th>
								</tr>
							</thead>
							<tbody>
								{r.bands.map((b) => {
									const rate = b.n > 0 ? b.hof / b.n : 0;
									return (
										<tr key={b.label}>
											<td>{b.label}</td>
											<td className="text-end">{b.n}</td>
											<td className="text-end">{b.hof}</td>
											<td className="text-end">{pct(b.hof, b.n)}</td>
											<td className="align-middle">
												<div
													className="bg-danger"
													style={{
														height: 8,
														width: `${maxRate > 0 ? (100 * rate) / maxRate : 0}%`,
														opacity: 0.7,
													}}
												/>
											</td>
											<td className="text-end">{pct(b.allStar, b.n)}</td>
										</tr>
									);
								})}
							</tbody>
						</table>
					</div>
				</>
			);
		}
	}

	return (
		<div className="mt-3">
			<button
				className="btn btn-link p-0 mb-2"
				type="button"
				onClick={toggle}
				aria-expanded={open}
			>
				{open ? "Hide" : "Show"} Hall of Fame rate by draft slot
			</button>
			{body}
		</div>
	);
};
