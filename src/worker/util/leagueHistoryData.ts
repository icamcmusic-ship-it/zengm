import type { UpdateEvent } from "../../common/types.ts";
import type { WLeague } from "../../common/wrapped/types.ts";
import {
	getWrapped,
	getWrappedStatus,
	isBulkSimming,
	memoize,
} from "./wrappedData.ts";

// For the league history pages (Redraft, Pick Value, Family Trees) that read the Wrapped/Storylines snapshot: the snapshot is kept between page loads and only what changed is read again, and each engine result is computed once per snapshot.
//
// Returns:
// - { loading: true, progress } if the snapshot isn't ready yet (the page is sent a "wrappedReady" update when it is)
// - { errorMessage } if reading it failed
// - { result } when there is something to show
// - undefined when nothing needs to be updated
export const loadFromSnapshot = async <T>({
	key,
	compute,
	updateEvents,
	inputsChanged,
	wasLoading,
}: {
	key: string;
	compute: (L: WLeague) => T;
	updateEvents: ReadonlySet<UpdateEvent>;
	inputsChanged: boolean;
	wasLoading: boolean;
}): Promise<
	| { loading: true; progress: string }
	| { errorMessage: string }
	| { result: T; L: WLeague }
	| undefined
> => {
	const firstRun = updateEvents.has("firstRun");
	if (firstRun || inputsChanged || wasLoading) {
		// Don't make the page wait for the league history to be read: show a placeholder, replaced when it is ready
		const st = getWrappedStatus(firstRun);
		if (st.status === "loading") {
			return { loading: true, progress: st.progress };
		}
		if (st.status === "error") {
			return {
				errorMessage: `Could not read the league history: ${st.message}`,
			};
		}
		const result = await memoize(st.built, key, () => compute(st.built.L));
		return { result, L: st.built.L };
	}

	// What these pages show changes at season boundaries, not every day of a sim
	if (!updateEvents.has("newPhase") || isBulkSimming()) {
		return;
	}
	const built = await getWrapped();
	const result = await memoize(built, key, () => compute(built.L));
	return { result, L: built.L };
};

// Team abbrev/name in a season (or the closest season the team has a row for)
export const teamNamer = (L: WLeague) => {
	const bySeason = new Map<
		string,
		{ abbrev: string; region: string; name: string }
	>();
	const latest = new Map<
		number,
		{ season: number; abbrev: string; region: string; name: string }
	>();
	for (const ts of L.teamSeasons) {
		const info = { abbrev: ts.abbrev, region: ts.region, name: ts.name };
		bySeason.set(`${ts.tid}|${ts.season}`, info);
		const cur = latest.get(ts.tid);
		if (!cur || ts.season > cur.season) {
			latest.set(ts.tid, { season: ts.season, ...info });
		}
	}
	return (tid: number, season?: number) => {
		const info =
			(season !== undefined ? bySeason.get(`${tid}|${season}`) : undefined) ??
			latest.get(tid);
		return info
			? { abbrev: info.abbrev, region: info.region, name: info.name }
			: { abbrev: "???", region: "", name: "" };
	};
};
