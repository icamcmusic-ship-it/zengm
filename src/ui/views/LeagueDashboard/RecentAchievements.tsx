import { useEffect, useState } from "react";
import { helpers } from "../../util/helpers.ts";
import { toWorker } from "../../util/toWorker.ts";
import { useLocal } from "../../util/local.ts";
import {
	RARITY_CLASS,
	RARITY_LABEL,
} from "../../../common/leagueAchievements/labels.ts";

type Recent = Awaited<
	ReturnType<
		typeof import("../../../worker/util/leagueAchievements.ts").getRecentLeagueAchievements
	>
>;

// Dashboard card: the newest League achievements. Read from what the worker remembers of its announcements, so it never waits for the achievements to be computed.
const RecentAchievements = ({ refreshKey }: { refreshKey: string }) => {
	const { gameSimInProgress, phase } = useLocal(["gameSimInProgress", "phase"]);
	const [recent, setRecent] = useState<Recent | undefined>();

	useEffect(() => {
		if (__SPORT !== "basketball" || gameSimInProgress) {
			return;
		}
		let cancelled = false;
		const load = async () => {
			try {
				const r = await toWorker("main", "getRecentLeagueAchievements", 5);
				if (!cancelled) {
					setRecent(r);
				}
			} catch (error) {
				console.error(error);
			}
		};
		void load();
		// Unlocks are checked a moment after games end, so look again then
		const t = setTimeout(load, 4000);
		return () => {
			cancelled = true;
			clearTimeout(t);
		};
	}, [refreshKey, gameSimInProgress, phase]);

	if (__SPORT !== "basketball" || !recent) {
		return null;
	}

	return (
		<div className="mt-3" data-recent-achievements>
			<h2>Recent achievements</h2>
			{recent.length === 0 ? (
				<p className="mb-1">
					None yet. Achievements unlock as the league plays.
				</p>
			) : (
				<ul className="list-unstyled mb-1">
					{recent.map((a) => (
						<li key={a.id} className="mb-1">
							<span className={`badge ${RARITY_CLASS[a.rarity]} me-1`}>
								{RARITY_LABEL[a.rarity]}
							</span>
							<a
								href={helpers.leagueUrl(["league_achievements", "all", a.id])}
								title={a.desc}
							>
								{a.name}
							</a>
							{a.who ? (
								<span className="small text-body-secondary"> {a.who}</span>
							) : null}
						</li>
					))}
				</ul>
			)}
			<a href={helpers.leagueUrl(["league_achievements"])}>
				» League achievements
			</a>
		</div>
	);
};

export default RecentAchievements;
