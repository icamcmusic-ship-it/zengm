import { useEffect, useState } from "react";
import { helpers } from "../../util/helpers.ts";
import { toWorker } from "../../util/toWorker.ts";
import { useLocal } from "../../util/local.ts";
import { chaseText, reachedText, WhenText } from "../Milestones.tsx";

type Card = Awaited<
	ReturnType<
		typeof import("../../../worker/api/recordsBook.ts").default.milestoneCard
	>
>;

// Dashboard card (League extras, Milestones): your players' next career milestones and the ones just reached. Loaded
// when the card shows, so the dashboard itself does not wait for it.
const MilestoneWatch = ({ refreshKey }: { refreshKey: string }) => {
	const { gameSimInProgress, teamInfoCache } = useLocal([
		"gameSimInProgress",
		"teamInfoCache",
	]);
	const [card, setCard] = useState<Card>();

	useEffect(() => {
		if (__SPORT !== "basketball" || gameSimInProgress) {
			return;
		}
		let cancelled = false;
		(async () => {
			try {
				const c = await toWorker("recordsBook", "milestoneCard", undefined);
				if (!cancelled) {
					setCard(c);
				}
			} catch (error) {
				console.error(error);
			}
		})();
		return () => {
			cancelled = true;
		};
	}, [refreshKey, gameSimInProgress]);

	if (!card || (card.upcoming.length === 0 && card.reached.length === 0)) {
		return null;
	}

	return (
		<div className="mt-3" data-testid="milestone-watch">
			<h2>Milestone Watch</h2>
			<ul className="list-unstyled mb-1">
				{card.reached.map((r, i) => (
					<li key={`r${i}`}>
						<span className="badge text-bg-success me-1">reached</span>
						<a href={helpers.leagueUrl(["player", r.pid])}>{r.name}</a>:{" "}
						{reachedText(r)}
					</li>
				))}
				{card.upcoming.map((r, i) => (
					<li key={`u${i}`}>
						<a href={helpers.leagueUrl(["player", r.pid])}>{r.name}</a>:{" "}
						{chaseText(r)}, needs {helpers.numberWithCommas(r.need)}
						<span className="text-body-secondary small">
							{" "}
							(<WhenText r={r} teams={teamInfoCache as any} />)
						</span>
					</li>
				))}
			</ul>
			<a href={helpers.leagueUrl(["milestones"])}>» Milestones</a>
		</div>
	);
};

export default MilestoneWatch;
