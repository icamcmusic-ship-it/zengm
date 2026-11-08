import { useState } from "react";
import { toWorker } from "../../util/toWorker.ts";
import { confirm } from "../../util/confirm.tsx";
import { bySport } from "../../../common/sportFunctions.ts";
import { useBuildSettings, mintSeed } from "./useBuildSettings.ts";

import type { previewRegenerateAllClasses } from "../../../worker/core/draft/regenerateRatings.ts";

type Summary = Awaited<ReturnType<typeof previewRegenerateAllClasses>>;

/**
 * Draft Scouting: do things to every upcoming draft class at once.
 * - Generate college/overseas stats for all classes (replace, or only prospects without any)
 * - Regenerate ratings for all classes, with the settings last used in the Regenerate ratings dialog, a preview summary per class, Undo (one undo for all classes) and Restore originals
 */
export const AllClassesPanel = ({ seasons }: { seasons: number[] }) => {
	const supported = bySport({
		baseball: false,
		basketball: true,
		football: false,
		hockey: false,
	});
	const { settings, update } = useBuildSettings("regenerateRatingsSettings");
	const [statsSeed, setStatsSeed] = useState(mintSeed);
	const [onlyMissing, setOnlyMissing] = useState(true);
	const [summary, setSummary] = useState<Summary | undefined>();
	const [status, setStatus] = useState<string | undefined>();
	const [busy, setBusy] = useState(false);

	if (!supported || seasons.length === 0) {
		return null;
	}

	const run = async (f: () => Promise<void>) => {
		setBusy(true);
		try {
			await f();
		} finally {
			setBusy(false);
		}
	};

	return (
		<div className="card mb-3">
			<div className="card-body">
				<h3 className="card-title">All draft classes ({seasons.join(", ")})</h3>

				<div className="d-flex flex-wrap align-items-center gap-2 mb-2">
					<b>College/overseas stats:</b>
					<label htmlFor="all-stats-seed">Seed</label>
					<input
						id="all-stats-seed"
						className="form-control form-control-sm"
						style={{ width: 110 }}
						value={statsSeed}
						onChange={(event) => setStatsSeed(event.target.value)}
					/>
					<button
						className="btn btn-sm btn-light-bordered"
						onClick={() => setStatsSeed(mintSeed())}
					>
						Reroll
					</button>
					<select
						className="form-select form-select-sm w-auto"
						value={onlyMissing ? "missing" : "replace"}
						onChange={(event) =>
							setOnlyMissing(event.target.value === "missing")
						}
					>
						<option value="missing">Only prospects without stats</option>
						<option value="replace">Replace everyone's stats</option>
					</select>
					<button
						className="btn btn-sm btn-primary"
						disabled={busy}
						onClick={() =>
							run(async () => {
								const ok = await confirm(
									onlyMissing
										? `Generate college/overseas stats and honors for prospects without any in all ${seasons.length} classes?`
										: `Replace the college/overseas stats and honors of every prospect in all ${seasons.length} classes?`,
									{ okText: "Generate" },
								);
								if (!ok) {
									return;
								}
								const { classes } = await toWorker(
									"main",
									"generateCollegeStatsAllClasses",
									{ seed: statsSeed, onlyMissing },
								);
								setStatus(
									`Stats: ${classes
										.map(
											(c) =>
												`${c.draftYear}: ${c.numPlayers} prospects, ${c.numSeasons} seasons, ${c.numHonors} honors`,
										)
										.join("; ")}`,
								);
							})
						}
					>
						Generate college/overseas stats for all classes
					</button>
				</div>

				<div className="d-flex flex-wrap align-items-center gap-2 mb-2">
					<b>Ratings:</b>
					<span className="text-body-secondary">
						seed {settings.seed} and the other settings from the Regenerate
						ratings dialog (each class gets its own seed derived from it)
					</span>
					<button
						className="btn btn-sm btn-light-bordered"
						onClick={() => update({ seed: mintSeed() })}
					>
						Reroll seed
					</button>
					<button
						className="btn btn-sm btn-light-bordered"
						disabled={busy}
						onClick={() =>
							run(async () => {
								setSummary(
									await toWorker(
										"regenerateRatings",
										"previewRegenerateAllClasses",
										{ settings },
									),
								);
							})
						}
					>
						Preview all classes
					</button>
					<button
						className="btn btn-sm btn-primary"
						disabled={busy}
						onClick={() =>
							run(async () => {
								const ok = await confirm(
									`Regenerate ratings for every prospect in all ${seasons.length} classes? Overall, potential and height stay the same. You can undo it until the page is reloaded.`,
									{ okText: "Regenerate" },
								);
								if (!ok) {
									return;
								}
								const { classes } = await toWorker(
									"regenerateRatings",
									"applyRegenerateAllClasses",
									{ settings },
								);
								setStatus(
									`Ratings: ${classes.map((c) => `${c.draftYear}: ${c.applied} regenerated`).join("; ")}`,
								);
								setSummary(
									await toWorker(
										"regenerateRatings",
										"previewRegenerateAllClasses",
										{ settings },
									),
								);
							})
						}
					>
						Regenerate ratings for all classes
					</button>
					<button
						className="btn btn-sm btn-light-bordered"
						disabled={busy || !summary?.canUndo}
						onClick={() =>
							run(async () => {
								const { restored } = await toWorker(
									"regenerateRatings",
									"undoRegenerate",
									undefined,
								);
								setStatus(`Undid the last apply for ${restored} prospects.`);
								setSummary(undefined);
							})
						}
					>
						Undo last apply
					</button>
					<button
						className="btn btn-sm btn-light-bordered"
						disabled={busy}
						onClick={() =>
							run(async () => {
								const { restored } = await toWorker(
									"regenerateRatings",
									"restoreOriginalRatingsAllClasses",
									undefined,
								);
								setStatus(
									`Restored the original ratings of ${restored} prospects in all classes.`,
								);
								setSummary(undefined);
							})
						}
					>
						Restore originals (all classes)
					</button>
				</div>

				{summary ? (
					<table className="table table-sm w-auto mb-2">
						<thead>
							<tr>
								<th>Class</th>
								<th>Prospects</th>
								<th>Would change</th>
								<th>Ovr changes</th>
								<th>Flavor</th>
							</tr>
						</thead>
						<tbody>
							{summary.classes.map((c) => (
								<tr key={c.draftYear}>
									<td>{c.draftYear}</td>
									<td>{c.numPlayers}</td>
									<td>{c.numChanged}</td>
									<td>{c.numOvrChanged}</td>
									<td>{c.flavor ?? ""}</td>
								</tr>
							))}
						</tbody>
					</table>
				) : null}

				{status ? <div className="alert alert-info mb-0">{status}</div> : null}
			</div>
		</div>
	);
};
