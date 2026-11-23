import { useState } from "react";
import useTitleBar from "../hooks/useTitleBar.tsx";
import { helpers } from "../util/helpers.ts";
import { useLocal } from "../util/local.ts";
import { frivolitiesMenu } from "./Frivolities.tsx";
import type { View } from "../../common/types.ts";

type Props = View<"skillBadges">;
type Tiered = Props["tiered"];
type Badge = Tiered["badges"][number];
type Holder = Badge["holders"][number];

const TierPill = ({
	short,
	name,
	tier,
}: {
	short: string;
	name: string;
	tier: number;
}) => (
	<span className={`skill ms-0 badge2k badge2k-${tier}`} title={name}>
		{short}
	</span>
);

const PlayerLink = ({ p, userTid }: { p: Holder; userTid: number }) => (
	<a
		href={helpers.leagueUrl(["player", p.pid])}
		className={p.tid === userTid ? "fw-bold" : undefined}
	>
		{p.name}
	</a>
);

// A badge's holders, grouped by tier (best tier first; within a tier as the worker ordered them)
const HoldersByTier = ({
	badge,
	tierNames,
	userTid,
	full,
	hideRatings,
}: {
	badge: Badge;
	tierNames: string[];
	userTid: number;
	full: boolean;
	hideRatings: boolean;
}) => {
	const tiers = [5, 4, 3, 2, 1].filter((tier) =>
		badge.holders.some((h) => h.tier === tier),
	);
	if (tiers.length === 0) {
		return <div className="text-body-secondary small">No holders</div>;
	}
	return (
		<div className="small">
			{tiers.map((tier) => (
				<div key={tier} className="mb-1">
					<TierPill
						short={tierNames[tier - 1]!}
						name={tierNames[tier - 1]!}
						tier={tier}
					/>{" "}
					{badge.holders
						.filter((h) => h.tier === tier)
						.map((h, i) => (
							<span key={h.pid}>
								{i > 0 ? ", " : ""}
								<PlayerLink p={h} userTid={userTid} />
								{full ? (
									<span className="text-body-secondary">
										{" "}
										({h.pos}, {h.abbrev}, {h.age}
										{!hideRatings && h.ovr !== undefined
											? `, ${h.ovr} ovr`
											: ""}
										)
									</span>
								) : null}
							</span>
						))}
				</div>
			))}
			{!full && badge.numHolders > badge.holders.length ? (
				<a href={helpers.leagueUrl(["frivolities", "skill_badges", badge.key])}>
					All {badge.numHolders} holders »
				</a>
			) : null}
		</div>
	);
};

const BadgeCard = ({
	badge,
	tierNames,
	userTid,
	full,
	hideRatings,
}: {
	badge: Badge;
	tierNames: string[];
	userTid: number;
	full: boolean;
	hideRatings: boolean;
}) => (
	<div className="mb-3" data-testid="badge-card">
		<div>
			<a href={helpers.leagueUrl(["frivolities", "skill_badges", badge.key])}>
				<TierPill short={badge.short} name={badge.name} tier={3} />
			</a>{" "}
			<b>{badge.name}</b>{" "}
			<span className="text-body-secondary small">
				{badge.category} · {badge.counts.join("/")} (Bronze/Silver/Gold/Hall of
				Fame/Legend)
			</span>
		</div>
		<div className="small">
			{badge.meaning} Driven by {badge.drivers}.
			{badge.gates ? ` Needs ${badge.gates}.` : ""}
			{badge.cutoffs ? (
				<span className="text-body-secondary">
					{" "}
					Cutoffs this season: {badge.cutoffs.join(" / ")}.
				</span>
			) : null}
		</div>
		<HoldersByTier
			badge={badge}
			tierNames={tierNames}
			userTid={userTid}
			full={full}
			hideRatings={hideRatings}
		/>
	</div>
);

const SkillBadges = ({ label, tiered, userTid }: Props) => {
	useTitleBar({
		title: "Badges",
		customMenu: frivolitiesMenu,
	});
	const { challengeNoRatings } = useLocal(["challengeNoRatings"]);
	const hideRatings = !!challengeNoRatings;
	const [category, setCategory] = useState<string>("all");

	const selected = tiered.badges.find((b) => b.key === label);
	const categories = [
		...new Map(tiered.badges.map((b) => [b.categoryKey, b.category])),
	];
	const shown = tiered.badges.filter(
		(b) => category === "all" || b.categoryKey === category,
	);

	return (
		<>
			<p>
				NBA 2K-style badges in {categories.length} categories, each in five
				tiers:{" "}
				{tiered.tierNames.map((name, i) => (
					<span key={name} className="me-1">
						<span className={`skill ms-0 badge2k badge2k-${i + 1}`}>
							{name}
						</span>
					</span>
				))}
				. Tiers are league-relative: a badge's score (a weighted average of the
				ratings, sub-ratings and known traits that drive it) is compared with
				the league's rotation players
				{tiered.numRotation !== undefined
					? ` (${tiered.numRotation} this season)`
					: ""}
				, Bronze from the 85th percentile, Silver 93rd, Gold 97.5th, Hall of
				Fame 99.3rd and Legend 99.9th (at most one Legend per badge). Badge
				points (Bronze 1 to Legend 5) are capped by ovr, and a player keeps at
				most his best 6 badges. Badges are set each preseason from his ratings
				as scouted and drop at most one tier a season. With the{" "}
				<i>2K Badge Effects in Sim</i> League Extra, they also add small effects
				in games, calibrated so league averages stay the same.
			</p>
			{selected ? (
				<div className="mb-4">
					<h2>{selected.name}</h2>
					<BadgeCard
						badge={selected}
						tierNames={tiered.tierNames}
						userTid={userTid}
						full
						hideRatings={hideRatings}
					/>
					<a href={helpers.leagueUrl(["frivolities", "skill_badges"])}>
						« All badges
					</a>
				</div>
			) : (
				<>
					<div
						className="btn-group flex-wrap mb-3"
						role="group"
						aria-label="Badge category"
					>
						{[["all", "All"] as const, ...categories].map(([key, name]) => (
							<button
								key={key}
								type="button"
								className={`btn btn-sm ${category === key ? "btn-primary" : "btn-outline-primary"}`}
								onClick={() => setCategory(key)}
							>
								{name}
							</button>
						))}
					</div>
					{categories
						.filter(([key]) => category === "all" || key === category)
						.map(([key, name]) => (
							<div key={key} className="mb-4">
								<h3>{name}</h3>
								{shown
									.filter((b) => b.categoryKey === key)
									.map((b) => (
										<BadgeCard
											key={b.key}
											badge={b}
											tierNames={tiered.tierNames}
											userTid={userTid}
											full={false}
											hideRatings={hideRatings}
										/>
									))}
							</div>
						))}
				</>
			)}
		</>
	);
};

export default SkillBadges;
