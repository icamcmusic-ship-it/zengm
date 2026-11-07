// Story lines going into a game: career milestones, players on a heater, revenge games, rookie duels and the playoff series so far.
import type {
	HGameInput,
	HListed,
	Heater,
	Milestone,
	Revenge,
	RookieDuel,
	SeriesSoFar,
	StatKey,
} from "./types.ts";
import {
	careerTotal,
	curGp,
	curTotal,
	fmtN,
	known,
	pick,
	pl,
} from "./util.ts";

const listed = (I: HGameInput) => [...I.players[0], ...I.players[1]];
const nm = (I: HGameInput, tid: number) => I.teamName[tid] ?? "";

// Largest regular-season ppg of the season before (or the one before that), the rate used to judge "within reach"
const prevPpg = (p: HListed, season: number) => {
	let best = 0;
	for (const r of p.rows) {
		if (r.season === season - 1 && r.gp > 0 && known(r.pts)) {
			best = Math.max(best, r.pts / r.gp);
		}
	}
	return best;
};

const rateOf = (p: HListed, k: StatKey, season: number) => {
	let prev = 0;
	let before = 0;
	let gp = 0;
	for (const r of p.rows) {
		if (r.gp > 0 && known(r[k])) {
			before += r[k]!;
			gp += r.gp;
			if (r.season === season - 1) {
				prev = r[k]! / r.gp;
			}
		}
	}
	return prev || (gp ? before / gp : 0);
};

// Career points marks (every 5,000 from 10,000) within about a game and a half of scoring
export const pointsMilestones = (I: HGameInput): Milestone[] => {
	const out: Milestone[] = [];
	for (const p of listed(I)) {
		const before = careerTotal(p, "pts");
		if (!known(before) || before < 8000) {
			continue;
		}
		const mark = Math.ceil((before + 1) / 5000) * 5000;
		const need = mark - before;
		if (mark >= 10000 && need <= 1.5 * (prevPpg(p, I.season) || 20)) {
			out.push({
				pid: p.pid,
				name: p.name,
				k: "pts",
				word: "points",
				before,
				mark,
				text: `${pl(p)} needs ${need} ${need === 1 ? "point" : "points"} for ${fmtN(mark)} career`,
			});
		}
	}
	return out.sort((a, b) => a.mark - b.mark || a.pid - b.pid).slice(0, 2);
};

// Other career marks within reach: rebounds, assists, threes, blocks, steals
const MARKS: [StatKey, string, number, number][] = [
	["trb", "rebounds", 5000, 2500],
	["ast", "assists", 5000, 2500],
	["tp", "three-pointers", 1000, 500],
	["blk", "blocks", 1000, 500],
	["stl", "steals", 1000, 500],
];

export const otherMilestones = (I: HGameInput): Milestone[] => {
	const out: Milestone[] = [];
	for (const p of listed(I)) {
		for (const [k, word, from, step] of MARKS) {
			const before = careerTotal(p, k);
			if (!known(before) || before < from * 0.8) {
				continue;
			}
			const mark = Math.max(from, Math.ceil((before + 1) / step) * step);
			const need = mark - before;
			const rate = rateOf(p, k, I.season);
			if (rate > 0 && need <= Math.max(1, 1.5 * rate)) {
				out.push({
					pid: p.pid,
					name: p.name,
					k,
					word,
					before,
					mark,
					text: `${pl(p)} needs ${need} ${need === 1 ? word.replace(/s$/, "") : word} for ${fmtN(mark)} career`,
				});
			}
		}
	}
	return out.sort((a, b) => a.pid - b.pid).slice(0, 2);
};

// Players on a heater going in: their last five games well above their pace before them
export const heaters = (I: HGameInput): Heater[] => {
	const out: Heater[] = [];
	for (const p of listed(I)) {
		const prior = p.lines.filter((x) => x.min > 0);
		if (prior.length < 8) {
			continue;
		}
		const last = prior.slice(-5);
		const rest = prior.slice(0, -5);
		const avg = (a: typeof prior) => a.reduce((s, x) => s + x.pts, 0) / a.length;
		const hot = avg(last);
		const base = avg(rest);
		const thirties = prior.slice(-3).every((x) => x.pts >= 30);
		if ((hot >= 20 && hot >= base + 6) || thirties) {
			out.push({
				pid: p.pid,
				name: p.name,
				hot,
				base,
				text: `${pl(p)} is on a heater: ${thirties ? "30 or more in each of his last 3 games" : `${hot.toFixed(1)} points a game over his last 5 (${base.toFixed(1)} before that)`}`,
			});
		}
	}
	return out.sort((a, b) => b.hot - a.hot || a.pid - b.pid).slice(0, 2);
};

const isRookie = (p: HListed, season: number) =>
	known(p.draft.year) &&
	p.draft.year === season - 1 &&
	!p.rows.some((r) => r.season < season && r.gp > 0);

export const rookieDuel = (I: HGameInput): RookieDuel | null => {
	const best = I.players.map((players, ti) => {
		let b: RookieDuel["a"] & { rank: number } | null = null;
		for (const p of players) {
			if (!isRookie(p, I.season)) {
				continue;
			}
			const d = p.draft;
			const no = d.round === 1 && known(d.pick) && d.pick > 0 ? d.pick : null;
			const gp = curGp(p);
			const pts = curTotal(p, "pts");
			const ppg = gp >= 8 && known(pts) ? pts / gp : null;
			const top = (no !== null && no <= 5) || (ppg !== null && ppg >= 12);
			if (!top) {
				continue;
			}
			const rank = (no !== null ? 6 - no : 0) + (ppg !== null ? ppg / 4 : 0);
			if (!b || rank > b.rank) {
				b = { pid: p.pid, name: p.name, tid: I.teams[ti]!.tid, no, ppg, rank, year: d.year };
			}
		}
		return b;
	});
	if (!best[0] || !best[1]) {
		return null;
	}
	const [a, b] = best[0].rank >= best[1].rank ? [best[0], best[1]] : [best[1], best[0]];
	const desc = (x: typeof a) =>
		x.ppg !== null && (x.no === null || x.ppg >= 15)
			? `${pl(x)} (${x.ppg.toFixed(1)} ppg)`
			: `No. ${x.no} pick ${pl(x)}`;
	const both = a.no !== null && b.no !== null && a.no <= 5 && b.no <= 5;
	const strip = (x: typeof a) => ({
		pid: x.pid,
		name: x.name,
		tid: x.tid,
		no: x.no,
		ppg: x.ppg,
		year: x.year,
	});
	const text =
		both && pick(I.gid, 31, [0, 1])
			? `Two of the ${a.year} draft's top picks meet: ${pl(a)} (No. ${a.no}) and ${pl(b)} (No. ${b.no})`
			: `${pick(I.gid, 32, ["Rookie showdown: ", "Battle of the rookies: ", "Rookie watch: "])}${desc(a)}${pick(I.gid, 33, [" vs ", " meets "])}${desc(b)}`;
	return {
		a: strip(a),
		b: strip(b),
		text,
		pts: 3 + (both && a.no! <= 3 && b.no! <= 3 ? 1 : 0),
	};
};

// A listed player facing a franchise he played for, how he left, and whether this is the first meeting since
export const revenge = (I: HGameInput): Revenge[] => {
	const out: Revenge[] = [];
	const S = I.season;
	for (const [ti, players] of I.players.entries()) {
		const myTid = I.teams[ti]!.tid;
		const oppTid = I.teams[1 - ti]!.tid;
		if (myTid === oppTid) {
			continue;
		}
		for (const p of players) {
			const rows = p.rows.filter((r) => r.gp > 0 && r.season < S);
			const cur = (p.cur ?? []).filter((r) => r.gp > 0);
			// cheap test first
			if (!rows.some((r) => r.tid === oppTid) && !cur.some((r) => r.tid === oppTid)) {
				continue;
			}
			const withOpp = rows.filter((r) => r.tid === oppTid);
			const oppNow = cur.filter((r) => r.tid === oppTid);
			const lastWith = oppNow.length ? S : Math.max(...withOpp.map((r) => r.season));
			const seasons = new Set(withOpp.map((r) => r.season)).size + (oppNow.length ? 1 : 0);
			if (lastWith < S - 4 && seasons < 4) {
				continue;
			}
			const ppgBest = Math.max(
				0,
				...withOpp
					.filter((r) => r.gp >= 10 && known(r.pts))
					.map((r) => r.pts! / r.gp),
			);
			const ovrBest = Math.max(
				-1,
				...withOpp.map((r) => p.ovrBySeason[r.season] ?? -1),
			);
			const allStar = p.allStar.filter((s) => withOpp.some((r) => r.season === s)).length;
			const cut = I.records?.starCut[lastWith] ?? Number.POSITIVE_INFINITY;
			const star = allStar > 0 || ppgBest >= 18 || ovrBest >= cut;
			if (!star && seasons < 2 && ppgBest < 10) {
				continue;
			}
			// his franchises in order: was the opponent his last stop before this team?
			const seq = [...rows, ...cur].map((r) => r.tid);
			let i = seq.length - 1;
			while (i >= 0 && seq[i] === myTid) {
				i--;
			}
			const direct = i >= 0 && seq[i] === oppTid;
			let how: Revenge["how"] = null;
			let when: Revenge["when"] = null;
			let whenPhase: number | null = null;
			// he moved after last season's playoffs (or since): any meeting since is in this season's games
			let movedSince = false;
			if (direct) {
				const mv = p.moves
					.filter((x) => x.season >= lastWith && x.season <= S && x.tid === myTid)
					.sort((a, b) => a.season - b.season || a.phase - b.phase)
					.at(-1);
				if (mv) {
					when = mv.season === S && mv.phase >= 1 ? "this season" : mv.season;
					whenPhase = mv.phase;
					movedSince = mv.season === S || (mv.season === S - 1 && mv.phase >= 3);
					if (mv.type === "trade" && mv.fromTid === oppTid) {
						how = "traded";
					} else if (mv.type === "freeAgent") {
						how = p.released.some(
							(x) => x.tid === oppTid && x.season >= lastWith && x.season <= S,
						)
							? "released"
							: "free agency";
					}
				}
			}
			// first meeting since he left: no stored game since against them, and all the seasons since stored in full
			const all = [...p.prevLines, ...p.lines];
			const met = all.some(
				(x) =>
					x.tid !== oppTid &&
					x.oppTid === oppTid &&
					(x.season > lastWith || oppNow.length > 0),
			);
			let first: boolean | null = null;
			if (met) {
				first = false;
			} else if (lastWith >= I.linesFrom || (movedSince && I.linesFrom <= S)) {
				first = true;
			}
			const recent = direct && lastWith >= S - 1;
			if (
				!(first === true && (recent || star)) &&
				!(star && seasons >= 3 && (first === true || (first === null && lastWith >= S - 1))) &&
				!(star && recent && allStar)
			) {
				continue;
			}
			const pts =
				3 +
				(first ? 2 : 0) +
				(star ? 2 : 0) +
				(how === "traded" || how === "released" ? 1 : 0) +
				(lastWith >= S - 1 ? 1 : 0);
			out.push({
				pid: p.pid,
				name: p.name,
				tid: myTid,
				oppTid,
				how,
				when,
				whenPhase,
				first,
				star,
				allStar,
				seasons,
				ppg: ppgBest,
				lastWith,
				direct,
				pts,
			});
		}
	}
	return out.sort((a, b) => b.pts - a.pts || a.pid - b.pid).slice(0, 2);
};

const starBits = (r: Revenge) => {
	const bits = [`${r.seasons} season${r.seasons === 1 ? "" : "s"} there`];
	if (r.allStar) {
		bits.push(`${r.allStar} All-Star pick${r.allStar === 1 ? "" : "s"}`);
	} else if (r.ppg >= 10) {
		bits.push(`up to ${r.ppg.toFixed(1)} ppg`);
	}
	return bits.join(", ");
};

export const revengeText = (I: HGameInput, r: Revenge) => {
	const team = `the ${nm(I, r.oppTid)}`;
	const Team = `The ${nm(I, r.oppTid)}`;
	const P = pl(r);
	const S = I.season;
	// a move in the preseason or the season is "earlier this season"; one in the offseason before it is "last offseason"
	const ago =
		r.when === "this season"
			? "earlier this season"
			: r.when === S - 1 && r.whenPhase !== null && r.whenPhase <= 2
				? "last season"
				: r.when === S - 1 || r.when === S
					? "last offseason"
					: r.when
						? `in ${r.when}`
						: "";
	const tail = r.star ? ` (${starBits(r)})` : "";
	const sp = ago ? ` ${ago}` : "";
	if (!r.direct) {
		return pick(I.gid, 21, [
			`${Team} see their old star ${P} again${tail}`,
			`${P} faces ${team}, his team for ${r.seasons} season${r.seasons === 1 ? "" : "s"}${tail}`,
		]);
	}
	if (r.how === "traded") {
		return `${r.first ? pick(I.gid, 22, [`${P} faces ${team} for the first time since they traded him${sp}`, `${Team} traded ${P}${sp}; tonight is his first crack at them`]) : pick(I.gid, 22, [`${P} meets ${team}, who traded him${sp}`, `Another look at ${team} for ${P}, traded away${sp}`])}${tail}`;
	}
	if (r.how === "released") {
		return `${P} ${r.first ? "gets his first shot at" : "meets"} ${team}, who released him${sp}${tail}`;
	}
	if (r.how === "free agency") {
		return `${r.first ? pick(I.gid, 23, [`${P} returns to face ${team} for the first time since leaving in free agency${sp}`, `First meeting with his old team since ${P} left ${team} in free agency${sp}`]) : `${P} meets ${team}, the team he left in free agency${sp}`}${tail}`;
	}
	return `${P} faces his former team, ${team}${r.first ? ", for the first time since leaving" : ""}${tail}`;
};

export const roundName = (round: number, numRounds: number) =>
	round === numRounds - 1
		? "the Finals"
		: round === numRounds - 2
			? "the semifinals"
			: `round ${round + 1}`;

// Series state before the game
export const seriesRecord = (I: HGameInput) => {
	const st = I.seriesState;
	if (!st) {
		return null;
	}
	let hw = 0;
	let aw = 0;
	for (const g of st.before) {
		if (g.winTid === st.info.home.tid) {
			hw++;
		} else {
			aw++;
		}
	}
	return { hw, aw, need: st.info.numToWin, info: st.info, index: st.index };
};

// Playoff series so far, before this game: results, home record, what a win means
export const seriesSoFar = (I: HGameInput): SeriesSoFar | null => {
	const st = I.seriesState;
	const R = seriesRecord(I);
	if (!st || !R || !st.info.away || I.playIn) {
		return null;
	}
	const m = st.info;
	const away = m.away!;
	const ab = (tid: number) =>
		I.teams.find((t) => t.tid === tid)?.abbrev ?? nm(I, tid);
	const { hw, aw, need } = R;
	const lines: string[] = [];
	const nGame = st.index + 1;
	const decided = st.before.length;
	const homeWins = st.before.filter((x) => x.winTid === x.homeTid).length;
	if (!st.index) {
		lines.push(
			`${pick(I.gid, 41, ["Series opener", "Game 1"])}: home court to ${nm(I, m.home.tid)}${m.home.seed ? ` (seed ${m.home.seed})` : ""}`,
		);
	} else {
		lines.push(
			hw === aw
				? `Series tied ${hw}-${aw}`
				: `${nm(I, hw > aw ? m.home.tid : away.tid)} lead ${Math.max(hw, aw)}-${Math.min(hw, aw)}`,
			st.before
				.map(
					(x, i) =>
						`G${i + 1} ${ab(x.winTid)} ${x.winPts}-${x.losePts}${x.ot ? ` (${x.ot > 1 ? x.ot : ""}OT)` : ""}`,
				)
				.join(", "),
		);
		if (decided >= 2) {
			lines.push(
				homeWins === decided
					? `Home teams have won ${decided === 2 ? "both" : `all ${decided}`}`
					: homeWins === 0
						? `The road team has won ${decided === 2 ? "both" : `all ${decided}`}`
						: `Home teams are ${homeWins}-${decided - homeWins}`,
			);
		}
		if (need > 1) {
			const fin = m.round === m.numRounds - 1;
			const wTxt = fin ? "the title" : "the series";
			const lineFor = (tid: number, w: number, l: number) =>
				w === need - 1
					? `a ${nm(I, tid)} win ${fin ? "clinches the title" : "ends it"}`
					: w === need - 2 && l < need - 1
						? `a ${nm(I, tid)} win puts them one away from ${wTxt}`
						: w === l - 1 && l < need - 1
							? `a ${nm(I, tid)} win evens it`
							: w < l - 1 && l < need - 1
								? `a ${nm(I, tid)} win cuts it to ${l}-${w + 1}`
								: null;
			if (hw === need - 1 && aw === need - 1) {
				lines.push(`Winner takes ${fin ? "the title" : "the series"}`);
			} else if (hw === aw && hw === need - 2) {
				lines.push(
					pick(I.gid, 42, [
						`The winner goes one game from ${wTxt}`,
						`Whoever wins tonight is one win from ${wTxt}`,
					]),
				);
			} else {
				const bits = [
					lineFor(m.home.tid, hw, aw),
					lineFor(away.tid, aw, hw),
				].filter((x): x is string => x !== null);
				const elim =
					hw === need - 1 ? away.tid : aw === need - 1 ? m.home.tid : null;
				if (elim !== null) {
					bits.push(`${nm(I, elim)} face elimination`);
				}
				if (bits.length) {
					lines.push(bits.join("; ").replace(/^a/, "A"));
				}
			}
		}
	}
	return {
		game: nGame,
		hw,
		aw,
		need,
		decided,
		lines,
		text: `${lines.join(". ")}.`,
	};
};
