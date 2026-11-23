// The paper's opinion columnists: made-up writers with their own column names, voices and pet topics. The same writers stay on staff
// for a league (each league gets four of the six, from its seed), and two of them write in each edition, taking turns by season.
// Openers and closers name the column's subject ({s}), so a voice is recognisable without the same sentence every season.

import type { Rng } from "./text.ts";

export type ColumnTopic =
	| "mvp"
	| "rebuild"
	| "believe"
	| "luck"
	| "defense"
	| "history";

export type Columnist = {
	id: string;
	name: string;
	column: string;
	role: string;
	// Topics in order of preference
	topics: ColumnTopic[];
	// First line of every column and last line ({s} is the subject: a team or player name)
	openers: string[];
	closers: string[];
	sign: string;
};

export const COLUMNISTS: Columnist[] = [
	{
		id: "oldschool",
		name: "Walt Brennaman",
		column: "Old School",
		role: "Columnist, covering the league since the set shot",
		topics: ["defense", "rebuild", "believe", "mvp", "history", "luck"],
		openers: [
			"I've watched this game longer than most of these kids have been alive, so humor me about {s}.",
			"Nobody asked me about {s}, so here it is anyway.",
			"Turn off the highlight package and look at {s} for a minute.",
			"Somebody has to say it about {s}, and it might as well be the guy with the oldest press pass in the building.",
			"Pull up a chair, youngsters, and let's talk about {s}.",
		],
		closers: [
			"Defense, rebounding, effort; {s} will learn it or the standings will teach it.",
			"That's basketball, {s} included, and it always has been.",
			"Now get off my lawn, and take {s} with you.",
			"Write in if you want; I'll be at the arena early watching {s}, like always.",
			"In my day you earned your minutes, and {s} should have to as well.",
		],
		sign: "— W.B.",
	},
	{
		id: "analyst",
		name: "Nadia Okonkwo",
		column: "Expected Value",
		role: "Columnist and resident numbers person",
		topics: ["luck", "believe", "mvp", "defense", "rebuild", "history"],
		openers: [
			"Let's start with the data on {s}, not the narrative.",
			"Records tell you what happened; margins tell you what {s} is likely to do next.",
			"A quick reminder before the numbers on {s}: samples this size lie more often than you'd think.",
			"The spreadsheet has opinions about {s} this week.",
			"I ran the numbers on {s} twice, because I knew you'd ask.",
		],
		closers: [
			"Small samples lie, big ones rarely do, and {s} is no exception.",
			"Bet on the margin, not the mood, when it comes to {s}.",
			"Check back on {s} in twenty games; the regression is coming either way.",
			"As always, the error bars around {s} are wider than the hot takes.",
			"Trust the denominator, even with {s}.",
		],
		sign: "— N.O.",
	},
	{
		id: "hottake",
		name: "Deke Malloy",
		column: "Full Court Press",
		role: "Columnist, loud on purpose",
		topics: ["mvp", "rebuild", "believe", "luck", "defense", "history"],
		openers: [
			"Hot take incoming on {s}, and I'm not sorry.",
			"Buckle up, {s} fans.",
			"I said it about {s} on the radio this morning and I'll say it again here.",
			"You're not going to like what I have to say about {s}.",
			"Somebody has to be brave about {s} around here.",
		],
		closers: [
			"Screenshot this take on {s}; I'll be right.",
			"Book it: {s}, just like I said.",
			"Don't @ me about {s}. Actually, do.",
			"Mark the date you read this about {s}.",
			"Agree with me about {s} or be wrong; those are the options.",
		],
		sign: "— DEKE",
	},
	{
		id: "historian",
		name: "Eleanor Fairweather",
		column: "From the Rafters",
		role: "Columnist and league historian",
		topics: ["history", "mvp", "believe", "rebuild", "defense", "luck"],
		openers: [
			"Every season rhymes with one that came before it, and {s} is this season's verse.",
			"The banners in the rafters were all hung by teams that once looked like {s}.",
			"Allow me a trip through the archives on {s}.",
			"History doesn't repeat, but it keeps a scorebook, and {s} is in it.",
			"I went back through the bound volumes to make sense of {s}.",
		],
		closers: [
			"The archive will judge {s}; it always does.",
			"Someday {s} will be a line in a record book; we'll see which line.",
			"File {s} away for the anniversary edition.",
			"Some seasons get remembered, and {s} is still deciding how this one will be.",
			"We will know what {s} meant in twenty years; we always do.",
		],
		sign: "— E.F.",
	},
	{
		id: "fan",
		name: "Rosie Kaminski",
		column: "From the Cheap Seats",
		role: "Columnist and season-ticket holder since forever",
		topics: ["believe", "rebuild", "mvp", "luck", "history", "defense"],
		openers: [
			"Writing this from section 312, where the real fans have been arguing about {s}.",
			"My season tickets have seen a lot, and they have notes on {s}.",
			"Pull up a folding chair; this is the people's column, and the people want to talk about {s}.",
			"The hot dog line was talking about {s}, so now I am too.",
			"The usher in my section has a theory about {s}, and for once I agree.",
		],
		closers: [
			"See you in the upper deck, where we'll be yelling about {s}.",
			"Ticket stubs don't lie, and mine say plenty about {s}.",
			"I'll be the one yelling at the referees during the next {s} game, as usual.",
			"Love the game, hate the parking, and keep an eye on {s}.",
			"Bring a sign next time {s} plays; the players notice.",
		],
		sign: "— Rosie",
	},
	{
		id: "insider",
		name: "Gideon Thorne",
		column: "Front Office Whispers",
		role: "Columnist with too many phone numbers",
		topics: ["rebuild", "luck", "believe", "mvp", "defense", "history"],
		openers: [
			"A few calls this week about {s} left me with one conclusion.",
			"Executives talk about {s}, and some of them even talk to me.",
			"Let's talk about the conversations on {s} happening behind closed doors.",
			"Here is what people around the league say about {s} when the microphones are off.",
			"My phone has been busy, and most of the calls were about {s}.",
		],
		closers: [
			"You didn't hear about {s} from me.",
			"Watch the trade calls around {s}; they'll tell you the rest.",
			"The front offices know about {s}, and now so do you.",
			"More on {s} when the phones ring again.",
			"Somebody in a front office is reading this about {s} and nodding.",
		],
		sign: "— G.T.",
	},
];

// This league's four columnists (stable for the league), and the two writing this edition
export const columnistsFor = (seedRng: Rng, season: number) => {
	const staff = seedRng.shuffle(COLUMNISTS).slice(0, 4);
	const i = ((season % staff.length) + staff.length) % staff.length;
	return [staff[i]!, staff[(i + 1) % staff.length]!];
};

export const voiceLine = (line: string, subject: string) =>
	line.replaceAll("{s}", subject);
