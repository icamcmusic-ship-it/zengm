import {
	TRAIT_DEFINITIONS,
	TRAIT_KEYS,
	TRAIT_LEVEL_LABELS,
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
					{def.visibility === "hidden" ? (
						<span
							className="text-body-secondary ms-1"
							title="Hidden trait: only shows up over time"
						>
							(hidden)
						</span>
					) : null}
				</span>
				<span className="text-body-secondary small">
					{trait.exact ? null : "~"}
					{trait.estimate}
					{trait.exact ? null : ` (${trait.low}-${trait.high})`} ·{" "}
					{TRAIT_LEVEL_LABELS[level]}
				</span>
			</div>
			<div
				className="position-relative bg-body-secondary rounded"
				style={{ height: 8 }}
				role="progressbar"
				aria-valuenow={trait.estimate}
				aria-valuemin={0}
				aria-valuemax={100}
				aria-label={def.name}
			>
				{trait.exact ? null : (
					<div
						className="position-absolute rounded bg-body-tertiary border"
						style={{
							left: `${trait.low}%`,
							width: `${Math.max(1, trait.high - trait.low)}%`,
							height: 8,
						}}
						title="Scouting uncertainty range"
					/>
				)}
				<div
					className={`position-absolute rounded ${barClass(trait.estimate)}`}
					style={{
						left: 0,
						width: `${trait.estimate}%`,
						height: 8,
						opacity: trait.exact ? 1 : 0.6,
					}}
				/>
				<div
					className="position-absolute bg-body"
					style={{ left: "50%", width: 1, height: 8 }}
				/>
			</div>
			<div className="small text-body-secondary">
				{traitDescription(trait.key, trait.estimate)}. {def.description}
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
