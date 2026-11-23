import { useId } from "react";
import { OverlayTrigger, Tooltip } from "react-bootstrap";
import { useLocal } from "../util/local.ts";
import { SKILLS } from "../../common/constants.ts";

import {
	TIER_NAMES,
	parseBadgeToken,
} from "../../common/tieredBadges/index.ts";

// 2K Badges: a token's text for sorting and searching (its name and tier), or the token itself
const tokenText = (token: string) => {
	const parsed = parseBadgeToken(token);
	return parsed ? `${parsed.def.name} ${TIER_NAMES[parsed.tier]}` : token;
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

// Basketball: the stock skill labels are never shown (they are still computed for the game logic); players show only their 2K badges
// (at most MAX_BADGES, best first, as tier-colored pills). Other sports: the stock skills.
const BADGES_ONLY = __SPORT === "basketball";

export const SkillsBlock = ({
	className,
	numSkillsBeforeTruncate,
	skills,
	badges,
	sub,
}: {
	className?: string;
	numSkillsBeforeTruncate?: number;
	skills?: string[];
	// 2K badge tokens (basketball, from player format `badges`), best first
	badges?: string[];
	// Sub-ratings of the same row (as scouted), to name the sub that drives each skill in its tooltip (other sports: unused)
	sub?: number[];
}) => {
	const { fullNames } = useLocal(["fullNames"]);

	if (BADGES_ONLY) {
		const tiered = (badges ?? [])
			.map(parseBadgeToken)
			.filter((x) => x !== undefined);
		if (tiered.length === 0) {
			return null;
		}
		const truncateBadges =
			!fullNames &&
			numSkillsBeforeTruncate !== undefined &&
			tiered.length > numSkillsBeforeTruncate;
		return (
			<span className={className}>
				{(truncateBadges
					? tiered.slice(0, numSkillsBeforeTruncate)
					: tiered
				).map((b) => (
					<span
						key={b.def.key}
						className={`skill badge2k badge2k-${b.tier}`}
						title={`${b.def.name} (${TIER_NAMES[b.tier]})`}
					>
						{b.def.short}
					</span>
				))}
				{truncateBadges ? (
					<TruncatedSkills
						skills={tiered.map((b) => b.def.short)}
						numSkillsBeforeTruncate={numSkillsBeforeTruncate}
					/>
				) : null}
			</span>
		);
	}

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
				<span key={skill} className="skill" title={SKILLS[skill]!}>
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

// A table cell with only badges (basketball) or skills (other sports): sorted and searched by what is shown (badge names and tiers)
export const wrappedSkillsBlock = ({
	skills,
	badges,
}: {
	skills: string[] | undefined;
	badges?: string[];
}) => {
	const text = BADGES_ONLY
		? (badges ?? []).map(tokenText).join(" ")
		: (skills ?? []).join(" ");
	return {
		value: (
			<span className="skills-alone">
				<SkillsBlock skills={skills} badges={badges} />
			</span>
		),
		sortValue: text,
		searchValue: text,
	};
};
