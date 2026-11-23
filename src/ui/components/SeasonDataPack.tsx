import { useState } from "react";
import { Modal } from "./Modal.tsx";
import {
	SEASON_PACK_CHUNK,
	buildSeasonPack,
	seasonPackCSVFiles,
	seasonPackToJSON,
	type SeasonPackChunk,
} from "../../common/seasonExport.ts";
import { downloadFile } from "../util/downloadFile.ts";
import { toWorker } from "../util/toWorker.ts";

export type SeasonPackFormat = "both" | "json" | "csv";

// Download season data: the worker sends the season's info, then its games in chunks (a progress bar, the worker never busy for
// long), the UI adds the standings history and writes a JSON file and/or CSVs in a zip. See common/seasonExport.ts.
export const downloadSeasonPack = async ({
	season,
	format,
	onProgress,
}: {
	season: number;
	format: SeasonPackFormat;
	onProgress?: (text: string, fraction: number) => void;
}) => {
	onProgress?.("Finding the season's games", 0.02);
	const info = await toWorker("main", "getSeasonPackInfo", { season });
	const chunks: SeasonPackChunk[] = [];
	const total = info.gids.length;
	for (let i = 0; i < total; i += SEASON_PACK_CHUNK) {
		onProgress?.(
			`Reading games ${i + 1}-${Math.min(total, i + SEASON_PACK_CHUNK)} of ${total}`,
			0.05 + (0.8 * i) / Math.max(1, total),
		);
		chunks.push(
			await toWorker("main", "getSeasonPackGames", {
				season,
				gids: info.gids.slice(i, i + SEASON_PACK_CHUNK),
			}),
		);
	}
	onProgress?.("Standings after each day", 0.87);
	// (let the progress bar paint before the work on this thread)
	await new Promise((resolve) => setTimeout(resolve, 0));
	const pack = buildSeasonPack(info, chunks);
	const base = `${info.league.name.replaceAll(/[^\w-]+/g, "_")}_${season}_season_data`;
	const encoder = new TextEncoder();
	const json = () => encoder.encode(seasonPackToJSON(pack));
	if (format === "json") {
		// Bytes, not a string: downloadFile would add a byte order mark, which strict JSON parsers reject
		downloadFile(`${base}.json`, [json()], "application/json");
		onProgress?.("Done", 1);
		return { pack, files: [`${base}.json`] };
	}
	onProgress?.("Writing the files", 0.93);
	await new Promise((resolve) => setTimeout(resolve, 0));
	const { makeZip } = await import("../util/zip.ts");
	const files = [
		...(format === "both"
			? [{ name: `${base}/${base}.json`, bytes: json() }]
			: []),
		...seasonPackCSVFiles(pack).map((f) => ({
			name: `${base}/${f.name}`,
			bytes: encoder.encode(f.text),
		})),
	];
	downloadFile(`${base}.zip`, [makeZip(files)], "application/zip");
	onProgress?.("Done", 1);
	return { pack, files: files.map((f) => f.name) };
};

const SeasonDataPackModal = ({
	onClose,
	season,
	show,
}: {
	onClose: () => void;
	season: number;
	show: boolean;
}) => {
	const [format, setFormat] = useState<SeasonPackFormat>("both");
	const [progress, setProgress] = useState<
		{ text: string; fraction: number } | undefined
	>();
	const [error, setError] = useState<string | undefined>();
	const [result, setResult] = useState<string | undefined>();
	const busy = progress !== undefined && progress.fraction < 1;

	const start = async () => {
		setError(undefined);
		setResult(undefined);
		try {
			const { pack } = await downloadSeasonPack({
				season,
				format,
				onProgress: (text, fraction) => setProgress({ text, fraction }),
			});
			setResult(
				`${pack.counts.games} games, ${pack.counts.days} days of standings.${pack.notes.length > 0 ? ` ${pack.notes[0]}` : ""}`,
			);
		} catch (error_) {
			setError((error_ as Error).message);
			setProgress(undefined);
		}
	};

	return (
		<Modal show={show} onHide={busy ? undefined : onClose} scrollable>
			<Modal.Header closeButton={!busy}>
				<Modal.Title>Download {season} season data</Modal.Title>
			</Modal.Header>
			<Modal.Body data-testid="season-pack-modal">
				<p className="mb-2">
					Every stored game of the season: summaries (teams, score, day,
					overtime, attendance, playoff round and game), each team&apos;s box
					score totals game by game, and the standings after each day.
				</p>
				<div className="d-flex flex-column gap-1 mb-3">
					{(
						[
							["both", "JSON and CSVs", "one zip"],
							["json", "JSON", "one file"],
							["csv", "CSVs", "a zip of spreadsheets"],
						] as const
					).map(([value, label, help]) => (
						<div className="form-check" key={value}>
							<input
								className="form-check-input"
								type="radio"
								name="season-pack-format"
								id={`season-pack-${value}`}
								checked={format === value}
								disabled={busy}
								onChange={() => setFormat(value)}
							/>
							<label
								className="form-check-label"
								htmlFor={`season-pack-${value}`}
							>
								<b>{label}</b>{" "}
								<span className="text-body-secondary">{help}</span>
							</label>
						</div>
					))}
				</div>
				{progress ? (
					<div className="mt-3">
						<div
							className="progress"
							role="progressbar"
							aria-valuenow={Math.round(progress.fraction * 100)}
						>
							<div
								className="progress-bar"
								style={{ width: `${Math.round(progress.fraction * 100)}%` }}
							/>
						</div>
						<div className="small mt-1" data-testid="season-pack-status">
							{progress.text}
						</div>
					</div>
				) : null}
				{result ? <div className="small mt-2">{result}</div> : null}
				{error ? <div className="text-danger mt-2">{error}</div> : null}
			</Modal.Body>
			<Modal.Footer>
				<button className="btn btn-secondary" onClick={onClose} disabled={busy}>
					Close
				</button>
				<button
					className="btn btn-primary"
					onClick={start}
					disabled={busy}
					data-testid="season-pack-download"
				>
					Download
				</button>
			</Modal.Footer>
		</Modal>
	);
};

// "Download season data" (Daily Schedule)
export const SeasonDataPackButton = ({
	season,
	className,
}: {
	season: number;
	className?: string;
}) => {
	const [show, setShow] = useState(false);
	return (
		<>
			<button
				type="button"
				className={className ?? "btn btn-light-bordered btn-sm"}
				onClick={() => setShow(true)}
				data-testid="season-pack-button"
			>
				Download season data
			</button>
			{show ? (
				<SeasonDataPackModal
					season={season}
					show={show}
					onClose={() => setShow(false)}
				/>
			) : null}
		</>
	);
};
