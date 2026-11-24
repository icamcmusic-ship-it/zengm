import { useState } from "react";
import { toWorker } from "../../util/toWorker.ts";
import type { HealthInfo } from "../../../worker/core/player/getHealthInfo.ts";
import type { PlayerInjury } from "../../../common/types.ts";
import {
	gameTimeStatus,
	injuryEstimateRange,
	injuryOutlookText,
} from "../../../common/injuryOutlook.ts";
import { useLocal } from "../../util/local.ts";

// (the same as player/injuryRecovery.ts's TREATMENT and TREATMENT_CHOICE_GAMES, kept here so the UI doesn't load worker code)
const TREATMENT = { surgery: { duration: 1.15 }, rehab: { duration: 0.85 } };
const TREATMENT_CHOICE_GAMES = 3;

// Injury history grouped by body part, plus the injuryDepth setting's status for this player (minutes restriction, re-injury risk,
// injury prone, load management)
const InjuryHealth = ({
	info,
	injury,
	pid,
}: {
	info: HealthInfo & { returnDay?: number };
	injury: PlayerInjury;
	pid: number;
}) => {
	const [loadManagement, setLoadManagement] = useState(info.loadManagement);
	const { godMode } = useLocal(["godMode"]);

	const status = [];

	// Injury outlook (common/injuryOutlook.ts): the medical staff's estimate, when he should be back, games missed so far, treatment
	if (injury.gamesRemaining > 0) {
		const estimated =
			gameTimeStatus(injury) !== undefined ||
			injuryEstimateRange(injury) !== undefined;
		status.push(
			<li key="outlook">
				<b>Outlook:</b> {injury.type}, {estimated ? "" : "out "}
				{injuryOutlookText(injury)}
				{godMode && estimated
					? ` (God Mode: ${injuryOutlookText(injury, true)})`
					: null}
				{info.returnDay !== undefined
					? `, expected back Day ${info.returnDay}`
					: null}
				{info.gamesMissed ? `, has missed ${info.gamesMissed} so far` : null}
			</li>,
		);
		if (info.treatment) {
			status.push(
				<li key="treatment">
					<b>Treatment:</b> {info.treatment === "surgery" ? "surgery" : "rehab"}
					{info.canChooseTreatment ? (
						<>
							{" "}
							(not decided yet: surgery keeps him out about{" "}
							{Math.round(
								100 *
									(TREATMENT.surgery.duration / TREATMENT.rehab.duration - 1),
							)}
							% longer than rehab, but costs less athleticism and gives a
							shorter re-injury window; surgery unless you choose within{" "}
							{TREATMENT_CHOICE_GAMES} games)
							<span className="ms-2">
								<button
									className="btn btn-sm btn-outline-secondary me-1"
									onClick={async () => {
										await toWorker("main", "setInjuryTreatment", {
											pid,
											treatment: "surgery",
										});
									}}
								>
									Surgery
								</button>
								<button
									className="btn btn-sm btn-outline-secondary"
									onClick={async () => {
										await toWorker("main", "setInjuryTreatment", {
											pid,
											treatment: "rehab",
										});
									}}
								>
									Rehab
								</button>
							</span>
						</>
					) : null}
				</li>,
			);
		}
	}
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
							<th title="Games missed (the recorded length for injuries before the count was kept)">
								Games
							</th>
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
