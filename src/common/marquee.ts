// Marquee Games (the marqueeGames League Extras setting, with the realistic schedule length): holiday slates on fixed days of the
// season, national TV games and rivalry games. The schedule builder is worker/core/season/marqueeSchedule.ts; this is what the
// schedule, the game sim and the UI share.

export type MarqueeKind = "openingNight" | "christmas" | "mlk" | "nationalTv";

// What a scheduled (or played) game carries
export type GameMarquee = {
	marquee?: MarqueeKind;
	rivalry?: boolean;
};

export const MARQUEE_LABELS: Record<MarqueeKind, string> = {
	openingNight: "Opening Night",
	christmas: "Christmas",
	mlk: "MLK Day",
	nationalTv: "National TV",
};

// A short line for the game preview and the box score
export const marqueeLine = (game: GameMarquee) => {
	const parts: string[] = [];
	if (game.marquee === "openingNight") {
		parts.push("Opening Night, on national TV");
	} else if (game.marquee === "christmas") {
		parts.push("Christmas Day showcase, on national TV");
	} else if (game.marquee === "mlk") {
		parts.push("MLK Day game, on national TV");
	} else if (game.marquee === "nationalTv") {
		parts.push("On national TV");
	}
	if (game.rivalry) {
		parts.push(parts.length > 0 ? "a rivalry game" : "Rivalry game");
	}
	return parts.length > 0 ? parts.join(", ") : undefined;
};

// The home crowd's hype bump (the crowd term of Load, Fatigue & Venue, 0.5 + hype): small, a sold-out building a bit louder
export const MARQUEE_CROWD = {
	holiday: 0.15,
	nationalTv: 0.1,
	rivalry: 0.1,
	max: 0.2,
};

export const marqueeCrowdBoost = (game: GameMarquee) => {
	let boost = 0;
	if (game.marquee === "nationalTv") {
		boost += MARQUEE_CROWD.nationalTv;
	} else if (game.marquee !== undefined) {
		boost += MARQUEE_CROWD.holiday;
	}
	if (game.rivalry) {
		boost += MARQUEE_CROWD.rivalry;
	}
	return Math.min(MARQUEE_CROWD.max, boost);
};

// Points added to the pre-game hype (Games to Watch)
export const marqueeHypePoints = (game: GameMarquee) =>
	game.marquee === "christmas"
		? 6
		: game.marquee === "openingNight"
			? 5
			: game.marquee === "mlk"
				? 3
				: game.marquee === "nationalTv"
					? 2
					: 0;

// Fixed days of the season (day 1 is opening night), for an 82-game season of about 171 days that starts in late October: opening
// night, Christmas (65 days later), MLK Day (the third Monday of January, about 90 days in). Shorter seasons scale them down.
export const HOLIDAY_DAYS = {
	openingNight: 1,
	christmas: 66,
	mlk: 91,
	// The season length these days are for
	seasonLength: 171,
};
