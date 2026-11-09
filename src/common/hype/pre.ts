// Pre-game hype: how much a game is worth watching, from what was known before tip-off.
// Every ingredient adds points (shown as a reason with its contribution); the sum is squashed to 0-100.
import { chaseText, findChases, type ChaseCtx } from "./chases.ts";
import {
	heaters,
	otherMilestones,
	pointsMilestones,
	revenge,
	revengeText,
	rookieDuel,
	roundName,
	seriesRecord,
	seriesSoFar,
} from "./story.ts";
import type {
	HGameInput,
	HStanding,
	HTeamState,
	Pre,
	Reason,
} from "./types.ts";
import { preScore } from "./calibration.ts";
import { clamp, known, label, pl } from "./util.ts";

const winPct = (w: number, l: number) => (w + 2) / (w + l + 4);

type Snap = {
	w: number;
	l: number;
	st: number;
	rank: number;
	gb: number | null;
};

// Where each of the two teams stands in its group (conference, or the league) and how far from the playoff line
const snapshot = (
	standings: HStanding[],
	teams: HTeamState[],
	P: number,
): Map<number, Snap> => {
	const out = new Map<number, Snap>();
	for (const t of teams) {
		const mine = standings.find((x) => x.tid === t.tid);
		if (!mine) {
			continue;
		}
		const list = standings
			.filter((x) => x.group === mine.group)
			.map((x) => ({ ...x, wp: winPct(x.won, x.lost) }))
			.sort((a, b) => b.wp - a.wp || b.won - a.won || a.tid - b.tid);
		const rank = list.findIndex((x) => x.tid === t.tid) + 1;
		const lineIn = list[P - 1];
		const lineOut = list[P];
		let gb: number | null = null;
		if (lineIn && lineOut) {
			const ref = rank <= P ? lineOut : lineIn;
			gb = Math.abs(mine.won - mine.lost - (ref.won - ref.lost)) / 2;
		}
		out.set(t.tid, { w: mine.won, l: mine.lost, st: t.streak, rank, gb });
	}
	return out;
};

export const chaseCtx = (I: HGameInput): ChaseCtx => ({
	season: I.season,
	numGames: I.numGames,
	records: I.records,
	teamGp: (tid) => {
		const t = I.teams.find((x) => x.tid === tid);
		return t ? t.won + t.lost + t.otl + t.tied : 0;
	},
	teamName: (tid) => I.teamName[tid] ?? "",
});

export const preHype = (I: HGameInput): Pre => {
	const reasons: Reason[] = [];
	const add = (k: string, pts: number, text: string) => {
		if (Math.abs(pts) > 0.4 && Number.isFinite(pts)) {
			reasons.push({ k, pts: Math.round(pts * 10) / 10, text });
		}
	};
	const nm = (tid: number) => I.teamName[tid] ?? "";
	const [H, A] = I.teams;
	const season = I.season;
	const R = seriesRecord(I);

	// stakes
	if (I.playoffs && !I.playIn) {
		let pts = 22;
		let text = "Playoff game";
		if (R) {
			const { info } = R;
			const frac = info.numRounds > 1 ? info.round / (info.numRounds - 1) : 1;
			pts = 20 + 18 * frac + (info.round === info.numRounds - 1 ? 8 : 0);
			text = `Game ${R.index + 1} of ${roundName(info.round, info.numRounds)}`;
			if (info.away) {
				const hi = Math.max(R.hw, R.aw);
				const lo = Math.min(R.hw, R.aw);
				if (R.hw === R.need - 1 && R.aw === R.need - 1 && R.need > 1) {
					pts += 26;
					text +=
						R.index + 1 === 2 * R.need - 1
							? ", winner takes all"
							: `: Game ${2 * R.need - 1}, winner takes all`;
				} else if (hi === R.need - 1) {
					pts += 6 + 4 * lo;
					text += `: elimination game (${hi}-${lo})`;
				} else if (hi === lo && hi > 0) {
					pts += 5;
					text += `, series tied ${hi}-${lo}`;
				} else if (hi > lo) {
					text += `, ${hi}-${lo} in the series`;
				}
			}
		}
		add("stakes", pts, text);
	} else if (I.playIn) {
		add("stakes", 24, "Play-in game: a playoff spot on the line");
	} else {
		const snap = I.standings
			? snapshot(I.standings, [H, A], I.maxPlayoffSeed)
			: null;
		const a = snap?.get(H.tid);
		const b = snap?.get(A.tid);
		if (a && b) {
			const gp = (a.w + a.l + b.w + b.l) / 2;
			const late = clamp((gp / I.numGames - 0.55) / 0.45, 0, 1);
			const q = (winPct(a.w, a.l) + winPct(b.w, b.l)) / 2;
			if (gp >= 8) {
				const both = a.w > a.l && b.w > b.l;
				const pts = (q - 0.5) * (q > 0.5 ? 55 : 45) * clamp(gp / 20, 0.4, 1);
				if (pts > 0 && both) {
					add(
						"teams",
						pts,
						`Two winning teams: ${a.w}-${a.l} vs ${b.w}-${b.l}`,
					);
				} else if (pts < 0 && a.w < a.l && b.w < b.l) {
					add(
						"teams",
						pts * (1 + 0.6 * late),
						`Two losing teams: ${a.w}-${a.l} vs ${b.w}-${b.l}`,
					);
				}
			}
			// the league's best: marquee matchups and top seed battles; its worst: tank races
			const all = (I.standings ?? [])
				.map((x) => ({ tid: x.tid, wp: winPct(x.won, x.lost) }))
				.sort((x, y) => y.wp - x.wp || x.tid - y.tid);
			const lr = (tid: number) => all.findIndex((x) => x.tid === tid) + 1;
			const n = all.length;
			if (gp >= 15 && n >= 8) {
				const ra = lr(H.tid);
				const rb = lr(A.tid);
				if (Math.max(ra, rb) <= 4) {
					add(
						"marquee",
						8 - Math.max(ra, rb) + 1,
						`Marquee matchup: two of the league's top four (${a.w}-${a.l} and ${b.w}-${b.l})`,
					);
				} else if (a.rank <= 2 && b.rank <= 2 && late > 0.3) {
					add("stakes", 6 * late, "Battle for the top seed");
				}
				if (Math.min(ra, rb) > n - 3 && late > 0.4) {
					add(
						"stakes",
						3,
						"Tank race: two of the league's three worst records, lottery odds at stake",
					);
				}
			}
			// late in the season: games that can settle a playoff spot, and games that settle nothing
			if (late > 0.5) {
				const fate = (tid: number, r: Snap) => {
					const left = I.numGames - (r.w + r.l);
					if (r.gb === null) {
						return null;
					}
					if (r.gb > left) {
						return r.rank <= I.maxPlayoffSeed ? "in" : "out";
					}
					if (r.gb >= left - 1) {
						return r.rank <= I.maxPlayoffSeed ? "clinch" : "elim";
					}
					return "open";
				};
				const fa = fate(H.tid, a);
				const fb = fate(A.tid, b);
				if (
					(fa === "in" || fa === "out") &&
					(fb === "in" || fb === "out") &&
					!(a.rank <= 2 && b.rank <= 2)
				) {
					add(
						"stakes",
						-10 * late,
						"Little at stake: both teams' playoff fates are settled",
					);
				}
				for (const [tid, f] of [
					[H.tid, fa],
					[A.tid, fb],
				] as const) {
					if (f === "clinch") {
						add("stakes", 5, `The ${nm(tid)} can close in on a playoff spot`);
					} else if (f === "elim") {
						add(
							"stakes",
							5,
							`The ${nm(tid)} are on the brink of playoff elimination`,
						);
					}
				}
			}
			const race = [
				{ tid: H.tid, r: a },
				{ tid: A.tid, r: b },
			].filter((x) => x.r.gb !== null && x.r.gb <= 3);
			if (race.length && late > 0) {
				const tight = Math.min(...race.map((x) => x.r.gb!));
				add(
					"stakes",
					late * (8 + 4 * race.length) * (1 - tight / 4),
					`${race.length === 2 ? "Both teams" : nm(race[0]!.tid)} within ${tight === 0 ? "a game" : `${tight} game${tight === 1 ? "" : "s"}`} of the playoff line, late in the season`,
				);
			}
			if (
				late > 0 &&
				Math.abs(a.w - a.l - (b.w - b.l)) <= 2 &&
				q > 0.5 &&
				gp / I.numGames > 0.6
			) {
				add(
					"stakes",
					4 * late,
					"Head-to-head for seeding (records within a game)",
				);
			}
		}
		for (const t of [H, A]) {
			if (Math.abs(t.streak) >= 5) {
				add(
					"streak",
					Math.min(8, Math.abs(t.streak) - 2),
					`${nm(t.tid)} have ${t.streak > 0 ? "won" : "lost"} ${Math.abs(t.streak)} straight`,
				);
			}
		}
	}

	// rivalry: playoff series of the two franchises before this season
	const meets = I.series
		.filter(
			(s) =>
				!s.playIn &&
				s.away &&
				s.season < season &&
				((s.home.tid === H.tid && s.away.tid === A.tid) ||
					(s.home.tid === A.tid && s.away.tid === H.tid)),
		)
		.sort((x, y) => x.season - y.season);
	if (meets.length) {
		const recent = meets.filter((x) => x.season >= season - 5);
		const lastYear = meets.find((x) => x.season === season - 1);
		let pts =
			Math.min(14, 2 * meets.length + 3 * recent.length) + (lastYear ? 4 : 0);
		if (I.playoffs && meets.some((x) => x.season >= season - 3)) {
			pts += 3;
		}
		const n = meets.length;
		add(
			"rivalry",
			pts,
			`Met ${n === 1 ? "once" : `${n} times`} in the playoffs before (last in ${meets.at(-1)!.season})${lastYear ? `, a rematch of last year's ${lastYear.round === lastYear.numRounds - 1 ? "Finals" : "series"}` : ""}`,
		);
	}
	if (H.did === A.did && H.cid === A.cid && H.did >= 0) {
		add("rivalry", 2, "Division rivals");
	}

	// star power
	const cut = I.starCut;
	if (cut !== null && Number.isFinite(cut)) {
		const stars = I.players
			.flat()
			.filter((p) => p.ovr !== null && p.ovr >= cut)
			.sort((x, y) => y.ovr! - x.ovr! || x.pid - y.pid);
		if (stars.length) {
			const sides = new Set(stars.map((x) => x.tid)).size;
			if (stars[0]!.ovr! >= cut + 7) {
				add("stars", 5, `Superstar: ${pl(stars[0]!)} (${stars[0]!.ovr})`);
			}
			if (sides === 2) {
				add("stars", 4, "Stars on both sides");
			}
			add(
				"stars",
				Math.min(14, 4 * stars.length),
				`Star power: ${stars
					.slice(0, 3)
					.map((x) => `${pl(x)} (${x.ovr})`)
					.join(", ")}${stars.length > 3 ? ` +${stars.length - 3}` : ""}`,
			);
		}
	}
	if (H.ovr !== null && A.ovr !== null) {
		const lo = Math.min(H.ovr, A.ovr);
		if (lo >= 60) {
			add(
				"stars",
				Math.min(6, (lo - 58) / 2),
				`Two strong rosters (team ovr ${H.ovr} and ${A.ovr})`,
			);
		}
	}

	if (!I.playoffs && !I.playIn) {
		for (const t of [H, A]) {
			if (t.b2b) {
				add(
					"rest",
					-2,
					`The ${nm(t.tid)} are on the second night of a back-to-back`,
				);
			}
		}
		if (I.day === 1) {
			add("stakes", 4, "Opening night");
		}
	}
	if (cut !== null && Number.isFinite(cut)) {
		const outStars = I.out
			.filter((p) => p.ovr >= cut)
			.sort((x, y) => y.ovr - x.ovr || x.pid - y.pid);
		if (outStars.length) {
			add(
				"injury",
				-Math.min(
					18,
					outStars.reduce((s, p) => s + 6 + (p.ovr - cut) * 0.5, 0),
				),
				`Out injured: ${outStars
					.slice(0, 3)
					.map((p) => `${pl(p)} (${p.ovr})`)
					.join(", ")}`,
			);
		}
	}

	// milestones and heaters
	const story: Pre["story"] = {
		milestones: [],
		chases: [],
		heaters: [],
		revenge: [],
		rookies: null,
	};
	if (!I.playoffs && !I.playIn) {
		for (const m of pointsMilestones(I)) {
			add("milestone", 6, `Milestone watch: ${m.text}`);
			story.milestones.push(m);
		}
		for (const m of otherMilestones(I)) {
			add("milestone", 4, `Milestone watch: ${m.text}`);
			story.milestones.push(m);
		}
	}
	for (const h of heaters(I)) {
		add("heater", 5, h.text);
		story.heaters.push(h);
	}

	// record chases (regular season)
	if (!I.playoffs && !I.playIn) {
		const C = chaseCtx(I);
		const x = findChases(C, I.players.flat()).slice(0, 2);
		for (const c of x) {
			add("chase", c.pts, chaseText(C, c, I.gid));
			story.chases.push(c);
		}
	}

	// revenge games and rookie duels
	for (const r of revenge(I)) {
		add("revenge", r.pts, revengeText(I, r));
		story.revenge.push(r);
	}
	const rk = rookieDuel(I);
	if (rk) {
		add("rookies", rk.pts, rk.text);
		story.rookies = rk;
	}

	// revenge: the opponent knocked this team out of last season's playoffs
	const lastS = meets.filter((x) => x.season === season - 1).at(-1);
	if (lastS?.away) {
		const homeWon = lastS.home.won > lastS.away.won;
		const winTid = homeWon ? lastS.home.tid : lastS.away.tid;
		const loseTid = homeWon ? lastS.away.tid : lastS.home.tid;
		if (
			known(winTid) &&
			(winTid === H.tid || winTid === A.tid) &&
			(loseTid === H.tid || loseTid === A.tid) &&
			lastS.home.won !== lastS.away.won
		) {
			add(
				"revenge",
				I.playoffs ? 3 : 4,
				`${nm(loseTid)} were knocked out by the ${nm(winTid)} last season: a revenge game`,
			);
		}
	}

	const raw = reasons.reduce((s, r) => s + r.pts, 0);
	reasons.sort(
		(x, y) => Math.abs(y.pts) - Math.abs(x.pts) || (x.text < y.text ? -1 : 1),
	);
	const score = preScore(raw);
	return {
		score,
		raw: Math.round(raw * 10) / 10,
		label: label(score),
		reasons,
		story,
		series: seriesSoFar(I),
	};
};
