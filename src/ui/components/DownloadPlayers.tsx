import { Dropdown } from "react-bootstrap";
import { useState } from "react";
import { Modal } from "./Modal.tsx";
import {
	fileSafeName,
	playersToCSVRows,
	playersToJSON,
	toCSV,
	type PlayerExport,
} from "../../common/playerExport.ts";
import { downloadFile } from "../util/downloadFile.ts";
import { helpers } from "../util/helpers.ts";
import { local } from "../util/local.ts";
import { toWorker } from "../util/toWorker.ts";

export type PlayerDownloadFormat = "pdf" | "json" | "csv";

const CHUNK_SIZE = 20;

// Fetches what the user can see of these players from the worker in chunks (with progress), then writes the file. The PDF
// writer is lazy loaded, so it costs nothing until used.
export const downloadPlayers = async ({
	pids,
	season,
	format,
	name,
	onProgress,
	gameLog = false,
	zip = false,
}: {
	pids: number[];
	season?: number;
	format: PlayerDownloadFormat;
	name: string;
	onProgress?: (text: string, fraction: number) => void;
	// Current season's game log in the PDF/JSON
	gameLog?: boolean;
	// PDF: a zip with one PDF per player instead of one PDF
	zip?: boolean;
}) => {
	const players: PlayerExport[] = [];
	for (let i = 0; i < pids.length; i += CHUNK_SIZE) {
		onProgress?.(
			`Loading players ${i + 1}-${Math.min(i + CHUNK_SIZE, pids.length)} of ${pids.length}`,
			i / pids.length / (format === "pdf" ? 2 : 1),
		);
		const chunk = await toWorker("main", "getPlayersForExport", {
			pids: pids.slice(i, i + CHUNK_SIZE),
			season,
			gameLog: gameLog && format !== "csv",
		});
		players.push(...chunk);
	}

	const state = local.getState();
	const league = `League ${state.lid}`;
	const base = fileSafeName(name);

	if (format === "csv") {
		downloadFile(`${base}.csv`, toCSV(playersToCSVRows(players)), "text/csv");
	} else if (format === "json") {
		downloadFile(
			`${base}.json`,
			playersToJSON(players, {
				league,
				exportedSeason: season ?? state.season ?? 0,
			}),
			"application/json",
		);
	} else {
		onProgress?.("Loading PDF writer", 0.5);
		const { playersToPdf, playersToPdfFiles } =
			await import("../util/playersPdf.ts");
		const progress = (done: number) => {
			onProgress?.(
				`Drawing player ${done} of ${players.length}`,
				0.5 + done / players.length / 2,
			);
		};
		if (zip) {
			const { makeZip } = await import("../util/zip.ts");
			const files = await playersToPdfFiles(players, league, progress);
			downloadFile(`${base}.zip`, [makeZip(files)], "application/zip");
		} else {
			const bytes = await playersToPdf(players, league, progress);
			downloadFile(`${base}.pdf`, [bytes], "application/pdf");
		}
	}
	onProgress?.("Done", 1);
	return players.length;
};

export const DownloadPlayersModal = ({
	name,
	onClose,
	pids,
	season,
	show,
}: {
	name: string;
	onClose: () => void;
	pids: number[];
	season?: number;
	show: boolean;
}) => {
	const [format, setFormat] = useState<PlayerDownloadFormat>("pdf");
	const [gameLog, setGameLog] = useState(false);
	const [zip, setZip] = useState(false);
	const [progress, setProgress] = useState<
		{ text: string; fraction: number } | undefined
	>();
	const [error, setError] = useState<string | undefined>();
	const busy = progress !== undefined && progress.fraction < 1;

	const start = async () => {
		setError(undefined);
		try {
			await downloadPlayers({
				pids,
				season,
				format,
				name,
				gameLog,
				zip,
				onProgress: (text, fraction) => setProgress({ text, fraction }),
			});
		} catch (error_) {
			setError((error_ as Error).message);
			setProgress(undefined);
		}
	};

	return (
		<Modal show={show} onHide={busy ? undefined : onClose}>
			<Modal.Header closeButton={!busy}>
				<Modal.Title>Download players</Modal.Title>
			</Modal.Header>
			<Modal.Body>
				<p>
					{pids.length} {pids.length === 1 ? "player" : "players"} (as shown,
					with your filters). Ratings and traits are what your scouts see.
				</p>
				<div className="d-flex flex-column gap-1 mb-3">
					{(
						[
							[
								"pdf",
								"PDF",
								"each player's profile: overview, stats, ratings history, traits, college/overseas",
							],
							["json", "JSON", "readable, one file"],
							["csv", "CSV", "one row per player"],
						] as const
					).map(([value, label, help]) => (
						<div className="form-check" key={value}>
							<input
								className="form-check-input"
								type="radio"
								name="download-players-format"
								id={`download-players-${value}`}
								checked={format === value}
								disabled={busy}
								onChange={() => setFormat(value)}
							/>
							<label
								className="form-check-label"
								htmlFor={`download-players-${value}`}
							>
								<b>{label}</b>{" "}
								<span className="text-body-secondary">{help}</span>
							</label>
						</div>
					))}
				</div>
				{format !== "csv" ? (
					<div className="mb-3">
						<div className="form-check">
							<input
								className="form-check-input"
								type="checkbox"
								id="download-players-game-log"
								checked={gameLog}
								disabled={busy}
								onChange={() => setGameLog(!gameLog)}
							/>
							<label
								className="form-check-label"
								htmlFor="download-players-game-log"
							>
								Include this season's game log
							</label>
						</div>
						{format === "pdf" ? (
							<div className="form-check">
								<input
									className="form-check-input"
									type="checkbox"
									id="download-players-zip"
									checked={zip}
									disabled={busy}
									onChange={() => setZip(!zip)}
								/>
								<label
									className="form-check-label"
									htmlFor="download-players-zip"
								>
									One PDF per player (zip)
								</label>
							</div>
						) : null}
					</div>
				) : null}
				<p className="text-body-secondary small mb-0">
					To move players into another league (exact ratings, the game's own
					format), use{" "}
					<a href={helpers.leagueUrl(["export_players"])} onClick={onClose}>
						Export Players
					</a>
					.
				</p>
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
						<div className="small mt-1" data-testid="download-players-status">
							{progress.text}
						</div>
					</div>
				) : null}
				{error ? <div className="text-danger mt-2">{error}</div> : null}
			</Modal.Body>
			<Modal.Footer>
				<button className="btn btn-secondary" onClick={onClose} disabled={busy}>
					Close
				</button>
				<button
					className="btn btn-primary"
					onClick={start}
					disabled={busy || pids.length === 0}
				>
					Download
				</button>
			</Modal.Footer>
		</Modal>
	);
};

// Single player page: "Download" with the three formats
export const DownloadPlayerButton = ({
	name,
	pid,
}: {
	name: string;
	pid: number;
}) => {
	const [status, setStatus] = useState<string | undefined>();
	const run = async (format: PlayerDownloadFormat, gameLog = false) => {
		try {
			await downloadPlayers({
				pids: [pid],
				format,
				gameLog,
				name,
				onProgress: (text) => setStatus(text),
			});
			setStatus(undefined);
		} catch (error) {
			setStatus(`Error: ${(error as Error).message}`);
		}
	};
	return (
		<div className="d-flex align-items-center gap-2 mb-2">
			<Dropdown>
				<Dropdown.Toggle
					variant="outline-secondary"
					size="sm"
					id="download-player"
					disabled={status !== undefined && !status.startsWith("Error")}
				>
					Download player
				</Dropdown.Toggle>
				<Dropdown.Menu>
					<Dropdown.Item onClick={() => run("pdf")}>PDF</Dropdown.Item>
					<Dropdown.Item onClick={() => run("pdf", true)}>
						PDF with this season's game log
					</Dropdown.Item>
					<Dropdown.Item onClick={() => run("json")}>JSON</Dropdown.Item>
					<Dropdown.Item onClick={() => run("csv")}>CSV</Dropdown.Item>
				</Dropdown.Menu>
			</Dropdown>
			{status ? (
				<span className="small text-body-secondary">{status}</span>
			) : null}
		</div>
	);
};
