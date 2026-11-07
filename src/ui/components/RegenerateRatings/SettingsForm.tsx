import { useState } from "react";
import { CLASS_FLAVORS } from "../../../common/ratingsBuilds/flavors.data.ts";
import {
	RANDOM_SCOPES,
	randomizeSettings,
	type RandomScope,
} from "../../../common/ratingsBuilds/randomize.ts";
import {
	SETTING_RANGES,
	TABLE_SIZE,
	type BuildSettings,
	type NumericSettingKey,
} from "../../../common/ratingsBuilds/settings.ts";
import { mintSeed } from "./useBuildSettings.ts";

const SCOPE_LABELS: Record<RandomScope, string> = {
	gentle: "Gently",
	wide: "Wide open",
	mix: "Build mix",
	shape: "Shape",
	flavor: "Flavor",
};

const RangeControl = ({
	id,
	label,
	help,
	settingKey,
	value,
	onChange,
	format,
	locked,
	onToggleLock,
}: {
	id: string;
	label: string;
	help: string;
	settingKey: NumericSettingKey;
	value: number;
	onChange: (value: number) => void;
	format?: (value: number) => string;
	locked?: boolean;
	onToggleLock?: () => void;
}) => {
	const { min, max, step } = SETTING_RANGES[settingKey];
	return (
		<div className="mb-2">
			<div className="d-flex justify-content-between align-items-baseline gap-2">
				<label htmlFor={id} className="form-label mb-0" title={help}>
					{label}
				</label>
				<span className="d-flex align-items-baseline gap-2">
					<b>{format ? format(value) : value}</b>
					{onToggleLock ? (
						<label
							className="form-check form-check-inline small text-body-secondary m-0"
							title="Locked settings are left alone by Randomize settings"
						>
							<input
								type="checkbox"
								className="form-check-input"
								checked={!!locked}
								onChange={onToggleLock}
							/>{" "}
							lock
						</label>
					) : null}
				</span>
			</div>
			<input
				id={id}
				type="range"
				className="form-range"
				min={min}
				max={max}
				step={step}
				value={value}
				onChange={(event) => onChange(Number(event.target.value))}
			/>
			<div className="form-text mt-0">{help}</div>
		</div>
	);
};

// The controls shared by the class panel (Draft Scouting) and the single-player panel (Customize Player). `compact`
// hides everything that only means something for a whole class.
export const SettingsForm = ({
	settings,
	update,
	compact,
	idPrefix,
}: {
	settings: BuildSettings;
	update: (patch: Partial<BuildSettings>) => void;
	compact?: boolean;
	idPrefix: string;
}) => {
	const [locks, setLocks] = useState<
		Partial<Record<NumericSettingKey, boolean>>
	>({});
	const [scope, setScope] = useState<RandomScope>("gentle");
	const [lastRandomSeed, setLastRandomSeed] = useState<string | undefined>();

	const toggleLock = (key: NumericSettingKey) =>
		setLocks((prev) => ({ ...prev, [key]: !prev[key] }));

	const range = (
		key: NumericSettingKey,
		label: string,
		help: string,
		format?: (value: number) => string,
	) => (
		<RangeControl
			id={`${idPrefix}-${key}`}
			label={label}
			help={help}
			settingKey={key}
			value={settings[key]}
			onChange={(value) => update({ [key]: value })}
			format={format}
			locked={locks[key]}
			onToggleLock={() => toggleLock(key)}
		/>
	);

	const randomize = () => {
		const randomSeed = mintSeed();
		setLastRandomSeed(randomSeed);
		update(randomizeSettings(settings, scope, randomSeed, locks));
	};

	const flavor = CLASS_FLAVORS.find((f) => f.name === settings.flavor);

	return (
		<>
			<div className="row g-2 mb-2">
				<div className="col-sm-6">
					<label className="form-label mb-0" htmlFor={`${idPrefix}-seed`}>
						Seed
					</label>
					<div className="input-group input-group-sm">
						<input
							id={`${idPrefix}-seed`}
							type="text"
							className="form-control"
							value={settings.seed}
							onChange={(event) => update({ seed: event.target.value })}
						/>
						<button
							className="btn btn-secondary"
							type="button"
							onClick={() => update({ seed: mintSeed() })}
							title="Draw a new seed: a different set of builds and different players in them"
						>
							Reroll
						</button>
					</div>
					<div className="form-text mt-0">
						Same seed and settings, same ratings.
					</div>
				</div>
				{compact ? null : (
					<div className="col-sm-6">
						<label
							className="form-label mb-0"
							htmlFor={`${idPrefix}-variation`}
						>
							Variation: <b>{settings.variation}</b>
						</label>
						<input
							id={`${idPrefix}-variation`}
							type="range"
							className="form-range"
							min={SETTING_RANGES.variation.min}
							max={SETTING_RANGES.variation.max}
							step={1}
							value={settings.variation}
							onChange={(event) =>
								update({ variation: Number(event.target.value) })
							}
						/>
						<div className="form-text mt-0">
							0 is the class this seed always makes. 1, 2, 3... keep its flavor,
							build pool and plan and re-roll every player in it.
						</div>
					</div>
				)}
			</div>

			<div className="mb-2">
				<label className="form-label mb-0" htmlFor={`${idPrefix}-flavor`}>
					{compact ? "Flavor (tilts which build he gets)" : "Class flavor"}
				</label>
				<select
					id={`${idPrefix}-flavor`}
					className="form-select form-select-sm"
					value={settings.flavor}
					onChange={(event) => update({ flavor: event.target.value })}
				>
					<option value="">Draw one from the seed</option>
					{CLASS_FLAVORS.map((f) => (
						<option key={f.name} value={f.name}>
							{f.name} ({f.label})
						</option>
					))}
				</select>
				{flavor ? (
					<div className="form-text mt-0">Asks for a {flavor.label} class.</div>
				) : null}
			</div>

			{range(
				"flavorStrength",
				"Flavor strength",
				"How hard the flavor leans. 1 is the table as written, 0 turns flavors off.",
			)}
			{compact
				? null
				: range(
						"flavorBlend",
						"Two flavors at once",
						"The chance a second flavor is layered on top of the first.",
					)}
			{compact
				? null
				: range(
						"buildsPerClass",
						"Builds per class",
						`How many of the ${TABLE_SIZE} builds this class is drawn from. Lower is more distinctive (the year of the stretch bigs). 0 makes every build eligible.`,
						(v) => (v === 0 ? "all" : String(v)),
					)}
			{compact
				? null
				: range(
						"diversity",
						"Archetype diversity",
						"Exactly 100 - this percent of the class stays Balanced.",
						(v) => `${v}%`,
					)}
			{range(
				"specialization",
				"Specialization",
				"0 keeps the ratings' shape, 2.5 makes extreme specialists. Specializing makes a player lopsided, never better: his overall never changes.",
			)}
			{range(
				"buildNoise",
				"Build noise",
				"Per-rating jitter, drawn as a player (a good-touch draw lifts ft, fg and tp together).",
			)}

			<div className="d-flex flex-wrap align-items-center gap-2 mb-3">
				<div className="btn-group btn-group-sm" role="group">
					{RANDOM_SCOPES.filter(
						(s) => !compact || s === "gentle" || s === "wide" || s === "shape",
					).map((s) => (
						<button
							key={s}
							type="button"
							className={
								scope === s ? "btn btn-secondary" : "btn btn-light-bordered"
							}
							onClick={() => setScope(s)}
							title={
								s === "gentle"
									? "Draws new settings near their defaults"
									: s === "wide"
										? "Draws new settings anywhere in their ranges"
										: `Randomizes only the ${SCOPE_LABELS[s].toLowerCase()} settings`
							}
						>
							{SCOPE_LABELS[s]}
						</button>
					))}
				</div>
				<button
					type="button"
					className="btn btn-sm btn-secondary"
					onClick={randomize}
				>
					Randomize settings
				</button>
				{lastRandomSeed ? (
					<span className="text-body-secondary small">
						randomizer seed {lastRandomSeed}
					</span>
				) : null}
			</div>

			<div className="row g-2">
				<div className="col-sm-6">
					<div className="form-check">
						<input
							className="form-check-input"
							type="checkbox"
							id={`${idPrefix}-keepHeights`}
							checked={settings.keepHeights}
							onChange={(event) =>
								update({ keepHeights: event.target.checked })
							}
						/>
						<label
							className="form-check-label"
							htmlFor={`${idPrefix}-keepHeights`}
						>
							Keep heights
						</label>
						<div className="form-text mt-0">
							On: nobody's hgt rating or listed height moves. Off: height is
							part of what a reroll redraws.
						</div>
					</div>
					<div className="form-check mt-1">
						<input
							className="form-check-input"
							type="checkbox"
							id={`${idPrefix}-signature`}
							checked={settings.signatureSkills}
							onChange={(event) =>
								update({ signatureSkills: event.target.checked })
							}
						/>
						<label
							className="form-check-label"
							htmlFor={`${idPrefix}-signature`}
						>
							Deliver signature skills
						</label>
						<div className="form-text mt-0">
							A shooting build tries to earn the 3, an athletic one the A, a
							rebounding one the R.
						</div>
					</div>
				</div>
				{compact ? null : (
					<div className="col-sm-6">
						<label className="form-label mb-0" htmlFor={`${idPrefix}-fuzz`}>
							Scouting fuzz
						</label>
						<select
							id={`${idPrefix}-fuzz`}
							className="form-select form-select-sm"
							value={settings.fuzz}
							onChange={(event) =>
								update({ fuzz: event.target.value as BuildSettings["fuzz"] })
							}
						>
							<option value="keep">Keep</option>
							<option value="zero">Zero (true ratings show)</option>
							<option value="regenerate">Regenerate (seeded)</option>
						</select>
						<label className="form-label mb-0 mt-2" htmlFor={`${idPrefix}-pot`}>
							Potential
						</label>
						<select
							id={`${idPrefix}-pot`}
							className="form-select form-select-sm"
							value={settings.pot}
							onChange={(event) =>
								update({ pot: event.target.value as BuildSettings["pot"] })
							}
						>
							<option value="keep">Keep each pot</option>
							<option value="estimate">
								Re-read from the game's pot estimator
							</option>
							<option value="build">Keep, plus the build's upside</option>
						</select>
					</div>
				)}
			</div>
			{compact ? null : (
				<details className="mt-2">
					<summary className="text-body-secondary small">Rookie caps</summary>
					{range(
						"skillCap",
						"Skill cap",
						"Skill ratings ease in under this and rarely pass it. 0 turns it off. A rating a player already has is never lowered by it.",
						(v) => (v === 0 ? "off" : String(v)),
					)}
					{range(
						"physCap",
						"Physical cap",
						"The same for stre, spd, jmp and endu.",
						(v) => (v === 0 ? "off" : String(v)),
					)}
				</details>
			)}
		</>
	);
};
