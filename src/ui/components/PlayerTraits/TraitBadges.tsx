import { useId } from "react";
import { OverlayTrigger, Tooltip } from "react-bootstrap";
import {
	TRAIT_CATEGORIES,
	TRAIT_CATEGORY_BY_KEY,
	TRAIT_DEFINITIONS,
	traitBadges,
	traitStatusText,
	type ScoutedTrait,
	type TraitKey,
	type TraitScores,
} from "../../../common/playerTraits/index.ts";

const Badge = ({
	traitKey,
	label,
	tone,
	uncertain,
	trait,
}: {
	traitKey: TraitKey;
	label: string;
	tone: "good" | "bad";
	uncertain: boolean;
	trait: ScoutedTrait;
}) => {
	const id = useId();
	const def = TRAIT_DEFINITIONS[traitKey];
	return (
		<OverlayTrigger
			overlay={
				<Tooltip id={id}>
					<b>{def.name}</b>: {traitStatusText(trait)}.
				</Tooltip>
			}
		>
			<span
				className={`badge me-1 ${tone === "good" ? "bg-success" : "bg-danger"}${uncertain ? " opacity-75" : ""}`}
				data-trait={traitKey}
				style={{ fontWeight: 500 }}
			>
				{label}
				{uncertain ? "?" : ""}
			</span>
		</OverlayTrigger>
	);
};

// Compact badges for the notable traits of a player (strong or weak ones only). Estimates for prospects get a "?".
export const TraitBadges = ({
	traits,
	max = 3,
}: {
	traits: ScoutedTrait[];
	max?: number;
}) => {
	// An estimate has to be more extreme than an exact reading to earn a badge
	const scores = {} as TraitScores;
	const uncertain = new Set<TraitKey>();
	for (const t of traits) {
		scores[t.key] =
			t.exact || Math.abs(t.estimate - 50) >= 30 ? t.estimate : 50;
		if (!t.exact) {
			uncertain.add(t.key);
		}
	}
	const byKey = new Map(traits.map((t) => [t.key, t]));
	// Most notable first, then shown grouped by category
	const order = TRAIT_CATEGORIES.map((c) => c.key);
	const badges = traitBadges(scores, { max }).sort(
		(a, b) =>
			order.indexOf(TRAIT_CATEGORY_BY_KEY[a.key]) -
			order.indexOf(TRAIT_CATEGORY_BY_KEY[b.key]),
	);
	if (badges.length === 0) {
		return null;
	}
	return (
		<>
			{badges.map((b) => (
				<Badge
					key={b.key}
					traitKey={b.key}
					label={b.label}
					tone={b.tone}
					uncertain={uncertain.has(b.key)}
					trait={byKey.get(b.key)!}
				/>
			))}
		</>
	);
};
