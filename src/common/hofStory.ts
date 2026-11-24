// Hall of Fame words: plaque text and induction speeches, built from career facts the worker gathers
// (worker/util/hofStory.ts). Pure and seeded by pid, so the same player always reads the same. Never shows a rating: the
// only rating input is an optional "shape" (what he was best at), which the worker leaves out under the no-visible-ratings
// challenge and reads from fuzzed ratings otherwise.
import { Rng } from "./pbpFlavor/rng.ts";

export type HofTeam = {
	tid: number;
	// "Boston Celtics", as the franchise was named when he played there (his last season there)
	name: string;
	seasons: number;
	first: number;
	last: number;
};

export type HofBestGame = {
	season: number;
	pts: number;
	trb: number;
	ast: number;
	opp: string;
	playoffs: boolean;
	won: boolean;
};

export type CareerFacts = {
	pid: number;
	firstName: string;
	lastName: string;
	teams: HofTeam[];
	titles: { season: number; team?: string }[];
	mvps: number;
	finalsMvps: number;
	allStars: number;
	dpoys: number;
	roy: boolean;
	draft?: { year: number; round: number; pick: number; team?: string };
	college?: string;
	hometown?: string;
	hgt?: number;
	archetype?: string;
	// Team that ended his season most often in the playoffs
	rival?: { name: string; times: number };
	// His first head coach (Coaching Staff setting)
	coach?: { name: string; team: string };
	// Fellow Hall of Famer he shared the most seasons with
	teammate?: { name: string; seasons: number };
	bestGame?: HofBestGame;
	career: {
		gp: number;
		pts: number;
		trb: number;
		ast: number;
		seasons: number;
	};
	perGame?: {
		pts: number;
		trb: number;
		ast: number;
		stl: number;
		blk: number;
		tpm: number;
	};
	prime?: { season: number; team?: string };
	retiredYear?: number;
	// He had died by his induction: the plaque says so, and his family accepts for him
	posthumous?: boolean;
};

const ord = (n: number) => {
	const s = ["th", "st", "nd", "rd"];
	const v = n % 100;
	return `${n}${s[(v - 20) % 10] ?? s[v] ?? s[0]}`;
};

const times = (n: number, what: string) =>
	n === 1 ? what : `${n}-time ${what}`;

const cityOf = (loc: string | undefined) => {
	if (!loc) {
		return undefined;
	}
	const city = loc.split(",")[0]!.trim();
	return city.length > 0 && city.length <= 16 ? city : undefined;
};

const fmt1 = (x: number) => (Math.round(x * 10) / 10).toFixed(1);

// ---- Plaque ---------------------------------------------------------------

// The plaque under his prime face: who he was, where he played, what he won. Matches the picture: it names the season and team
// of the jersey he is drawn in.
export const plaqueText = (f: CareerFacts): string => {
	const rng = new Rng(f.pid, 7302);
	const parts: string[] = [];
	const teams = f.teams.slice(0, 3).map((t) => t.name);
	const teamList =
		teams.length <= 1
			? (teams[0] ?? "")
			: `${teams.slice(0, -1).join(", ")} and ${teams.at(-1)}`;
	parts.push(
		`${f.firstName} ${f.lastName}. ${f.career.seasons} seasons${teamList ? `, ${teamList}` : ""}.`,
	);
	const honors: string[] = [];
	if (f.titles.length > 0) {
		honors.push(times(f.titles.length, "Champion"));
	}
	if (f.mvps > 0) {
		honors.push(times(f.mvps, "MVP"));
	}
	if (f.finalsMvps > 0) {
		honors.push(times(f.finalsMvps, "Finals MVP"));
	}
	if (f.dpoys > 0) {
		honors.push(times(f.dpoys, "Defensive Player of the Year"));
	}
	if (f.allStars > 0) {
		honors.push(times(f.allStars, "All-Star"));
	}
	if (f.roy) {
		honors.push("Rookie of the Year");
	}
	if (honors.length > 0) {
		parts.push(`${honors.join(", ")}.`);
	}
	if (f.career.gp > 0) {
		parts.push(
			`${f.career.pts.toLocaleString("en-US")} points, ${f.career.trb.toLocaleString("en-US")} rebounds, ${f.career.ast.toLocaleString("en-US")} assists.`,
		);
	}
	if (f.archetype) {
		parts.push(
			rng.pick([
				`The model ${f.archetype.toLowerCase()} of his era.`,
				`A ${f.archetype.toLowerCase()} the league is still measuring others against.`,
				`Every ${f.archetype.toLowerCase()} since has been compared to him.`,
			]),
		);
	}
	if (f.posthumous) {
		parts.push("Inducted posthumously.");
	}
	if (f.prime) {
		parts.push(plaquePrimeLine(f.prime));
	}
	return parts.join(" ");
};

// Last sentence of a plaque with his prime face (League Extras "Face Aging"): the season and team of the jersey he is drawn in.
// Separate so the rest of the plaque can be stored once at induction (worker/util/hofStory.ts) and this added when it is shown.
export const plaquePrimeLine = (prime: { season: number; team?: string }) =>
	`Pictured in ${prime.season}${prime.team ? `, with the ${prime.team}` : ""}.`;

// ---- Induction speech -----------------------------------------------------

// His speech at the induction, in his own voice: a few short paragraphs picked from what his career actually had.
export const inductionSpeech = (f: CareerFacts): string[] => {
	if (f.posthumous) {
		return posthumousSpeech(f);
	}
	const rng = new Rng(f.pid, 7303);
	const out: string[] = [];

	// Opening: where it started
	const city = cityOf(f.hometown);
	const open: string[] = [];
	if (city) {
		open.push(
			`I grew up in ${city} shooting on a hoop with no net. If you had told that kid he'd be standing here, he'd have asked you to rebound for him.`,
			`To everybody back home in ${city}: this one is yours. You saw me before anybody else did.`,
		);
	}
	open.push(
		"I'm not much for speeches, so bear with me. I'd rather be on the floor.",
		"I wrote this three times and threw it out three times, so I'm going to just talk.",
	);
	out.push(rng.pick(open));

	// The road in: college and the draft
	const road: string[] = [];
	if (f.college && f.draft && f.draft.round > 0) {
		road.push(
			`${f.college} gave me a chance, and the ${f.draft.team ?? "team"} took one on me with the ${ord(f.draft.pick)} pick in ${f.draft.year}. I've tried to make both of them look smart.`,
		);
	} else if (f.draft && f.draft.round === 0) {
		road.push(
			`Nobody drafted me in ${f.draft.year}. I kept that list of thirty teams in my locker for a long time.`,
		);
	} else if (f.draft && f.draft.round > 1) {
		road.push(
			`I went in the ${ord(f.draft.round)} round in ${f.draft.year}. Second-round guys don't get guarantees; we get gym keys.`,
		);
	} else if (f.draft && f.draft.pick === 1) {
		road.push(
			`Going first overall in ${f.draft.year} comes with a lot of noise. I just wanted to earn it every night after that.`,
		);
	} else if (f.draft) {
		road.push(
			`The ${f.draft.team ?? "team"} picked me ${ord(f.draft.pick)} in ${f.draft.year}, and I remember thinking I had a lot to prove.`,
		);
	}
	if (road.length > 0) {
		out.push(rng.pick(road));
	}

	// People: coach, teammate
	const people: string[] = [];
	if (f.coach) {
		people.push(
			`${f.coach.name} was my first coach with the ${f.coach.team}. He yelled at me more than anybody ever has, and he was right every time.`,
		);
	}
	if (f.teammate) {
		people.push(
			`${f.teammate.name}, we played ${f.teammate.seasons} seasons together and you're up here too. I wouldn't be without you.`,
		);
	}
	if (people.length > 0) {
		out.push(people.join(" "));
	}

	// Teams and titles
	const main = f.teams[0];
	if (main) {
		const t: string[] = [];
		if (f.titles.length > 0) {
			const last = f.titles.at(-1)!;
			t.push(
				f.titles.length === 1
					? `To the ${last.team ?? main.name} and that ${last.season} team: we did it. Nobody can ever take that banner down.`
					: `${f.titles.length} rings. I remember every one of them, but ${last.season} with the ${last.team ?? main.name} was the sweetest.`,
			);
		} else {
			t.push(
				`We never got the ring, and I'll carry that. But the ${main.name} fans showed up for ${main.seasons} seasons like we were going to win it all.`,
			);
		}
		if (f.teams.length > 1) {
			const others = f.teams.slice(1, 3).map((x) => `the ${x.name}`);
			t.push(
				`Thank you as well to ${others.join(" and ")}. Every stop taught me something.`,
			);
		}
		out.push(t.join(" "));
	}

	// Rival
	if (f.rival && f.rival.times >= 2) {
		out.push(
			rng.pick([
				`And to the ${f.rival.name}: you sent me home ${f.rival.times} times in the playoffs. I hated you then. I thank you now.`,
				`The ${f.rival.name} knocked us out ${f.rival.times} times. Every summer I spent in the gym, I spent because of them.`,
			]),
		);
	}

	// Signature moment
	if (f.bestGame) {
		const b = f.bestGame;
		const line = `${b.pts} points${b.trb >= 10 ? `, ${b.trb} rebounds` : ""}${b.ast >= 10 ? `, ${b.ast} assists` : ""}`;
		out.push(
			rng.pick([
				`People still ask about ${b.season}${b.playoffs ? " in the playoffs" : ""}, ${line} against the ${b.opp}. Honestly? I just remember the rim looking like an ocean.`,
				`Everybody brings up that night against the ${b.opp} in ${b.season}, the ${line}${b.won ? "" : ". We lost, by the way, so I don't bring it up"}.`,
			]),
		);
	}

	// Style, by archetype (a label, never a rating)
	if (f.archetype) {
		out.push(
			rng.pick([
				`They called me a ${f.archetype.toLowerCase()}. I just called it playing the way my dad taught me.`,
				`To the young ${f.archetype.toLowerCase()}s out there: put in the work nobody sees.`,
			]),
		);
	}

	// Close
	out.push(
		rng.pick([
			`${f.career.seasons} seasons, ${f.career.pts.toLocaleString("en-US")} points, and I'd do every one of them again. Thank you.`,
			`To my family, who sat through every game: this is your plaque too. Thank you.`,
		]),
	);
	return out;
};

// Inducted after he died: his family accepts for him and speaks about him
const posthumousSpeech = (f: CareerFacts): string[] => {
	const rng = new Rng(f.pid, 7304);
	const out = [
		rng.pick([
			`He should be the one standing here. Our family accepts this on his behalf, and we know exactly what he would have said: that he'd rather be on the floor.`,
			`We wish more than anything that ${f.firstName} could have been here for this. On behalf of our family, thank you for remembering him.`,
		]),
	];
	const main = f.teams[0];
	if (main) {
		out.push(
			f.titles.length > 0
				? `He talked about ${f.titles.at(-1)!.season} with the ${f.titles.at(-1)!.team ?? main.name} for the rest of his life. To the ${main.name} fans: he never forgot you, and you never forgot him.`
				: `The ${main.name} fans gave him ${main.seasons} seasons he never stopped talking about. Thank you for loving him the way he loved playing for you.`,
		);
	}
	out.push(
		`${f.career.seasons} seasons, ${f.career.pts.toLocaleString("en-US")} points. He earned every one of them, and now he has this too. Thank you.`,
	);
	return out;
};

export const perGameLine = (f: CareerFacts) =>
	f.perGame
		? `${fmt1(f.perGame.pts)} pts, ${fmt1(f.perGame.trb)} reb, ${fmt1(f.perGame.ast)} ast`
		: undefined;
