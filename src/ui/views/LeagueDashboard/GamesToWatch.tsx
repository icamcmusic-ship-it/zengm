import { useEffect, useState } from "react";
import type { HypeBoard } from "../../../worker/api/hype.ts";
import { HypeGameRow, HypeText } from "../../components/GameHype.tsx";
import { helpers } from "../../util/helpers.ts";
import { toWorker } from "../../util/toWorker.ts";
import { useLocal } from "../../util/local.ts";

// Dashboard card: the must-watch games of the next days and the record chases going on. Computed in the worker when the card loads, so the dashboard itself does not wait for it.
const GamesToWatch = ({ refreshKey }: { refreshKey: string }) => {
	const { gameSimInProgress, phase, userTid } = useLocal([
		"gameSimInProgress",
		"phase",
		"userTid",
	]);
	const [board, setBoard] = useState<HypeBoard | undefined>();

	useEffect(() => {
		if (__SPORT !== "basketball" || gameSimInProgress) {
			return;
		}
		let cancelled = false;
		(async () => {
			try {
				const b = await toWorker("hype", "board", { days: 2, chases: 3 });
				if (!cancelled) {
					setBoard(b);
				}
			} catch (error) {
				console.error(error);
			}
		})();
		return () => {
			cancelled = true;
		};
	}, [refreshKey, gameSimInProgress, phase]);

	if (__SPORT !== "basketball" || !board?.enabled) {
		return null;
	}

	return (
		<div className="games-to-watch">
			<h2 className="mt-3">Games to Watch</h2>
			{board.days.length === 0 ? (
				<p>No games scheduled right now.</p>
			) : (
				board.days.map((d, i) => (
					<div key={d.day}>
						<div className="fw-bold text-body-secondary mb-1">
							{i === 0 ? "Next up" : "The day after"}
						</div>
						{(() => {
							const n = i === 0 ? 3 : 2;
							const shown = d.games.slice(0, n);
							// your own game is always listed
							const mine = d.games
								.slice(n)
								.find((h) => h.teams.some((t) => t.tid === userTid));
							return [...shown, ...(mine ? [mine] : [])].map((h) => (
								<HypeGameRow key={h.gid} h={h} maxReasons={2} />
							));
						})()}
					</div>
				))
			)}
			{board.chases.length > 0 ? (
				<>
					<div className="fw-bold text-body-secondary mb-1">Record chases</div>
					<ul className="ps-3">
						{board.chases.map((c) => (
							<li key={`${c.pid}-${c.k}-${c.scope}-${c.kind}`}>
								<HypeText text={c.text} />
							</li>
						))}
					</ul>
				</>
			) : null}
			<a href={helpers.leagueUrl(["hype"])}>» Games to Watch</a>
		</div>
	);
};

export default GamesToWatch;
