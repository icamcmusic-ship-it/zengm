import { useState } from "react";
import { toWorker } from "../../util/toWorker.ts";
import type { HealthInfo } from "../../../worker/core/player/getHealthInfo.ts";

// Injury history grouped by body part, plus the injuryDepth setting's status for this player (minutes restriction, re-injury risk,
// injury prone, load management)
const InjuryHealth = ({ info, pid }: { info: HealthInfo; pid: number }) => {
	const [loadManagement, setLoadManagement] = useState(info.loadManagement);

	const status = [];
	if (info.enabled) {
		if (info.restrictGames > 0) {
			status.push(
				<li key="restrict">
					<b>Minutes restriction:</b> about{" "}
					{Math.round(100 * info.restrictionFactor)}% of normal playing time
					weight, {info.restrictGames} more{" "}
					{info.restrictGames === 1 ? "day" : "days"}
				</li>,
			);
		}
		if (info.returnGames > 0) {
			status.push(
				<li key="return">
					<b>Recently returned:</b> higher re-injury risk for {info.returnGames}{" "}
					more {info.returnGames === 1 ? "day" : "days"}
					{info.recentBodyPart && info.recentBodyPart !== "Other"
						? `, especially the ${info.recentBodyPart.toLowerCase()}`
						: null}
				</li>,
			);
		}
		if (info.injuryProne) {
			status.push(
				<li key="prone">
					<span className="badge bg-warning text-dark">Injury prone</span> gets
					hurt more often than most players
				</li>,
			);
		}
	}

	if (info.byBodyPart.length === 0 && status.length === 0) {
		return null;
	}

	return (
		<div className="mb-3" data-testid="injury-health">
			{status.length > 0 ? <ul className="ps-3 mb-2">{status}</ul> : null}
			{info.canEditLoadManagement ? (
				<div className="form-check mb-2">
					<input
						className="form-check-input"
						type="checkbox"
						id="player-load-management"
						checked={loadManagement}
						onChange={async (event) => {
							const value = event.target.checked;
							setLoadManagement(value);
							await toWorker("main", "setLoadManagement", { pid, value });
						}}
					/>
					<label className="form-check-label" htmlFor="player-load-management">
						Load management (rest on the second night of back-to-backs)
					</label>
				</div>
			) : null}
			{info.byBodyPart.length > 0 ? (
				<table className="table table-sm table-striped table-borderless table-nonfluid mb-0">
					<thead>
						<tr>
							<th>Body part</th>
							<th title="Number of injuries">#</th>
							<th title="Games missed">Games</th>
							<th>Last</th>
						</tr>
					</thead>
					<tbody>
						{info.byBodyPart.map((row) => (
							<tr key={row.bodyPart} title={row.types.join(", ")}>
								<td>{row.bodyPart}</td>
								<td>{row.count}</td>
								<td>{row.games}</td>
								<td>{row.lastSeason}</td>
							</tr>
						))}
					</tbody>
				</table>
			) : null}
		</div>
	);
};

export default InjuryHealth;
