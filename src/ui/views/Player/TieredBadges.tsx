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

const TIER_LABEL = ["", "Bronze", "Silver", "Gold", "Hall of Fame", "Legend"];

// 2K Badges (League Extra): his badges by category, with the tier, the ratings that drive each one and the progress to the next tier
// (the numbers are left out by the worker under the no visible ratings challenge)
export const TieredBadgesSection = ({ info }: { info: Info }) => {
	const numBadges = info.categories.reduce((a, c) => a + c.badges.length, 0);
	const past = info.history.filter((h) => h.season !== info.season).slice(-6);
	return (
		<HideableSection
			title="Badges"
			description={
				<>
					{numBadges} badge{numBadges === 1 ? "" : "s"}, {info.points} badge
					point{info.points === 1 ? "" : "s"}
					{info.cap !== undefined ? ` (cap ${info.cap} for his ovr)` : ""}
					{info.live ? " (live reading, set at the next preseason)" : ""}.{" "}
					<a href={helpers.leagueUrl(["frivolities", "skill_badges"])}>
						All badges »
					</a>
				</>
			}
		>
			{info.categories.length === 0 ? (
				<p className="text-body-secondary">No badges this season.</p>
			) : (
				<div className="row g-3 mb-2" data-testid="player-tiered-badges">
					{info.categories.map((cat) => (
						<div key={cat.key} className="col-12 col-sm-6 col-lg-4">
							<h3 className="mb-1">{cat.name}</h3>
							<ul className="list-unstyled mb-0">
								{cat.badges.map((b) => (
									<li key={b.key} className="mb-2" title={b.meaning}>
										<TierPill short={b.short} name={b.name} tier={b.tier} />{" "}
										<b>{b.name}</b>{" "}
										<span className="text-body-secondary">
											{TIER_LABEL[b.tier]}
											{b.capped ? " (capped)" : ""}
										</span>
										<div className="small text-body-secondary">
											{b.drivers
												.map((d) =>
													d.value !== undefined
														? `${d.name} ${d.value}`
														: d.name,
												)
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
														className="progress-bar"
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
									</li>
								))}
							</ul>
						</div>
					))}
				</div>
			)}
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
