// The worker API for "Regenerate ratings", called from the UI as toWorker("regenerateRatings", ...)
export {
	applyRegenerate,
	getArchetypeTargets,
	getBuildList,
	previewRegenerate,
	previewRegenerateSingle,
	restoreOriginalRatings,
	undoRegenerate,
} from "../core/draft/regenerateRatings.ts";
