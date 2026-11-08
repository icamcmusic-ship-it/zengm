import {
	TRAIT_DEFINITIONS,
	TRAIT_KEYS,
	TRAIT_LEVEL_LABELS,
	formatTraitReading,
	traitDescription,
	traitLevel,
	type ScoutedTrait,
} from "../../../common/playerTraits/index.ts";

const barClass = (score: number) =>
	score >= 65 ? "bg-success" : score <= 35 ? "bg-danger" : "bg-secondary";

export const TraitBar = ({ trait }: { trait: ScoutedTrait }) => {
	const def = TRAIT_DEFINITIONS[trait.key];
	const level = traitLevel(trait.estimate);
	return (
		<div className="mb-2" data-trait={trait.key}>
			<div className="d-flex justify-content-between align-items-baseline">
				<span title={def.description}>
					<b>{def.name}</b>
					{def.visibility === "hidden" && !trait.exact ? (
						<span
							className="text-body-secondary ms-1"
							title="Hidden trait: only shows up over time"
						>
							(hidden)
						</span>
					) : null}
				</span>
				<span className="text-body-secondary small">
					{formatTraitReading(trait)}
					{trait.exact ? ` · ${TRAIT_LEVEL_LABELS[level]}` : null}
				</span>
			</div>
			<div
				className="position-relative bg-body-secondary rounded"
				style={{ height: 8 }}
				role="progressbar"
				aria-valuenow={trait.exact ? trait.estimate : undefined}
				aria-valuetext={formatTraitReading(trait)}
				aria-valuemin={0}
				aria-valuemax={100}
				aria-label={def.name}
			>
				{trait.exact ? (
					<div
						className={`position-absolute rounded ${barClass(trait.estimate)}`}
						style={{
							left: 0,
							width: `${trait.estimate}%`,
							height: 8,
						}}
					/>
				) : (
					// Only the range the scouts can vouch for, no point estimate
					<div
						className="position-absolute rounded bg-secondary opacity-50"
						style={{
							left: `${trait.low}%`,
							width: `${Math.max(1, trait.high - trait.low)}%`,
							height: 8,
						}}
						title="Scouting range"
					/>
				)}
				<div
					className="position-absolute bg-body"
					style={{ left: "50%", width: 1, height: 8 }}
				/>
			</div>
			<div className="small text-body-secondary">
				{trait.exact
					? `${traitDescription(trait.key, trait.estimate)}. `
					: "Not fully known yet. "}
				{def.description}
			</div>
		</div>
	);
};

export const TraitBars = ({ traits }: { traits: ScoutedTrait[] }) => {
	const byKey = new Map(traits.map((t) => [t.key, t]));
	return (
		<div className="row">
			{TRAIT_KEYS.map((key) => {
				const trait = byKey.get(key);
				return trait ? (
					<div key={key} className="col-12 col-md-6 col-xl-4">
						<TraitBar trait={trait} />
					</div>
				) : null;
			})}
		</div>
	);
};

// Plain language list of what each trait does in games
export const TraitEffectsHelp = () => (
	<details className="mb-3">
		<summary>How traits affect games</summary>
		<p className="mt-2 mb-1 text-body-secondary">
			50 is a league average player and changes nothing. Effects are small and
			average out across the league, so team strength and league stats stay
			about the same. They shape who does what, and how close games and injuries
			play out.
		</p>
		<ul>
			{TRAIT_KEYS.map((key) => (
				<li key={key}>
					<b>{TRAIT_DEFINITIONS[key].name}</b>: {TRAIT_DEFINITIONS[key].effect}{" "}
					<span className="text-body-secondary">
						{TRAIT_DEFINITIONS[key].growth}
					</span>
				</li>
			))}
		</ul>
	</details>
);
