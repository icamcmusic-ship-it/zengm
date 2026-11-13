// The long front-page features: the MVP, the best record, the No. 1 pick, the feat of the season, the trade and the breakout. Each runs four to eight paragraphs: context, key numbers, a dated best night, a colour pull quote, the franchise's story and a what's-next paragraph, with a "By the numbers" box and the back half behind a "Continue reading" fold.

import { Ctx, P } from "./ctx.ts";
import {
	type Para,
	breakNext,
	playerCareer,
	playerNight,
	playerRace,
	playerRank,
	playerSeason,
	playerShare,
	teamCore,
	teamDraft,
	teamHistory,
	teamNight,
	teamPost,
	teamRace,
	teamSeason,
	tradeSince,
} from "./longform.ts";
import type { Rng } from "./text.ts";
import { fmt1, ordinal, plural, poss, record, winp } from "./text.ts";
import type {
	Article,
	Block,
	NPPlayer,
	NPTrade,
	NPTradeAsset,
	Seg,
} from "./types.ts";

type Builder = (c: Ctx, r: Rng) => Para | undefined;

// One paragraph from several builders, skipping those without data
const merge = (
	c: Ctx,
	r: Rng,
	...bs: (Builder | undefined)[]
): Block | undefined => {
	const kids: Seg[] = [];
	for (const b of bs) {
		const out = b?.(c, r);
		if (out && out.kids.length > 0) {
			kids.push(...out.kids, " ");
		}
	}
	return kids.length > 0 ? P(kids) : undefined;
};

const QUOTES: Record<
	string,
	((n: string, x: string, past: boolean) => string)[]
> = {
	star: [
		(n, x, p) =>
			`${n} ${p ? "was" : "is"} the one player every opponent ${p ? "had" : "has"} to plan around, and ${x} says why.`,
		(n, x, p) =>
			`You do not put up ${x} by accident, and ${n} ${p ? "earned" : "is earning"} every bit of it.`,
		(n, x, p) =>
			`Some nights you just tip your cap, and with ${n} at ${x} there ${p ? "were" : "are"} a lot of those nights.`,
		(n, x, p) =>
			`Ask anyone who ${p ? "had" : "has"} to guard ${n} what ${x} ${p ? "felt" : "feels"} like from the other side.`,
	],
	riser: [
		(n, x, p) =>
			`${n} ${p ? "came" : "came"} back a different player, and the jump to ${x} ${p ? "was" : "is"} real.`,
		(n, x, p) =>
			`A year ago ${n} was a name on the roster; at ${x} he ${p ? "was" : "is"} a problem for everybody.`,
		(n, x) =>
			`Whatever ${n} did over the summer worked, because ${x} does not lie.`,
	],
	teamUp: [
		(n, x, p) =>
			`Everybody ${p ? "circled" : "has circled"} the ${n} on the schedule, and that is what ${x} does to a league.`,
		(n, x, p) =>
			`The ${n} ${p ? "made" : "make"} ${x} look routine, and it is not routine.`,
		(n, x, p) =>
			`Nobody ${p ? "wanted" : "wants"} to see the ${n} this year, and ${x} tells you why.`,
	],
	teamDown: [
		(n, x, p) =>
			`It ${p ? "was" : "has been"} a long year for the ${n}, and ${x} says so plainly.`,
		(n, x, p) =>
			`The ${n} ${p ? "will want" : "would like"} to forget ${x} in a hurry.`,
	],
	pick: [
		(n, x) =>
			`Every scout in the building had ${n} circled, and ${x} will tell us if they were right.`,
		(n, x) => `The tape on ${n} is all there; now comes ${x}.`,
	],
	deal: [
		(n, x) =>
			`Both sides talked themselves into the ${n} deal, and ${x} will settle the argument.`,
		(n, x) =>
			`The ${n} deal will be argued about for years, and ${x} is where it starts.`,
	],
};

const quoteFor = (
	c: Ctx,
	mood: string,
	n: string,
	x: string,
): Block | undefined => {
	const list = QUOTES[mood];
	if (!list) {
		return undefined;
	}
	const fn = c.cycle(`quote|${mood}|${n}`, list);
	return c.quote(fn(n, x, c.regDone), "newsroom colour");
};

const playerBox = (
	c: Ctx,
	p: NPPlayer,
	extra: { value: string; label: string }[] = [],
) => {
	const kp = c.statRank(p.pid, "pts");
	const items = [
		...extra,
		{
			value: fmt1(p.pts),
			label: `points a game${kp && kp <= 20 ? ` (${ordinal(kp)})` : ""}`,
		},
		{ value: fmt1(p.trb), label: "rebounds a game" },
		{ value: fmt1(p.ast), label: "assists a game" },
		p.ws !== 0 ? { value: fmt1(p.ws), label: "win shares" } : undefined,
		{ value: String(p.gp), label: c.R("games so far", "games played") },
		p.career && p.career.seasons >= 2
			? {
					value: Math.round(
						p.career.pts + (c.regDone ? p.pts * p.gp : 0),
					).toLocaleString("en-US"),
					label: `career points in ${plural(p.career.seasons + (c.regDone ? 1 : 0), "season")}`,
				}
			: undefined,
	].filter((x): x is { value: string; label: string } => x !== undefined);
	return items.length >= 3 ? { title: "By the numbers", items } : undefined;
};

const teamBox = (
	c: Ctx,
	tid: number,
	extra: { value: string; label: string }[] = [],
) => {
	const t = c.team(tid);
	if (!t) {
		return undefined;
	}
	const k = c.rank(tid);
	const items = [
		...extra,
		{
			value: record(t),
			label: `${c.R("record so far", "record")}${k ? ` (${ordinal(k)})` : ""}`,
		},
		t.pts !== undefined && t.oppPts !== undefined
			? { value: fmt1(t.pts - t.oppPts), label: "point differential a game" }
			: undefined,
		t.wonHome + t.lostHome > 0
			? { value: `${t.wonHome}-${t.lostHome}`, label: "at home" }
			: undefined,
		t.wonAway + t.lostAway > 0
			? { value: `${t.wonAway}-${t.lostAway}`, label: "on the road" }
			: undefined,
		t.prev && c.regDone
			? { value: record(t.prev), label: `in ${c.season - 1}` }
			: undefined,
	].filter((x): x is { value: string; label: string } => x !== undefined);
	return items.length >= 3 ? { title: "By the numbers", items } : undefined;
};

type Plan = {
	intro: Block[];
	paras: (Block | undefined)[];
	quote?: Block;
	next?: Para;
	box?: Article["box"];
};

// Assemble four to eight paragraphs, quote and fold; undefined when the data supports fewer than three extra paragraphs
const assemble = (
	c: Ctx,
	o: {
		id: string;
		kicker: string;
		head: string;
		beat: string;
		dateline?: string;
		photoPid?: number;
		deck?: Seg[];
	},
	plan: Plan,
): Article | undefined => {
	const paras = plan.paras.filter((p): p is Block => p !== undefined);
	if (paras.length < 3) {
		return undefined;
	}
	paras.splice(Math.max(3, 8 - plan.intro.length - (plan.quote ? 1 : 0)));
	const body: Block[] = [
		...plan.intro,
		paras[0]!,
		{ type: "fold" },
		...paras.slice(1),
	];
	if (plan.quote) {
		body.splice(body.findIndex((b) => b.type === "fold") + 2, 0, plan.quote);
	}
	if (plan.next) {
		body.push(P(plan.next.kids));
	}
	return {
		id: o.id,
		type: o.id,
		size: "feature",
		kicker: o.kicker,
		head: o.head,
		deck: o.deck,
		byline: c.byline(o.beat, o.dateline),
		photoPid: o.photoPid,
		box: plan.box,
		body,
	};
};

// A paragraph about one subject runs once per paper, so two features about the same player or team do not repeat each other
const once =
	(
		key: string,
		id: number,
		fn: (c: Ctx, id: number, r: Rng) => Para | undefined,
	): Builder =>
	(c, r) =>
		c.claim(`${key}|${id}`) ? fn(c, id, r) : undefined;

const bySeason = (id: number): Builder => once("ps", id, playerSeason);

// ---- The MVP ------------------------------------------------------------------

export const mvpFeature = (c: Ctx): Article | undefined => {
	if (c.pre) {
		return undefined;
	}
	const aw = c.award("MVP");
	let p: NPPlayer | undefined;
	if (c.done && aw) {
		p = c.player(aw.pid);
	} else {
		p = c.qual.toSorted(
			(a, b) =>
				b.ws +
				winp(c.team(b.tid) ?? { won: 0, lost: 0 }) * 4 -
				(a.ws + winp(c.team(a.tid) ?? { won: 0, lost: 0 }) * 4),
		)[0];
	}
	if (!p) {
		return undefined;
	}
	const r = c.rng("feature-mvp");
	const t = c.team(p.tid);
	const second =
		c.done && aw?.order[1] !== undefined
			? c.player(aw.order[1])
			: c.qual.toSorted((a, b) => b.ws - a.ws).find((x) => x.pid !== p!.pid);
	const intro: Block[] = [
		P(
			c.pl(p.pid),
			` of the `,
			c.tl(p.tid),
			c.done
				? ` is the ${c.season} Most Valuable Player. The ${p.age}-year-old ${p.pos} averaged ${c.lineWords(p)} in ${plural(p.gp, "game")}.`
				: ` ${c.regDone ? "led" : "leads"} the MVP race by the numbers. The ${p.age}-year-old ${p.pos} ${c.R("is averaging", "averaged")} ${c.lineWords(p)} in ${plural(p.gp, "game")}${c.regDone ? "" : " so far"}.`,
		),
	];
	if (t) {
		intro.push(
			P(
				`The `,
				c.tl(t.tid),
				` ${c.done ? `went ${record(t)} and ${c.fate(t.playoffRoundsWon)}` : `${c.R("are", "went")} ${record(t)}`}.`,
				second
					? [
							" ",
							c.pl(second.pid),
							` (${fmt1(second.pts)}/${fmt1(second.trb)}/${fmt1(second.ast)}, `,
							c.tl(second.tid, c.team(second.tid)?.abbrev),
							`) ${c.done ? "finished second in the voting" : "is the closest challenger by win shares"}.`,
						]
					: [],
			),
		);
	}
	const head = c.freshHead(r, [
		c.done
			? `${p.name} is the ${c.season} MVP`
			: `${p.name} leads the MVP race`,
		c.done
			? `${p.name}, MVP: a season in full`
			: `The MVP race, ${c.f.gp} games in: ${p.name} out front`,
		c.done && t
			? `${p.name} carries the ${t.name} to MVP honors`
			: `${p.name}: the case for MVP`,
	])!;
	return assemble(
		c,
		{
			id: "feature-mvp",
			kicker: c.done ? "Most Valuable Player" : "Award watch",
			head,
			beat: "awards",
			photoPid: p.pid,
		},
		{
			intro,
			paras: [
				merge(c, r, bySeason(p.pid), (cc, rr) => playerRank(cc, p!.pid, rr)),
				merge(c, r, once("ts", p!.tid, teamSeason), (cc, rr) =>
					teamRace(cc, p!.tid, rr),
				),
				merge(
					c,
					r,
					once("pn", p!.pid, playerNight),
					once("psh", p!.pid, playerShare),
				),
				merge(c, r, once("pc", p!.pid, playerCareer), (cc, rr) =>
					playerRace(cc, p!.pid, rr),
				),
				merge(c, r, once("th", p!.tid, teamHistory)),
			],
			quote: quoteFor(c, "star", p.name, `${fmt1(p.pts)} points a game`),
			next: teamPost(c, p.tid, r),
			box: playerBox(c, p),
		},
	);
};

// ---- The best record -------------------------------------------------------------

export const bestRecordFeature = (c: Ctx): Article | undefined => {
	const a = c.rows[0];
	if (c.pre || !a || a.gp < 10) {
		return undefined;
	}
	// The champion story already tells that team's season
	if (c.done && c.f.champion === a.tid) {
		return undefined;
	}
	const r = c.rng("feature-best");
	const lead = c.teamPlayers(a.tid)[0];
	const tn = a.name;
	const intro: Block[] = [
		P(
			`No team ${c.R("has won", "won")} more than the `,
			c.tl(a.tid, c.tfull(a.tid)),
			`, ${record(a)}${c.regDone ? " over the regular season" : ` through ${a.gp} games`}.`,
			lead
				? [
						" ",
						c.pl(lead.pid),
						` ${c.R("is", "was")} the engine: ${fmt1(lead.ws)} win shares and ${fmt1(lead.pts)} points a game.`,
					]
				: [],
		),
	];
	const head = c.freshHead(r, [
		`The ${tn}: the league's best team, ${record(a)}`,
		`${tn}, ${record(a)}: inside the league's best record`,
		`${tn}, ${record(a)}: the best team in the league`,
	])!;
	return assemble(
		c,
		{
			id: "feature-best",
			kicker: "Best record",
			head,
			beat: "league",
			dateline: c.city(a.tid),
			photoPid: lead?.pid,
		},
		{
			intro,
			paras: [
				merge(c, r, once("ts", a.tid, teamSeason), (cc, rr) =>
					teamRace(cc, a.tid, rr),
				),
				merge(c, r, once("tc", a.tid, teamCore)),
				merge(
					c,
					r,
					once("tn", a.tid, teamNight),
					once("th", a.tid, teamHistory),
				),
				lead
					? merge(c, r, bySeason(lead.pid), (cc, rr) =>
							playerRank(cc, lead.pid, rr),
						)
					: undefined,
				lead
					? merge(
							c,
							r,
							once("pn", lead.pid, playerNight),
							once("pc", lead.pid, playerCareer),
						)
					: undefined,
			],
			quote: quoteFor(
				c,
				winp(a) >= 0.5 ? "teamUp" : "teamDown",
				tn,
				`${aOr(record(a))} record`,
			),
			next: c.done
				? (teamPost(c, a.tid, r) ?? teamDraft(c, a.tid, r))
				: teamPost(c, a.tid, r),
			box: teamBox(c, a.tid),
		},
	);
};

const aOr = (s: string) =>
	/^(8|11|18|8\d)(\D|$)/.test(s) ? `an ${s}` : `a ${s}`;

// ---- The No. 1 pick ----------------------------------------------------------------

export const topPickFeature = (c: Ctx): Article | undefined => {
	if (!c.done) {
		return undefined;
	}
	const d = c.f.draft.find((x) => x.round === 1 && x.pick === 1);
	if (!d) {
		return undefined;
	}
	const r = c.rng("feature-pick");
	const ts = c.team(d.tid);
	const top5 = c.f.draft
		.filter((x) => x.round === 1)
		.toSorted((a, b) => a.pick - b.pick)
		.slice(0, 5);
	const intro: Block[] = [
		P(
			`With the first overall pick, the `,
			c.tl(d.tid, c.tfull(d.tid)),
			` took `,
			c.pl(d.pid, d.name),
			`, a ${d.age}-year-old ${d.pos}${d.college ? ` out of ${d.college}` : ""}${c.noRatings ? "" : `, rated ${d.ovr} now with ${d.pot} potential`}.`,
		),
	];
	const highPot = c.f.draft.toSorted((a, b) => b.pot - a.pot)[0];
	const scout: Block | undefined = c.noRatings
		? undefined
		: P(
				r.pick([
					`On draft night ${d.name} carries an overall rating of ${d.ovr} and a potential of ${d.pot}. `,
					`The ratings: ${d.ovr} overall now, ${d.pot} potential, at ${d.age}. `,
				]),
				highPot && highPot.pid !== d.pid && highPot.pot > d.pot
					? [
							`The highest potential in the class, though, belongs to `,
							c.pl(highPot.pid, highPot.name),
							` (${highPot.pot}), taken No. ${highPot.pick} in round ${highPot.round}.`,
						]
					: [
							`No one else in the ${c.season} class has a higher potential rating.`,
						],
			);
	const table: Block = {
		type: "table",
		head: ["Pick", "Player", "Team", "Age", c.noRatings ? "Pos" : "Ovr/Pot"],
		numCols: [3],
		rows: top5.map((x) => [
			[String(x.pick)],
			[c.pl(x.pid, x.name)],
			[c.tl(x.tid, c.team(x.tid)?.abbrev)],
			[String(x.age)],
			[c.noRatings ? x.pos || "–" : `${x.ovr}/${x.pot}`],
		]),
	};
	const head = c.freshHead(r, [
		`${c.tn(d.tid)} take ${d.name} first overall`,
		`No. 1: ${d.name} goes to the ${c.tn(d.tid)}`,
		`${d.name} heads the ${c.season} draft class`,
	])!;
	const teens = c.f.draft.filter((x) => x.age <= 19).length;
	const art = assemble(
		c,
		{
			id: "feature-pick",
			kicker: `${c.season} draft`,
			head,
			beat: "draft",
			photoPid: d.pid,
		},
		{
			intro,
			paras: [
				scout,
				ts
					? merge(c, r, once("ts", d.tid, teamSeason), (cc, rr) =>
							teamRace(cc, d.tid, rr),
						)
					: undefined,
				merge(c, r, once("tc", d.tid, teamCore)),
				merge(c, r, once("th", d.tid, teamHistory)),
				P(
					`The ${c.f.draft.length}-player ${c.season} class ${teens > 0 ? `includes ${plural(teens, "teenager")}` : "has no one under 20"}; its first round is below.`,
				),
			],
			quote: quoteFor(
				c,
				"pick",
				d.name,
				`his first season with the ${c.tn(d.tid)}`,
			),
			next: teamDraft(c, d.tid, r),
			box: {
				title: "The pick",
				items: [
					...(c.noRatings
						? [{ value: `No. ${d.pick}`, label: "overall pick" }]
						: [
								{ value: String(d.ovr), label: "overall rating" },
								{ value: String(d.pot), label: "potential" },
							]),
					{ value: String(d.age), label: "years old" },
					...(ts ? [{ value: record(ts), label: `${ts.name} record` }] : []),
				],
			},
		},
	);
	if (!art) {
		return undefined;
	}
	// The class table closes the story
	art.body.push(table);
	return art;
};

// ---- The feat ---------------------------------------------------------------------------

export const featFeature = (c: Ctx): Article | undefined => {
	if (c.pre) {
		return undefined;
	}
	const score = (f: {
		pts: number;
		trb: number;
		ast: number;
		stl: number;
		blk: number;
	}) => f.pts + 1.2 * f.trb + 1.5 * f.ast + 2 * (f.stl + f.blk);
	const f = c.f.feats
		.filter((x) => c.done || !x.playoffs)
		.toSorted((a, b) => score(b) - score(a))[0];
	if (!f || f.pts < 30) {
		return undefined;
	}
	const p = c.player(f.pid);
	const r = c.rng("feature-feat");
	const opp = c.team(f.oppTid) ? c.tn(f.oppTid) : undefined;
	const nFeats = c.f.feats.filter(
		(x) => x.pid === f.pid && (c.done || !x.playoffs),
	).length;
	const intro: Block[] = [
		P(
			c.pl(f.pid, f.name),
			` of the `,
			c.tl(f.tid),
			` had ${f.pts} points${f.trb >= 8 ? `, ${f.trb} rebounds` : ""}${f.ast >= 6 ? ` and ${f.ast} assists` : ""}${opp ? ` against the ${opp}` : ""}${f.playoffs ? " in the playoffs" : ""}, a ${f.score} ${f.result === "W" ? "win" : f.result === "L" ? "loss" : "tie"} (`,
			c.gl(f.gid, f.tid, "box score"),
			`).`,
		),
	];
	const head = c.freshHead(r, [
		`${f.name} goes for ${f.pts}`,
		`${poss(f.name)} ${f.pts}-point night`,
		`${f.pts} points: the night of the ${c.season} season`,
	])!;
	const more =
		nFeats >= 2
			? P(
					`It was one of ${plural(nFeats, "standout game")} for ${f.name} on the feats list this season.`,
				)
			: undefined;
	return assemble(
		c,
		{
			id: "feature-feat",
			kicker: "Big night",
			head,
			beat: "numbers",
			photoPid: f.pid,
		},
		{
			intro,
			paras: [
				merge(c, r, bySeason(f.pid)),
				more,
				merge(c, r, once("psh", f.pid, playerShare), (cc, rr) =>
					playerRace(cc, f.pid, rr),
				),
				merge(c, r, once("ts", f.tid, teamSeason), (cc, rr) =>
					teamRace(cc, f.tid, rr),
				),
				merge(c, r, once("pc", f.pid, playerCareer), (cc, rr) =>
					playerRank(cc, f.pid, rr),
				),
			],
			quote: quoteFor(c, "star", f.name, `${f.pts} points in one game`),
			next: teamPost(c, f.tid, r),
			box: p
				? playerBox(c, p, [
						{ value: String(f.pts), label: "points that night" },
					])
				: undefined,
		},
	);
};

// ---- The trade ----------------------------------------------------------------------------

const assetLine = (c: Ctx, assets: NPTradeAsset[]): Seg[] =>
	assets.length === 0
		? ["nothing"]
		: assets.flatMap((a, i): Seg[] => [
				i > 0 ? (i === assets.length - 1 ? " and " : ", ") : "",
				...(a.kind === "player"
					? [c.pl(a.pid, a.name)]
					: [
							`${typeof a.season === "number" ? a.season : "a"} ${ordinal(a.round)}-round pick${a.originalTid >= 0 && c.team(a.originalTid) ? ` (${c.team(a.originalTid)!.abbrev})` : ""}`,
						]),
			]);

export const tradeFeature = (c: Ctx, tr?: NPTrade): Article | undefined => {
	if (c.pre) {
		return undefined;
	}
	const t =
		tr ??
		c.f.trades
			.filter((x) => x.phase >= 0 && x.phase <= 3)
			.toSorted((a, b) => b.score - a.score)[0];
	if (!t) {
		return undefined;
	}
	const [a, b] = t.tids;
	const r = c.rng("feature-trade");
	const stars = t.got
		.flatMap((g) =>
			g.filter(
				(x): x is Extract<NPTradeAsset, { kind: "player" }> =>
					x.kind === "player",
			),
		)
		.map((x) => c.player(x.pid))
		.filter((p): p is NPPlayer => p !== undefined && p.gp >= 3)
		.toSorted((p, q) => q.ws - p.ws);
	const star = stars[0];
	const head = c.freshHead(r, [
		star ? `${star.name} on the move: ${c.tn(a)}, ${c.tn(b)} deal` : null,
		`${c.tn(a)} and ${c.tn(b)} make a deal`,
		`The ${c.tn(a)}-${c.tn(b)} trade, examined`,
	])!;
	const intro: Block[] = [
		P(
			`The `,
			c.tl(a, c.tfull(a)),
			` and the `,
			c.tl(b, c.tfull(b)),
			` completed a trade ${t.phase === 0 ? "before the season" : "during the season"}.`,
		),
		{
			type: "list",
			items: [
				[c.tl(a), " get ", ...assetLine(c, t.got[0])],
				[c.tl(b), " get ", ...assetLine(c, t.got[1])],
			],
		},
	];
	const aTeam = c.team(a);
	const bTeam = c.team(b);
	return assemble(
		c,
		{
			id: "feature-trade",
			kicker: "Trade",
			head,
			beat: "moves",
			photoPid: star?.pid,
		},
		{
			intro,
			paras: [
				merge(c, r, once("ts", a, teamSeason), (cc, rr) => teamRace(cc, a, rr)),
				merge(c, r, once("ts", b, teamSeason), (cc, rr) => teamRace(cc, b, rr)),
				star
					? merge(c, r, bySeason(star.pid), once("psh", star.pid, playerShare))
					: undefined,
				star
					? merge(
							c,
							r,
							once("pn", star.pid, playerNight),
							once("pc", star.pid, playerCareer),
						)
					: undefined,
			],
			quote: quoteFor(
				c,
				"deal",
				`${c.tn(a)}-${c.tn(b)}`,
				`the ${c.season} win-shares column`,
			),
			next: tradeSince(c, t, r),
			box:
				aTeam && bTeam
					? {
							title: "The teams",
							items: [
								{
									value: record(aTeam),
									label: `${aTeam.name}${c.regDone ? "" : " so far"}`,
								},
								{
									value: record(bTeam),
									label: `${bTeam.name}${c.regDone ? "" : " so far"}`,
								},
								{
									value: String(
										t.got.flat().filter((x) => x.kind === "player").length,
									),
									label: "players moved",
								},
								...(star
									? [{ value: fmt1(star.ws), label: `${star.name} win shares` }]
									: []),
							],
						}
					: undefined,
		},
	);
};

// ---- The breakout ---------------------------------------------------------------------------

export const breakoutFeature = (c: Ctx): Article | undefined => {
	if (c.pre) {
		return undefined;
	}
	const b = c.qual
		.filter((p) => p.prevOvr !== undefined && p.ovr - p.prevOvr >= 4)
		.toSorted((x, y) => y.ovr - y.prevOvr! - (x.ovr - x.prevOvr!))[0];
	if (!b) {
		return undefined;
	}
	const r = c.rng("feature-break");
	const intro: Block[] = [
		P(
			c.pl(b.pid),
			c.noRatings
				? ` ${c.R("is having", "had")} a breakout season, the biggest step forward among regulars. The ${b.age}-year-old ${c.R("is averaging", "averaged")} ${c.lineWords(b)} for the `
				: ` came into the season rated ${b.prevOvr} and ${c.R("is now", "finished at")} ${b.ovr}, the biggest jump among regulars. The ${b.age}-year-old ${c.R("is averaging", "averaged")} ${c.lineWords(b)} for the `,
			c.tl(b.tid),
			b.prevLine ? `, up from ${fmt1(b.prevLine.pts)} points a year ago.` : ".",
		),
	];
	const head = c.freshHead(r, [
		`${b.name} takes the leap`,
		c.noRatings
			? `${poss(b.name)} breakout season`
			: `From ${b.prevOvr} to ${b.ovr}: ${poss(b.name)} breakout`,
		`The breakout: ${b.name}`,
	])!;
	return assemble(
		c,
		{
			id: "feature-break",
			kicker: "Breakout",
			head,
			beat: "features",
			photoPid: b.pid,
		},
		{
			intro,
			paras: [
				merge(c, r, bySeason(b.pid), once("psh", b.pid, playerShare)),
				merge(
					c,
					r,
					once("pn", b.pid, playerNight),
					once("tc", b.tid, teamCore),
				),
				merge(c, r, once("ts", b.tid, teamSeason), (cc, rr) =>
					teamRace(cc, b.tid, rr),
				),
				merge(c, r, once("pc", b.pid, playerCareer), (cc, rr) =>
					playerRank(cc, b.pid, rr),
				),
			],
			quote: quoteFor(
				c,
				"riser",
				b.name,
				c.noRatings ? "this level" : aOr(`${b.ovr} rating`),
			),
			next: breakNext(c, b.pid, r),
			box: playerBox(
				c,
				b,
				c.noRatings
					? []
					: [{ value: `${b.prevOvr}→${b.ovr}`, label: "overall rating" }],
			),
		},
	);
};
