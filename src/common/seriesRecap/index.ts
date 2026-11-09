// Playoff series recaps, ported from League Explorer (views/series.js). Pure: the worker gathers the bracket entry and
// the stored box scores, this finds the story (result, game by game, leaders, series MVP, turning points, upsets,
// comebacks) and writes it up.

export type RecapPlayerLine = {
	pid: number;
	name: string;
	min: number;
	pts: number;
	trb: number;
	ast: number;
	stl: number;
	blk: number;
	tov: number;
	fg: number;
	fga: number;
	ft: number;
	fta: number;
};

export type RecapGameTeam = {
	tid: number;
	pts: number;
	ptsQtrs: number[];
	players: RecapPlayerLine[];
};

export type RecapGame = {
	gid: number;
	overtimes: number;
	// [home, away] as stored in the box score
	teams: [RecapGameTeam, RecapGameTeam];
	clutchPlays?: string[];
};

export type RecapSeriesInput = {
	season: number;
	round: number;
	numRounds: number;
	roundName: string;
	home: { tid: number; seed: number; won: number };
	away: { tid: number; seed: number; won: number };
	numToWin: number;
	// False when the seeds are from different conferences (like most Finals), so a lower seed winning is no upset
	seedsComparable?: boolean;
	games: RecapGame[];
};

export type RecapGameRow = {
	no: number;
	gid: number;
	homeTid: number;
	awayTid: number;
	homePts: number;
	awayPts: number;
	winTid: number;
	margin: number;
	overtimes: number;
	// Series score after the game, winner of the series first
	wWins: number;
	lWins: number;
};

export type RecapLeader = {
	pid: number;
	name: string;
	tid: number;
	gp: number;
	pts: number;
	trb: number;
	ast: number;
	gmsc: number;
};

export type RecapTurningPoint = {
	kind:
		| "biggestWin"
		| "comebackGame"
		| "overtime"
		| "swing"
		| "closeout"
		| "clutch";
	gid: number;
	no: number;
	text: string;
};

export type SeriesRecap = {
	season: number;
	round: number;
	roundName: string;
	finals: boolean;
	complete: boolean;
	winner: { tid: number; seed: number; won: number };
	loser: { tid: number; seed: number; won: number };
	games: RecapGameRow[];
	leaders: RecapLeader[];
	mvp: RecapLeader | null;
	sweep: boolean;
	distance: boolean;
	// The series winner's seed was worse
	upset: boolean;
	// Biggest series deficit the winner came back from, like [1, 3] for down 3-1
	comeback: [number, number] | null;
	turningPoints: RecapTurningPoint[];
	headline: string;
	text: string[];
};

// Hollinger game score
export const gameScore = (p: RecapPlayerLine) =>
	p.pts +
	0.4 * p.fg -
	0.7 * p.fga -
	0.4 * (p.fta - p.ft) +
	0.5 * p.trb +
	p.stl +
	0.7 * p.ast +
	0.7 * p.blk -
	p.tov;

const r1 = (x: number) => Math.round(x * 10) / 10;

const ordinalGame = (no: number) => `Game ${no}`;

export const seriesRecap = (
	input: RecapSeriesInput,
	name: (tid: number) => string,
): SeriesRecap => {
	const homeWinner = input.home.won >= input.away.won;
	const winner = homeWinner ? input.home : input.away;
	const loser = homeWinner ? input.away : input.home;
	const complete = winner.won >= input.numToWin;
	const finals = input.round === input.numRounds - 1;

	// Game by game
	let wWins = 0;
	let lWins = 0;
	let comeback: [number, number] | null = null;
	const games: RecapGameRow[] = input.games.map((g, i) => {
		const [h, a] = g.teams;
		const winTid = h.pts > a.pts ? h.tid : a.tid;
		if (winTid === winner.tid) {
			wWins += 1;
		} else {
			lWins += 1;
		}
		if (
			lWins - wWins >= 1 &&
			(!comeback ||
				lWins - wWins > comeback[1] - comeback[0] ||
				(lWins - wWins === comeback[1] - comeback[0] && lWins > comeback[1]))
		) {
			comeback = [wWins, lWins];
		}
		return {
			no: i + 1,
			gid: g.gid,
			homeTid: h.tid,
			awayTid: a.tid,
			homePts: h.pts,
			awayPts: a.pts,
			winTid,
			margin: Math.abs(h.pts - a.pts),
			overtimes: g.overtimes,
			wWins,
			lWins,
		};
	});
	// Only a real comeback if the winner was down 2 games and won the series from there
	if (!complete || (comeback && comeback[1] - comeback[0] < 2)) {
		comeback = null;
	}

	// Leaders
	const byPid = new Map<number, RecapLeader>();
	for (const g of input.games) {
		for (const t of g.teams) {
			for (const p of t.players) {
				if (!(p.min > 0)) {
					continue;
				}
				let e = byPid.get(p.pid);
				if (!e) {
					e = {
						pid: p.pid,
						name: p.name,
						tid: t.tid,
						gp: 0,
						pts: 0,
						trb: 0,
						ast: 0,
						gmsc: 0,
					};
					byPid.set(p.pid, e);
				}
				e.gp += 1;
				e.pts += p.pts;
				e.trb += p.trb;
				e.ast += p.ast;
				e.gmsc += gameScore(p);
			}
		}
	}
	const leaders = [...byPid.values()]
		.map((e) => ({
			...e,
			pts: r1(e.pts / e.gp),
			trb: r1(e.trb / e.gp),
			ast: r1(e.ast / e.gp),
			gmsc: r1(e.gmsc / e.gp),
		}))
		.sort((x, y) => y.gmsc * y.gp - x.gmsc * x.gp || x.pid - y.pid);
	const mvp =
		leaders.find((x) => x.tid === winner.tid && x.gp >= games.length / 2) ??
		null;

	// Turning points
	const tps: RecapTurningPoint[] = [];
	const W = name(winner.tid);
	const L = name(loser.tid);
	const score = (row: RecapGameRow) => {
		const hi = Math.max(row.homePts, row.awayPts);
		const lo = Math.min(row.homePts, row.awayPts);
		return `${hi}-${lo}${row.overtimes > 0 ? (row.overtimes > 1 ? ` (${row.overtimes}OT)` : " (OT)") : ""}`;
	};
	if (games.length > 1) {
		const big = games.reduce((b, x) => (x.margin > b.margin ? x : b));
		tps.push({
			kind: "biggestWin",
			gid: big.gid,
			no: big.no,
			text: `${ordinalGame(big.no)}: the ${name(big.winTid)} won by ${big.margin}, ${score(big)}.`,
		});
	}
	// Biggest deficit after three quarters that the game's winner overcame
	let bestCb: { row: RecapGameRow; down: number } | null = null;
	input.games.forEach((g, i) => {
		const row = games[i]!;
		const wi = g.teams[0].tid === row.winTid ? 0 : 1;
		const q = (t: RecapGameTeam) =>
			t.ptsQtrs.slice(0, 3).reduce((s, x) => s + x, 0);
		if (g.teams[0].ptsQtrs.length < 3) {
			return;
		}
		const down = q(g.teams[1 - wi]!) - q(g.teams[wi]!);
		if (down >= 6 && (!bestCb || down > bestCb.down)) {
			bestCb = { row, down };
		}
	});
	if (bestCb) {
		const { row, down } = bestCb as { row: RecapGameRow; down: number };
		tps.push({
			kind: "comebackGame",
			gid: row.gid,
			no: row.no,
			text: `${ordinalGame(row.no)}: the ${name(row.winTid)} were down ${down} after three quarters and won ${score(row)}.`,
		});
	}
	for (const row of games.filter((x) => x.overtimes > 0).slice(0, 2)) {
		tps.push({
			kind: "overtime",
			gid: row.gid,
			no: row.no,
			text: `${ordinalGame(row.no)} went to ${row.overtimes > 1 ? `${row.overtimes} overtimes` : "overtime"}: the ${name(row.winTid)} won ${score(row)}.`,
		});
	}
	// Swing game: the first win that put the eventual winner ahead for good
	if (complete && games.length >= 4) {
		let swing: RecapGameRow | null = null;
		for (const row of games) {
			if (row.wWins > row.lWins) {
				if (!swing) {
					swing = row;
				}
			} else {
				swing = null;
			}
		}
		if (swing && swing.no > 1 && swing.no < games.length) {
			tps.push({
				kind: "swing",
				gid: swing.gid,
				no: swing.no,
				text: `${ordinalGame(swing.no)} swung it: the ${W} went ahead ${swing.wWins}-${swing.lWins} and never trailed again.`,
			});
		}
	}
	if (complete && games.length > 0) {
		const last = games.at(-1)!;
		tps.push({
			kind: "closeout",
			gid: last.gid,
			no: last.no,
			text: `${ordinalGame(last.no)}: the ${W} closed it out, ${score(last)}.`,
		});
	}
	input.games.forEach((g, i) => {
		for (const text of (g.clutchPlays ?? []).slice(0, 1)) {
			tps.push({
				kind: "clutch",
				gid: g.gid,
				no: i + 1,
				text: `${ordinalGame(i + 1)}: ${text.replace(/<[^>]*>/g, "")}`,
			});
		}
	});

	const sweep = complete && loser.won === 0 && input.numToWin > 1;
	const distance =
		complete && loser.won === input.numToWin - 1 && input.numToWin > 1;
	const upset =
		complete && input.seedsComparable !== false && winner.seed > loser.seed;
	const seedGap = winner.seed - loser.seed;

	let headline: string;
	if (!complete) {
		headline = `${W} lead the ${L} ${winner.won}-${loser.won}`;
	} else if (
		comeback &&
		(comeback as [number, number])[1] - (comeback as [number, number])[0] >= 2
	) {
		const [x, y] = comeback as [number, number];
		headline = `${W} rally from down ${y}-${x} to beat the ${L}`;
	} else if (upset && seedGap >= 3) {
		headline = `Upset! No. ${winner.seed} ${W} stun No. ${loser.seed} ${L}`;
	} else if (sweep) {
		headline = `${W} sweep the ${L}`;
	} else if (distance) {
		headline = `${W} outlast the ${L} in ${games.length || input.numToWin * 2 - 1}`;
	} else {
		headline = `${W} beat the ${L} ${winner.won}-${loser.won}`;
	}

	const text: string[] = [];
	if (complete) {
		text.push(
			`The ${winner.seed ? `No. ${winner.seed} ` : ""}${W} beat the ${loser.seed ? `No. ${loser.seed} ` : ""}${L} ${winner.won}-${loser.won} in the ${input.season} ${input.roundName}${finals ? " to win the title" : ""}.`,
		);
	} else {
		text.push(
			`The ${input.season} ${input.roundName} between the ${W} and the ${L} stands at ${winner.won}-${loser.won}.`,
		);
	}
	if (comeback) {
		const [x, y] = comeback as [number, number];
		text.push(`They were down ${y}-${x} in the series before winning it.`);
	}
	if (upset) {
		text.push(
			seedGap >= 3
				? `A big upset: ${seedGap} seeds separated them.`
				: "The lower seed won.",
		);
	}
	if (games.length > 0) {
		const avg = games.reduce((s, x) => s + x.margin, 0) / games.length;
		const close = games.filter((x) => x.margin <= 5 || x.overtimes > 0).length;
		text.push(
			`The average margin was ${r1(avg)} points${close > 0 ? `, and ${close} of the ${games.length} games were decided by 5 or fewer or in overtime` : ""}.`,
		);
	}
	if (mvp) {
		text.push(
			`${mvp.name} led the way with ${mvp.pts} points, ${mvp.trb} rebounds and ${mvp.ast} assists a game.`,
		);
	}
	const loserBest = leaders.find((x) => x.tid === loser.tid);
	if (loserBest) {
		text.push(
			`${loserBest.name} averaged ${loserBest.pts} points for the ${L}.`,
		);
	}

	return {
		season: input.season,
		round: input.round,
		roundName: input.roundName,
		finals,
		complete,
		winner,
		loser,
		games,
		leaders: leaders.slice(0, 10),
		mvp,
		sweep,
		distance,
		upset,
		comeback,
		turningPoints: tps,
		headline,
		text,
	};
};

// One line for the news feed when a series ends, from just the bracket entry and the series' game winners
export const seriesEndNote = (
	winner: { seed: number; won: number },
	loser: { seed: number; won: number },
	gameWinnersAreSeriesWinner: boolean[],
	seedsComparable = true,
) => {
	let w = 0;
	let l = 0;
	let worst = 0;
	let at: [number, number] | null = null;
	for (const x of gameWinnersAreSeriesWinner) {
		if (x) {
			w += 1;
		} else {
			l += 1;
		}
		if (l - w > worst) {
			worst = l - w;
			at = [w, l];
		}
	}
	if (at && worst >= 2) {
		return `They came back from down ${at[1]}-${at[0]}.`;
	}
	if (seedsComparable && winner.seed - loser.seed >= 3) {
		return `An upset: the No. ${winner.seed} seed knocked out No. ${loser.seed}.`;
	}
	if (loser.won === 0 && winner.won > 1) {
		return "A sweep.";
	}
	return "";
};
