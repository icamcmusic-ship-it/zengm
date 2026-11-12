// Plain-language wording for the coaching pages (Coaching Staff, Coaches, Coach's notes, the coach page), shared so every page uses
// the same terms and the same explanations
import type { CoachRatings, CoachRole } from "./types.staff.ts";

// A 0-100 coach rating in words (coaches average in the 50s; an assistant's specialty is usually in the 60s)
export const ratingWord = (x: number) =>
	x >= 80
		? "Elite"
		: x >= 70
			? "Excellent"
			: x >= 60
				? "Good"
				: x >= 50
					? "Average"
					: x >= 40
						? "Below average"
						: "Poor";

// Bootstrap colour for a 0-100 value where higher is better
export const ratingColor = (x: number) =>
	x >= 70
		? "success"
		: x >= 60
			? "info"
			: x >= 45
				? "secondary"
				: x >= 35
					? "warning"
					: "danger";

// What each job does for the team, and the rating that matters most for it
export const COACH_ROLE_INFO: Record<
	CoachRole,
	{ does: string; doesSystems: string; keyRating: keyof CoachRatings }
> = {
	head: {
		does: "Runs the team. His development and motivation ratings count for about 30% of how fast your players improve.",
		doesSystems:
			"Runs the team: the offense and defense your players run are his systems, and his ratings decide how well they run them. He also counts for about 30% of how fast your players improve.",
		keyRating: "mot",
	},
	dev: {
		does: "Works with players between games. He is half of your staff's player development, the biggest single part.",
		doesSystems:
			"Works with players between games. He is half of your staff's player development, the biggest single part.",
		keyRating: "dev",
	},
	off: {
		does: "Assists the head coach with the offense, and adds a little (10%) to player development.",
		doesSystems:
			"Teaches the head coach's offense: 40% of the staff's offense strength (shot making), and a little (10%) of player development.",
		keyRating: "off",
	},
	def: {
		does: "Assists the head coach with the defense, and adds a little (10%) to player development.",
		doesSystems:
			"Teaches the head coach's defense: 40% of the staff's defense strength (opponents' shot making), and a little (10%) of player development.",
		keyRating: "def",
	},
};

// "What does this mean?" for each concept. The title is the term used on every page
export const COACH_TERMS = {
	ovr: {
		title: "Overall",
		text: "How good a coach is at one job, 0-100, from his four ratings weighted for that job (a head coach needs offense, defense and motivation; an assistant mostly his specialty). Most working coaches are between 50 and 75.",
	},
	ratings: {
		title: "Ratings",
		text: "Development: how much he helps players improve. Offense and Defense: teaching and scheming on that side of the ball. Motivation: getting players to play hard, which matters late in close games and a little for development. All 0-100.",
	},
	systems: {
		title: "Systems",
		text: "The offense and the defense a head coach runs. A system changes how the team plays (pace, threes, post-ups, turnovers forced, fouls ...), not how good it is: every system is balanced on average. What matters is whether your players suit it. See Scheme fit.",
	},
	fit: {
		title: "Scheme fit",
		text: "How well a roster's rotation players suit the head coach's systems, compared with the other teams in the league. 50 is a typical team; 65 is clearly better than most, 35 clearly worse. Offense counts 60%, defense 40%. Each 15 points is worth about 1 point per 100 possessions (roughly 3 wins a season).",
	},
	install: {
		title: "Installation",
		text: "A new head coach (or a coach who changed systems) needs time to teach them. The systems start 35% installed and are fully in after about half a season of games. Until then the team's tendencies are muted and it shoots slightly worse.",
	},
	hotSeat: {
		title: "Job security",
		text: "How safe a head coach's job is: his team's results against the preseason expectation over the last three seasons, with extra patience for coaches with a high reputation. Safe, Some pressure, Warm, Red hot. AI teams fire coaches whose seat is hot after the playoffs; your own coach is only ever fired by you.",
	},
	reputation: {
		title: "Reputation",
		text: "A coach's standing around the league, 0-100: results against expectations, playoff runs, Coach of the Year awards and the development of his young players, recent seasons counting most. 50 is an ordinary coach with no track record. Players like playing for respected coaches, and owners are more patient with them.",
	},
	devLevel: {
		title: "Development level",
		text: "Your staff's player development as a 1-100 level, compared with the league's average staff (level 34, the same as a default coaching budget). A higher level means players improve a little faster and decline a little slower each offseason. The player development coach is half of it, the head coach about 30%, each coordinator 10%.",
	},
	strengths: {
		title: "Staff strengths",
		text: "What the staff is good at on game day, 0-100. Offense and Defense blend the head coach (60%) with his coordinator (40%) and nudge shot making for and against. Game management is late-game decisions: timeouts, fouling, who takes the last shot. Motivation helps in the last minutes of close games.",
	},
	buyout: {
		title: "Buyout",
		text: "Firing a coach pays half of what is left on his contract right away, as a coaching expense. It does not count against the salary cap.",
	},
	contract: {
		title: "Contract",
		text: "Coach salaries are paid as coaching expenses, not against the salary cap. A contract that expires this season ends after the playoffs unless you extend it. A coach asks for a salary that follows his overall rating at the job.",
	},
	philosophy: {
		title: "Philosophy",
		text: "Win now, development, or a balance. A development coach helps players 23 and under improve faster and pays less attention to veterans 30 and over; a win-now coach is the other way around.",
	},
	personality: {
		title: "Personality",
		text: "Disciplinarian, even-keeled or players' coach. Players are a little happier under a players' coach; disciplinarians clash with big egos but their teams pick up fewer technical fouls.",
	},
	adaptability: {
		title: "Adaptability",
		text: "How readily a coach changes his systems to suit his roster, 0-100. In the offseason an adaptable coach may switch to a system his players fit clearly better (which restarts installation). Below 25 he is stubborn and never switches.",
	},
	tree: {
		title: "Coaching tree",
		text: "When an assistant becomes a head coach, the head coach he last worked under is recorded as his mentor, and he usually brings part of that coach's system with him. A coach's tree is his mentors above him and the head coaches who came up under him.",
	},
	recommendation: {
		title: "Recommendations",
		text: "Tags on the candidates who lead the available coaches in one thing. Best overall: highest overall rating for the job. Best fit: his systems suit your current roster best. Best developer: improves your development level the most. Best tactician: the best offense and defense ratings. Top reputation: the most respected.",
	},
} as const;

export type CoachTerm = keyof typeof COACH_TERMS;

// The development level in words (the league's average staff is level 34)
export const devLevelWord = (level: number) =>
	level >= 65
		? "Excellent"
		: level >= 45
			? "Good"
			: level >= 26
				? "About average"
				: level >= 12
					? "Below average"
					: "Poor";

export const hotSeatColor = (text: string) =>
	text === "Red hot"
		? "danger"
		: text === "Warm"
			? "warning"
			: text === "Some pressure"
				? "info"
				: "success";

// A job as a noun in a sentence ("your player development coach", "hire a head coach")
export const roleNoun = (role: CoachRole) =>
	role === "head"
		? "head coach"
		: role === "dev"
			? "player development coach"
			: role === "off"
				? "offensive coordinator"
				: "defensive coordinator";
