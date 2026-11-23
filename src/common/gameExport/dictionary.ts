// Per-game download: what each part of the file means (the file's `dataDictionary`). Paths use [] for "every item of the list". Units:
// times in seconds from the tip (`time`, `in`, `out`) unless the name says minutes (min); the game clock as the box score shows it
// (`clock`); probabilities 0-1; teams[0] / index 0 is the home team throughout.

export const GAME_DATA_DICTIONARY: Record<string, string> = {
	format: 'Always "zengm-game".',
	schemaVersion:
		"Version of this layout. 1: box score and play-by-play only. 2: adds pregame, teamContext, playerContext, analytics, unavailable and this dictionary.",
	sport:
		"basketball, football, hockey or baseball. Other sports get the box score, stakes, schedule load, head-to-head, venue, front office, availability and player profiles.",
	exported: "When the file was made (ISO time).",
	asOf: 'On a field: "export" means it is read now (when the file was made), not as it was at the game; anything else is as of the game.',
	teams: "The two teams, home first: tid, region, name, abbreviation.",
	game: "Everything stored with the game: both teams' totals and every player's line (with his recorded playing-time context `ctx`), quarter scores, scoring summary, clutch plays, attendance, overtimes.",
	"game.teams[].players[].ctx":
		"Recorded at game time for this file (basketball): ptm playing time setting (when not 1), restr minutes restriction factor, rest (rested), plan / planEnd rotation's planned minutes at the start and the end, en energy (0-1) at the end of each period. Missing in games played before it was recorded.",
	playByPlay:
		"The stored play-by-play (null when none was stored): lines (period, clock, team, text, score after, players), the sim's events, players (pid, team, career numbers before the game; no ratings) and the rivalry level.",
	pregame: "What was true before the tip.",
	"pregame.stakes":
		"Day, game numbers, each team's record, streak, last ten and standings coming in (conference/division rank by winning percentage, no tiebreakers; games back), and the pregame win probability and spread.",
	"pregame.stakes.winProbability":
		"Season Odds' team strength (seasonOdds/strength.ts): team rating at tip-off blended with the margin played to, plus home court. spread is the expected home margin; logistic win probability (scale 6.5).",
	"pregame.odds":
		"Regular season: playoff and title odds before and after the game (Season Odds' simulation, seeded from the game id, no Math.random). Playoffs: series win probability before and after (exact).",
	"pregame.series":
		"Playoff series: games needed, game number, seeds, wins before and after, deciding game / Game 7, who can clinch, who faces elimination, storylines.",
	"pregame.scheduleLoad":
		"Per team: rest days, back-to-back, three in four nights, games in the last 7 days, travel (km from the previous game's city, as the sim's travel), homestand or road trip (game number and length).",
	"pregame.headToHead":
		"Season series before the game, the last meeting, the rivalry level (tier, score, history: playoff series, finals, regular season wins; as of export).",
	"pregame.venue":
		"City, event, neutral site, attendance and capacity, Marquee game, rivalry game, big game flag, the crowd boost (Marquee, rivalry and series state) and the home team's hype.",
	teamContext: "One entry per team, home first.",
	"teamContext[].coaching":
		"Head coach (acting: interim), offense and defense systems used in the game, scheme fit and installation (as of export, current season only), in-game minutes adjustments from the recorded rotation plan.",
	"teamContext[].identity":
		"Power rank at the latest day before the game, pregame strength, ORtg / DRtg / pace over the team's games before this one, shot profile (share of FGA at the rim, post, mid-range, three), defensive scheme, archetype and badge mix of the players who played.",
	"teamContext[].frontOffice":
		"GM name, style and leanings (words; numbers only in God Mode), payroll vs salary cap and luxury tax, owner mood and open requests (your teams; ultimatum: make the playoffs). As of export unless payrollAsOf says endOfSeason.",
	"teamContext[].availability":
		"Players who did not play and why (rest, injury, no playing time, coach's decision), players playing through an injury, injured in the game, minutes restrictions.",
	"teamContext[].lineups":
		"Starters, planned vs actual minutes, the closing five, the most-used five-man groups (seconds, points for and against, +/-, possessions, net rating) and each player's on/off (from the play-by-play substitutions).",
	playerContext: "One entry per player in the box score.",
	"playerContext[].profile":
		"Position, age, height, weight, wingspan (the 0-100 rating, unfuzzed like height as on the player page; null under No Visible Ratings), archetype and its why line, up to 6 badges with tier, traits as the Traits page reads them. As the player page shows it now (asOf export).",
	"playerContext[].seasonBaseline":
		"His averages before the game (same season type), this game's line and game score, the difference, this game's rank in his season (points, game score), career highs (before the game when the play-by-play stored them), feat notes and feat score (Feat Rarity).",
	"playerContext[].role":
		"Starter / bench / DNP, rotation rank, minutes before the game, playing time setting, mood about minutes and coach relationship (current season, as of export).",
	"playerContext[].fatigue":
		"Energy at the end of each period (when recorded), minutes by period, stints, longest stint, knocks and returns, injuries, foul trouble (2 fouls in the 1st, 3 in the 2nd, 4 in the 3rd, one short of fouling out after).",
	"playerContext[].matchups":
		"Shots by the defender the sim credited on each field goal attempt (Advanced Tracking Stats): offense (whom he shot over) and defense (whom he contested), attempts, makes, points.",
	"playerContext[].shotChart":
		"Every field goal attempt: period, clock, zone, points, made, blocked, assisted, transition, putback, seconds into the possession, score after; play type, sub-zone, xFG, contest level and defender when Advanced Tracking Stats recorded them. No court coordinates: the sim has none.",
	analytics: "Worked out from the box score and the play-by-play.",
	"analytics.box":
		"Possessions, pace, Four Factors (eFG%, TOV%, ORB%, FT rate), ORtg / DRtg, bench points, each player's TS% and usage.",
	"analytics.winProbability":
		"Home win probability after each scoring play: normal model with the margin, the share of regulation left and the pregame spread (SD 11.8 points over a full game). swings: the biggest changes; topPlayers: win probability added by scorers.",
	"analytics.flow":
		"Largest lead of each team, runs of 8+ unanswered points, lead changes, ties, garbage time start (margin 25+ with 9-12 minutes left, 20+ with 6-9, 10+ under 6, held to the end).",
	"analytics.clutch":
		"Last 5 minutes of the 4th period or overtime with the margin within 5: seconds, team and player lines (+/- too).",
	"analytics.splits":
		"Points in the paint, second chance, off turnovers, fast break (within 8 seconds of a steal or defensive rebound), transition (within 8 seconds of a change of possession), half court, free throws, bench.",
	unavailable: "Sections left out or null, each with the reason.",
	dataDictionary: "This list.",
};
