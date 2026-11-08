import { useId } from "react";
import { OverlayTrigger, Tooltip } from "react-bootstrap";
import { useLocal } from "../util/local.ts";
import { SKILLS } from "../../common/constants.ts";
import { SKILL_BADGES_BY_LABEL } from "../../common/skillBadges/definitions.ts";
import {
	describeBadge,
	selectBadgesForMode,
} from "../../common/skillBadges/compute.ts";
import { useBadgeMode } from "../util/badgeSettings.ts";

const ExtendedBadges = ({ badges }: { badges: string[] }) => {
	const mode = useBadgeMode();
	const { shown, hidden } = selectBadgesForMode(badges, mode);
	const tooltipId = useId();
	if (shown.length === 0) {
		return null;
	}
	return (
		<span className="skill-badges">
			{shown.map((label) => {
				const def = SKILL_BADGES_BY_LABEL[label];
				return (
					<span
						key={label}
						className={`skill skill-badge skill-badge-${def?.flag ? "flag" : (def?.group ?? "mental")}`}
						title={describeBadge(label)}
					>
						{label}
					</span>
				);
			})}
			{hidden.length > 0 ? (
				<OverlayTrigger
					overlay={
						<Tooltip id={tooltipId}>
							{hidden.map((label) => (
								<div key={label}>
									{label}: {describeBadge(label)}
								</div>
							))}
						</Tooltip>
					}
				>
					<button className="btn btn-link p-0 skill skill-badge skill-badge-more">
						+{hidden.length}
					</button>
				</OverlayTrigger>
			) : null}
		</span>
	);
};

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
	// Extended skill badges (display only), shown after the original skills according to the user's badge setting
	badges?: string[];
}) => {
	const { fullNames } = useLocal(["fullNames"]);

	if (skills === undefined) {
		return null;
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
			{badges && badges.length > 0 ? <ExtendedBadges badges={badges} /> : null}
		</span>
	);
};
