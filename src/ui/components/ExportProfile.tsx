import { useEffect, useState } from "react";
import { Modal } from "./Modal.tsx";
import { fileSafeName } from "../../common/playerExport.ts";
import {
	PROFILE_SECTIONS,
	profileToJSON,
	type ProfileSectionKey,
} from "../../common/playerProfileExport.ts";
import { downloadFile } from "../util/downloadFile.ts";
import { toWorker } from "../util/toWorker.ts";

export type ProfileExportFormat = "json" | "pdf" | "both";

// Export profile: the worker gathers what his pages show, then the UI writes a JSON file, a zip of PDFs (one per page), or a zip
// with both. The PDF and zip writers are lazy loaded. See common/playerProfileExport.ts.
export const exportProfile = async ({
	pid,
	name,
	format,
	sections,
	onProgress,
}: {
	pid: number;
	name: string;
	format: ProfileExportFormat;
	sections: ProfileSectionKey[];
	onProgress?: (text: string, fraction: number) => void;
}) => {
	onProgress?.("Gathering his profile", 0.05);
	const profile = await toWorker("main", "getPlayerProfileExport", {
		pid,
		sections,
	});
	if (!profile) {
		throw new Error("Player not found.");
	}
	const base = `${pid}_${fileSafeName(name)}_profile`;
	const json = profileToJSON(profile);
	if (format === "json") {
		// Bytes, not a string: downloadFile would add a byte order mark, which strict JSON parsers reject
		downloadFile(
			`${base}.json`,
			[new TextEncoder().encode(json)],
			"application/json",
		);
		onProgress?.("Done", 1);
		return { profile, files: [`${base}.json`] };
	}

	onProgress?.("Loading PDF writer", 0.2);
	const [{ profileToPdfFiles }, { makeZip }] = await Promise.all([
		import("../util/profilePdf.ts"),
		import("../util/zip.ts"),
	]);
	const pdfs = await profileToPdfFiles(profile, (done, total) => {
		onProgress?.(
			`Drawing page ${done} of ${total}`,
			0.2 + (0.75 * done) / total,
		);
	});
	const files = [
		...(format === "both"
			? [{ name: `${base}.json`, bytes: new TextEncoder().encode(json) }]
			: []),
		...pdfs.map((f) => ({ name: `${base}/${f.name}`, bytes: f.bytes })),
	];
	downloadFile(`${base}.zip`, [makeZip(files)], "application/zip");
	onProgress?.("Done", 1);
	return { profile, files: files.map((f) => f.name) };
};

type SectionInfo = { key: ProfileSectionKey; label: string; reason?: string };

export const ExportProfileModal = ({
	name,
	onClose,
	pid,
	show,
}: {
	name: string;
	onClose: () => void;
	pid: number;
	show: boolean;
}) => {
	const [format, setFormat] = useState<ProfileExportFormat>("both");
	const [infos, setInfos] = useState<SectionInfo[] | undefined>();
	const [selected, setSelected] = useState<Set<ProfileSectionKey>>(
		() => new Set(PROFILE_SECTIONS.map((s) => s.key)),
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
			const result = await toWorker(
				"main",
				"getPlayerProfileExportSections",
				pid,
			);
			if (!cancelled && result) {
				setInfos(result);
				setSelected(new Set(result.filter((s) => !s.reason).map((s) => s.key)));
			}
		})();
		return () => {
			cancelled = true;
		};
	}, [pid, show]);

	const available = (infos ?? []).filter((s) => !s.reason);
	const chosen = available.filter((s) => selected.has(s.key));

	const start = async () => {
		setError(undefined);
		try {
			await exportProfile({
				pid,
				name,
				format,
				sections: chosen.map((s) => s.key),
				onProgress: (text, fraction) => setProgress({ text, fraction }),
			});
		} catch (error_) {
			setError((error_ as Error).message);
			setProgress(undefined);
		}
	};

	const toggle = (key: ProfileSectionKey) => {
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
				<Modal.Title>Export profile</Modal.Title>
			</Modal.Header>
			<Modal.Body data-testid="export-profile-modal">
				<p className="mb-2">
					Everything {name}&apos;s player pages show. Ratings, traits and
					scouting grades are what your scouts see.
				</p>
				<div className="d-flex flex-column gap-1 mb-3">
					{(
						[
							["both", "JSON and PDFs", "one zip"],
							["json", "JSON", "one readable file"],
							["pdf", "PDF set", "a zip with one PDF per page"],
						] as const
					).map(([value, label, help]) => (
						<div className="form-check" key={value}>
							<input
								className="form-check-input"
								type="radio"
								name="export-profile-format"
								id={`export-profile-${value}`}
								checked={format === value}
								disabled={busy}
								onChange={() => setFormat(value)}
							/>
							<label
								className="form-check-label"
								htmlFor={`export-profile-${value}`}
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
										id={`export-profile-section-${s.key}`}
										checked={!s.reason && selected.has(s.key)}
										disabled={busy || !!s.reason}
										onChange={() => toggle(s.key)}
									/>
									<label
										className="form-check-label"
										htmlFor={`export-profile-section-${s.key}`}
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
						<div className="small mt-1" data-testid="export-profile-status">
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
					data-testid="export-profile-download"
				>
					Download
				</button>
			</Modal.Footer>
		</Modal>
	);
};

// "Export profile" on the player pages (the button row under his bio)
export const ExportProfileButton = ({
	name,
	pid,
	className,
}: {
	name: string;
	pid: number;
	className?: string;
}) => {
	const [show, setShow] = useState(false);
	return (
		<>
			<button
				type="button"
				className={className ?? "btn btn-light-bordered"}
				onClick={() => setShow(true)}
				data-testid="export-profile-button"
			>
				Export profile
			</button>
			{show ? (
				<ExportProfileModal
					name={name}
					pid={pid}
					show={show}
					onClose={() => setShow(false)}
				/>
			) : null}
		</>
	);
};
