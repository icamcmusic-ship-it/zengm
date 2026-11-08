// Paragraph builders for the long front-page features. Each takes one subject (a player, a team, a trade) and returns a paragraph of facts in one of several seeded phrasings, or nothing when the data cannot support it. The same builders serve the champion arcs and the team edition.

import type { Ctx } from "./ctx.ts";
import type { Rng } from "./text.ts";
import {
	aOrAn,
	andList,
	capFirst,
	fmt1,
	ordinal,
	plural,
	poss,
	record,
	signed,
	winp,
} from "./text.ts";
import type { NPFeat, NPPlayer, NPTeam, NPTrade, Seg } from "./types.ts";
import { seriesOf, sides } from "./front.ts";

export type Para = { kids: Seg[]; keys: string[] };

const lastName = (n: string) => {
	const xs = n.replace(/\s+(Jr\.?|Sr\.?|II|III|IV)$/, "").split(/\s+/);
	return xs.at(-1) ?? n;
};

const pick = <T>(
	r: Rng,
	xs: (T | null | undefined | false)[],
): T | undefined => {
	const ok = xs.filter(
		(x): x is T => x !== null && x !== undefined && x !== false,
	);
	return ok.length > 0 ? r.pick(ok) : undefined;
};

const join = (parts: (Seg[] | undefined)[]): Seg[] =>
	parts.flatMap((p) => (p ? [...p, " "] : []));

// ---- Players -----------------------------------------------------------------

export const playerSeason = (c: Ctx, pid: number, r: Rng): Para | undefined => {
	const p = c.player(pid);
	if (!p || p.gp < 5) {
		return undefined;
	}
	const t = c.team(p.tid);
	const tn = t?.name ?? "team";
	const ln = lastName(p.name);
	const kp = c.statRank(pid, "pts");
	const kw = c.statRank(pid, "ws");
	const yrs = p.career ? p.career.seasons + 1 : undefined;
	const lw = c.lineWords(p);
	const s1 = pick<Seg[]>(r, [
		yrs !== undefined
			? [
					c.pl(pid),
					`, ${p.age}, ${c.R("is", "was")} in his ${ordinal(yrs)} season, ${c.R("playing", "playing")} for the ${tn}. `,
				]
			: undefined,
		[
			`At ${p.age}, `,
			c.pl(pid),
			` ${c.R("is playing", "played")} ${plural(p.gp, "game")} for the ${tn}${c.R(" so far", "")}. `,
		],
		[
			c.pl(pid),
			` of the ${tn} (${p.age}) ${c.R("has played", "played")} ${plural(p.gp, "game")}${c.R(" so far this season", " this season")}. `,
		],
	])!;
	const s2 = pick<Seg[]>(r, [
		[
			`${capFirst(c.R("he is averaging ", "he averaged "))}${lw}${kp && kp <= 20 ? `, ${kp === 1 ? "the league's best scoring average" : `${ordinal(kp)} in the league in scoring`}` : ""}. `,
		],
		[
			`The line: ${lw}${kp && kp <= 20 ? ` (${ordinal(kp)} in scoring)` : ""}. `,
		],
		[
			`${ln} ${c.R("is putting up", "put up")} ${lw} a game${kp && kp <= 10 ? `; ${kp > 1 ? `only ${plural(kp - 1, "player")} scored more` : "nobody scored more"}` : ""}. `,
		],
	])!;
	const s3: Seg[] | undefined =
		kw && kw <= 30 && p.ws > 0
			? (pick<Seg[]>(r, [
					[
						`${poss(ln)} ${fmt1(p.ws)} win shares ${c.R("rank", "ranked")} ${ordinal(kw)} in the league. `,
					],
					[
						`By win shares (${fmt1(p.ws)}) he ${c.R("is", "was")} the league's ${kw === 1 ? "most productive player" : `${ordinal(kw)}-most productive player`}. `,
					],
				]) ?? undefined)
			: undefined;
	const pl = p.prevLine;
	let s4: Seg[] | undefined;
	if (pl && pl.gp >= 10) {
		const d = p.pts - pl.pts;
		s4 =
			Math.abs(d) < 0.5
				? [
						`His scoring held steady from ${c.season - 1} (${fmt1(pl.pts)} a game). `,
					]
				: [
						pick<string>(r, [
							`That is ${d > 0 ? "up" : "down"} from ${fmt1(pl.pts)} points a game in ${c.season - 1}. `,
							`In ${c.season - 1} he averaged ${fmt1(pl.pts)} points, ${fmt1(Math.abs(d))} ${d > 0 ? "fewer" : "more"} than now. `,
						])!,
					];
	}
	const kids = [
		...s1,
		...s2,
		...(r.chance(0.5)
			? [...(s3 ?? []), ...(s4 ?? [])]
			: [...(s4 ?? []), ...(s3 ?? [])]),
	];
	return { kids, keys: [fmt1(p.pts)] };
};

export const playerCareer = (c: Ctx, pid: number, r: Rng): Para | undefined => {
	const p = c.player(pid);
	if (!p?.career || p.career.seasons < 2 || p.career.pts <= 0) {
		return undefined;
	}
	const inc = c.regDone;
	const tot = {
		pts: Math.round(p.career.pts + (inc ? p.pts * p.gp : 0)),
		gp: p.career.gp + (inc ? p.gp : 0),
		n: p.career.seasons + (inc ? 1 : 0),
	};
	const h = p.honors;
	const hon: string[] = [];
	if (h?.mvp) {
		hon.push(h.mvp === 1 ? "an MVP award" : plural(h.mvp, "MVP award"));
	}
	if (h?.allStar) {
		hon.push(
			h.allStar === 1
				? "an All-Star selection"
				: plural(h.allStar, "All-Star selection"),
		);
	}
	if (h?.allLeague && !h.mvp) {
		hon.push(
			h.allLeague === 1
				? "an All-League team"
				: plural(h.allLeague, "All-League team"),
		);
	}
	if (h?.titles) {
		hon.push(
			h.titles === 1 ? "a championship" : plural(h.titles, "championship"),
		);
	}
	const honTxt =
		hon.length === 0
			? ""
			: hon.length === 1
				? hon[0]!
				: `${hon.slice(0, -1).join(", ")} and ${hon.at(-1)}`;
	const through = inc ? `through ${c.season}` : "so far";
	const ppg = tot.gp ? tot.pts / tot.gp : undefined;
	const kids = pick<Seg[]>(r, [
		[
			`${capFirst(through)}, `,
			c.pl(pid),
			` has ${tot.pts.toLocaleString("en-US")} career points in ${plural(tot.n, "season")}${honTxt ? `, with ${honTxt} before this season` : ""}. `,
		],
		[
			`${poss(p.name)} career to date: ${plural(tot.n, "season")}, ${plural(tot.gp, "game")}, ${tot.pts.toLocaleString("en-US")} points${ppg ? ` (${fmt1(ppg)} a game)` : ""}${honTxt ? `; ${honTxt} earlier` : ""}. `,
		],
		[
			`${poss(lastName(p.name))} ${tot.n}-season career ${inc ? "stands at" : "has reached"} ${tot.pts.toLocaleString("en-US")} points${honTxt ? `, with ${honTxt} before this year` : ""}. `,
		],
	])!;
	return { kids, keys: [tot.pts.toLocaleString("en-US")] };
};

// A player's best night: the biggest feat of the season, else his highest-scoring game on file
export const bestFeat = (
	c: Ctx,
	pid?: number,
	tid?: number,
): NPFeat | undefined => {
	const score = (f: NPFeat) =>
		f.pts + 1.2 * f.trb + 1.5 * f.ast + 2 * (f.stl + f.blk);
	return c.f.feats
		.filter(
			(f) =>
				(pid !== undefined ? f.pid === pid : f.tid === tid) &&
				(c.done || !f.playoffs),
		)
		.toSorted((a, b) => score(b) - score(a) || a.gid - b.gid)[0];
};

const featWords = (f: NPFeat) => {
	const xs = [plural(f.pts, "point")];
	if (f.trb >= 8) {
		xs.push(`${f.trb} rebounds`);
	}
	if (f.ast >= 6) {
		xs.push(`${f.ast} assists`);
	}
	if (f.stl >= 4) {
		xs.push(`${f.stl} steals`);
	}
	if (f.blk >= 4) {
		xs.push(`${f.blk} blocks`);
	}
	return xs.length === 1
		? xs[0]!
		: `${xs.slice(0, -1).join(", ")} and ${xs.at(-1)}`;
};

export const playerNight = (c: Ctx, pid: number, r: Rng): Para | undefined => {
	const p = c.player(pid);
	const f = bestFeat(c, pid);
	if (p && f && f.pts > 0) {
		const ln = lastName(p.name);
		const opp = c.team(f.oppTid) ? c.tn(f.oppTid) : undefined;
		const res = `${f.result === "W" ? "win" : f.result === "L" ? "loss" : "tie"}`;
		const kids = pick<Seg[]>(r, [
			[
				`${poss(ln)} best night ${c.R("so far ", "")}came ${opp ? `against the ${opp}` : "in one game"}${f.playoffs ? " in the playoffs" : ""}: `,
				c.gl(f.gid, f.tid, featWords(f)),
				`, in ${aOrAn(f.score)} ${res}. `,
			],
			[
				opp ? `Against the ${opp}, ` : "One night, ",
				`${ln} had `,
				c.gl(f.gid, f.tid, featWords(f)),
				` in ${aOrAn(f.score)} ${res}. `,
			],
			[
				`The high point for ${ln}: `,
				c.gl(f.gid, f.tid, featWords(f)),
				opp ? ` against the ${opp}` : "",
				`, ${aOrAn(f.score)} ${res}. `,
			],
		])!;
		return { kids, keys: [`${f.pts} points`] };
	}
	if (p?.hi && p.hi >= 25) {
		return {
			kids: [
				`${poss(lastName(p.name))} ${c.R("season high is", "season high was")} ${p.hi} points${p.g30 ? `, one of ${plural(p.g30, "game")} of 30 or more` : ""}. `,
			],
			keys: [`${p.hi} points`],
		};
	}
	return undefined;
};

// Where his numbers rank in the league this season
export const playerRank = (c: Ctx, pid: number, r: Rng): Para | undefined => {
	const p = c.player(pid);
	if (!p || p.gp < 10) {
		return undefined;
	}
	const stats = [
		["pts", "scoring"],
		["trb", "rebounding"],
		["ast", "assists"],
		["stl", "steals"],
		["blk", "blocks"],
		["per", "efficiency"],
	] as const;
	const ranks: { label: string; rank: number }[] = [];
	for (const [k, label] of stats) {
		const rank = c.statRank(pid, k);
		if (rank !== undefined && rank <= 10) {
			ranks.push({ label, rank });
		}
	}
	ranks.sort((a, b) => a.rank - b.rank);
	ranks.splice(3);
	if (ranks.length < 2) {
		return undefined;
	}
	const list = ranks.map((x) => `${ordinal(x.rank)} in ${x.label}`);
	const joined =
		list.length === 2
			? `${list[0]} and ${list[1]}`
			: `${list[0]}, ${list[1]} and ${list[2]}`;
	const kids = pick<string>(r, [
		`Among qualified players ${lastName(p.name)} ${c.R("ranks", "ranked")} ${joined}. `,
		`Across the league he ${c.R("is", "was")} ${joined}. `,
	])!;
	return { kids: [kids], keys: [] };
};

export const playerShare = (c: Ctx, pid: number, r: Rng): Para | undefined => {
	const p = c.player(pid);
	if (!p || p.ws <= 0) {
		return undefined;
	}
	const mates = c.teamPlayers(p.tid).filter((x) => x.ws > 0 || x.pid === pid);
	const tot = mates.reduce((a, x) => a + x.ws, 0);
	if (tot <= 5) {
		return undefined;
	}
	const next = mates
		.filter((x) => x.pid !== pid)
		.toSorted((a, b) => b.ws - a.ws)[0];
	const pc = Math.round((100 * p.ws) / tot);
	const tn = c.tn(p.tid);
	const top = !next || p.ws >= next.ws;
	const kids = top
		? pick<Seg[]>(r, [
				[
					`He ${c.R("accounts", "accounted")} for ${pc}% of the ${poss(tn)} win shares (${fmt1(p.ws)} of ${fmt1(tot)})${next ? "; the next-best teammate, " : ". "}`,
					...(next
						? [c.pl(next.pid), `, ${c.R("has", "had")} ${fmt1(next.ws)}. `]
						: []),
				],
				[
					`${fmt1(p.ws)} of the ${poss(tn)} ${fmt1(tot)} win shares ${c.R("are", "were")} his, ${pc}% of the total${next ? ". Next on the roster: " : ". "}`,
					...(next ? [c.pl(next.pid), ` (${fmt1(next.ws)}). `] : []),
				],
			])!
		: [
				`His ${fmt1(p.ws)} win shares ${c.R("are", "were")} ${pc}% of the ${poss(tn)} total; `,
				c.pl(next!.pid),
				` ${c.R("leads", "led")} the roster with ${fmt1(next!.ws)}. `,
			];
	return { kids, keys: [`${pc}%`] };
};

export const playerRace = (c: Ctx, pid: number, r: Rng): Para | undefined => {
	const q = c.qual.toSorted((a, b) => b.pts - a.pts);
	const k = q.findIndex((x) => x.pid === pid);
	if (k < 0 || k > 9 || q.length < 10) {
		return undefined;
	}
	const v = (x: NPPlayer) => fmt1(x.pts);
	const up = q[k - 1];
	const dn = q[k + 1];
	const kids: Seg[] =
		k === 0
			? pick<Seg[]>(r, [
					[
						`He ${c.R("leads", "led")} the league in scoring, ahead of `,
						c.pl(q[1]!.pid),
						` (${v(q[1]!)}) and `,
						c.pl(q[2]!.pid),
						` (${v(q[2]!)}). `,
					],
					[
						`Nobody ${c.R("scores", "scored")} more: the next two in the scoring race ${c.R("are", "were")} `,
						c.pl(q[1]!.pid),
						` at ${v(q[1]!)} and `,
						c.pl(q[2]!.pid),
						` at ${v(q[2]!)}. `,
					],
				])!
			: pick<Seg[]>(r, [
					[
						`In the scoring race he ${c.R("sits", "ranked")} ${ordinal(k + 1)}, behind `,
						c.pl(up!.pid),
						` (${v(up!)})${dn ? " and ahead of " : ". "}`,
						...(dn ? [c.pl(dn.pid), ` (${v(dn)}). `] : []),
					],
					[
						`${capFirst(ordinal(k + 1))} in scoring: `,
						c.pl(up!.pid),
						` ${c.R("is", "was")} one place above him at ${v(up!)}. `,
					],
				])!;
	return { kids, keys: [] };
};

// ---- Teams ---------------------------------------------------------------------

const gbOf = (a: NPTeam, b: NPTeam) => (a.won - b.won + (b.lost - a.lost)) / 2;
const gbWords = (v: number) =>
	`${Math.abs(v) % 1 ? Math.abs(v).toFixed(1) : Math.abs(v)} ${Math.abs(v) === 1 ? "game" : "games"}`;
// "3 games behind", or "level with them" when there is no gap
const behind = (v: number) =>
	v === 0 ? "level with them" : `${gbWords(v)} behind`;

export const teamSeason = (c: Ctx, tid: number, r: Rng): Para | undefined => {
	const t = c.team(tid);
	if (!t || t.gp === 0) {
		return undefined;
	}
	const k = c.rank(tid);
	const nT = c.rows.length;
	const rec = record(t);
	const d = c.regDone && t.prev ? t.won - t.prev.won : undefined;
	const place =
		k === 0
			? ""
			: k === 1
				? `the best record of ${nT} teams`
				: k === nT
					? `the worst record of ${nT} teams`
					: k > nT / 2
						? `the ${ordinal(nT - k + 1)}-worst record of ${nT} teams`
						: `${ordinal(k)} of ${nT} teams`;
	const pd =
		t.pts !== undefined && t.oppPts !== undefined
			? t.pts - t.oppPts
			: undefined;
	const s1 = c.regDone
		? pick<Seg[]>(r, [
				[
					"The ",
					c.tl(tid, c.tfull(tid)),
					` went ${rec}${place ? `, ${place}` : ""}${d !== undefined && d !== 0 ? `, ${d > 0 ? `${plural(d, "win")} better` : `${plural(-d, "win")} worse`} than ${c.season - 1} (${record(t.prev!)})` : ""}. `,
				],
				place
					? [
							`At ${rec}, the `,
							c.tl(tid, c.tfull(tid)),
							` had ${k === 1 ? "the league's best record" : `the ${place}`}${d !== undefined ? (d === 0 ? ", the same win total as a year earlier" : `; a year earlier they were ${record(t.prev!)}`) : ""}. `,
						]
					: undefined,
				[
					`${capFirst(t.name)}, ${c.season}: ${rec}${place ? `, ${place}` : ""}${d !== undefined && d !== 0 ? `, ${d > 0 ? "up" : "down"} ${plural(Math.abs(d), "win")} on the year before` : ""}. `,
				],
			])!
		: pick<Seg[]>(r, [
				[
					"The ",
					c.tl(tid, c.tfull(tid)),
					` are ${rec} after ${plural(t.gp, "game")}${place ? `, ${place}` : ""}. `,
				],
				[
					`After ${t.gp} games the `,
					c.tl(tid, c.tfull(tid)),
					` stand at ${rec}${place ? ` (${place})` : ""}. `,
				],
			])!;
	const s2: Seg[] | undefined =
		pd !== undefined
			? pd < 0
				? [
						`${c.R("Opponents are outscoring the " + t.name + " by ", "Opponents outscored the " + t.name + " by ")}${fmt1(-pd)} points a game. `,
					]
				: [
						pick<string>(r, [
							`The ${t.name} ${c.R("are outscoring", "outscored")} opponents by ${fmt1(pd)} points a game. `,
							`${capFirst(poss(t.name))} point differential ${c.R("is", "was")} ${signed(pd)} a game. `,
						])!,
					]
			: undefined;
	const hr: Seg[] | undefined =
		t.wonHome + t.lostHome > 0 && t.wonAway + t.lostAway > 0
			? [
					pick<string>(r, [
						`The ${t.name} ${c.R("are", "went")} ${t.wonHome}-${t.lostHome} at home and ${t.wonAway}-${t.lostAway} on the road. `,
						`${capFirst(poss(t.name))} home record ${c.R("is", "was")} ${t.wonHome}-${t.lostHome}; on the road, ${t.wonAway}-${t.lostAway}. `,
					])!,
				]
			: undefined;
	const kids = [...s1, ...(s2 ?? []), ...(hr ?? [])];
	return { kids, keys: [rec] };
};

export const teamRace = (c: Ctx, tid: number, r: Rng): Para | undefined => {
	const rows = c.rows;
	const k = rows.findIndex((x) => x.tid === tid);
	if (k < 0 || rows.length < 6) {
		return undefined;
	}
	const me = rows[k]!;
	const up = rows[k - 1];
	const dn = rows[k + 1];
	const tl = (x: NPTeam) => c.tl(x.tid);
	const kids: Seg[] =
		k === 0
			? pick<Seg[]>(r, [
					[
						`The closest pursuers ${c.R("are", "were")} the `,
						tl(rows[1]!),
						` (${record(rows[1]!)}, ${gbOf(me, rows[1]!) === 0 ? "level" : `${gbWords(gbOf(me, rows[1]!))} back`}) and the `,
						tl(rows[2]!),
						` (${record(rows[2]!)}). `,
					],
					[
						`Nobody ${c.R("has", "had")} a better record; the `,
						tl(rows[1]!),
						` ${c.R("are", "were")} next at ${record(rows[1]!)}, ${behind(gbOf(me, rows[1]!))}. `,
					],
				])!
			: pick<Seg[]>(r, [
					up && gbOf(up, me) > 0
						? [
								`In the league table they ${c.R("sit", "stood")} ${gbWords(gbOf(up, me))} behind the `,
								tl(up),
								` (${record(up)})${dn ? ` and ${gbWords(gbOf(me, dn))} ahead of the ` : ". "}`,
								...(dn ? [tl(dn), ` (${record(dn)}). `] : []),
							]
						: undefined,
					[
						`Just above them ${c.R("are", "were")} the `,
						tl(up!),
						` at ${record(up!)}${dn ? "; just below, the " : ". "}`,
						...(dn ? [tl(dn), ` at ${record(dn)}. `] : []),
					],
					[
						`The best record in the league ${c.R("belongs", "belonged")} to the `,
						tl(rows[0]!),
						` (${record(rows[0]!)}), ${gbWords(gbOf(rows[0]!, me))} ahead of them. `,
					],
				])!;
	return { kids, keys: [] };
};

export const teamCore = (c: Ctx, tid: number, r: Rng): Para | undefined => {
	const tl3 = c
		.teamPlayers(tid)
		.filter((x) => x.gp >= 5)
		.slice(0, 3);
	if (tl3.length < 3 || tl3[0]!.ws <= 1) {
		return undefined;
	}
	const it = (x: NPPlayer): Seg[] => [
		c.pl(x.pid),
		` (${fmt1(x.ws)} win shares, ${fmt1(x.pts)} points a game)`,
	];
	const list: Seg[] = [
		...it(tl3[0]!),
		", ",
		...it(tl3[1]!),
		" and ",
		...it(tl3[2]!),
	];
	const tn = c.tn(tid);
	const lead = pick<string>(r, [
		`Three players ${c.R("are carrying", "carried")} the ${tn}: `,
		`The ${poss(tn)} top three by win shares: `,
		`For the ${tn}, most of the work ${c.R("comes", "came")} from `,
	])!;
	return {
		kids: [lead, ...list, ". "],
		keys: [`${fmt1(tl3[0]!.ws)} win shares`],
	};
};

export const teamNight = (c: Ctx, tid: number, r: Rng): Para | undefined => {
	const f = bestFeat(c, undefined, tid);
	if (f && f.pts > 0) {
		const opp = c.team(f.oppTid) ? c.tn(f.oppTid) : undefined;
		const kids = pick<Seg[]>(r, [
			[
				`Their best individual night ${c.R("so far ", "")}came ${opp ? `against the ${opp}` : "in one game"}: `,
				c.pl(f.pid, f.name),
				` had `,
				c.gl(f.gid, f.tid, featWords(f)),
				`. `,
			],
			[
				opp ? `Against the ${opp}, ` : "One night, ",
				c.pl(f.pid, f.name),
				` put up `,
				c.gl(f.gid, f.tid, featWords(f)),
				`. `,
			],
		])!;
		return { kids, keys: [`${f.pts} points`] };
	}
	const mine = c.f.games.filter((g) => g.won.tid === tid || g.lost.tid === tid);
	const star = mine
		.flatMap((g) => g.stars.filter((s) => s.tid === tid).map((s) => ({ s, g })))
		.toSorted((a, b) => b.s.pts - a.s.pts)[0];
	if (star && star.s.pts >= 25) {
		return {
			kids: [
				`Their top scoring night on file: `,
				c.pl(star.s.pid, star.s.name),
				`, ${star.s.pts} points. `,
			],
			keys: [`${star.s.pts} points`],
		};
	}
	return undefined;
};

export const teamHistory = (c: Ctx, tid: number, r: Rng): Para | undefined => {
	const t = c.team(tid);
	if (!t || t.gp === 0 || !c.regDone || !t.hist || t.hist.length < 5) {
		return undefined;
	}
	const past = t.hist.toSorted((a, b) => b.season - a.season);
	const better = past.find((x) => winp(x) > winp(t));
	const worse = past.find((x) => winp(x) < winp(t));
	const tn = t.name;
	const out: string[] = [];
	if (!better) {
		out.push(
			pick<string>(r, [
				`It was the best record in ${plural(past.length + 1, "season")} of franchise history. `,
				`No ${tn} team in ${plural(past.length + 1, "season")} had a better record. `,
			])!,
		);
	} else if (!worse) {
		out.push(
			pick<string>(r, [
				`It was the worst record in ${plural(past.length + 1, "season")} of franchise history. `,
				`No ${tn} team in ${plural(past.length + 1, "season")} had a worse record. `,
			])!,
		);
	} else if (winp(t) >= 0.5 && c.season - better.season >= 3) {
		out.push(
			pick<string>(r, [
				`It was the franchise's best record since ${better.season} (${record(better)}). `,
				`They had not done better since ${better.season}, when they went ${record(better)}. `,
			])!,
		);
	} else if (winp(t) < 0.5 && c.season - worse.season >= 3) {
		out.push(
			pick<string>(r, [
				`It was the franchise's worst record since ${worse.season} (${record(worse)}). `,
				`They had not been this bad since ${worse.season} (${record(worse)}). `,
			])!,
		);
	}
	const titles = t.titles.length + (c.done && c.f.champion === tid ? 1 : 0);
	if (titles > 0 && c.done && c.f.champion === tid) {
		out.push(
			titles === 1
				? "It is the franchise's first title. "
				: `The franchise now has ${plural(titles, "title")}${t.titles.at(-1) ? `; the one before came in ${t.titles.at(-1)}` : ""}. `,
		);
	}
	return out.length > 0 ? { kids: [out.join("")], keys: [] } : undefined;
};

// The team's playoffs: the whole run once it is over, the finished series and the live one during the playoffs, and the race before them
export const teamPost = (c: Ctx, tid: number, r: Rng): Para | undefined => {
	const t = c.team(tid);
	if (!t || t.gp === 0) {
		return undefined;
	}
	const tn = t.name;
	const path = seriesOf(c, tid);
	const step = (
		round: number,
		opp: number,
		w: number,
		l: number,
		won: boolean,
	) =>
		won
			? pick<string>(r, [
					`beat the ${c.tn(opp)} ${w}-${l} in the ${c.roundPhrase(round)}`,
					`got past the ${c.tn(opp)} in the ${c.roundPhrase(round)}, ${w}-${l}`,
				])!
			: pick<string>(r, [
					`lost ${l}-${w} to the ${c.tn(opp)} in the ${c.roundPhrase(round)}`,
					`went out against the ${c.tn(opp)} in the ${c.roundPhrase(round)}, ${l}-${w}`,
				])!;
	if (c.done) {
		if (t.playoffRoundsWon < 0 || path.length === 0) {
			return undefined;
		}
		const steps = path
			.map(({ s, round }) => {
				const { me, opp } = sides(s, tid);
				return opp && me
					? step(round, opp.tid, me.won, opp.won, t.playoffRoundsWon > round)
					: undefined;
			})
			.filter((x): x is string => x !== undefined);
		if (steps.length === 0) {
			return undefined;
		}
		const list =
			steps.length === 1
				? steps[0]!
				: `${steps.slice(0, -1).join(", ")}${steps.length > 2 ? "," : ""} and then ${steps.at(-1)}`;
		const lead = pick<string>(r, [
			`In the playoffs the ${tn} ${list}. `,
			`The postseason: the ${tn} ${list}. `,
			`Then came the playoffs, where the ${tn} ${list}. `,
		])!;
		const star = c.f.players
			.filter((p) => p.tid === tid && p.po && p.po.gp >= 3)
			.toSorted((a, b) => b.po!.pts - a.po!.pts)[0];
		return {
			kids: [
				lead,
				...(star?.po
					? [
							pick<string>(r, [
								"Their top playoff scorer was ",
								"Their leading playoff scorer: ",
							])!,
							c.pl(star.pid),
							` (${fmt1(star.po.pts)} points a game in ${plural(star.po.gp, "game")}). `,
						]
					: []),
			],
			keys: [],
		};
	}
	if (c.inPlayoffs) {
		if (path.length === 0) {
			return undefined;
		}
		const out: string[] = [];
		for (const { s, round } of path) {
			const { me, opp } = sides(s, tid);
			if (!opp || !me) {
				continue;
			}
			const rd = c.roundPhrase(round);
			if (round < c.f.currentRound) {
				out.push(step(round, opp.tid, me.won, opp.won, me.won > opp.won));
			} else if (me.won === opp.won) {
				out.push(
					`are level ${me.won}-${opp.won} with the ${c.tn(opp.tid)} in the ${rd}`,
				);
			} else {
				out.push(
					`${me.won > opp.won ? "lead" : "trail"} the ${c.tn(opp.tid)} ${Math.max(me.won, opp.won)}-${Math.min(me.won, opp.won)} in the ${rd}`,
				);
			}
		}
		return out.length > 0
			? {
					kids: [
						`In the playoffs so far the ${tn} ${out.length === 1 ? out[0] : `${out.slice(0, -1).join(", ")} and ${out.at(-1)}`}. `,
					],
					keys: [],
				}
			: undefined;
	}
	if (c.mid) {
		const rows = c.rows;
		const k = rows.findIndex((x) => x.tid === tid);
		if (k < 0 || rows.length < 4) {
			return undefined;
		}
		const left = c.f.numGames - t.gp;
		const g = k > 0 ? gbOf(rows[0]!, t) : gbOf(t, rows[1]!);
		const lead =
			k === 0
				? g > 0
					? `${aOrAn(gbWords(g))} lead for the league's best record`
					: "a share of the league's best record"
				: g > 0
					? `${gbWords(g)} of ground to make up on the ${c.tn(rows[0]!.tid)} for the best record`
					: "a share of the league's best record";
		return {
			kids: [
				pick<string>(r, [
					`${left > 0 ? `${plural(left, "game")} remain on the ${poss(tn)} schedule` : "The schedule goes on"}, and they have ${lead}. `,
					`With ${left > 0 ? `${plural(left, "game")} to play` : "the season still running"}, the ${tn} have ${lead}. `,
				])!,
			],
			keys: [],
		};
	}
	return undefined;
};

export const teamDraft = (c: Ctx, tid: number, r: Rng): Para | undefined => {
	if (!c.done) {
		return undefined;
	}
	const picks = c.f.draft
		.filter((d) => d.tid === tid)
		.toSorted((a, b) => a.round - b.round || a.pick - b.pick);
	if (picks.length === 0) {
		return undefined;
	}
	const tn = c.tn(tid);
	const nm = (d: (typeof picks)[number]): Seg[] => [
		c.pl(d.pid, d.name),
		` (${d.round === 1 ? `No. ${d.pick}` : `round ${d.round}, pick ${d.pick}`})`,
	];
	const list = andList(picks.slice(0, 3).map(nm));
	const lead = pick<string>(r, [
		`At the ${c.season} draft the ${tn} took `,
		`Next came the draft, where the ${tn} added `,
		`The ${poss(tn)} ${c.season} draft: `,
	])!;
	return {
		kids: [
			lead,
			...list,
			picks.length > 3 ? `, among ${plural(picks.length, "pick")}. ` : ". ",
		],
		keys: [],
	};
};

export const tradeSince = (c: Ctx, tr: NPTrade, r: Rng): Para | undefined => {
	if (tr.phase < 0 || tr.phase > 2) {
		return undefined;
	}
	const out: { p: NPPlayer; to: number }[] = [];
	for (const [i, got] of tr.got.entries()) {
		const to = tr.tids[i as 0 | 1];
		for (const a of got) {
			if (a.kind !== "player") {
				continue;
			}
			const p = c.player(a.pid);
			if (p && p.gp >= 3 && p.tid === to) {
				out.push({ p, to });
			}
		}
	}
	if (out.length === 0) {
		return undefined;
	}
	out.sort((a, b) => b.p.ws - a.p.ws || b.p.gp - a.p.gp);
	const kids: Seg[] = [];
	for (const [i, x] of out.slice(0, 2).entries()) {
		const tn = c.tn(x.to);
		if (i === 0) {
			kids.push(
				...(pick<Seg[]>(r, [
					[
						capFirst(c.R("since the trade, ", "after the trade, ")),
						c.pl(x.p.pid),
						` ${c.R("has played", "played")} ${plural(x.p.gp, "game")} for the ${tn}, averaging ${fmt1(x.p.pts)} points with ${fmt1(x.p.ws)} win shares. `,
					],
					[
						`With the ${tn}, `,
						c.pl(x.p.pid),
						` ${c.R("is averaging", "averaged")} ${fmt1(x.p.pts)} points over ${plural(x.p.gp, "game")} (${fmt1(x.p.ws)} win shares for the season). `,
					],
				]) ?? []),
			);
		} else {
			kids.push(
				c.pl(x.p.pid),
				` ${c.R("has", "had")} ${fmt1(x.p.pts)} a game in ${plural(x.p.gp, "game")} for the ${tn}. `,
			);
		}
	}
	return { kids, keys: [] };
};

export const breakNext = (c: Ctx, pid: number, r: Rng): Para | undefined => {
	const p = c.player(pid);
	if (!p) {
		return undefined;
	}
	const nm = lastName(p.name);
	const room = p.pot - p.ovr;
	const kids =
		room >= 3
			? pick<string>(r, [
					`The ratings say there is more to come: at ${p.age}, ${nm} carries a potential of ${p.pot}, ${plural(room, "point")} above his ${p.ovr}. `,
					`${nm} is ${p.age} and his potential rating is ${p.pot}, so by the numbers the climb from ${p.ovr} is not finished. `,
				])!
			: pick<string>(r, [
					`By the ratings ${nm} is near his ceiling: at ${p.age} his potential is ${p.pot}, against an overall of ${p.ovr}. `,
					`At ${p.age}, ${nm} has a potential rating of ${p.pot}; the jump to ${p.ovr} already reaches most of it. `,
				])!;
	return { kids: [kids], keys: [] };
};

export const teamNameOf = (c: Ctx, tid: number) => c.tn(tid);
export { join };
