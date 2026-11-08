// Post-game: "instant classic" from the box score, and the verdict on whether the game lived up to its billing.
import { chaseCtx } from "./pre.ts";
import { recLabel } from "./chases.ts";
import type {
	HBoxLine,
	HGameInput,
	HResult,
	Post,
	Pre,
	Reason,
	Verdict,
} from "./types.ts";
import {
	POST_K,
	an,
	fmtN,
	known,
	label,
	num,
	pick,
	pl,
	squash,
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

// A notable individual line, from the box score alone
const lineFacts = (p: HBoxLine) => {
	const dd = [p.pts, p.trb, p.ast, p.stl, p.blk].filter((x) => x >= 10).length;
	if (p.pts >= 50) {
		return { pts: 12, text: `${pl(p)} scored ${p.pts}` };
	}
	if (dd >= 4) {
		return {
			pts: 11,
			text: `${pl(p)}: a quadruple-double (${p.pts} pts, ${p.trb} reb, ${p.ast} ast)`,
		};
	}
	if (dd >= 3 && p.pts >= 10 && p.trb >= 10 && p.ast >= 10) {
		return {
			pts: p.pts >= 30 ? 7 : 4,
			text: `${pl(p)}: a triple-double (${p.pts} pts, ${p.trb} reb, ${p.ast} ast)`,
		};
	}
	if (p.pts >= 40) {
		return { pts: 6, text: `${pl(p)} scored ${p.pts}` };
	}
	if (p.tp >= 9) {
		return { pts: 4, text: `${pl(p)} hit ${p.tp} threes` };
	}
	if (p.blk >= 8 || p.stl >= 7) {
		return {
			pts: 3,
			text: `${pl(p)}: ${p.blk >= 8 ? `${p.blk} blocks` : `${p.stl} steals`}`,
		};
	}
	return null;
};

export const postHype = (I: HGameInput, res: HResult, pre: Pre): Post => {
	const reasons: Reason[] = [];
	const add = (k: string, pts: number, text: string) => {
		if (pts > 0.4 && Number.isFinite(pts)) {
			reasons.push({ k, pts: Math.round(pts * 10) / 10, text });
		}
	};
	const finish = (): Post => {
		const raw = reasons.reduce((s, r) => s + r.pts, 0);
		reasons.sort((x, y) => y.pts - x.pts || (x.text < y.text ? -1 : 1));
		const score = squash(raw, POST_K);
		return {
			score,
			raw: Math.round(raw * 10) / 10,
			label: label(score),
			reasons,
		};
	};
	if (isEmpty(res)) {
		const r = finish();
		r.note =
			"No points or box score lines stored (a forfeit or an unplayed game): nothing to rate.";
		return r;
	}
	const wp = res.winPts;
	const lp = res.losePts;
	const margin = Math.abs(wp - lp);

	// margin
	if (margin === 0) {
		add("margin", 24, "Ended in a tie");
	} else {
		add(
			"margin",
			30 * Math.exp(-(Math.max(1, margin) - 1) / 5),
			margin <= 3 ? `Decided by ${margin}` : `Final margin ${margin}`,
		);
	}
	if (res.overtimes > 0) {
		add(
			"ot",
			Math.min(30, 12 + 8 * (res.overtimes - 1)),
			res.overtimes === 1 ? "Went to overtime" : `${res.overtimes} overtimes`,
		);
	}

	// quarter flow
	const F = flow(res);
	if (F.ok) {
		if (F.changes) {
			add(
				"flow",
				Math.min(12, 3 * F.changes),
				`${F.changes} lead change${F.changes === 1 ? "" : "s"} between periods`,
			);
		}
		if (F.ties) {
			add(
				"flow",
				Math.min(6, 2 * F.ties),
				`Tied at ${F.ties === 1 ? "one period break" : `${F.ties} period breaks`}`,
			);
		}
		if (F.deficit >= 9 && margin > 0) {
			add(
				"comeback",
				Math.min(16, (F.deficit - 6) * 1.2),
				`${nm(I, res.winTid)} came back from ${F.deficit} down ${["after one", "at halftime", "after three", "at the end of regulation"][F.deficitAt] ?? "after an overtime"}`,
			);
		}
		if (F.lateMargin !== null && F.lateMargin <= 5 && !res.overtimes) {
			add(
				"late",
				8 * (1 - F.lateMargin / 6),
				F.lateMargin === 0
					? "Tied going into the fourth"
					: `Within ${F.lateMargin} going into the fourth`,
			);
		}
		if (F.lateLeader < 0 && margin > 0 && !res.overtimes) {
			add(
				"late",
				5,
				`${nm(I, res.winTid)} trailed going into the fourth and won it late`,
			);
		}
	}

	// clutch plays
	let cl = 0;
	const ctext: string[] = [];
	for (const s of res.clutch) {
		if (/game-winning|win the game/i.test(s) && /buzzer/i.test(s)) {
			cl += 14;
		} else if (/game-winning|win the game|go-ahead/i.test(s)) {
			cl += 9;
		} else if (/force/i.test(s)) {
			cl += 5;
		} else {
			cl += 2;
		}
		ctext.push(s);
	}
	if (cl) {
		add(
			"clutch",
			Math.min(20, cl),
			ctext[0]! + (ctext.length > 1 ? ` (+${ctext.length - 1} more)` : ""),
		);
	}

	// star duel: the top scorer on each side
	const tops = res.teams.map((t) =>
		t.players.reduce<HBoxLine | null>(
			(b, p) => (!b || p.pts > b.pts ? p : b),
			null,
		),
	);
	if (tops[0] && tops[1]) {
		const lo = Math.min(tops[0].pts, tops[1].pts);
		if (lo >= 35) {
			add(
				"duel",
				lo >= 40 ? 10 + Math.min(6, (lo - 40) / 2) : 4,
				`Star duel: ${pl(tops[1])} ${tops[1].pts}, ${pl(tops[0])} ${tops[0].pts}`,
			);
		}
	}

	// notable individual lines
	const lines = allLines(res)
		.filter((p) => p.min > 0)
		.map((p) => ({ p, f: lineFacts(p) }))
		.filter((x) => x.f !== null)
		.sort((x, y) => y.f!.pts - x.f!.pts || x.p.pid - y.p.pid);
	lines
		.slice(0, 2)
		.forEach((x, i) => add("star", x.f!.pts * (i ? 0.6 : 1), x.f!.text));

	// scoring extremes against the season's stored games
	const T = I.env;
	if (T && T.n >= 30 && T.sd > 0) {
		const adj = res.overtimes
			? (wp + lp) * (4 / (4 + 0.4167 * res.overtimes))
			: wp + lp;
		const z = (wp + lp - T.mean) / T.sd;
		const zr = (adj - T.mean) / T.sd;
		if (zr >= 2) {
			add(
				"pace",
				Math.min(8, 3 * (zr - 1.5)),
				`A shootout: ${wp + lp} combined points (season average ${Math.round(T.mean)})`,
			);
		} else if (zr <= -2 && margin <= 8) {
			add(
				"defense",
				Math.min(6, 2.5 * (-zr - 1.5)),
				`A defensive struggle: ${wp + lp} combined points (season average ${Math.round(T.mean)}), and close`,
			);
		}
		if (z > 0 && wp >= T.hiTeam && T.n >= 100 && !I.playoffs) {
			add(
				"pace",
				4,
				`${wp} points by the ${nm(I, res.winTid)}: the most by a team in a stored game this season`,
			);
		}
	}

	// upset: the pre-game records (regular season) or seeds (playoffs)
	if (margin > 0) {
		const w = I.teams.find((t) => t.tid === res.winTid);
		const l = I.teams.find((t) => t.tid === res.loseTid);
		if (!I.playoffs && !I.playIn && w && l) {
			if (l.streak >= 7) {
				add(
					"streak",
					Math.min(6, l.streak - 4),
					`Ended ${an(l.streak)}${l.streak}-game winning streak (${nm(I, l.tid)})`,
				);
			}
			if (w.won + w.lost >= 10 && l.won + l.lost >= 10) {
				const pw = (r: { won: number; lost: number }) =>
					r.won / (r.won + r.lost);
				const gap = pw(l) - pw(w);
				if (gap >= 0.2) {
					add(
						"upset",
						Math.min(10, 25 * (gap - 0.12)),
						`Upset: ${w.won}-${w.lost} ${nm(I, w.tid)} beat the ${l.won}-${l.lost} ${nm(I, l.tid)}`,
					);
				}
			}
		} else if (I.seriesState?.info.away) {
			const { home, away } = I.seriesState.info;
			const sw = home.tid === res.winTid ? home.seed : away.seed;
			const sl = home.tid === res.winTid ? away.seed : home.seed;
			if (sw - sl >= 4) {
				add("upset", Math.min(6, sw - sl), `Lower seed won (${sw} over ${sl})`);
			}
		}
	}

	// stakes carry over, and chases that fell tonight
	const C = chaseCtx(I);
	for (const c of pre.story.chases) {
		if (c.status === "broken") {
			continue;
		}
		const line = allLines(res).find((p) => p.pid === c.pid);
		if (line && known(line[c.k]) && c.cur + line[c.k] > c.record.v) {
			add(
				"milestone",
				c.scope === "league" ? 8 : 5,
				`${pl(c)} broke ${recLabel(C, c)} (${fmtN(c.cur + line[c.k])})`,
			);
		}
	}
	const stakes =
		pre.reasons.filter((r) => r.k === "stakes").reduce((s, r) => s + r.pts, 0) +
		0.5 *
			pre.reasons
				.filter((r) => r.k === "rivalry" || r.k === "revenge")
				.reduce((s, r) => s + r.pts, 0);
	if (stakes) {
		const top =
			pre.reasons.find((r) => r.k === "stakes") ??
			pre.reasons.find((r) => r.k === "rivalry" || r.k === "revenge");
		if (top) {
			const head =
				top.k === "stakes"
					? "Stakes: "
					: top.k === "revenge"
						? "Revenge game: "
						: "Rivalry: ";
			add(
				"stakes",
				0.45 * stakes,
				head +
					top.text
						.replace(/: a revenge game$/, "")
						.replace(
							/^(Both|Two|Head|Play|Game|Met|Division|Rivalry|Clinched|First)\b/,
							(w) => w.toLowerCase(),
						),
			);
		}
	}
	if (res.clinchedTitle) {
		add("stakes", 8, "Clinched the title");
	}
	return finish();
};

type Fact = { pol: number; w: number; text: string; story: boolean };

// Did the game live up to the billing? Compares the two scores and checks what the pre-game story lines promised against the box score
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
	const margin = Math.abs(res.winPts - res.losePts);
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
	if (res.overtimes > 0) {
		add(
			1,
			6,
			res.overtimes === 1
				? "it went to overtime"
				: `it took ${res.overtimes} overtimes`,
		);
	}
	if (margin >= 20) {
		add(-1, 6, `${nm(I, res.winTid)} won by ${margin}`);
	} else if (margin >= 1 && margin <= 3) {
		add(1, 5, `it was decided by ${margin}`);
	} else if (margin >= 12) {
		add(-1, 3, `${an(margin)}${margin}-point margin`);
	}
	const F = flow(res);
	if (F.ok && F.changes >= 3) {
		add(1, 3, `${F.changes} lead changes between periods`);
	}
	if (F.ok && F.deficit >= 12 && margin > 0) {
		add(1, 4, `${nm(I, res.winTid)} came back from ${F.deficit} down`);
	}
	let top: HBoxLine | null = null;
	for (const t of res.teams) {
		for (const p of t.players) {
			if (!top || p.pts > top.pts) {
				top = p;
			}
		}
	}
	if (top && top.pts >= 40) {
		add(1, 4, `${pl(top)} scored ${top.pts}`);
	} else if (top && top.pts >= 30 && post.score >= 50) {
		add(1, 2, `${pl(top)} scored ${top.pts}`);
	}

	const st = pre.story;
	story = true;
	for (const m of st.milestones) {
		const x = lineOf(m.pid);
		if (!x || !(x.p.min > 0)) {
			continue;
		}
		const got = m.before + x.p[m.k];
		if (got >= m.mark) {
			add(1, 4, `${pl(x.p)} reached ${fmtN(m.mark)} career ${m.word}`);
		} else {
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
		if (now > c.record.v) {
			add(1, 6, `${pl(c)} broke ${recLabel(C, c)}`);
		} else if (now === c.record.v) {
			add(1, 4, `${pl(c)} tied ${recLabel(C, c)}`);
		} else {
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
				add(-1, 1, `${pl(h)} cooled off (${x.p.pts} points)`);
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
	const clutch = post.reasons.find((r) => r.k === "clutch");
	if (
		clutch &&
		/game-winning|win the game|go-ahead|buzzer/i.test(clutch.text)
	) {
		add(
			1,
			5,
			`a late ${/buzzer/i.test(clutch.text) ? "buzzer-beater" : "game-winner"}`,
		);
	}
	const hist = post.reasons.find((r) => r.k === "star");
	if (hist) {
		add(
			1,
			4,
			hist.text.replace(
				/^(\[\[p:\d+\|[^\]]*]]|[^:]+?)(:| scored| hit).*$/,
				"a big line from $1",
			),
		);
	}
	if (F.ok && F.changes === 0 && margin >= 6) {
		add(-1, 1, "no lead changes between periods");
	}
	if (margin >= 6 && margin < 12 && !res.overtimes) {
		add(-1, 1, `${an(margin)}${margin}-point final margin`);
	}

	const P = pre.score;
	const Q = post.score;
	let kind: Verdict["kind"];
	if (P >= 50 && Q >= P - 10) {
		kind = "lived";
	} else if (P >= 50) {
		kind = "fizzled";
	} else if (Q >= 50 && Q - P >= 15) {
		kind = "exceeded";
	} else if (Q >= 50) {
		kind = "lived";
	} else {
		kind = "quiet";
	}
	const HEAD: Record<Verdict["kind"], string[]> = {
		lived: [
			"Lived up to the hype",
			"Delivered on the billing",
			"As good as advertised",
		],
		fizzled: ["Didn't live up to it", "Fell flat", "All hype, little payoff"],
		exceeded: [
			"Better than billed",
			"A sleeper that delivered",
			"Nobody saw this one coming",
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
		.filter((f) => f.pol === want || f.pol === 0)
		.slice(0, 2)
		.map((f) => f.text);
	if (!why.length) {
		// nothing specific to say: the game's own top ingredient, else its rating
		const first = post.reasons.find((r) => r.k !== "stakes");
		why.push(
			first
				? first.text.replace(
						/^(Decided|Final|Went|Upset|Within|Lower|Ended|Tied|Star duel|A shootout|A defensive)\b/,
						(w) => w.toLowerCase(),
					)
				: want > 0
					? `a game rating of ${Q}`
					: `a game rating of only ${Q}`,
		);
	}
	const other = sorted
		.filter(
			(f) => f.story && f.pol === -want && f.w >= 2 && !why.includes(f.text),
		)
		.sort((a, b) => b.w - a.w)[0];
	const head = pick(I.gid, 51, HEAD[kind]);
	const text = `${head}: ${why.length === 2 && !other ? `${why[0]}, and ${why[1]}` : why[0]}${other ? `, though ${other.text}` : ""}.`;
	return { kind, head, why, pre: P, post: Q, text };
};
