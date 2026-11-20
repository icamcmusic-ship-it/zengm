// The weekly power rankings column (from the stored weekly snapshots, NPTeam.power) and the draft-night section (trades on draft
// night, draft-and-stash picks, reaches and steals against the consensus board, the top picks with their real-player comps). Every
// line comes from the facts; without the facts nothing prints. No rating numbers anywhere, so the No Visible Ratings challenge holds.
import { PHASE } from "../constants.ts";
import { type Ctx, P } from "./ctx.ts";
import { fmt1, plural, record, tradeSides } from "./text.ts";
import type {
	Article,
	Block,
	NPDraftee,
	NPTeam,
	NPTrade,
	NPTradeAsset,
	Seg,
} from "./types.ts";

// ---- Power rankings --------------------------------------------------------

const TIERS = ["Contenders", "In the mix", "Bubble", "Rebuilding"] as const;

const moveText = (t: NPTeam) => {
	const p = t.power!;
	if (p.prev === undefined) {
		return "new";
	}
	const d = p.prev - p.rank;
	return d > 0 ? `▲${d}` : d < 0 ? `▼${-d}` : "–";
};

const inSeasonTrade = (tr: NPTrade) => tr.phase >= 0 && tr.phase <= 3;

const blurb = (c: Ctx, t: NPTeam): Seg[] => {
	const r = c.rng("power-blurb", t.tid);
	const options: Seg[][] = [];
	if (t.streak >= 3) {
		options.push([
			r.pick([
				`Winners of ${t.streak} straight.`,
				`${t.streak} wins in a row and counting.`,
			]),
		]);
	} else if (t.streak <= -3) {
		options.push([
			r.pick([
				`Lost ${-t.streak} in a row.`,
				`A ${-t.streak}-game skid to snap.`,
			]),
		]);
	}
	const roster = c.f.players
		.filter((p) => p.tid === t.tid && p.gp > 0)
		.toSorted((a, b) => b.ws - a.ws || a.pid - b.pid);
	const hurt = c.f.injuries
		.filter((x) => x.tid === t.tid && x.gamesRemaining > 0)
		.toSorted(
			(a, b) =>
				(roster.find((p) => p.pid === b.pid)?.ws ?? 0) -
					(roster.find((p) => p.pid === a.pid)?.ws ?? 0) || a.pid - b.pid,
		)[0];
	if (hurt) {
		options.push([
			"Without ",
			c.pl(hurt.pid, hurt.name),
			` (${hurt.type.toLowerCase()}) for ${plural(hurt.gamesRemaining, "more game")}.`,
		]);
	}
	const trade = c.f.trades
		.filter(inSeasonTrade)
		.findLast((tr) => tradeSides(tr).some((s) => s.tid === t.tid));
	const got = trade
		? tradeSides(trade)
				.find((s) => s.tid === t.tid)
				?.got.find(
					(a): a is Extract<NPTradeAsset, { kind: "player" }> =>
						a.kind === "player",
				)
		: undefined;
	if (got) {
		options.push([
			r.pick(["Still working in ", "The trade for "]),
			c.pl(got.pid, got.name),
			r.pick([
				" is the story here.",
				" changed the rotation.",
				`, and how ${c.pr("he")} fits.`,
			]),
		]);
	}
	const star = roster[0];
	if (star && star.gp > 0) {
		options.push([
			c.pl(star.pid, star.name),
			r.pick([
				` keeps doing ${c.pr("his")} part: ${fmt1(star.pts / star.gp)} points a night.`,
				` leads the way at ${fmt1(star.pts / star.gp)} points a game.`,
			]),
		]);
	}
	if (options.length === 0) {
		return [
			t.power!.prev === t.power!.rank ? "Holding steady." : "Quiet week.",
		];
	}
	return options[0]!;
};

export const powerRankColumn = (c: Ctx): Article | undefined => {
	if (c.pre || c.done) {
		return undefined;
	}
	const ranked = c.f.teams
		.filter((t) => t.power)
		.toSorted((a, b) => a.power!.rank - b.power!.rank || a.tid - b.tid);
	if (ranked.length < 4) {
		return undefined;
	}
	const per = Math.ceil(ranked.length / TIERS.length);
	const body: Block[] = [];
	const top = ranked[0]!;
	const climber = ranked
		.filter((t) => t.power!.prev !== undefined)
		.toSorted(
			(a, b) =>
				b.power!.prev! - b.power!.rank - (a.power!.prev! - a.power!.rank) ||
				a.tid - b.tid,
		)[0];
	const climb = climber ? climber.power!.prev! - climber.power!.rank : 0;
	body.push(
		P(
			"The ",
			c.tl(top.tid, c.tfull(top.tid)),
			` sit on top this week at ${record(top)}.`,
			climb >= 3 && climber
				? [
						" The big mover: the ",
						c.tl(climber.tid),
						`, up ${plural(climb, "spot")}.`,
					]
				: undefined,
		),
	);
	TIERS.forEach((tier, i) => {
		const list = ranked.slice(i * per, (i + 1) * per);
		if (list.length === 0) {
			return;
		}
		body.push(
			{ type: "sub", text: tier },
			{
				type: "table",
				head: ["#", "Move", "Team", "Record", "The word"],
				rows: list.map((t) => [
					[String(t.power!.rank)],
					[moveText(t)],
					[c.tl(t.tid, c.tfull(t.tid))],
					[record(t)],
					blurb(c, t),
				]),
			},
		);
	});
	const r = c.rng("power-column");
	return {
		id: "power-rankings-column",
		size: "feature",
		kicker: "Power rankings",
		head: c.freshHead(r, [
			`Power rankings: the ${c.tn(top.tid)} hold the top spot`,
			`This week's power rankings: ${c.tn(top.tid)} on top`,
			`Ranking the league: it starts with the ${c.tn(top.tid)}`,
		])!,
		byline: c.byline("league"),
		body,
	};
};

// ---- Draft night -----------------------------------------------------------

const DRAFT_NIGHT = "Draft night: ";

const isDraftNight = (tr: NPTrade) =>
	tr.phase === PHASE.DRAFT || (tr.note?.startsWith(DRAFT_NIGHT) ?? false);

const assetText = (c: Ctx, a: NPTradeAsset): Seg[] =>
	a.kind === "player"
		? [c.pl(a.pid, a.name)]
		: [
				`${typeof a.season === "number" ? `a ${a.season}` : "a"} round ${a.round} pick`,
				a.originalTid >= 0 ? ` (originally the ${c.tn(a.originalTid)}')` : "",
			];

const joinSegs = (parts: Seg[][]): Seg[] =>
	parts.flatMap((x, i) =>
		i === 0 ? x : [i === parts.length - 1 ? " and " : ", ", ...x],
	);

const overall = (d: NPDraftee, perRound: number) =>
	(d.round - 1) * perRound + d.pick;

export const draftNightStory = (c: Ctx): Article | undefined => {
	if (!c.done || c.f.draft.length === 0) {
		return undefined;
	}
	const picks = c.f.draft.toSorted(
		(a, b) => a.round - b.round || a.pick - b.pick,
	);
	const perRound = Math.max(
		1,
		...picks.filter((d) => d.round === 1).map((d) => d.pick),
	);
	const trades = c.f.trades.filter((tr) => isDraftNight(tr));
	const stashed = picks.filter((d) => d.stash);
	const gaps = picks
		.filter((d) => d.cons !== undefined)
		.map((d) => ({ d, gap: overall(d, perRound) - d.cons! }));
	const MIN_GAP = 5;
	const steals = gaps
		.filter((x) => x.gap >= MIN_GAP)
		.toSorted((a, b) => b.gap - a.gap || a.d.pid - b.d.pid)
		.slice(0, 3);
	const reaches = gaps
		.filter((x) => x.gap <= -MIN_GAP)
		.toSorted((a, b) => a.gap - b.gap || a.d.pid - b.d.pid)
		.slice(0, 3);
	const withComps = c.noRatings ? [] : picks.slice(0, 5).filter((d) => d.comps);
	if (
		trades.length === 0 &&
		stashed.length === 0 &&
		steals.length === 0 &&
		reaches.length === 0 &&
		withComps.length === 0
	) {
		return undefined;
	}
	const r = c.rng("draft-night");
	const body: Block[] = [];
	if (trades.length > 0) {
		body.push(
			{ type: "sub", text: "Moving up, moving down" },
			{
				type: "list",
				items: trades.map((tr) => {
					if (tr.note?.startsWith(DRAFT_NIGHT)) {
						const text = tr.note.slice(DRAFT_NIGHT.length);
						return [text.charAt(0).toUpperCase() + text.slice(1)];
					}
					const sides = tradeSides(tr);
					return sides.flatMap((s, i): Seg[] => [
						i === 0 ? "The " : "; the ",
						c.tl(s.tid),
						" got ",
						...(s.got.length > 0
							? joinSegs(s.got.map((a) => assetText(c, a)))
							: ["nothing on the night"]),
						i === sides.length - 1 ? "." : "",
					]);
				}),
			},
		);
	}
	if (steals.length > 0 || reaches.length > 0) {
		const line = (x: { d: NPDraftee; gap: number }, steal: boolean): Seg[] => [
			c.pl(x.d.pid, x.d.name),
			` went No. ${overall(x.d, perRound)} to the `,
			c.tl(x.d.tid),
			`; the consensus board had ${c.pr("him")} at No. ${x.d.cons}`,
			steal
				? r.pick([" — a steal on paper.", ", and slid."])
				: r.pick([" — a reach, by the board.", ", so somebody saw something."]),
		];
		body.push(
			{ type: "sub", text: "Reaches and steals" },
			P(
				r.pick([
					"The scouts' consensus board and the real draft never agree. ",
					"Where the board and the teams parted ways: ",
				]),
			),
			{
				type: "list",
				items: [
					...steals.map((x) => line(x, true)),
					...reaches.map((x) => line(x, false)),
				],
			},
		);
	}
	if (stashed.length > 0) {
		body.push(
			{ type: "sub", text: "Draft and stash" },
			P(
				stashed.length === 1
					? "One pick stays overseas for now: "
					: `${plural(stashed.length, "pick")} stay overseas for now: `,
				joinSegs(
					stashed.map((d): Seg[] => [
						c.pl(d.pid, d.name),
						` (the ${c.tn(d.tid)}' No. ${overall(d, perRound)}, to ${d.stash})`,
					]),
				),
				".",
			),
		);
	}
	if (withComps.length > 0) {
		body.push(
			{ type: "sub", text: "The top of the class" },
			{
				type: "table",
				head: ["Pick", "Player", "Team", "Real-player comps"],
				rows: withComps.map((d) => [
					[String(overall(d, perRound))],
					[c.pl(d.pid, d.name)],
					[c.tl(d.tid, c.team(d.tid)?.abbrev)],
					[d.comps!.slice(0, 2).join("; ")],
				]),
			},
		);
	}
	const head = c.freshHead(r, [
		trades.length > 0
			? `Draft night: ${plural(trades.length, "trade")} and a board reshuffled`
			: null,
		steals[0]
			? `Draft night: ${steals[0].d.name} slides to the ${c.tn(steals[0].d.tid)}`
			: null,
		`Draft night, pick by pick`,
		`Inside draft night`,
	]);
	return {
		id: "draft-night",
		size: "feature",
		kicker: `${c.season} draft night`,
		head: head ?? "Inside draft night",
		byline: c.byline("draft"),
		photoPid: picks[0]?.pid,
		body,
	};
};
