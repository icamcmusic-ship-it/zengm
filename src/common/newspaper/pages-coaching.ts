// Coaching pages (the coachSystems setting): the hot seat (head coaches whose teams are short of expectations) and the systems around the
// league. Nothing without the facts, so leagues without coaching systems print exactly what they did.
import { P } from "./ctx.ts";
import { SEASON_EDS, addPage, arcPage } from "./kit.ts";
import { andList, record, winp } from "./text.ts";
import type { NPCoaching, NPTeam } from "./types.ts";

type Head = NPCoaching["heads"][number];

addPage(
	arcPage<{ hot: { h: Head; t: NPTeam }[] }>({
		id: "coach-hot-seat",
		section: "teams",
		kicker: "The hot seat",
		eds: SEASON_EDS,
		beat: "league",
		prep: (c) => {
			const heads = c.f.coaching?.heads;
			if (!heads || c.f.gp < 15) {
				return undefined;
			}
			const hot = heads
				.filter((h) => h.heat >= 0.5)
				.map((h) => ({ h, t: c.f.teams.find((t) => t.tid === h.tid)! }))
				.filter((x) => x.t)
				.toSorted((a, b) => b.h.heat - a.h.heat)
				.slice(0, 4);
			if (hot.length === 0) {
				return undefined;
			}
			return { hot };
		},
		arcs: [
			{
				id: "list",
				heads: (x, c) => [
					`${x.hot[0]!.h.name} ${c.T("is", "was")} feeling the heat`,
					`Coaches on the hot seat`,
					`The ${x.hot[0]!.t.name} expected more from ${x.hot[0]!.h.name}`,
				],
				build: (x, r, c) => [
					P(
						c.T(
							"Not every coach is safe. These teams are well short of what was expected of them before the season: ",
							"Not every coach was safe. These teams fell well short of what was expected of them: ",
						),
						...andList(
							x.hot.map(({ h, t }) => [
								c.tl(t.tid),
								` (${record(t)}${h.expectedPct !== undefined ? `, picked to win ${Math.round(100 * h.expectedPct)}%` : ""}) with ${h.name}`,
							]),
						),
						".",
					),
					P(
						r.pick([
							"Owners have fired coaches for less.",
							"Results against expectations are what get coaches fired.",
							"A coach's reputation buys him some time, but not forever.",
						]),
					),
				],
			},
		],
	}),
);

addPage(
	arcPage<{ best: { h: Head; t: NPTeam }; common: [string, number] }>({
		id: "coaching-systems",
		section: "teams",
		kicker: "X's and O's",
		eds: SEASON_EDS,
		beat: "league",
		prep: (c) => {
			const heads = c.f.coaching?.heads;
			if (!heads || heads.length < 6 || c.f.gp < 10) {
				return undefined;
			}
			const rows = heads
				.map((h) => ({ h, t: c.f.teams.find((t) => t.tid === h.tid)! }))
				.filter((x) => x.t && x.t.gp > 0)
				.toSorted((a, b) => winp(b.t) - winp(a.t));
			const best = rows[0];
			if (!best) {
				return undefined;
			}
			const counts = new Map<string, number>();
			for (const h of heads) {
				counts.set(h.offense, (counts.get(h.offense) ?? 0) + 1);
			}
			const common = [...counts.entries()].toSorted((a, b) => b[1] - a[1])[0]!;
			return { best, common };
		},
		arcs: [
			{
				id: "systems",
				heads: (x, c) => [
					`${x.best.h.offense} and ${x.best.h.defense}: how the ${x.best.t.name} win`,
					`The ${x.common[0]} era: ${x.common[1]} teams ${c.T("run", "ran")} it`,
				],
				build: (x, r, c) => [
					P(
						c.tl(x.best.t.tid),
						` (${record(x.best.t)}) ${c.T("play", "played")} ${x.best.h.offense} on offense and ${x.best.h.defense} on defense under ${x.best.h.name}`,
						x.best.h.fit >= 60
							? ", and the roster fits it like a glove."
							: x.best.h.fit < 40
								? ", even though the roster isn't built for it."
								: ".",
					),
					P(
						`Around the league, ${x.common[1]} head coaches ${c.T("run", "ran")} ${x.common[0]}, the most popular offense. `,
						r.pick([
							"Systems that win get copied.",
							"Every coach has his system; the good ones fit it to their players.",
						]),
					),
				],
			},
		],
	}),
);
