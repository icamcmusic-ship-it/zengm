// archfb: "Your archetype tuning" (League -> Archetypes): how many picks the user made, what they changed (in words),
// the cross-league switch, reset, and the picks as a JSON file for the developer's full offline refit
import { useEffect, useState } from "react";
import type { TuningInfo } from "../../../worker/api/archetypes.ts";
import { downloadFile } from "../../util/downloadFile.ts";
import { realtimeUpdate } from "../../util/realtimeUpdate.ts";
import { toWorker } from "../../util/toWorker.ts";

const plural = (n: number) => `${n} pick${n === 1 ? "" : "s"}`;

export const ArchetypeTuningPanel = () => {
	const [info, setInfo] = useState<TuningInfo | undefined>();
	const [note, setNote] = useState<string | undefined>();

	const load = async () => {
		setInfo(await toWorker("archetypes", "tuningInfo", undefined));
	};
	useEffect(() => {
		load();
	}, []);

	if (!info || !info.enabled) {
		return null;
	}

	const after = async (msg: string) => {
		setNote(msg);
		await load();
		await realtimeUpdate(["playerMovement"]);
	};

	return (
		<div className="card mb-4" style={{ maxWidth: 640 }}>
			<div className="card-body">
				<h2 className="h5 card-title">Your archetype tuning</h2>
				<p className="mb-2">
					{info.usedPicks === 0
						? "No picks yet. When a label doesn't fit, use \"Doesn't fit?\" on the player's page: your pick becomes his label, and your picks tune how similar players are read."
						: `${info.usedPicks} pick${info.usedPicks === 1 ? " tunes" : "s tune"} the reading${info.globalWeights ? "" : ` (from ${info.minPicksGlobal} picks on, they can also reweigh sub-ratings, play types, traits and families)`}.`}
				</p>
				{info.changes.length > 0 ? (
					<ul className="mb-2">
						{info.changes.map((c) => (
							<li key={c}>{c}</li>
						))}
					</ul>
				) : info.usedPicks > 0 ? (
					<p className="mb-2 text-body-secondary">
						Not enough picks yet to change how others are read.
					</p>
				) : null}
				<p className="mb-2 text-body-secondary small">
					This league: {plural(info.leaguePicks)}. All leagues:{" "}
					{plural(info.globalPicks)}. New labels follow at the next preseason;
					players whose label you picked keep it until you clear it.
				</p>
				<div className="form-check form-switch mb-2">
					<input
						className="form-check-input"
						type="checkbox"
						role="switch"
						id="archetype-cross-league"
						checked={info.crossLeague}
						onChange={async (e) => {
							await toWorker("archetypes", "setCrossLeague", {
								enabled: e.target.checked,
							});
							await after(
								e.target.checked
									? "Your picks now apply in all leagues."
									: "Only this league's picks apply here now.",
							);
						}}
					/>
					<label className="form-check-label" htmlFor="archetype-cross-league">
						Use my archetype picks in all leagues
					</label>
				</div>
				<div className="d-flex flex-wrap gap-2">
					<button
						type="button"
						className="btn btn-sm btn-secondary"
						disabled={info.leaguePicks + info.globalPicks === 0}
						onClick={async () => {
							const file = await toWorker(
								"archetypes",
								"tuningExport",
								undefined,
							);
							downloadFile(
								"archetype-picks.json",
								JSON.stringify(file, null, 1),
								"application/json",
							);
						}}
					>
						Export my picks (JSON)
					</button>
					<label className="btn btn-sm btn-secondary mb-0">
						Import picks
						<input
							type="file"
							accept=".json,application/json"
							className="d-none"
							onChange={async (e) => {
								const f = e.target.files?.[0];
								if (!f) {
									return;
								}
								try {
									const res = await toWorker("archetypes", "tuningImport", {
										file: JSON.parse(await f.text()),
									});
									await after(`Imported ${res.n} picks.`);
								} catch (error) {
									setNote(`Could not import: ${(error as Error).message}`);
								}
							}}
						/>
					</label>
					<button
						type="button"
						className="btn btn-sm btn-outline-danger"
						disabled={info.leaguePicks + info.globalPicks === 0}
						onClick={async () => {
							await toWorker("archetypes", "tuningReset", undefined);
							await after("Your tuning was reset.");
						}}
					>
						Reset my tuning
					</button>
				</div>
				{note ? <div className="mt-2 small">{note}</div> : null}
			</div>
		</div>
	);
};
