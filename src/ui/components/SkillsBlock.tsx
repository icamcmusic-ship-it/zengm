import { useId, useState } from "react";
import { OverlayTrigger, Tooltip } from "react-bootstrap";
import { useLocal } from "../util/local.ts";
import { SKILLS } from "../../common/constants.ts";
import {
	badgeTitle,
	capDisplayItems,
	orderDisplayItems,
} from "../../common/skillBadges/compute.ts";
import { useFeatureOn } from "../util/nativeFeatures.ts";

const TruncatedSkills = ({
	numSkillsBeforeTruncate,
	skills,
}: {
	numSkillsBeforeTruncate: number;
	skills: string[];
}) => {
	const remainingSkills = skills.slice(numSkillsBeforeTruncate);

	const tooltipId = useId();

	return (
		<OverlayTrigger
			overlay={
				<Tooltip id={tooltipId}>
					{numSkillsBeforeTruncate > 0 ? "..." : null}
					{remainingSkills.join(" ")}
				</Tooltip>
			}
		>
			<button className="btn btn-link p-0 skill">...</button>
		</OverlayTrigger>
	);
};

export const SkillsBlock = ({
	className,
	numSkillsBeforeTruncate,
	skills,
	badges,
}: {
	className?: string;
	numSkillsBeforeTruncate?: number;
	skills?: string[];
	// Extended skill badges and combos (display only, from getDisplayBadges), all shown after the original skills in the same format
	badges?: string[];
}) => {
	const { fullNames } = useLocal(["fullNames"]);
	const badgesOn = useFeatureOn("skillBadges");
	const [expanded, setExpanded] = useState(false);

	if (skills === undefined) {
		return null;
	}

	if (badgesOn && badges) {
		// Extended badges: combos replace the skills they combine (e.g. Dp + Di -> Sw), display only. Up to 7, then a "…" that toggles the rest for this player.
		const { shown, hasMore } = capDisplayItems(
			orderDisplayItems(skills, badges),
			expanded,
		);
		return (
			<span className={className}>
				{shown.map(({ token, original }) => (
					<span
						key={token}
						className="skill"
						title={original ? SKILLS[token] : badgeTitle(token)}
					>
						{token}
					</span>
				))}
				{hasMore ? (
					<span
						className="skill"
						role="button"
						tabIndex={0}
						aria-expanded={expanded}
						title={expanded ? "Show fewer skills" : "Show all skills"}
						style={{ cursor: "pointer" }}
						onClick={(event) => {
							event.preventDefault();
							event.stopPropagation();
							setExpanded((x) => !x);
						}}
						onKeyDown={(event) => {
							if (event.key === "Enter" || event.key === " ") {
								event.preventDefault();
								event.stopPropagation();
								setExpanded((x) => !x);
							}
						}}
					>
						…
					</span>
				) : null}
			</span>
		);
	}

	const truncate =
		!fullNames &&
		numSkillsBeforeTruncate !== undefined &&
		skills.length > numSkillsBeforeTruncate;
	const truncatedSkills = truncate
		? skills.slice(0, numSkillsBeforeTruncate)
		: skills;

	return (
		<span className={className}>
			{truncatedSkills.map((skill) => (
				<span key={skill} className="skill" title={SKILLS[skill]}>
					{skill}
				</span>
			))}
			{truncate ? (
				<TruncatedSkills
					skills={skills}
					numSkillsBeforeTruncate={numSkillsBeforeTruncate}
				/>
			) : null}
		</span>
	);
};
