// Post-game: "instant classic" from the box score, and the verdict on whether the game lived up to its billing.
import { chaseCtx } from "./pre.ts";
import { recLabel } from "./chases.ts";
import {
	calMean,
	postScore,
	rarity,
	rarityText,
	type LineStat,
} from "./calibration.ts";
import { roundName } from "./story.ts";
import type {
	HBoxLine,
	HGameInput,
	HResult,
	Post,
	Pre,
	Reason,
	StatKey,
	Verdict,
} from "./types.ts";
import {
	an,
	clamp,
	fmtN,
	gmsc,
	known,
	label,
	num,
	pick,
	pl,
	tsPct,
} from "./util.ts";

const nm = (I: HGameInput, tid: number) => I.teamName[tid] ?? "";

// Quarter flow: lead changes and ties at the period breaks, the winner's largest deficit at a break, the margin entering the last regulation period
export const flow = (res: HResult) => {
	const [h0, a0] = res.teams;
	const qa = a0.ptsQtrs ?? [];
	const qh = h0.ptsQtrs ?? [];
	const n = Math.min(qa.length, qh.length);
	let a = 0;
	let hh = 0;
	let lead = 0;
	let changes = 0;
	let ties = 0;
	let deficit = 0;
	let deficitAt = -1;
	let lateMargin: number | null = null;
	let lateLeader = 0;
	const winnerIsHome = res.winTid === h0.tid;
	for (let i = 0; i < n; i++) {
		a += num(qa[i]);
		hh += num(qh[i]);
		const m = hh - a;
		if (i < n - 1) {
			if (m === 0) {
				ties++;
			}
			const s = Math.sign(m);
			if (s && lead && s !== lead) {
				changes++;
			}
			if (s) {
				lead = s;
			}
			const wm = winnerIsHome ? m : -m;
			if (-wm > deficit) {
				deficit = -wm;
				deficitAt = i;
			}
			if (i === Math.min(n, 4) - 2) {
				lateMargin = Math.abs(m);
				lateLeader = Math.sign(wm);
			}
		}
	}
	// the quarters must add up to the final score
	const ok = n >= 2 && hh === num(h0.pts) && a === num(a0.pts);
	return { n, changes, ties, deficit, deficitAt, lateMargin, lateLeader, ok };
};

export const isEmpty = (res: HResult) =>
	res.winPts + res.losePts === 0 || res.teams.every((t) => !t.players.length);

const allLines = (res: HResult) => res.teams.flatMap((t) => t.players);

const plural = (n: number, w: string) => `${n} ${w}${n === 1 ? "" : "s"}`;

// Scale of a stat in this season's scoring environment relative to the calibration leagues (more than 1 when the stat is scarcer than there)
const eraScale = (I: HGameInput, k: LineStat) => {
	const e = I.env;
	const m = e?.per[k];
	if (!e || e.nLines < 1500 || !m || m <= 0) {
		return 1;
	}
	return clamp(calMean(k) / m, 0.5, 2);
};

// Points for a line that a share 10^-r of lines reach: nothing below the top 2%, then quickly more
const rarePts = (r: number) =>
	r < 1.7 ? 0 : 6.5 * (r - 1.7) + 2.5 * Math.max(0, r - 3.5) ** 2;

// Below these a stat is never special, whatever the scoring environment
const FLOOR: Record<StatKey, number> = {
	pts: 20,
	trb: 10,
	ast: 8,
	stl: 3,
	blk: 3,
	tp: 4,
};

export type LineEval = {
	p: HBoxLine;
	tid: number;
	pts: number;
	gs: number;
	gsR: number;
	text: string;
};

const WORD: Record<StatKey, [string, string]> = {
	pts: ["point", "points"],
	trb: ["rebound", "rebounds"],
	ast: ["assist", "assists"],
	stl: ["steal", "steals"],
	blk: ["block", "blocks"],
	tp: ["three", "threes"],
};

// How special a single line is: the rarity of each stat (and of the whole line by game score) in the league's distribution, plus the classic feats
export const evalLine = (I: HGameInput, p: HBoxLine, tid: number): LineEval => {
	const parts: { pts: number; r: number; k: string; text: string }[] = [];
	for (const k of ["pts", "trb", "ast", "stl", "blk", "tp"] as const) {
		const v = p[k];
		if (v < FLOOR[k]) {
			continue;
		}
		const r = rarity(k, v, eraScale(I, k));
		const w = k === "pts" ? 1.15 : k === "tp" ? 0.8 : 1;
		const x = w * rarePts(r);
		if (x > 0) {
			let text = `${v} ${WORD[k][v === 1 ? 0 : 1]}`;
			if (k === "ast" && known(p.tov)) {
				text += ` (${plural(p.tov, "turnover")})`;
			}
			if (k === "tp" && known(p.tpa) && p.tpa > 0) {
				text = `${v}-of-${p.tpa} from three`;
			}
			parts.push({ pts: x, r, k, text });
		}
	}
	const gs = gmsc(p);
	const gsR = rarity("gmsc", gs, eraScale(I, "gmsc"));
	const feats: { pts: number; text: string }[] = [];
	const cats = [p.pts, p.trb, p.ast, p.stl, p.blk];
	const tens = cats.filter((x) => x >= 10).length;
	const fives = cats.filter((x) => x >= 5).length;
	const line = `${p.pts} pts, ${p.trb} reb, ${p.ast} ast${p.stl >= 5 ? `, ${p.stl} stl` : ""}${p.blk >= 5 ? `, ${p.blk} blk` : ""}`;
	if (tens >= 4) {
		feats.push({ pts: 20, text: `a quadruple-double (${line})` });
	} else if (tens >= 3) {
		feats.push({
			pts:
				5 +
				(p.pts >= 30 ? 4 : 0) +
				(p.pts >= 20 && p.trb >= 15 && p.ast >= 15 ? 4 : 0),
			text: `a triple-double (${line})`,
		});
	}
	if (fives === 5) {
		feats.push({
			pts: 7,
			text: `a five-by-five (${line}, ${p.stl} stl, ${p.blk} blk)`,
		});
	}
	if (p.pts >= 20 && p.trb >= 20) {
		feats.push({
			pts: 6 + Math.min(6, (p.pts - 20) / 3 + (p.trb - 20) / 2),
			text: `a ${p.pts}-${p.trb} game`,
		});
	}
	if (p.ast >= 15 && known(p.tov) && p.tov <= 3) {
		feats.push({
			pts: 4 + (p.ast - 15) * 0.8 + (3 - p.tov) * 1.2,
			text: `${p.ast} assists against only ${plural(p.tov, "turnover")}`,
		});
	}
	const ts = tsPct(p);
	if (ts !== null && p.pts >= 28 && ts >= 0.7) {
		feats.push({
			pts: 3 + (p.pts - 28) * 0.25 + (ts - 0.7) * 30,
			text: `${p.pts} points on ${Math.round(ts * 100)}% true shooting${known(p.fg) && known(p.fga) ? ` (${p.fg}-of-${p.fga})` : ""}`,
		});
	}
	if (known(p.fg) && known(p.fga) && p.fga >= 8 && p.fg === p.fga) {
		feats.push({
			pts: 3 + (p.fga - 8) * 0.8,
			text: `a perfect ${p.fg}-of-${p.fga} shooting night`,
		});
	}
	if (known(p.tov) && p.tov >= 10) {
		feats.push({ pts: -2, text: `${p.tov} turnovers` });
	}
	parts.sort((a, b) => b.pts - a.pts);
	feats.sort((a, b) => b.pts - a.pts);
	// the best stat counts in full, the rest less, and the whole line at least as much as its game score rarity says
	let pts = 0;
	parts.forEach((x, i) => (pts += x.pts * (i === 0 ? 1 : 0.45)));
	pts = Math.max(pts, rarePts(gsR));
	feats.forEach((x, i) => (pts += x.pts * (i === 0 ? 1 : 0.5)));
	// a season best in the league so far (only once enough of the season is stored)
	const E = I.env;
	let best = "";
	if (E && E.n >= 150 && parts[0] && parts[0].r >= 2) {
		const k = parts[0].k as StatKey;
		const prev = E.best[k];
		if (known(prev) && p[k] > prev) {
			pts += 4;
			best = `, the most ${WORD[k][1]} in a game this season`;
		}
	}
	pts = Math.min(75, pts);
	const bits: string[] = [];
	if (feats[0] && feats[0].pts > 0) {
		bits.push(feats[0].text);
	}
	for (const x of parts) {
		if (bits.length >= 2) {
			break;
		}
		if (!bits.some((b) => b.includes(x.text.split(" ")[0]!))) {
			bits.push(x.text);
		}
	}
	if (!bits.length) {
		bits.push(line);
	}
	const r = Math.max(gsR, parts[0]?.r ?? 0);
	const text = `${pl(p)}: ${bits.join(", ")}${best}${r >= 3 ? ` (a ${rarityText(r)} line)` : ""}`;
	return { p, tid, pts, gs, gsR, text };
};

export const postHype = (I: HGameInput, res: HResult, pre: Pre): Post => {
	const reasons: Reason[] = [];
	const add = (k: string, pts: number, text: string) => {
		if (Math.abs(pts) > 0.4 && Number.isFinite(pts)) {
			reasons.push({ k, pts: Math.round(pts * 10) / 10, text });
		}
	};
	const finish = (empty = false): Post => {
		const raw = reasons.reduce((s, r) => s + r.pts, 0);
		reasons.sort(
			(x, y) => Math.abs(y.pts) - Math.abs(x.pts) || (x.text < y.text ? -1 : 1),
		);
		const score = empty ? 0 : postScore(raw);
		return {
			score,
			raw: Math.round(raw * 10) / 10,
			label: label(score),
			reasons,
		};
	};
	if (isEmpty(res)) {
		const r = finish(true);
		r.note =
			"No points or box score lines stored (a forfeit or an unplayed game): nothing to rate.";
		return r;
	}
	const wp = res.winPts;
	const lp = res.losePts;
	const margin = Math.abs(wp - lp);
	const W = nm(I, res.winTid);
	const po = I.playoffs || I.playIn;

	// final margin: close games up, blowouts down
	if (margin === 0) {
		add("margin", 14, "Ended in a tie");
	} else if (margin <= 9) {
		add(
			"margin",
			22 * Math.exp(-(margin - 1) / 4) - 1,
			margin <= 3 ? `Decided by ${margin}` : `Final margin ${margin}`,
		);
	} else if (margin >= 15) {
		add(
			"blowout",
			-Math.min(34, (margin - 13) * 1.35),
			`Blowout: the ${W} won by ${margin}`,
		);
	}
	if (res.overtimes > 0) {
		add(
			"ot",
			Math.min(36, 15 + 9 * (res.overtimes - 1)),
			res.overtimes === 1 ? "Went to overtime" : `${res.overtimes} overtimes`,
		);
	}

	// quarter flow
	const F = flow(res);
	if (F.ok) {
		if (F.changes) {
			add(
				"flow",
				Math.min(12, 3.5 * F.changes),
				`${plural(F.changes, "lead change")} between periods`,
			);
		}
		if (F.ties) {
			add(
				"flow",
				Math.min(6, 2.5 * F.ties),
				`Tied at ${F.ties === 1 ? "one period break" : `${F.ties} period breaks`}`,
			);
		}
		if (F.deficit >= 8 && margin > 0) {
			const late = F.deficitAt >= 2;
			add(
				"comeback",
				Math.min(26, (F.deficit - 6) * (late ? 1.8 : 1.3)),
				`${W} came back from ${F.deficit} down ${["after one", "at halftime", "after three", "at the end of regulation"][F.deficitAt] ?? "after an overtime"}`,
			);
		}
		if (F.lateMargin !== null && !res.overtimes) {
			if (F.lateMargin <= 5) {
				add(
					"late",
					8 * (1 - F.lateMargin / 6),
					F.lateMargin === 0
						? "Tied going into the fourth"
						: `Within ${F.lateMargin} going into the fourth`,
				);
			} else if (F.lateMargin >= 20 && F.lateLeader > 0) {
				add(
					"blowout",
					-Math.min(8, (F.lateMargin - 16) * 0.7),
					`Over after three: the ${W} led by ${F.lateMargin}`,
				);
			}
		}
		if (F.lateLeader < 0 && margin > 0 && !res.overtimes) {
			add("late", 6, `${W} trailed going into the fourth and won it late`);
		}
	}

	// clutch plays (a defensive stop to win counts like a shot)
	let cl = 0;
	const ctext: string[] = [];
	for (const s of res.clutch) {
		const win = /game-winning|win the game|go-ahead|to win\b/i.test(s);
		if (win && /buzzer|no time/i.test(s)) {
			cl += 20;
		} else if (win) {
			cl += 13;
		} else if (
			/\b(block|blocked|steal|stole|stop)\b/i.test(s) &&
			/win|seal|preserve/i.test(s)
		) {
			cl += 13;
		} else if (/force/i.test(s)) {
			cl += /buzzer|no time/i.test(s) ? 10 : 7;
		} else if (/shootout/i.test(s)) {
			cl += 8;
		} else {
			cl += 3;
		}
		ctext.push(s.replace(/\s+/g, " "));
	}
	if (cl) {
		add(
			"clutch",
			Math.min(30, cl),
			ctext[0]! + (ctext.length > 1 ? ` (+${ctext.length - 1} more)` : ""),
		);
	}

	// individual lines
	const evals = res.teams
		.flatMap((t) =>
			t.players.filter((p) => p.min > 0).map((p) => evalLine(I, p, t.tid)),
		)
		.sort((x, y) => y.pts - x.pts || x.p.pid - y.p.pid);
	evals
		.filter((x) => x.pts >= 1.5)
		.slice(0, 3)
		.forEach((x, i) => add("star", x.pts * [1, 0.6, 0.35][i]!, x.text));

	// duel: the best line on each side, both big
	const bestOf = res.teams.map(
		(t) =>
			evals
				.filter((x) => x.tid === t.tid)
				.sort((a, b) => b.gs - a.gs || a.p.pid - b.p.pid)[0],
	);
	if (bestOf[0] && bestOf[1]) {
		const lo = Math.min(bestOf[0].gsR, bestOf[1].gsR);
		if (lo >= 1.4) {
			const [h, a] = bestOf;
			add(
				"duel",
				Math.min(14, 7 * (lo - 1.1)),
				`Star duel: ${pl(a.p)} ${a.p.pts} pts, ${a.p.trb} reb, ${a.p.ast} ast vs ${pl(h.p)} ${h.p.pts} pts, ${h.p.trb} reb, ${h.p.ast} ast`,
			);
		}
	}

	// team scoring, shooting and sloppiness against the season's stored games
	const T = I.env;
	if (T && T.n >= 30 && T.sd > 0) {
		const adj = res.overtimes
			? (wp + lp) * (4 / (4 + 0.4167 * res.overtimes))
			: wp + lp;
		const zr = (adj - T.mean) / T.sd;
		if (zr >= 1.8) {
			add(
				"pace",
				Math.min(10, 3.5 * (zr - 1.4)),
				`A shootout: ${wp + lp} combined points (season average ${Math.round(T.mean)})`,
			);
		} else if (zr <= -2 && margin <= 8) {
			add(
				"defense",
				Math.min(5, 2 * (-zr - 1.5)),
				`A defensive struggle: ${wp + lp} combined points (season average ${Math.round(T.mean)}), and close`,
			);
		} else if (zr <= -1.8) {
			add(
				"ugly",
				-Math.min(8, 3 * (-zr - 1.4)),
				`Low scoring: ${wp + lp} combined points (season average ${Math.round(T.mean)})`,
			);
		}
		if (T.n >= 100 && !po) {
			for (const tm of res.teams) {
				if (tm.pts > T.hiTeam) {
					add(
						"team",
						6,
						`${tm.pts} points by the ${nm(I, tm.tid)}: the most by a team this season`,
					);
				}
				const tp = tm.players.reduce((s, p) => s + p.tp, 0);
				if (tp > T.hiTeamTp && T.hiTeamTp > 0) {
					add(
						"team",
						4,
						`${tp} threes by the ${nm(I, tm.tid)}: the most by a team this season`,
					);
				}
			}
		}
		const sh = res.teams.map((tm) => {
			let fg = 0;
			let fga = 0;
			let tov = 0;
			let ok = true;
			for (const p of tm.players) {
				if (!known(p.fg) || !known(p.fga) || !known(p.tov)) {
					ok = false;
					break;
				}
				fg += p.fg;
				fga += p.fga;
				tov += p.tov;
			}
			return ok && fga > 0 ? { fgp: fg / fga, tov } : null;
		});
		if (sh[0] && sh[1] && T.fgp && T.fgp.sd > 0) {
			const fgp = (sh[0].fgp + sh[1].fgp) / 2;
			const z = (fgp - T.fgp.mean) / (T.fgp.sd / Math.SQRT2);
			if (z <= -1.6) {
				add(
					"ugly",
					-Math.min(10, 3.5 * (-z - 1.2)),
					`Ugly shooting: ${Math.round(sh[0].fgp * 100)}% and ${Math.round(sh[1].fgp * 100)}% from the field`,
				);
			}
		}
		if (sh[0] && sh[1] && T.tov && T.tov.sd > 0) {
			const tv = sh[0].tov + sh[1].tov;
			const z = (tv - 2 * T.tov.mean) / (T.tov.sd * Math.SQRT2);
			if (z >= 1.8) {
				add(
					"ugly",
					-Math.min(7, 2.5 * (z - 1.3)),
					`Sloppy: ${tv} turnovers between them (${Math.round(2 * T.tov.mean)} in a typical game)`,
				);
			}
		}
	}

	// upsets: records (regular season), seeds (playoffs), else team ratings
	const w = I.teams.find((t) => t.tid === res.winTid);
	const l = I.teams.find((t) => t.tid === res.loseTid);
	if (margin > 0 && w && l) {
		let upset = false;
		if (!po) {
			if (l.streak >= 7) {
				add(
					"streak",
					Math.min(8, l.streak - 4),
					`Ended ${an(l.streak)}${l.streak}-game winning streak (${nm(I, l.tid)})`,
				);
			}
			if (w.streak <= -8) {
				add(
					"streak",
					3,
					`Snapped ${an(-w.streak)}${-w.streak}-game losing streak (${nm(I, w.tid)})`,
				);
			}
			if (w.won + w.lost >= 10 && l.won + l.lost >= 10) {
				const pw = (r: { won: number; lost: number }) =>
					r.won / (r.won + r.lost);
				const gap = pw(l) - pw(w);
				if (gap >= 0.18) {
					upset = true;
					add(
						"upset",
						Math.min(14, 30 * (gap - 0.12)),
						`Upset: the ${w.won}-${w.lost} ${nm(I, w.tid)} beat the ${l.won}-${l.lost} ${nm(I, l.tid)}`,
					);
				}
			}
		} else if (I.seriesState?.info.away) {
			const { home, away } = I.seriesState.info;
			const sw = home.tid === res.winTid ? home.seed : away.seed;
			const sl = home.tid === res.winTid ? away.seed : home.seed;
			if (sw - sl >= 3) {
				upset = true;
				add(
					"upset",
					Math.min(8, 1.5 * (sw - sl)),
					`Lower seed won (${sw} over ${sl})`,
				);
			}
		}
		if (
			!upset &&
			w.ovr !== null &&
			l.ovr !== null &&
			w.ovr > 0 &&
			l.ovr > 0 &&
			l.ovr - w.ovr >= 6 &&
			(w.won + w.lost < 10 || po)
		) {
			add(
				"upset",
				Math.min(10, 1.5 * (l.ovr - w.ovr - 3)),
				`Upset: the ${nm(I, w.tid)} (team ovr ${w.ovr}) beat the ${nm(I, l.tid)} (${l.ovr})`,
			);
		}
	}

	// bad teams: a regular season game between losing teams is worth less whatever happens
	if (!po) {
		const bad = I.teams.filter(
			(t) => t.won + t.lost >= 15 && t.won / (t.won + t.lost) < 0.4,
		);
		if (bad.length === 2) {
			add(
				"teams",
				-7,
				`Two losing teams (${I.teams[1].won}-${I.teams[1].lost} at ${I.teams[0].won}-${I.teams[0].lost})`,
			);
		}
	}

	// context: the playoffs matter more, deeper rounds most (less so when it was a rout)
	const S = I.seriesState;
	const damp = margin >= 15 ? clamp(1 - (margin - 12) / 30, 0.4, 1) : 1;
	if (I.playIn) {
		add("stakes", 8 * damp, "Play-in game");
	} else if (I.playoffs) {
		const frac =
			S && S.info.numRounds > 1 ? S.info.round / (S.info.numRounds - 1) : 0.5;
		add(
			"stakes",
			(9 + 14 * frac) * damp,
			S
				? `Playoffs: ${roundName(S.info.round, S.info.numRounds)}, Game ${S.index + 1}`
				: "Playoff game",
		);
		if (res.lastGameOfSeries && S && !res.clinchedTitle) {
			add("stakes", (6 + 6 * frac) * damp, `The ${W} won the series`);
		}
	}

	// milestones reached and records broken tonight
	const C = chaseCtx(I);
	for (const c of pre.story.chases) {
		if (c.status === "broken") {
			continue;
		}
		const line = allLines(res).find((p) => p.pid === c.pid);
		if (line && known(line[c.k]) && c.cur + line[c.k] > c.record.v) {
			add(
				"milestone",
				c.scope === "league" ? 12 : 7,
				`${pl(c)} broke ${recLabel(C, c)} (${fmtN(c.cur + line[c.k])})`,
			);
		}
	}
	for (const m of pre.story.milestones) {
		const line = allLines(res).find((p) => p.pid === m.pid);
		if (line && line.min > 0 && m.before + line[m.k] >= m.mark) {
			add(
				"milestone",
				m.k === "pts" ? 7 : 5,
				`${pl(m)} reached ${fmtN(m.mark)} career ${m.word}`,
			);
		}
	}

	// what was at stake going in carries over (regular season stakes, rivalries, revenge)
	const carry = pre.reasons.filter((r) =>
		r.pts <= 0
			? false
			: po
				? r.k === "rivalry" || r.k === "revenge"
				: ["stakes", "rivalry", "revenge"].includes(r.k),
	);
	const stakes = carry.reduce(
		(s, r) => s + Math.max(0, r.pts) * (r.k === "stakes" ? 0.45 : 0.25),
		0,
	);
	if (stakes > 0 && carry[0]) {
		const top = carry[0];
		const head =
			top.k === "stakes"
				? "Stakes: "
				: top.k === "revenge"
					? "Revenge game: "
					: "Rivalry: ";
		add(
			"stakes",
			stakes,
			head +
				top.text
					.replace(/: a revenge game$/, "")
					.replace(
						/^(Both|Two|Head|Play|Game|Met|Division|Rivalry|Clinched|First|Battle|Can|Marquee|Tank)\b/,
						(x) => x.toLowerCase(),
					),
		);
	}
	// elimination and winner-takes-all games: stakes the pre-game reasons spelled out
	if (I.playoffs) {
		const big = pre.reasons.find(
			(r) => r.k === "stakes" && /winner takes all|elimination/.test(r.text),
		);
		if (big) {
			add(
				"stakes",
				(/winner takes all/.test(big.text) ? 16 : 6) * damp,
				/winner takes all/.test(big.text)
					? "Winner takes all"
					: "An elimination game",
			);
		}
	}
	if (res.clinchedTitle) {
		add("stakes", 14 * damp, `The ${W} clinched the title`);
	}
	return finish();
};

type Fact = { pol: number; w: number; text: string; story: boolean };

// "Decided by 2" -> "decided by 2" (a player token stays as is)
const lower = (t: string) =>
	/^(\[\[|[A-Z][a-z]*[A-Z]|[A-Z]{2})/.test(t)
		? t
		: t.charAt(0).toLowerCase() + t.slice(1);

const capital = (t: string) =>
	t.startsWith("[[") ? t : t.charAt(0).toUpperCase() + t.slice(1);

// Did the game live up to the billing? Compares the pre-game hype with the game rating, and says why from the rating's biggest reasons and what the pre-game story lines promised
export const verdictOf = (
	I: HGameInput,
	res: HResult,
	pre: Pre,
	post: Post,
): Verdict | null => {
	if (isEmpty(res)) {
		return null;
	}
	const facts: Fact[] = [];
	let story = false;
	const add = (pol: number, w: number, text: string) =>
		facts.push({ pol, w, text, story });
	const lineOf = (pid: number) => {
		for (const t of res.teams) {
			for (const p of t.players) {
				if (p.pid === pid) {
					return { p, tid: t.tid };
				}
			}
		}
		return null;
	};
	// the rating's own reasons (stakes carried over from the billing say nothing about how it played)
	for (const r of post.reasons) {
		if (r.k === "stakes" || r.k === "teams") {
			continue;
		}
		add(Math.sign(r.pts), Math.abs(r.pts) / 3, lower(r.text));
	}

	const st = pre.story;
	story = true;
	for (const m of st.milestones) {
		const x = lineOf(m.pid);
		if (!x || !(x.p.min > 0)) {
			continue;
		}
		const got = m.before + x.p[m.k];
		if (got < m.mark) {
			add(
				-1,
				2,
				`${pl(x.p)} fell ${fmtN(m.mark - got)} short of ${fmtN(m.mark)} career ${m.word}`,
			);
		}
	}
	const C = chaseCtx(I);
	for (const c of st.chases) {
		if (c.status === "broken") {
			continue;
		}
		const x = lineOf(c.pid);
		if (!x || !(x.p.min > 0)) {
			continue;
		}
		const now = c.cur + x.p[c.k];
		if (now === c.record.v) {
			add(1, 4, `${pl(c)} tied ${recLabel(C, c)}`);
		} else if (now < c.record.v) {
			add(
				0,
				1,
				`${pl(c)} added ${x.p[c.k]} ${c.word}, ${fmtN(c.record.v - now + 1)} to go`,
			);
		}
	}
	for (const r of st.revenge) {
		const x = lineOf(r.pid);
		if (!x) {
			continue;
		}
		if (!(x.p.min > 0)) {
			add(-1, 2, `${pl(r)} did not play against his old team`);
			continue;
		}
		const won = res.winTid === x.tid;
		if (won && x.p.pts >= 20) {
			add(1, 4, `${pl(r)} got his revenge: ${x.p.pts} points in a win`);
		} else if (!won && x.p.pts < 12) {
			add(-1, 2, `${pl(r)}'s return fell flat (${x.p.pts} points in a loss)`);
		} else {
			add(
				0,
				1,
				`${pl(r)} had ${x.p.pts} in a ${won ? "win" : "loss"} against his old team`,
			);
		}
	}
	for (const h of st.heaters) {
		const x = lineOf(h.pid);
		if (x && x.p.min > 0) {
			if (x.p.pts >= h.hot) {
				add(1, 3, `${pl(h)} stayed hot with ${x.p.pts} points`);
			} else if (x.p.pts < h.base) {
				add(-1, 1.5, `${pl(h)} cooled off (${x.p.pts} points)`);
			}
		}
	}
	if (st.rookies) {
		const a = lineOf(st.rookies.a.pid);
		const b = lineOf(st.rookies.b.pid);
		if (a && b && a.p.min > 0 && b.p.min > 0 && a.p.pts !== b.p.pts) {
			const [hi, lo] = a.p.pts > b.p.pts ? [a, b] : [b, a];
			add(
				hi.p.pts >= 20 ? 1 : 0,
				2,
				`the rookie duel went to ${pl(hi.p)} (${hi.p.pts} to ${lo.p.pts})`,
			);
		}
	}
	story = false;

	const P = pre.score;
	const Q = post.score;
	const d = Q - P;
	let kind: Verdict["kind"];
	if (d >= 20 && Q >= 50) {
		kind = "exceeded";
	} else if (d <= -20 && P >= 40) {
		kind = "fizzled";
	} else if (Q >= 50) {
		kind = "lived";
	} else {
		kind = "quiet";
	}
	const HEAD: Record<Verdict["kind"], string[]> = {
		lived:
			P >= 60
				? [
						"Lived up to the hype",
						"Delivered on the billing",
						"As good as advertised",
					]
				: ["Delivered", "Worth the watch, as billed", "Held up its end"],
		fizzled:
			P >= 60
				? ["Didn't live up to it", "Fell flat", "All hype, little payoff"]
				: ["Less than billed", "Underwhelmed", "Not much to see after all"],
		exceeded:
			P < 40
				? [
						"A sleeper that delivered",
						"Nobody saw this one coming",
						"Far better than billed",
					]
				: [
						"Better than billed",
						"Exceeded the hype",
						"Even better than advertised",
					],
		quiet: [
			"As billed, a quiet one",
			"No surprises, nothing special",
			"Ordinary on paper, ordinary on the floor",
		],
	};
	const want = kind === "fizzled" || kind === "quiet" ? -1 : 1;
	const sorted = facts
		.slice()
		.sort(
			(a, b) => Number(b.pol === want) - Number(a.pol === want) || b.w - a.w,
		);
	const why = sorted
		.filter((f) => f.pol === want || (f.pol === 0 && f.story))
		.slice(0, 2)
		.map((f) => f.text);
	if (!why.length) {
		const margin = Math.abs(res.winPts - res.losePts);
		why.push(
			want > 0
				? `a game rating of ${Q}`
				: margin >= 6
					? `the ${nm(I, res.winTid)} won by ${margin}, with no close finish and no big lines`
					: "no big lines and no late drama",
		);
	}
	const other = sorted
		.filter((f) => f.pol === -want && f.w >= 2 && !why.includes(f.text))
		.sort((a, b) => b.w - a.w)[0];
	const head = pick(I.gid, 51, HEAD[kind]);
	const cmp = `hype ${P}, game ${Q}${d === 0 ? "" : `, ${d > 0 ? "+" : "−"}${Math.abs(d)}`}`;
	const text = `${head} (${cmp}). ${capital(why.length === 2 ? `${why[0]}; ${why[1]}` : why[0]!)}${other ? `; though ${other.text}` : ""}.`;
	return { kind, head, why, pre: P, post: Q, text };
};
