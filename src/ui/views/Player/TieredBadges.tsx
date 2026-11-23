import HideableSection from "../../components/HideableSection.tsx";
import { helpers } from "../../util/helpers.ts";
import type { View } from "../../../common/types.ts";

type Info = NonNullable<View<"player">["player"]["tieredBadges"]>;

export const TierPill = ({
	short,
	name,
	tier,
	tierName,
}: {
	short: string;
	name: string;
	tier: number;
	tierName?: string;
}) => (
	<span
		className={`skill ms-0 badge2k badge2k-${tier}`}
		title={tierName ? `${name} (${tierName})` : name}
	>
		{short}
	</span>
);

type BadgeView = Info["earned"][number];

const BadgeItem = ({ b, nextUp }: { b: BadgeView; nextUp?: boolean }) => (
	<div
		className={`mb-2${nextUp ? " badge2k-next" : ""}`}
		title={b.meaning}
		data-testid={nextUp ? "player-badge-next" : "player-badge"}
	>
		<span style={nextUp ? { opacity: 0.45 } : undefined}>
			<TierPill short={b.short} name={b.name} tier={b.tier} />
		</span>{" "}
		<b className={nextUp ? "fw-normal" : undefined}>{b.name}</b>{" "}
		<span className="text-body-secondary">
			{nextUp ? `working toward ${b.tierName}` : b.tierName}
			{b.capped ? " (capped)" : ""} · {b.category}
		</span>
		<div className="small text-body-secondary">
			{b.drivers
				.map((d) => (d.value !== undefined ? `${d.name} ${d.value}` : d.name))
				.join(", ")}
		</div>
		{b.progress !== undefined && b.nextTierName ? (
			<div
				className="d-flex align-items-center gap-2 small"
				title={`Score ${b.score}`}
			>
				<div
					className="progress flex-grow-1"
					style={{ height: 6, maxWidth: 160 }}
				>
					<div
						className={`progress-bar${nextUp ? " bg-secondary" : ""}`}
						style={{
							width: `${Math.round(b.progress * 100)}%`,
						}}
					/>
				</div>
				<span className="text-body-secondary">
					{Math.round(b.progress * 100)}% to {b.nextTierName}
				</span>
			</div>
		) : null}
	</div>
);

// 2K Badges: his badges (at most info.max, best first) with the tier, the ratings that drive each one and the progress to the next
// tier, then the ones he is closest to earning ("next up", faded, not counted). The numbers are left out by the worker under the no
// visible ratings challenge
export const TieredBadgesSection = ({ info }: { info: Info }) => {
	const numBadges = info.earned.length;
	const past = info.history.filter((h) => h.season !== info.season).slice(-6);
	return (
		<HideableSection
			title="Badges"
			description={
				<>
					{numBadges} of {info.max} badge{info.max === 1 ? "" : "s"},{" "}
					{info.points} badge point{info.points === 1 ? "" : "s"}
					{info.cap !== undefined ? ` (cap ${info.cap} for his ovr)` : ""}
					{info.live ? " (live reading, set at the next preseason)" : ""}.{" "}
					<a href={helpers.leagueUrl(["frivolities", "skill_badges"])}>
						All badges »
					</a>
				</>
			}
		>
			{numBadges === 0 ? (
				<p className="text-body-secondary">No badges this season.</p>
			) : (
				<div className="row g-2 mb-2" data-testid="player-tiered-badges">
					{info.earned.map((b) => (
						<div key={b.key} className="col-12 col-sm-6 col-lg-4">
							<BadgeItem b={b} />
						</div>
					))}
				</div>
			)}
			{info.nextUp.length > 0 ? (
				<div className="mb-2" data-testid="player-tiered-badges-next">
					<h3 className="mb-1 text-body-secondary">Next up</h3>
					<div className="row g-2 mb-0">
						{info.nextUp.map((b) => (
							<div key={b.key} className="col-12 col-sm-6 col-lg-4">
								<BadgeItem b={b} nextUp />
							</div>
						))}
					</div>
				</div>
			) : null}
			{past.length > 0 ? (
				<div className="small mb-3">
					<b>Past seasons:</b>
					{past.map((h) => (
						<div key={h.season}>
							{h.season}:{" "}
							{h.badges.length === 0
								? "none"
								: h.badges.map((b, i) => (
										<span key={b.short} className={i > 0 ? "ms-1" : undefined}>
											<TierPill short={b.short} name={b.name} tier={b.tier} />
										</span>
									))}
						</div>
					))}
				</div>
			) : null}
		</HideableSection>
	);
};
