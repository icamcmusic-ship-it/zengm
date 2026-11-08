// Basketball play-by-play display and storage settings (see docs/native-features.md, "Play-by-play settings")

export type PbpStoreScope = "all" | "user" | "none";
export type PbpBoxScoreMode = "always" | "button";

// Leagues from before pbpStore existed only had storePlayByPlay, so it still turns storage off
export const getPbpStoreScope = ({
	pbpStore,
	storePlayByPlay,
}: {
	pbpStore: PbpStoreScope | undefined;
	storePlayByPlay: boolean | undefined;
}): PbpStoreScope => {
	if (storePlayByPlay === false) {
		return "none";
	}
	return pbpStore ?? "all";
};

// Whether a finished game's events are saved with its box score
export const shouldStorePbp = (
	scope: PbpStoreScope,
	tids: readonly number[],
	userTids: readonly number[],
) => {
	if (scope === "all") {
		return true;
	}
	if (scope === "user") {
		return tids.some((tid) => userTids.includes(tid));
	}
	return false;
};

// What the box score shows for its play-by-play
export const getBoxScorePbpView = ({
	hasEvents,
	mode,
	revealed,
}: {
	hasEvents: boolean;
	mode: PbpBoxScoreMode;
	revealed: boolean;
}): "tab" | "button" | "none" | "message" => {
	if (!hasEvents) {
		return mode === "button" ? "message" : "none";
	}
	if (mode === "always" || revealed) {
		return "tab";
	}
	return "button";
};
