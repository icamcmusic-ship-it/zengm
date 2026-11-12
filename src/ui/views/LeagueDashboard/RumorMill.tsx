import { useEffect, useState } from "react";
import type { Rumor } from "../../../common/rumors/types.ts";
import { helpers } from "../../util/helpers.ts";
import { toWorker } from "../../util/toWorker.ts";
import { useLocal } from "../../util/local.ts";
import { RumorItem } from "../Rumors.tsx";

// Dashboard card (League extras, Rumors): the latest rumors about your team and its players (highlighted), filled up with
// the latest from around the league. Loaded when the card shows, so the dashboard itself does not wait for it.
const RumorMill = ({ refreshKey }: { refreshKey: string }) => {
	const { gameSimInProgress } = useLocal(["gameSimInProgress"]);
	const [rumors, setRumors] = useState<Rumor[]>();

	useEffect(() => {
		if (gameSimInProgress) {
			return;
		}
		let cancelled = false;
		(async () => {
			try {
				const rows = await toWorker("main", "getRumorsCard", undefined);
				if (!cancelled) {
					setRumors(rows);
				}
			} catch (error) {
				console.error(error);
			}
		})();
		return () => {
			cancelled = true;
		};
	}, [refreshKey, gameSimInProgress]);

	if (!rumors || rumors.length === 0) {
		return null;
	}

	return (
		<div className="mt-3" data-testid="rumor-mill">
			<h2>Rumor Mill</h2>
			<div className="list-group list-group-flush mb-1">
				{rumors.map((rumor) => (
					<RumorItem key={rumor.rid} rumor={rumor} compact />
				))}
			</div>
			<a href={helpers.leagueUrl(["rumors"])}>» Rumors</a>
		</div>
	);
};

export default RumorMill;
