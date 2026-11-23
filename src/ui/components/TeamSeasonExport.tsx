import { useEffect, useState } from "react";
import { Modal } from "./Modal.tsx";
import {
	TEAM_SECTIONS,
	mergeTeamExports,
	teamExportBaseName,
	teamExportCSVFiles,
	teamExportToJSON,
	type TeamSectionKey,
} from "../../common/teamExport.ts";
import { downloadFile } from "../util/downloadFile.ts";
import { toWorker } from "../util/toWorker.ts";

export type TeamExportFormat = "both" | "json" | "csv";

// Export team season: the worker gathers what the team's pages show, then the UI writes a JSON file, a zip of CSVs, or a zip with
// both. See common/teamExport.ts.
export const exportTeamSeason = async ({
	tid,
	season,
	format,
	sections,
	onProgress,
}: {
	tid: number;
	season: number;
	format: TeamExportFormat;
	sections: TeamSectionKey[];
	onProgress?: (text: string, fraction: number) => void;
}) => {
	// One section per worker request, so a big team-season never blocks the worker for long
	const parts = [];
	for (const [i, key] of sections.entries()) {
		const label = TEAM_SECTIONS.find((s) => s.key === key)?.label ?? key;
		onProgress?.(
			`${label} (${i + 1} of ${sections.length})`,
			0.05 + (0.75 * i) / Math.max(1, sections.length),
		);
		const part = await toWorker("main", "getTeamSeasonExport", {
			tid,
			season,
			sections: [key],
		});
		if (!part) {
			throw new Error("Team season not found.");
		}
		parts.push(part);
	}
	const x = mergeTeamExports(parts);
	if (!x) {
		throw new Error("No sections chosen.");
	}
	const base = teamExportBaseName(x.team);
	const encoder = new TextEncoder();
	if (format === "json") {
		// Bytes, not a string: downloadFile would add a byte order mark, which strict JSON parsers reject
		downloadFile(
			`${base}.json`,
			[encoder.encode(teamExportToJSON(x))],
			"application/json",
		);
		onProgress?.("Done", 1);
		return { export: x, files: [`${base}.json`] };
	}
	onProgress?.("Writing the files", 0.8);
	const { makeZip } = await import("../util/zip.ts");
	const files = [
		...(format === "both"
			? [
					{
						name: `${base}/${base}.json`,
						bytes: encoder.encode(teamExportToJSON(x)),
					},
				]
			: []),
		...teamExportCSVFiles(x).map((f) => ({
			name: `${base}/${f.name}`,
			bytes: encoder.encode(f.text),
		})),
	];
	downloadFile(`${base}.zip`, [makeZip(files)], "application/zip");
	onProgress?.("Done", 1);
	return { export: x, files: files.map((f) => f.name) };
};

type SectionInfo = { key: TeamSectionKey; label: string; reason?: string };

const TeamSeasonExportModal = ({
	abbrev,
	onClose,
	season,
	show,
	tid,
}: {
	abbrev: string;
	onClose: () => void;
	season: number;
	show: boolean;
	tid: number;
}) => {
	const [format, setFormat] = useState<TeamExportFormat>("both");
	const [infos, setInfos] = useState<SectionInfo[] | undefined>();
	const [selected, setSelected] = useState<Set<TeamSectionKey>>(
		() => new Set(TEAM_SECTIONS.map((s) => s.key)),
	);
	const [progress, setProgress] = useState<
		{ text: string; fraction: number } | undefined
	>();
	const [error, setError] = useState<string | undefined>();
	const busy = progress !== undefined && progress.fraction < 1;

	useEffect(() => {
		if (!show) {
			return;
		}
		let cancelled = false;
		setProgress(undefined);
		setError(undefined);
		(async () => {
			const result = await toWorker("main", "getTeamSeasonExportSections", {
				tid,
				season,
			});
			if (!cancelled) {
				setInfos(result);
				setSelected(new Set(result.filter((s) => !s.reason).map((s) => s.key)));
			}
		})();
		return () => {
			cancelled = true;
		};
	}, [tid, season, show]);

	const available = (infos ?? []).filter((s) => !s.reason);
	const chosen = available.filter((s) => selected.has(s.key));

	const start = async () => {
		setError(undefined);
		try {
			await exportTeamSeason({
				tid,
				season,
				format,
				sections: chosen.map((s) => s.key),
				onProgress: (text, fraction) => setProgress({ text, fraction }),
			});
		} catch (error_) {
			setError((error_ as Error).message);
			setProgress(undefined);
		}
	};

	const toggle = (key: TeamSectionKey) => {
		const next = new Set(selected);
		if (next.has(key)) {
			next.delete(key);
		} else {
			next.add(key);
		}
		setSelected(next);
	};

	return (
		<Modal show={show} onHide={busy ? undefined : onClose} scrollable>
			<Modal.Header closeButton={!busy}>
				<Modal.Title>
					Export {season} {abbrev} season
				</Modal.Title>
			</Modal.Header>
			<Modal.Body data-testid="team-export-modal">
				<p className="mb-2">
					Everything the team&apos;s pages show about this season. Ratings are
					what your scouts see.
				</p>
				<div className="d-flex flex-column gap-1 mb-3">
					{(
						[
							["both", "JSON and CSVs", "one zip"],
							["json", "JSON", "one readable file"],
							["csv", "CSVs", "a zip with one spreadsheet per table"],
						] as const
					).map(([value, label, help]) => (
						<div className="form-check" key={value}>
							<input
								className="form-check-input"
								type="radio"
								name="team-export-format"
								id={`team-export-${value}`}
								checked={format === value}
								disabled={busy}
								onChange={() => setFormat(value)}
							/>
							<label
								className="form-check-label"
								htmlFor={`team-export-${value}`}
							>
								<b>{label}</b>{" "}
								<span className="text-body-secondary">{help}</span>
							</label>
						</div>
					))}
				</div>
				<div className="d-flex align-items-baseline gap-2 mb-1">
					<b>Sections</b>
					<button
						type="button"
						className="btn btn-link btn-sm p-0"
						disabled={busy}
						onClick={() => setSelected(new Set(available.map((s) => s.key)))}
					>
						All
					</button>
					<button
						type="button"
						className="btn btn-link btn-sm p-0"
						disabled={busy}
						onClick={() => setSelected(new Set())}
					>
						None
					</button>
				</div>
				{infos ? (
					<div className="row row-cols-1 row-cols-sm-2 g-0 mb-2">
						{infos.map((s) => (
							<div className="col" key={s.key}>
								<div className="form-check" title={s.reason}>
									<input
										className="form-check-input"
										type="checkbox"
										id={`team-export-section-${s.key}`}
										checked={!s.reason && selected.has(s.key)}
										disabled={busy || !!s.reason}
										onChange={() => toggle(s.key)}
									/>
									<label
										className="form-check-label"
										htmlFor={`team-export-section-${s.key}`}
									>
										{s.label}
										{s.reason ? (
											<div className="small text-body-secondary">
												{s.reason}
											</div>
										) : null}
									</label>
								</div>
							</div>
						))}
					</div>
				) : (
					<div className="text-body-secondary mb-2">Loading...</div>
				)}
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
						<div className="small mt-1" data-testid="team-export-status">
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
					disabled={busy || chosen.length === 0}
					data-testid="team-export-download"
				>
					Download
				</button>
			</Modal.Footer>
		</Modal>
	);
};

// "Export team season" (Roster page)
export const TeamSeasonExportButton = ({
	abbrev,
	className,
	season,
	tid,
}: {
	abbrev: string;
	className?: string;
	season: number;
	tid: number;
}) => {
	const [show, setShow] = useState(false);
	return (
		<>
			<button
				type="button"
				className={className ?? "btn btn-light-bordered btn-sm"}
				onClick={() => setShow(true)}
				data-testid="team-export-button"
			>
				Export team season
			</button>
			{show ? (
				<TeamSeasonExportModal
					abbrev={abbrev}
					season={season}
					show={show}
					tid={tid}
					onClose={() => setShow(false)}
				/>
			) : null}
		</>
	);
};
