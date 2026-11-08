// The worker API for "Regenerate ratings", called from the UI as toWorker("regenerateRatings", ...)
import { g, toUI } from "../util/index.ts";
import league from "../core/league/index.ts";

export {
	applyRegenerate,
	applyRegenerateAllClasses,
	getBuildList,
	previewRegenerate,
	previewRegenerateAllClasses,
	previewRegenerateSingle,
	restoreOriginalRatings,
	restoreOriginalRatingsAllClasses,
	undoRegenerate,
} from "../core/draft/regenerateRatings.ts";

// "Save as league default": the settings "Re-randomize ratings when a new draft class is created" uses. null clears them
export const saveLeagueDefaultSettings = async (
	settings: Record<string, unknown> | null,
) => {
	await league.setGameAttributes({
		draftClassRegenSettings: settings ?? undefined,
	});
	await toUI("realtimeUpdate", [["gameAttributes"]]);
};

export const getLeagueDefaultSettings = () =>
	g.get("draftClassRegenSettings") ?? null;
