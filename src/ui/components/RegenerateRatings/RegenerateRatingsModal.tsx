import clsx from "clsx";
import { Fragment, useEffect, useRef, useState } from "react";
import type {
	PreviewResult,
	PreviewRow,
	UiLock,
} from "../../../worker/core/draft/regenerateRatings.ts";
import { helpers } from "../../util/helpers.ts";
import { toWorker } from "../../util/toWorker.ts";
import { ActionButton } from "../ActionButton.tsx";
import { Modal } from "../Modal.tsx";
import { ResponsiveTableWrapper } from "../ResponsiveTableWrapper.tsx";
import { SkillsBlock } from "../SkillsBlock.tsx";
import { ChangeSummary, RatingsDiff } from "./RatingsDiff.tsx";
import { SettingsForm } from "./SettingsForm.tsx";
import {
	ArchetypeOptions,
	ArchetypePoolPicker,
	eligibleArchetypes,
	type ArchetypeTargetInfo,
} from "./ArchetypeTargets.tsx";
import { mintSeed, useBuildSettings } from "./useBuildSettings.ts";
import type { RatingKey } from "../../../common/types.basketball.ts";

type Scope = "class" | "selected" | "one";

type BuildInfo = { name: string; min: number; max: number; tags: string[] };

const SCOPES: { value: Scope; label: string }[] = [
	{ value: "class", label: "Whole class" },
	{ value: "selected", label: "Selected prospects" },
	{ value: "one", label: "One prospect" },
];

const lockCount = (lock: UiLock | undefined) => {
	if (!lock) {
		return 0;
	}
	return (
		(lock.skip ? 1 : 0) +
		(lock.build ? 1 : 0) +
		(lock.archetype ? 1 : 0) +
		(lock.pinKeys?.length ?? 0) +
		(lock.ovrDelta ? 1 : 0) +
		(lock.potDelta ? 1 : 0)
	);
};

const NumberLock = ({
	label,
	value,
	onChange,
	title,
}: {
	label: string;
	value: number | undefined;
	onChange: (value: number | undefined) => void;
	title: string;
}) => (
	<label className="d-flex align-items-center gap-2" title={title}>
		<span className="text-nowrap">{label}</span>
		<input
			type="number"
			className="form-control form-control-sm"
			style={{ width: "5rem" }}
			min={-40}
			max={40}
			placeholder="0"
			value={value ?? ""}
			onChange={(event) => {
				const v =
					event.target.value === "" ? undefined : Number(event.target.value);
				onChange(v === undefined || !Number.isFinite(v) ? undefined : v);
			}}
		/>
	</label>
);

const RowDetail = ({
	row,
	builds,
	archetypes,
	lock,
	setLock,
}: {
	row: PreviewRow;
	builds: BuildInfo[];
	archetypes: ArchetypeTargetInfo[];
	lock: UiLock;
	setLock: (lock: UiLock) => void;
}) => {
	const eligible = builds.filter((b) => row.hgt >= b.min && row.hgt <= b.max);
	const eligibleArch = eligibleArchetypes(archetypes, row.hgt);
	return (
		<div
			className="p-2"
			// Pinned to the visible edge, so on a phone the details do not scroll away with a wide table
			style={{
				position: "sticky",
				left: 0,
				width: "min(100%, calc(100vw - 3rem))",
			}}
		>
			<RatingsDiff
				ratings={row.ratings}
				pinned={lock.pinKeys}
				onTogglePin={(key: RatingKey) => {
					const keys = new Set(lock.pinKeys ?? []);
					if (keys.has(key)) {
						keys.delete(key);
					} else {
						keys.add(key);
					}
					setLock({ ...lock, pinKeys: [...keys] });
				}}
			/>
			<div className="d-flex flex-wrap align-items-center gap-3 mt-2">
				<div className="d-flex align-items-center gap-2">
					<span>Skills</span>
					<span>
						<SkillsBlock skills={row.skills[0]} />{" "}
						<span className="text-body-secondary">{"→"}</span>{" "}
						<SkillsBlock skills={row.skills[1]} />
					</span>
				</div>
				<label className="d-flex align-items-center gap-2">
					<span>Archetype</span>
					<select
						className="form-select form-select-sm"
						style={{ maxWidth: "16rem" }}
						value={lock.archetype ?? ""}
						onChange={(event) =>
							setLock({
								...lock,
								archetype: event.target.value || undefined,
								build: event.target.value ? undefined : lock.build,
							})
						}
						aria-label="Target archetype"
					>
						<option value="">Auto</option>
						{lock.archetype &&
						!eligibleArch.some((a) => a.id === lock.archetype) ? (
							<option value={lock.archetype}>{lock.archetype}</option>
						) : null}
						<ArchetypeOptions list={eligibleArch} />
					</select>
				</label>
				<details>
					<summary className="text-body-secondary">Advanced: build</summary>
					<label className="d-flex align-items-center gap-2 mt-1">
						<span>Build</span>
						<select
							className="form-select form-select-sm"
							style={{ maxWidth: "16rem" }}
							value={lock.build ?? ""}
							onChange={(event) =>
								setLock({
									...lock,
									build: event.target.value || undefined,
									archetype: event.target.value ? undefined : lock.archetype,
								})
							}
						>
							<option value="">Auto</option>
							{lock.build && !eligible.some((b) => b.name === lock.build) ? (
								<option value={lock.build}>{lock.build}</option>
							) : null}
							{eligible.map((b) => (
								<option key={b.name} value={b.name}>
									{b.name}
								</option>
							))}
						</select>
					</label>
				</details>
				<NumberLock
					label="Ovr shift"
					title="Build him to a different overall: this many points more (or fewer) than he has. Blank keeps his overall."
					value={lock.ovrDelta}
					onChange={(v) => setLock({ ...lock, ovrDelta: v })}
				/>
				<NumberLock
					label="Pot shift"
					title="Give him this many points more (or fewer) of potential than he has."
					value={lock.potDelta}
					onChange={(v) => setLock({ ...lock, potDelta: v })}
				/>
				<div className="form-check m-0">
					<input
						className="form-check-input"
						type="checkbox"
						id={`regen-skip-${row.pid}`}
						checked={!!lock.skip}
						onChange={(event) =>
							setLock({ ...lock, skip: event.target.checked || undefined })
						}
					/>
					<label className="form-check-label" htmlFor={`regen-skip-${row.pid}`}>
						Leave him alone
					</label>
				</div>
				<button
					type="button"
					className="btn btn-sm btn-secondary"
					onClick={() => setLock({ ...lock, reroll: (lock.reroll ?? 0) + 1 })}
					title="Redraw just this prospect (his build and his jitter); nobody else changes"
				>
					Reroll just him{lock.reroll ? ` (${lock.reroll})` : ""}
				</button>
				{lockCount(lock) > 0 || lock.reroll ? (
					<button
						type="button"
						className="btn btn-sm btn-link"
						onClick={() => setLock({})}
					>
						Clear locks
					</button>
				) : null}
			</div>
		</div>
	);
};

export const RegenerateRatingsModal = ({
	seasons,
	show,
	onHide,
}: {
	seasons: number[];
	show: boolean;
	onHide: () => void;
}) => {
	const { settings, update, reset } = useBuildSettings(
		"regenerateRatingsSettings",
	);
	const [season, setSeason] = useState(seasons[0] ?? 0);
	const [scope, setScope] = useState<Scope>("class");
	const [selected, setSelected] = useState<Set<number>>(new Set());
	const [oneId, setOneId] = useState<number | undefined>();
	const [locks, setLocks] = useState<Record<number, UiLock>>({});
	const [preview, setPreview] = useState<PreviewResult | undefined>();
	const [error, setError] = useState<string | undefined>();
	// Said inside the modal, not as a toast: a toast lands on top of the footer buttons
	const [status, setStatus] = useState<string | undefined>();
	const [applying, setApplying] = useState(false);
	const [expanded, setExpanded] = useState<number | undefined>();
	const [builds, setBuilds] = useState<BuildInfo[]>([]);
	const [archetypes, setArchetypes] = useState<ArchetypeTargetInfo[]>([]);
	const [showSettings, setShowSettings] = useState(
		() => window.innerWidth >= 992,
	);
	const requestId = useRef(0);

	useEffect(() => {
		if (seasons.length > 0 && !seasons.includes(season)) {
			setSeason(seasons[0]!);
		}
	}, [seasons, season]);

	useEffect(() => {
		if (!show) {
			return;
		}
		let mounted = true;
		(async () => {
			const list = await toWorker(
				"regenerateRatings",
				"getBuildList",
				undefined,
			);
			const targets = await toWorker(
				"regenerateRatings",
				"getArchetypeTargets",
				undefined,
			);
			if (mounted) {
				setBuilds(list);
				setArchetypes(targets);
			}
		})();
		return () => {
			mounted = false;
		};
	}, [show]);

	const pids =
		scope === "class"
			? null
			: scope === "selected"
				? [...selected]
				: oneId === undefined
					? []
					: [oneId];

	const pidsKey = pids === null ? "all" : pids.join(",");

	const load = async () => {
		const id = ++requestId.current;
		try {
			const result = await toWorker("regenerateRatings", "previewRegenerate", {
				draftYear: season,
				settings,
				locks,
				pids,
			});
			if (id === requestId.current) {
				setPreview(result);
				setError(undefined);
			}
		} catch (error) {
			if (id === requestId.current) {
				setError(error.message);
			}
		}
	};

	useEffect(() => {
		if (!show || !season) {
			return;
		}
		const timeout = setTimeout(load, 150);
		return () => clearTimeout(timeout);
		// eslint-disable-next-line react-hooks/exhaustive-deps
	}, [show, season, JSON.stringify(settings), JSON.stringify(locks), pidsKey]);

	const rows = preview
		? [...preview.rows].sort(
				(a, b) =>
					b.ovr[0] - a.ovr[0] ||
					b.pot[0] - a.pot[0] ||
					a.lastName.localeCompare(b.lastName),
			)
		: [];

	const setLock = (pid: number, lock: UiLock) => {
		setLocks((prev) => {
			const next = { ...prev };
			if (lockCount(lock) === 0 && !lock.reroll) {
				delete next[pid];
			} else {
				next[pid] = lock;
			}
			return next;
		});
	};

	const apply = async () => {
		setApplying(true);
		try {
			const result = await toWorker("regenerateRatings", "applyRegenerate", {
				draftYear: season,
				settings,
				locks,
				pids,
			});
			const unchanged = preview?.rows.every(
				(r) => !r.inScope || r.skipped || (r.ovrUnchanged && r.potUnchanged),
			);
			setStatus(
				`Applied to ${result.applied} prospect${result.applied === 1 ? "" : "s"}.${unchanged ? " Overalls and potentials are unchanged." : ""}`,
			);
			await load();
		} catch (error) {
			setError(error.message);
		} finally {
			setApplying(false);
		}
	};

	const undo = async () => {
		const result = await toWorker(
			"regenerateRatings",
			"undoRegenerate",
			undefined,
		);
		setStatus(
			result.restored > 0
				? `Undid the last apply (${result.restored} prospects restored).`
				: "Nothing to undo.",
		);
		await load();
	};

	const restore = async () => {
		const result = await toWorker(
			"regenerateRatings",
			"restoreOriginalRatings",
			{
				draftYear: season,
				pids,
			},
		);
		setStatus(
			`Restored the original ratings of ${result.restored} prospect${result.restored === 1 ? "" : "s"}.`,
		);
		await load();
	};

	const numInScope = preview?.numInScope ?? 0;
	const allOk = preview !== undefined && preview.numOvrChanged === 0;
	const anyShortfall = rows.some((r) => r.inScope && r.shortfall !== 0);

	return (
		<Modal show={show} onHide={onHide} fullscreen scrollable>
			<Modal.Header closeButton>
				<Modal.Title>Regenerate ratings</Modal.Title>
			</Modal.Header>
			<Modal.Body>
				<p className="text-body-secondary">
					Rebuild prospects into specialized archetypes (Floor General, Stretch
					Five, Rim Protector, ...) without changing anyone's overall rating,
					potential or height. Every build is re-solved against the game's own
					ovr formula. Nothing is saved until you press Apply, and Apply can be
					undone.
				</p>

				<div className="d-flex flex-wrap align-items-end gap-3 mb-3">
					{seasons.length > 1 ? (
						<div>
							<label className="form-label mb-0" htmlFor="regen-season">
								Draft class
							</label>
							<select
								id="regen-season"
								className="form-select form-select-sm"
								value={season}
								onChange={(event) => {
									setSeason(Number(event.target.value));
									setSelected(new Set());
									setOneId(undefined);
									setLocks({});
									setExpanded(undefined);
								}}
							>
								{seasons.map((s) => (
									<option key={s} value={s}>
										{s}
									</option>
								))}
							</select>
						</div>
					) : null}
					<div>
						<div className="form-label mb-0">Scope</div>
						<div className="btn-group btn-group-sm" role="group">
							{SCOPES.map((s) => (
								<button
									key={s.value}
									type="button"
									className={
										scope === s.value
											? "btn btn-secondary"
											: "btn btn-light-bordered"
									}
									onClick={() => setScope(s.value)}
								>
									{s.label}
								</button>
							))}
						</div>
					</div>
					{scope === "one" ? (
						<div>
							<label className="form-label mb-0" htmlFor="regen-one">
								Prospect
							</label>
							<select
								id="regen-one"
								className="form-select form-select-sm"
								value={oneId ?? ""}
								onChange={(event) =>
									setOneId(
										event.target.value === ""
											? undefined
											: Number(event.target.value),
									)
								}
							>
								<option value="">Pick a prospect</option>
								{rows.map((r) => (
									<option key={r.pid} value={r.pid}>
										{r.firstName} {r.lastName} ({r.pos[0]}, {r.ovr[0]}/
										{r.pot[0]})
									</option>
								))}
							</select>
						</div>
					) : null}
					<div className="d-flex flex-wrap gap-2 ms-auto">
						<button
							type="button"
							className="btn btn-sm btn-light-bordered"
							onClick={() => update({ seed: mintSeed() })}
							title="Draw a new seed"
						>
							Reroll seed
						</button>
						<button
							type="button"
							className="btn btn-sm btn-light-bordered"
							disabled={!preview?.canUndo}
							onClick={undo}
							title="Undo the last Apply (until the page is reloaded)"
						>
							Undo last apply
						</button>
						<button
							type="button"
							className="btn btn-sm btn-light-bordered"
							disabled={!preview || preview.numWithOriginals === 0}
							onClick={restore}
							title="Put prospects in scope back to their ratings from before they were first regenerated (survives a reload)"
						>
							Restore originals
						</button>
						<button
							type="button"
							className="btn btn-sm btn-link"
							onClick={() => setShowSettings((v) => !v)}
						>
							{showSettings ? "Hide settings" : "Show settings"}
						</button>
					</div>
				</div>

				<div className="row g-3">
					{showSettings ? (
						<div className="col-lg-4">
							<div
								className="border rounded p-3"
								style={{ maxHeight: "68vh", overflowY: "auto" }}
							>
								<ArchetypePoolPicker
									list={archetypes}
									value={settings.archetypePool}
									onChange={(ids) => update({ archetypePool: ids })}
								/>
								<SettingsForm
									settings={settings}
									update={update}
									idPrefix="regen"
								/>
								<button
									type="button"
									className="btn btn-sm btn-link px-0 mt-2"
									onClick={reset}
								>
									Reset settings
								</button>
							</div>
						</div>
					) : null}
					<div className={showSettings ? "col-lg-8" : "col-12"}>
						{error ? <div className="alert alert-danger">{error}</div> : null}
						{status ? (
							<div
								className="alert alert-success alert-dismissible py-2"
								role="status"
							>
								{status}
								<button
									type="button"
									className="btn-close py-2"
									aria-label="Dismiss"
									onClick={() => setStatus(undefined)}
								/>
							</div>
						) : null}

						{preview ? (
							<>
								<div className="mb-2 d-flex flex-wrap gap-x-3 gap-y-1 column-gap-4">
									<span>
										Class flavor:{" "}
										<b>
											{preview.flavor
												? `${preview.flavor.name} (${preview.flavor.label})`
												: "none"}
										</b>
									</span>
									<span>
										Build pool:{" "}
										<b>
											{preview.poolSize === null
												? "every build"
												: preview.poolSize}
										</b>
									</span>
									<span>
										Changing <b>{numInScope}</b> of {preview.numPlayers}{" "}
										prospects
									</span>
									<span className={allOk ? "text-success" : "text-warning"}>
										{allOk
											? "All overalls unchanged"
											: `${preview.numOvrChanged} overall${preview.numOvrChanged === 1 ? "" : "s"} will change (locks)`}
									</span>
									{anyShortfall ? (
										<span className="text-danger">
											Some prospects cannot be built to the overall asked for at
											their height
										</span>
									) : null}
								</div>

								<ResponsiveTableWrapper>
									<table className="table table-sm table-striped align-middle mb-0">
										<thead>
											<tr>
												{scope === "selected" ? (
													<th>
														<input
															type="checkbox"
															className="form-check-input"
															aria-label="Select all prospects"
															checked={
																selected.size > 0 &&
																selected.size === rows.length
															}
															onChange={(event) =>
																setSelected(
																	event.target.checked
																		? new Set(rows.map((r) => r.pid))
																		: new Set(),
																)
															}
														/>
													</th>
												) : null}
												<th>#</th>
												<th>Name</th>
												<th>Pos</th>
												<th>Ovr</th>
												<th>Pot</th>
												<th>Archetype</th>
												<th>Ratings changed</th>
												<th title="Overall and potential unchanged">OK</th>
												<th />
											</tr>
										</thead>
										<tbody>
											{rows.map((r, i) => {
												const lock = locks[r.pid] ?? {};
												const open = expanded === r.pid;
												const dim = !r.inScope || r.skipped;
												return (
													<Fragment key={r.pid}>
														<tr className={clsx({ "text-body-tertiary": dim })}>
															{scope === "selected" ? (
																<td>
																	<input
																		type="checkbox"
																		className="form-check-input"
																		aria-label={`Select ${r.firstName} ${r.lastName}`}
																		checked={selected.has(r.pid)}
																		onChange={(event) =>
																			setSelected((prev) => {
																				const next = new Set(prev);
																				if (event.target.checked) {
																					next.add(r.pid);
																				} else {
																					next.delete(r.pid);
																				}
																				return next;
																			})
																		}
																	/>
																</td>
															) : null}
															<td>{i + 1}</td>
															<td className="text-nowrap">
																<a href={helpers.leagueUrl(["player", r.pid])}>
																	{r.firstName} {r.lastName}
																</a>{" "}
																<span className="text-body-secondary small">
																	{r.age}
																</span>
															</td>
															<td className="text-nowrap">
																{r.pos[0]}
																{r.pos[0] !== r.pos[1] && !dim ? (
																	<>
																		{" "}
																		<span className="text-body-secondary">
																			{"→"}
																		</span>{" "}
																		<b>{r.pos[1]}</b>
																	</>
																) : null}
															</td>
															<td className="text-nowrap">
																{r.ovr[0]}
																{r.ovr[0] !== r.ovr[1] && !dim ? (
																	<>
																		{" "}
																		{"→"} <b>{r.ovr[1]}</b>
																	</>
																) : null}
															</td>
															<td className="text-nowrap">
																{r.pot[0]}
																{r.pot[0] !== r.pot[1] && !dim ? (
																	<>
																		{" "}
																		{"→"} <b>{r.pot[1]}</b>
																	</>
																) : null}
															</td>
															<td className="text-wrap">
																{r.skipped ? (
																	<span className="text-body-secondary">
																		left alone
																	</span>
																) : (
																	<>
																		<b>{r.archetype.after}</b>
																		{r.archetype.target ? (
																			<span
																				className={
																					r.archetype.target.matched
																						? "text-success"
																						: "text-warning"
																				}
																				title={
																					r.archetype.target.matched
																						? `Aimed at ${r.archetype.target.name}: it came out`
																						: `Aimed at ${r.archetype.target.name}: ${r.archetype.target.inLabel ? "close, it is part of his label" : "his ratings could not get all the way there at this overall"}`
																				}
																			>
																				{" "}
																				{r.archetype.target.matched ? "✓" : "~"}
																			</span>
																		) : null}
																		{r.archetype.before !==
																		r.archetype.after ? (
																			<span className="text-body-secondary">
																				{" "}
																				(was {r.archetype.before})
																			</span>
																		) : null}
																		<div className="small text-body-secondary">
																			via {r.build.name}
																		</div>
																	</>
																)}
															</td>
															<td className="text-wrap">
																{r.skipped ? null : (
																	<ChangeSummary ratings={r.ratings} />
																)}
															</td>
															<td>
																{r.skipped ? null : r.shortfall !== 0 ? (
																	<span
																		className="text-danger"
																		title="This overall cannot be reached at his height with the locks you set"
																	>
																		!
																	</span>
																) : r.ovrUnchanged && r.potUnchanged ? (
																	<span
																		className="text-success"
																		title="Overall and potential unchanged"
																	>
																		{"✓"}
																	</span>
																) : (
																	<span
																		className="text-warning"
																		title="You asked for a different overall or potential"
																	>
																		~
																	</span>
																)}
															</td>
															<td className="text-nowrap text-end">
																<div className="btn-group btn-group-sm">
																	<button
																		type="button"
																		className="btn btn-light-bordered"
																		onClick={() =>
																			setLock(r.pid, {
																				...lock,
																				reroll: (lock.reroll ?? 0) + 1,
																			})
																		}
																		title="Reroll just him"
																	>
																		Reroll
																	</button>
																	<button
																		type="button"
																		className={clsx(
																			"btn",
																			lockCount(lock) > 0
																				? "btn-secondary"
																				: "btn-light-bordered",
																		)}
																		onClick={() =>
																			setExpanded(open ? undefined : r.pid)
																		}
																		aria-expanded={open}
																	>
																		{open
																			? "Hide"
																			: lockCount(lock) > 0
																				? `Locks (${lockCount(lock)})`
																				: "Details"}
																	</button>
																</div>
															</td>
														</tr>
														{open ? (
															<tr>
																<td
																	colSpan={scope === "selected" ? 10 : 9}
																	className="bg-body-secondary"
																>
																	<RowDetail
																		row={r}
																		builds={builds}
																		archetypes={archetypes}
																		lock={lock}
																		setLock={(l) => setLock(r.pid, l)}
																	/>
																</td>
															</tr>
														) : null}
													</Fragment>
												);
											})}
										</tbody>
									</table>
								</ResponsiveTableWrapper>
							</>
						) : error ? null : (
							<div className="text-body-secondary">Loading preview...</div>
						)}
					</div>
				</div>
			</Modal.Body>
			<Modal.Footer>
				<div className="d-flex flex-wrap gap-2">
					<button type="button" className="btn btn-secondary" onClick={onHide}>
						Close
					</button>
					<ActionButton
						variant="primary"
						onClick={apply}
						processing={applying}
						processingText="Applying"
						disabled={!preview || numInScope === 0 || !!error}
					>
						Apply to {numInScope} prospect{numInScope === 1 ? "" : "s"}
					</ActionButton>
				</div>
			</Modal.Footer>
		</Modal>
	);
};
