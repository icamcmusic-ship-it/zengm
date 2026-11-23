import { useId } from "react";
import { OverlayTrigger, Popover, Tooltip } from "react-bootstrap";
import { useLocal } from "../util/local.ts";
import { SKILLS } from "../../common/constants.ts";

import {
	CATEGORY_NAMES,
	TIER_NAMES,
	TIER_PERCENTILES,
	parseBadgeToken,
} from "../../common/tieredBadges/index.ts";
import {
	BADGE_EFFECTS,
	formatBadgeEffect,
} from "../../common/tieredBadges/effects.ts";

type ParsedBadge = NonNullable<ReturnType<typeof parseBadgeToken>>;

// "Top 15%" of rotation players for a tier
const tierShare = (tier: number) => {
	const pct = 100 * (1 - TIER_PERCENTILES[tier - 1]!);
	return `top ${pct >= 1 ? Math.round(pct) : pct.toFixed(1)}%`;
};

// 2K Badges: a pill that opens a popup on click with what the badge is and what it does in games
const BadgePill = ({ badge }: { badge: ParsedBadge }) => {
	const popoverId = useId();
	const { def, tier } = badge;
	const effects = BADGE_EFFECTS[def.key];
	return (
		<OverlayTrigger
			trigger="click"
			rootClose
			placement="auto"
			overlay={
				<Popover id={popoverId} style={{ maxWidth: 320 }}>
					<Popover.Header as="div">
						<span className={`skill badge2k badge2k-${tier} me-1`}>
							{def.short}
						</span>
						<b>{def.name}</b> · {TIER_NAMES[tier]}
						<div className="text-body-secondary small">
							{CATEGORY_NAMES[def.category]} badge
						</div>
					</Popover.Header>
					<Popover.Body>
						<p className="mb-2">{def.meaning}</p>
						{effects ? (
							<>
								<div className="fw-bold">In games ({TIER_NAMES[tier]})</div>
								<ul className="ps-3 mb-2">
									{effects.map((e, i) => (
										<li key={i}>
											{formatBadgeEffect(e, tier)} to {e.what}
										</li>
									))}
								</ul>
								<div className="text-body-secondary small mb-1">
									Only when "2K Badge Effects in Sim" is on in League Extras.
								</div>
							</>
						) : (
							<p className="text-body-secondary small mb-1">
								No direct effect in games: it describes his game. Within a tier,
								badges with a game effect take his badge slots first.
							</p>
						)}
						<div className="text-body-secondary small">
							{TIER_NAMES[tier]}: {tierShare(tier)} of rotation players at this
							skill this season.
						</div>
					</Popover.Body>
				</Popover>
			}
		>
			<button
				type="button"
				className={`skill badge2k badge2k-${tier} border-0`}
				title={`${def.name} (${TIER_NAMES[tier]}): click for details`}
				onClick={(event) => {
					// Don't trigger row clicks or links around the pill
					event.stopPropagation();
				}}
			>
				{def.short}
			</button>
		</OverlayTrigger>
	);
};

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
					<BadgePill key={b.def.key} badge={b} />
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
