import { useEffect, useRef, useState } from "react";
import type {
	SingleResult,
	UiLock,
} from "../../../worker/core/draft/regenerateRatings.ts";
import {
	RATING_ORDER,
	RatingsDiff,
} from "../../components/RegenerateRatings/RatingsDiff.tsx";
import { SettingsForm } from "../../components/RegenerateRatings/SettingsForm.tsx";
import {
	mintSeed,
	useBuildSettings,
} from "../../components/RegenerateRatings/useBuildSettings.ts";
import { Modal } from "../../components/Modal.tsx";
import { SkillsBlock } from "../../components/SkillsBlock.tsx";
import { toWorker } from "../../util/toWorker.ts";
import type { RatingKey } from "../../../common/types.basketball.ts";
import type { StoredRatingsBuild } from "../../../common/ratingsBuilds/types.ts";

type BuildInfo = { name: string; min: number; max: number; tags: string[] };

// Reads the form's ratings (strings while being typed) as numbers, or undefined if any is not a number
const parseRatings = (row: Record<string, any>) => {
	const out: Partial<Record<RatingKey, number>> = {};
	for (const key of RATING_ORDER) {
		const v = Number.parseInt(row[key]);
		if (Number.isNaN(v)) {
			return undefined;
		}
		out[key] = Math.min(100, Math.max(0, v));
	}
	return out as Record<RatingKey, number>;
};

export const RegenerateBuild = ({
	pid,
	ratingsRow,
	age,
	hgtInches,
	college,
	disabled,
	currentBuild,
	onApply,
}: {
	pid: number | undefined;
	ratingsRow: Record<string, any>;
	age: unknown;
	hgtInches: unknown;
	college: string;
	disabled: boolean;
	currentBuild: string | undefined;
	onApply: (result: {
		ratings: Record<RatingKey, number>;
		stored: StoredRatingsBuild;
	}) => void;
}) => {
	const [show, setShow] = useState(false);
	const { settings, update } = useBuildSettings("regenerateBuildSettings");
	const [lock, setLock] = useState<UiLock>({});
	const [result, setResult] = useState<SingleResult | undefined>();
	const [error, setError] = useState<string | undefined>();
	const [builds, setBuilds] = useState<BuildInfo[]>([]);
	const requestId = useRef(0);

	const ratings = parseRatings(ratingsRow);
	const ageNum = Number.parseInt(String(age));
	const hgtNum = Number.parseInt(String(hgtInches));

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
			if (mounted) {
				setBuilds(list);
			}
		})();
		return () => {
			mounted = false;
		};
	}, [show]);

	const ratingsKey = JSON.stringify(ratings);

	useEffect(() => {
		if (!show) {
			return;
		}
		if (!ratings || Number.isNaN(ageNum) || Number.isNaN(hgtNum)) {
			setError("Fix the ratings, age and height in the form first.");
			return;
		}
		const id = ++requestId.current;
		const timeout = setTimeout(async () => {
			try {
				const res = await toWorker(
					"regenerateRatings",
					"previewRegenerateSingle",
					{
						pid,
						ratings,
						fuzz: Number(ratingsRow.fuzz) || 0,
						pot: Number(ratingsRow.pot) || 0,
						age: ageNum,
						hgtInches: hgtNum,
						college,
						settings,
						lock,
					},
				);
				if (id === requestId.current) {
					setResult(res);
					setError(undefined);
				}
			} catch (error) {
				if (id === requestId.current) {
					setError(error.message);
				}
			}
		}, 150);
		return () => clearTimeout(timeout);
		// eslint-disable-next-line react-hooks/exhaustive-deps
	}, [show, ratingsKey, JSON.stringify(settings), JSON.stringify(lock), pid]);

	const eligible = ratings
		? builds.filter((b) => ratings.hgt >= b.min && ratings.hgt <= b.max)
		: [];

	return (
		<>
			<button
				type="button"
				className="btn btn-secondary btn-sm mt-1"
				disabled={disabled}
				onClick={() => setShow(true)}
				title="Rebuild this player's ratings into a different build (archetype) without changing his overall, potential or height"
			>
				Regenerate build
			</button>
			<Modal show={show} onHide={() => setShow(false)} size="xl" scrollable>
				<Modal.Header closeButton>
					<Modal.Title>Regenerate build</Modal.Title>
				</Modal.Header>
				<Modal.Body>
					<p className="text-body-secondary">
						Rebuilds the ratings in the form into a different build, keeping his
						overall, potential and height. Nothing is saved until you press{" "}
						<b>Use these ratings</b> and then save the player.
						{currentBuild ? (
							<>
								{" "}
								His current build is <b>{currentBuild}</b>.
							</>
						) : null}
					</p>
					<div className="row g-3">
						<div className="col-lg-4">
							<SettingsForm
								settings={settings}
								update={update}
								compact
								idPrefix="regen-one"
							/>
							<label className="form-label mb-0" htmlFor="regen-one-build">
								Build
							</label>
							<select
								id="regen-one-build"
								className="form-select form-select-sm mb-2"
								value={lock.build ?? ""}
								onChange={(event) =>
									setLock({ ...lock, build: event.target.value || undefined })
								}
							>
								<option value="">Auto (drawn from the seed)</option>
								{eligible.map((b) => (
									<option key={b.name} value={b.name}>
										{b.name}
									</option>
								))}
							</select>
						</div>
						<div className="col-lg-8">
							{error ? <div className="alert alert-danger">{error}</div> : null}
							{result ? (
								<>
									<div className="mb-2 d-flex flex-wrap column-gap-4">
										<span>
											Build: <b>{result.build.name}</b>{" "}
											<span className="text-body-secondary">
												{result.build.tags.join(", ")}
											</span>
										</span>
										<span>
											Pos {result.pos[0]}
											{result.pos[0] !== result.pos[1]
												? ` → ${result.pos[1]}`
												: ""}
										</span>
										<span>
											Skills <SkillsBlock skills={result.skills[0]} /> {"→"}{" "}
											<SkillsBlock skills={result.skills[1]} />
										</span>
										<span
											className={
												result.ovr[0] === result.ovr[1] &&
												result.shortfall === 0
													? "text-success"
													: "text-warning"
											}
										>
											Overall {result.ovr[0]} {"→"} {result.ovr[1]}
										</span>
										<span>
											Pot {result.pot[0]} {"→"} {result.pot[1]}
										</span>
									</div>
									<RatingsDiff
										ratings={result.ratings}
										pinned={lock.pinKeys}
										onTogglePin={(key) => {
											const keys = new Set(lock.pinKeys ?? []);
											if (keys.has(key)) {
												keys.delete(key);
											} else {
												keys.add(key);
											}
											setLock({ ...lock, pinKeys: [...keys] });
										}}
									/>
									<div className="form-text">
										Flip a rating's switch to keep it exactly where it is.
									</div>
								</>
							) : error ? null : (
								<div className="text-body-secondary">Loading preview...</div>
							)}
						</div>
					</div>
				</Modal.Body>
				<Modal.Footer className="justify-content-between">
					<button
						type="button"
						className="btn btn-light-bordered"
						onClick={() => {
							update({ seed: mintSeed() });
							setLock({ ...lock, reroll: undefined });
						}}
					>
						Reroll
					</button>
					<div className="d-flex gap-2">
						<button
							type="button"
							className="btn btn-secondary"
							onClick={() => setShow(false)}
						>
							Cancel
						</button>
						<button
							type="button"
							className="btn btn-primary"
							disabled={!result || !!error}
							onClick={() => {
								if (!result) {
									return;
								}
								const next = {} as Record<RatingKey, number>;
								for (const r of result.ratings) {
									next[r.key] = r.after;
								}
								onApply({ ratings: next, stored: result.stored });
								setShow(false);
							}}
						>
							Use these ratings
						</button>
					</div>
				</Modal.Footer>
			</Modal>
		</>
	);
};
