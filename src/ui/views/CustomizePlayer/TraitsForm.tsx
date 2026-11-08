import {
	TRAIT_DEFINITIONS,
	TRAIT_KEYS,
	TRAIT_LEVEL_LABELS,
	clampSeed,
	completeTraitSeeds,
	seedForScore,
	seedKey,
	traitLevel,
	traitScores,
	type PlayerTraits,
	type TraitKey,
	type TraitRatings,
} from "../../../common/playerTraits/index.ts";

// God Mode editor for the 0-100 trait scores. Moving a slider changes the stored random component of that trait so the score lands on the chosen value with the player's current ratings, age and experience. If the ratings change a lot afterwards the score moves with them.
export const TraitsForm = ({
	age,
	experience,
	leagueSeed,
	onChange,
	pid,
	ratings,
	traits,
}: {
	age: number;
	experience: number;
	leagueSeed: number;
	onChange: (traits: PlayerTraits) => void;
	pid: number | undefined;
	ratings: TraitRatings;
	traits: PlayerTraits | undefined;
}) => {
	const seeds = completeTraitSeeds(traits, leagueSeed, pid ?? 0);
	const context = { age, experience };
	const scores = traitScores(ratings, seeds, context);

	const setScore = (key: TraitKey, wanted: number) => {
		onChange({
			...seeds,
			[seedKey(key)]: clampSeed(seedForScore(key, ratings, wanted, context)),
		});
	};

	return (
		<>
			<h2>Traits</h2>
			<p className="text-body-secondary">
				0-100, where 50 is a league average player. These are what the game
				simulation uses. Hidden traits are only visible to you here.
			</p>
			<div className="row">
				{TRAIT_KEYS.map((key) => {
					const def = TRAIT_DEFINITIONS[key];
					const id = `trait-${key}`;
					return (
						<div className="col-md-6 col-xl-4 mb-3" key={key}>
							<label
								htmlFor={id}
								className="form-label mb-0"
								title={def.effect}
							>
								<b>{def.name}</b>{" "}
								<span className="text-body-secondary">
									{scores[key]} · {TRAIT_LEVEL_LABELS[traitLevel(scores[key])]}
								</span>
							</label>
							<input
								id={id}
								type="range"
								className="form-range"
								min={0}
								max={100}
								step={1}
								value={scores[key]}
								onChange={(event) => {
									setScore(key, Number.parseInt(event.target.value));
								}}
							/>
							<div className="small text-body-secondary">
								{def.low} / {def.high}
							</div>
						</div>
					);
				})}
			</div>
		</>
	);
};
