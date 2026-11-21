import { useEffect, useState } from "react";
import { toWorker } from "../util/toWorker.ts";
import { useLocal } from "../util/local.ts";
import {
	badgeCounts,
	nextSeen,
	readSeen,
	writeSeen,
	type SidebarBadgeKey,
} from "../util/sidebarExtras.ts";

// New-item counts for the side menu, refreshed when the page, the phase or a sim changes
const useSidebarBadges = (pageID: string | undefined) => {
	const { gameSimInProgress, lid, phase, season } = useLocal([
		"gameSimInProgress",
		"lid",
		"phase",
		"season",
	]);
	const [badges, setBadges] = useState<
		Partial<Record<SidebarBadgeKey, number>>
	>({});

	useEffect(() => {
		if (lid === undefined || gameSimInProgress) {
			if (lid === undefined) {
				setBadges({});
			}
			return;
		}
		let cancelled = false;
		(async () => {
			try {
				const seen = readSeen(lid);
				const counts = await toWorker("main", "getSidebarCounts", seen);
				if (cancelled) {
					return;
				}
				writeSeen(lid, nextSeen(seen, counts, pageID));
				setBadges(badgeCounts(counts, pageID));
			} catch {
				// The badges are an extra: no badges rather than an error
			}
		})();
		return () => {
			cancelled = true;
		};
	}, [gameSimInProgress, lid, pageID, phase, season]);

	return badges;
};

export default useSidebarBadges;
