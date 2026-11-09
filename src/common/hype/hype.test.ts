import { describe, expect, test } from "vitest";
import {
	buildRecords,
	chaseBoard,
	hypeForGame,
	isBadText,
	plainText,
	storedGame,
	targetOfGame,
	withActiveCareers,
	type HBoxLine,
	type HGame,
	type HRaw,
	type Target,
} from "./index.ts";
import {
	CHASER_PID,
	HEATER_PID,
	HOLDER_PID,
	MILESTONE_PID,
	MOVER_PID,
	NUM_GAMES,
	ROOKIE_A,
	ROOKIE_B,
	SEASON,
	makeRaw,
} from "./fixture.ts";
import { postScore, preScore, rarity } from "./calibration.ts";
import { evalLine } from "./post.ts";

const raw0 = makeRaw();
const regular = raw0.games.filter((g) => !g.playoffs);
const playoff = raw0.games.filter((g) => g.playoffs);

const complete = (raw: HRaw, g: HGame) => hypeForGame(raw, targetOfGame(g))!;

// Games of a team in play order
const gamesOf = (raw: HRaw, tid: number, playoffs = false) =>
	raw.games.filter(
		(g) => g.playoffs === playoffs && g.teams.some((t) => t.tid === tid),
	);

const allText = (h: ReturnType<typeof hypeForGame>) =>
	[
		...(h?.pre.reasons.map((r) => r.text) ?? []),
		...(h?.post?.reasons.map((r) => r.text) ?? []),
		h?.verdict?.text ?? "",
		h?.pre.series?.text ?? "",
	].join("\n");

describe("fixture", () => {
	test("is deterministic and well formed", () => {
		expect(JSON.stringify(makeRaw())).toBe(JSON.stringify(raw0));
		expect(regular.length).toBe(NUM_GAMES * 4);
		expect(playoff.length).toBeGreaterThanOrEqual(6);
		for (const g of raw0.games) {
			for (const t of g.teams) {
				expect(t.pts).toBe(t.players.reduce((s, p) => s + p.pts, 0));
			}
			expect(g.teams[0].pts).not.toBe(g.teams[1].pts);
		}
	});
});

describe("hype engine", () => {
	test("is deterministic, sorted and has clean text", () => {
		for (const g of [...regular.filter((_, i) => i % 7 === 0), ...playoff]) {
			const a = complete(raw0, g);
			const b = complete(raw0, g);
			expect(JSON.stringify(a)).toBe(JSON.stringify(b));
			const txt = allText(a);
			expect(isBadText(txt), txt).toBe(false);
			expect(txt).not.toMatch(/\bundefined\b|\bNaN\b|\[object/);
			expect(a.pre.score).toBeGreaterThanOrEqual(0);
			expect(a.pre.score).toBeLessThanOrEqual(100);
			expect(a.post!.score).toBeLessThanOrEqual(100);
			// reasons by size of contribution, up or down, and they add up to the raw points (every contributor is listed)
			for (const x of [a.pre, a.post!]) {
				const pts = x.reasons.map((r) => Math.abs(r.pts));
				expect([...pts].sort((p, q) => q - p)).toEqual(pts);
				const sum = x.reasons.reduce((s, r) => s + r.pts, 0);
				expect(Math.abs(sum - x.raw)).toBeLessThan(0.5);
			}
			for (const r of a.pre.reasons) {
				expect(plainText(r.text)).not.toMatch(/\[\[|]]/);
				expect(r.text.length).toBeGreaterThan(3);
			}
			expect(a.verdict).not.toBeNull();
		}
	});

	test("pre-game hype never sees the result: changing this game and later ones changes nothing", () => {
		const mid = regular[150]!;
		const base = complete(raw0, mid).pre;
		// rewrite this game and every later one
		const key = (g: HGame) => (g.playoffs ? 1000 : 0) + g.day;
		const games = raw0.games.map((g) => {
			if (key(g) < key(mid)) {
				return g;
			}
			const flip = (t: HGame["teams"][0], i: number) => ({
				...t,
				pts: 200 + i * 7 + (g.gid % 5),
				won: 33,
				lost: 1,
				players: t.players.map((p) => ({
					...p,
					pts: 33 + (p.pid % 4),
					trb: 17,
					ast: 12,
				})),
			});
			return {
				...g,
				overtimes: 3,
				clutch: ["A game-winning something at the buzzer"],
				teams: [flip(g.teams[0], 0), flip(g.teams[1], 1)] as HGame["teams"],
			};
		});
		// same-day games are not "before" either, but the box score record of the game itself is its own
		const raw1: HRaw = {
			...raw0,
			games: games.map((g) =>
				g.gid === mid.gid
					? {
							...g,
							teams: [
								{
									...g.teams[0],
									won: mid.teams[0].won,
									lost: mid.teams[0].lost,
								},
								{
									...g.teams[1],
									won: mid.teams[1].won,
									lost: mid.teams[1].lost,
								},
							] as HGame["teams"],
						}
					: g,
			),
		};
		const changed = hypeForGame(
			raw1,
			targetOfGame(raw1.games.find((g) => g.gid === mid.gid)!),
		)!.pre;
		expect(changed).toEqual(base);
	});

	test("an upcoming game scores the same as the finished one with the same history", () => {
		for (const idx of [40, 150, 260]) {
			const g = regular[idx]!;
			const done = complete(raw0, g).pre;
			// only the games before it exist, the teams' records come from teamNow
			const before = raw0.games.filter((x) => !x.playoffs && x.day < g.day);
			const rec = (tid: number) => {
				let won = 0;
				let lost = 0;
				let streak = 0;
				for (const x of before) {
					const i =
						x.teams[0].tid === tid ? 0 : x.teams[1].tid === tid ? 1 : -1;
					if (i < 0) {
						continue;
					}
					const w = x.teams[i as 0 | 1].pts > x.teams[(1 - i) as 0 | 1].pts;
					won += w ? 1 : 0;
					lost += w ? 0 : 1;
					streak = w
						? streak > 0
							? streak + 1
							: 1
						: streak < 0
							? streak - 1
							: -1;
				}
				return {
					won,
					lost,
					tied: 0,
					otl: 0,
					streak,
					ovr: g.teams.find((t) => t.tid === tid)?.ovr,
				};
			};
			const teamNow = Object.fromEntries(
				raw0.teams.map((t) => [t.tid, rec(t.tid)]),
			);
			const raw1: HRaw = { ...raw0, games: before, teamNow };
			const target: Target = { ...targetOfGame(g), completed: false };
			const up = hypeForGame(raw1, target)!;
			expect(up.completed).toBe(false);
			expect(up.post).toBeNull();
			expect(up.pre).toEqual(done);
		}
	});

	test("career milestone: needs N points, from the rows plus this season's games", () => {
		const games = gamesOf(raw0, 0);
		const p = raw0.players[MILESTONE_PID]!;
		const prior = p.rows
			.filter((r) => r.season < SEASON)
			.reduce((s, r) => s + r.pts!, 0);
		expect(prior).toBe(19800);
		let found = 0;
		games.forEach((g, k) => {
			const before = prior + 20 * k;
			const need = 20000 - before;
			const h = complete(raw0, g).pre;
			const m = h.story.milestones.find((x) => x.pid === MILESTONE_PID);
			if (need > 0 && need <= 30) {
				expect(m, `game ${k}`).toBeTruthy();
				expect(
					h.reasons.some(
						(r) =>
							plainText(r.text) ===
							`Milestone watch: Player 0 needs ${need} ${need === 1 ? "point" : "points"} for 20,000 career`,
					),
				).toBe(true);
				expect(m!.mark).toBe(20000);
				found++;
			} else {
				expect(m, `game ${k}`).toBeUndefined();
			}
		});
		expect(found).toBe(1);
	});

	test("heater: last five games against the pace before them", () => {
		const games = gamesOf(raw0, 1);
		const g16 = games[15]!;
		const h = complete(raw0, g16).pre;
		const heat = h.story.heaters.find((x) => x.pid === HEATER_PID);
		expect(heat).toBeTruthy();
		expect(heat!.hot).toBeCloseTo(25, 5);
		expect(heat!.base).toBeCloseTo(10, 5);
		expect(plainText(heat!.text)).toBe(
			"Player 12 is on a heater: 25.0 points a game over his last 5 (10.0 before that)",
		);
		// not before it started
		for (const g of games.slice(0, 10)) {
			expect(
				complete(raw0, g).pre.story.heaters.some((x) => x.pid === HEATER_PID),
			).toBe(false);
		}
	});

	test("revenge: first meeting with the team that traded him", () => {
		const meets = regular.filter(
			(g) =>
				g.teams.some((t) => t.tid === 2) && g.teams.some((t) => t.tid === 3),
		);
		const first = complete(raw0, meets[0]!).pre;
		const r = first.story.revenge.find((x) => x.pid === MOVER_PID);
		expect(r).toBeTruthy();
		expect(r!.how).toBe("traded");
		expect(r!.first).toBe(true);
		expect(r!.oppTid).toBe(3);
		const text = first.reasons.find(
			(x) => x.k === "revenge" && x.text.includes("Player 22"),
		)!.text;
		expect(plainText(text)).toMatch(
			/first time since they traded him last offseason|first crack at them/,
		);
		expect(plainText(text)).toContain("Team3");
		// the second meeting is no longer the first
		const second = complete(raw0, meets[1]!).pre;
		const r2 = second.story.revenge.find((x) => x.pid === MOVER_PID);
		expect(r2?.first ?? false).toBe(false);
		if (r2) {
			expect(
				plainText(second.reasons.find((x) => x.k === "revenge")!.text),
			).not.toMatch(/first time since|first crack/);
		}
		// he is never "revenge" against a team he did not play for
		const other = regular.find(
			(g) =>
				g.teams.some((t) => t.tid === 2) && g.teams.some((t) => t.tid === 6),
		)!;
		expect(
			complete(raw0, other).pre.story.revenge.some((x) => x.pid === MOVER_PID),
		).toBe(false);
	});

	test("rookie duel and last year's finals rematch", () => {
		const g = regular.find(
			(x) =>
				x.teams.some((t) => t.tid === 0) && x.teams.some((t) => t.tid === 1),
		)!;
		const h = complete(raw0, g).pre;
		expect(h.story.rookies).toBeTruthy();
		const txt = plainText(h.story.rookies!.text);
		expect(txt).toContain("Player 5");
		expect(txt).toContain("Player 15");
		expect([ROOKIE_A, ROOKIE_B]).toContain(h.story.rookies!.a.pid);
		// teams 0 and 1 met in the playoffs three times, last in 2029 (the finals)
		const meet = h.reasons.find(
			(r) => r.k === "rivalry" && r.text.startsWith("Met"),
		)!;
		expect(meet.text).toBe(
			"Met 3 times in the playoffs before (last in 2029), a rematch of last year's Finals",
		);
		expect(
			h.reasons.some(
				(r) =>
					r.text.includes("were knocked out by the City0 Team0 last season") ||
					r.text.includes("were knocked out by the City1 Team1 last season"),
			),
		).toBe(true);
	});

	test("record chase: on pace for the league single-season record", () => {
		const games = gamesOf(raw0, 3);
		const g = games[30]!;
		const h = complete(raw0, g).pre;
		const c = h.story.chases.find((x) => x.pid === CHASER_PID && x.k === "pts");
		expect(c).toBeTruthy();
		expect(c!.scope).toBe("league");
		expect(c!.kind).toBe("season");
		expect(c!.record.pid).toBe(HOLDER_PID);
		expect(c!.record.v).toBe(2700);
		expect(c!.cur).toBe(40 * 30);
		expect(c!.need).toBe(2700 - 40 * 30 + 1);
		expect(c!.proj).toBe(40 * NUM_GAMES);
		const t = plainText(h.reasons.find((r) => r.k === "chase")!.text);
		expect(t).toContain("league single-season points record");
		expect(t).toContain("Player 40");
		expect(t).toContain("in 2026");
		expect(t).toContain((2700 - 40 * 30 + 1).toLocaleString("en-US"));
		expect(t).toContain("40 games left");
		// the record holder himself is never "chasing" it
		for (const x of games
			.slice(10, 50)
			.map((gg) => complete(raw0, gg).pre.story.chases)) {
			expect(
				x.some((y) => y.pid === HOLDER_PID && y.record.pid === HOLDER_PID),
			).toBe(false);
		}
		// early in the season there is no pace to judge (15 games)
		expect(
			complete(raw0, games[5]!).pre.story.chases.some(
				(x) => x.pid === CHASER_PID,
			),
		).toBe(false);
		// the board shows him after 30 games
		const g30 = Math.max(...games.slice(0, 30).map((x) => x.day));
		const before = raw0.games.filter((x) => !x.playoffs && x.day <= g30);
		const teamNow = Object.fromEntries(
			raw0.teams.map((t) => {
				const gs = before.filter((x) => x.teams.some((y) => y.tid === t.tid));
				return [t.tid, { won: gs.length, lost: 0, tied: 0, otl: 0, streak: 0 }];
			}),
		);
		const rows = raw0.players.map((p) => ({
			...p,
			rows: p.rows.map((r) =>
				r.season === SEASON
					? {
							...r,
							gp: before.filter((x) =>
								x.teams.some((t) =>
									t.players.some((l) => l.pid === p.pid && l.min > 0),
								),
							).length,
							pts: before.reduce(
								(s, x) =>
									s +
									(x.teams
										.flatMap((t) => t.players)
										.find((l) => l.pid === p.pid)?.pts ?? 0),
								0,
							),
						}
					: r,
			),
		}));
		const board = chaseBoard({
			...raw0,
			games: before,
			players: rows,
			teamNow,
		});
		expect(
			board.some((x) => x.pid === CHASER_PID && x.scope === "league"),
		).toBe(true);
		expect(isBadText(board.map((x) => x.text).join("\n"))).toBe(false);
	});

	test("records: unknown stats are skipped, never counted as 0", () => {
		const players = raw0.players.map((p) => ({
			...p,
			rows: p.rows.map((r) => ({ ...r })),
		}));
		// holder of the points record loses his tp in one season: his tp career and that season are unknown
		const h = players[HOLDER_PID]!;
		delete h.rows[2]!.tp;
		const R = buildRecords(players, SEASON);
		expect(R.careerLeague.tp?.some((e) => e.pid === HOLDER_PID)).toBe(false);
		expect(R.seasonLeague.pts?.pid).toBe(HOLDER_PID);
		expect(R.seasonLeague.pts?.v).toBe(2700);
		expect(R.firstSeason).toBe(2022);
		expect(R.seasonFranchise[4]?.n).toBe(8);
		// naive recomputation of the career points leader
		const career = (pid: number) =>
			players[pid]!.rows.filter((r) => r.season < SEASON).reduce(
				(s, r) => s + r.pts!,
				0,
			);
		const best = players
			.map((p) => ({ pid: p.pid, v: career(p.pid) }))
			.sort((a, b) => b.v - a.v)[0]!;
		expect(R.careerLeague.pts![0]!.v).toBe(best.v);
		// active holders keep adding
		const R2 = withActiveCareers(R, (pid) =>
			players[pid]!.rows.filter((r) => r.season === SEASON),
		);
		const top = R2.careerLeague.pts![0]!;
		const cur = players[top.pid]!.rows.filter(
			(r) => r.season === SEASON,
		).reduce((s, r) => s + r.pts!, 0);
		expect(top.v).toBe(
			R.careerLeague.pts!.find((e) => e.pid === top.pid)!.v + cur,
		);
		// a player with an unknown stat never chases it
		const raw2: HRaw = { ...raw0, players, records: R };
		const g = gamesOf(raw2, 4)[40]!;
		const out = complete(raw2, g).pre;
		expect(isBadText(out.reasons.map((r) => r.text).join(" "))).toBe(false);
	});

	test("stakes: two winning teams and records match the box scores", () => {
		let seen = 0;
		for (const g of regular.filter((_, i) => i > 140 && i % 5 === 0)) {
			const h = complete(raw0, g).pre;
			const t = h.reasons.find((r) => r.text.startsWith("Two winning teams"));
			if (!t) {
				continue;
			}
			seen++;
			const rec = (tid: number) => {
				const gs = regular.filter(
					(x) => x.day < g.day && x.teams.some((y) => y.tid === tid),
				);
				const won = gs.filter(
					(x) =>
						x.teams.find((y) => y.tid === tid)!.pts >
						x.teams.find((y) => y.tid !== tid)!.pts,
				).length;
				return `${won}-${gs.length - won}`;
			};
			expect(t.text).toBe(
				`Two winning teams: ${rec(g.teams[0].tid)} vs ${rec(g.teams[1].tid)}`,
			);
		}
		expect(seen).toBeGreaterThan(0);
	});

	test("playoffs: series state, elimination, winner takes all", () => {
		const finalsGames = playoff.filter((g) =>
			raw0.series
				.find((s) => s.season === SEASON && s.round === 1)
				?.gids.includes(g.gid),
		);
		expect(finalsGames.length).toBeGreaterThanOrEqual(2);
		const first = complete(raw0, finalsGames[0]!).pre;
		expect(first.reasons.find((r) => r.k === "stakes")!.text).toBe(
			"Game 1 of the Finals",
		);
		expect(first.series!.text).toMatch(/^Game 1|^Series opener/);
		const last = complete(raw0, finalsGames.at(-1)!).pre;
		const lastText = last.reasons.find((r) => r.k === "stakes")!.text;
		expect(lastText).toMatch(
			/^Game \d of the Finals(: elimination game \(1-[01]\)|, winner takes all|: Game 3, winner takes all)/,
		);
		// a third game of a best-of-3 is winner takes all
		const three = raw0.series.find(
			(s) => s.season === SEASON && s.gids.length === 3,
		);
		if (three) {
			const g3 = raw0.games.find((g) => g.gid === three.gids[2])!;
			const t3 = complete(raw0, g3).pre;
			expect(t3.reasons.find((r) => r.k === "stakes")!.text).toMatch(
				/winner takes all/,
			);
			expect(t3.series!.lines.join(" ")).toContain("Winner takes");
		}
		expect(last.series!.hw + last.series!.aw).toBe(finalsGames.length - 1);
		// playoff games weigh more than a typical regular season game
		const avgRs =
			regular
				.slice(0, 60)
				.reduce((s, g) => s + complete(raw0, g).pre.score, 0) / 60;
		expect(first.score).toBeGreaterThan(avgRs);
		// no result of the game itself in the series line
		expect(first.series!.lines.join(" ")).not.toMatch(/\d+-\d+ \(/);
	});
});

describe("post-game verdict", () => {
	const g0 = playoff.at(-1)!;
	const variant = (patch: (g: HGame) => HGame): HRaw => ({
		...raw0,
		games: raw0.games.map((g) => (g.gid === g0.gid ? patch(g) : g)),
	});

	test("a close overtime game with a buzzer-beater lived up to a big billing", () => {
		const r = variant((g) => ({
			...g,
			overtimes: 1,
			clutch: [
				"[[p:12|Player 12]] made a game-winning three-pointer at the buzzer.",
			],
			teams: [
				{ ...g.teams[0], pts: 110, ptsQtrs: [28, 27, 25, 28, 2] },
				{ ...g.teams[1], pts: 108, ptsQtrs: [25, 29, 26, 28, 0] },
			],
		}));
		// make the lines add up to those scores is not needed by the engine: it reads the team totals
		const h = hypeForGame(r, targetOfGame(storedGame(r, g0.gid)!))!;
		expect(h.pre.score).toBeGreaterThanOrEqual(50);
		expect(h.post!.score).toBeGreaterThanOrEqual(60);
		expect(h.verdict!.kind).toBe("lived");
		expect(h.verdict!.text).toMatch(/overtime|buzzer|decided by 2/i);
		expect(h.verdict!.text).toMatch(/^[^(]+\(hype \d+, game \d+/);
		expect(isBadText(h.verdict!.text)).toBe(false);
	});

	test("a blowout fizzled", () => {
		const r = variant((g) => ({
			...g,
			overtimes: 0,
			clutch: [],
			teams: [
				{ ...g.teams[0], pts: 130, ptsQtrs: [40, 30, 30, 30] },
				{ ...g.teams[1], pts: 90, ptsQtrs: [20, 20, 25, 25] },
			],
		}));
		const h = hypeForGame(r, targetOfGame(storedGame(r, g0.gid)!))!;
		expect(h.verdict!.kind).toBe("fizzled");
		expect(h.post!.score).toBeLessThan(25);
		expect(h.post!.reasons[0]!.pts).toBeLessThan(0);
		expect(h.verdict!.text).toMatch(/won by 40/);
	});

	test("a game with nothing stored is not rated", () => {
		const r = variant((g) => ({
			...g,
			teams: [
				{ ...g.teams[0], pts: 0, players: [] },
				{ ...g.teams[1], pts: 0, players: [] },
			],
		}));
		const h = hypeForGame(r, targetOfGame(storedGame(r, g0.gid)!))!;
		expect(h.post!.score).toBe(0);
		expect(h.post!.note).toMatch(/nothing to rate/);
		expect(h.verdict).toBeNull();
	});
});

describe("star power of finished games", () => {
	const starText = (raw: HRaw, gid: number) => {
		const h = hypeForGame(raw, targetOfGame(storedGame(raw, gid)!));
		return JSON.stringify(h).match(/Star power:[^"]*/)?.[0] ?? "";
	};
	test("uses each player's ratings of the game's season, not later ones", () => {
		const raw = makeRaw();
		const gm = raw.games.find((x) => !x.playoffs)!;
		const before = starText(raw, gm.gid);
		const pid = gm.teams[0].players[0]!.pid;
		const p = raw.players.find((x) => x.pid === pid)!;
		const name = p.name;
		// a later season's (current) rating changes nothing
		for (const x of raw.players) {
			x.ovrBySeason = { ...x.ovrBySeason, [SEASON + 3]: 99 };
		}
		expect(starText(raw, gm.gid)).toBe(before);
		// that season's rating does
		p.ovrBySeason = { ...p.ovrBySeason, [SEASON]: 99 };
		const after = starText(raw, gm.gid);
		expect(after).toContain(`${name.split(" ").at(-1)}`);
		expect(after).toContain("(99)");
	});
});

describe("game rating calibration", () => {
	const late = regular.at(-20)!;
	const rate = (r: HRaw, gid: number) =>
		hypeForGame(r, targetOfGame(storedGame(r, gid)!))!;
	const patchGame = (gid: number, patch: (g: HGame) => HGame): HRaw => ({
		...raw0,
		games: raw0.games.map((g) => (g.gid === gid ? patch(g) : g)),
	});
	// one player's line replaced (team 0, his first box score line)
	const withLine = (g: HGame, line: Partial<HBoxLine>): HGame => ({
		...g,
		teams: [
			{
				...g.teams[0],
				players: g.teams[0].players.map((p, i) =>
					i === 0 ? { ...p, min: 40, ...line } : p,
				),
			},
			g.teams[1],
		],
	});
	const close = (g: HGame, a: number, b: number): HGame => ({
		...g,
		overtimes: 0,
		clutch: [],
		teams: [
			{ ...g.teams[0], pts: a, ptsQtrs: undefined },
			{ ...g.teams[1], pts: b, ptsQtrs: undefined },
		],
	});
	const mid = rate(raw0, late.gid).post!.score;

	test("21 assists and 2 turnovers in a close game rates high, and is listed", () => {
		const r = patchGame(late.gid, (g) =>
			withLine(close(g, 108, 106), {
				pts: 14,
				ast: 21,
				tov: 2,
				trb: 5,
				fg: 6,
				fga: 12,
				ft: 2,
				fta: 2,
			}),
		);
		const h = rate(r, late.gid);
		expect(h.post!.score).toBeGreaterThanOrEqual(80);
		expect(h.post!.score).toBeGreaterThan(mid);
		const top = h.post!.reasons.slice(0, 3).map((x) => plainText(x.text));
		expect(top.join("\n")).toMatch(/21 assists against only 2 turnovers/);
	});

	test("a 60-point game is near the top of the scale", () => {
		// Early in the season, before the league's own scoring environment is known (the fixture's lines average 12 points, so later its era scaling would count 60 like a 47-point game of a real league)
		const early = regular[10]!;
		const r = patchGame(early.gid, (g) =>
			withLine(close(g, 121, 112), {
				pts: 60,
				fg: 21,
				fga: 33,
				ft: 12,
				fta: 13,
				tp: 6,
				tpa: 11,
			}),
		);
		const h = rate(r, early.gid);
		expect(h.post!.score).toBeGreaterThanOrEqual(88);
		expect(plainText(h.post!.reasons[0]!.text)).toMatch(/60 points/);
	});

	test("good but not great lines barely count, historic ones dominate", () => {
		// judged against the calibration leagues (no scoring environment of its own yet)
		const I = { env: undefined } as unknown as Parameters<typeof evalLine>[0];
		const pts = (
			pts: number,
			trb: number,
			ast: number,
			more: Partial<HBoxLine> = {},
		) =>
			evalLine(
				I,
				{
					pid: 1,
					name: "X",
					min: 38,
					pts,
					trb,
					ast,
					stl: 1,
					blk: 0,
					tp: 2,
					tpa: 6,
					fg: Math.round(pts / 2.4),
					fga: Math.round(pts / 1.25),
					ft: 4,
					fta: 5,
					tov: 3,
					...more,
				},
				0,
			).pts;
		// star nights that most games have someone close to: nothing, or next to it
		for (const [a, b, c] of [
			[25, 5, 5],
			[28, 8, 6],
			[30, 4, 3],
			[22, 4, 12],
			[30, 10, 3],
			[35, 5, 4],
			[15, 10, 10],
			[30, 12, 12],
		] as const) {
			expect(pts(a, b, c)).toBeLessThanOrEqual(1.5);
		}
		expect(pts(40, 6, 4)).toBeLessThan(5);
		// correlated stats are not added up: a 30-12-12 triple-double is less than a 45-point game
		expect(pts(30, 12, 12)).toBeLessThan(pts(45, 6, 4));
		expect(pts(50, 7, 5)).toBeGreaterThanOrEqual(10);
		expect(pts(60, 8, 5)).toBeGreaterThan(2.5 * pts(50, 7, 5));
		expect(pts(14, 4, 21, { tov: 2 })).toBeGreaterThan(
			pts(14, 4, 21, { tov: 7 }),
		);
	});

	test("only the best two lines count", () => {
		const g = late;
		const many = patchGame(g.gid, (x) => ({
			...x,
			teams: [
				{
					...x.teams[0],
					players: x.teams[0].players.map((p, i) =>
						i < 4 ? { ...p, min: 38, pts: 38, fg: 14, fga: 26 } : p,
					),
				},
				x.teams[1],
			],
		}));
		const h = rate(many, g.gid);
		expect(
			h.post!.reasons.filter((r) => r.k === "star" || r.k === "duel").length,
		).toBeLessThanOrEqual(2);
	});

	test("a deciding game (Game 7 style) won in overtime on a game-winner is legendary, before and after", () => {
		// a series that went the distance: its last game is winner-takes-all
		const s = raw0.series.find(
			(x) =>
				x.season === SEASON &&
				x.away &&
				x.home.won === x.numToWin &&
				x.away.won === x.numToWin - 1,
		)!;
		const gid = s.gids.at(-1)!;
		const r = patchGame(gid, (g) => {
			const hw = g.teams[0].tid === s.home.tid;
			const p = g.teams[hw ? 0 : 1].players[0]!;
			const [w, l] = [111, 109];
			return {
				...g,
				overtimes: 1,
				clutch: [
					`[[p:${p.pid}|${p.name}]] made a game-winning jumper with 1.2 seconds remaining`,
				],
				teams: [
					{
						...g.teams[0],
						pts: hw ? w : l,
						ptsQtrs: hw ? [25, 26, 24, 27, 9] : [27, 24, 26, 25, 7],
					},
					{
						...g.teams[1],
						pts: hw ? l : w,
						ptsQtrs: hw ? [27, 24, 26, 25, 7] : [25, 26, 24, 27, 9],
					},
				],
			};
		});
		const h = rate(r, gid);
		expect(h.pre.reasons[0]!.text).toMatch(/winner takes all/);
		expect(h.pre.score).toBeGreaterThanOrEqual(90);
		// (top 0.5% of real-league games, whose playoff tail runs longer than the old simplified sim's)
		expect(h.post!.score).toBeGreaterThanOrEqual(93);
		expect(h.verdict!.kind).toBe("lived");
		expect(h.post!.reasons.map((x) => x.text).join("\n")).toMatch(
			/Winner takes all|game-winning/,
		);
	});

	test("a 40-point blowout between two bad teams rates near the bottom", () => {
		const r = patchGame(late.gid, (g) => ({
			...g,
			overtimes: 0,
			clutch: [],
			teams: [
				{
					...g.teams[0],
					pts: 130,
					ptsQtrs: [35, 35, 30, 30],
					won: 16,
					lost: 46,
				},
				{
					...g.teams[1],
					pts: 90,
					ptsQtrs: [20, 22, 24, 24],
					won: 18,
					lost: 45,
				},
			],
		}));
		const h = rate(r, late.gid);
		expect(h.post!.score).toBeLessThanOrEqual(10);
		const neg = h.post!.reasons.filter((x) => x.pts < 0).map((x) => x.text);
		expect(neg.join("\n")).toMatch(/won by 40/);
		expect(neg.join("\n")).toMatch(/Two losing teams/);
	});

	test("works from box score totals alone (no shooting, no turnovers, no quarters)", () => {
		const strip: HRaw = {
			...raw0,
			games: raw0.games.map((g) => ({
				...g,
				clutch: [],
				teams: g.teams.map((t) => ({
					...t,
					ptsQtrs: undefined,
					players: t.players.map(({ fg, fga, ft, fta, tov, tpa, ...p }) => p),
				})) as HGame["teams"],
			})),
		};
		for (const g of strip.games.filter((_, i) => i % 25 === 0)) {
			const h = rate(strip, g.gid);
			expect(h.post!.score).toBeGreaterThanOrEqual(0);
			expect(h.post!.score).toBeLessThanOrEqual(100);
			expect(isBadText(allText(h))).toBe(false);
		}
	});

	test("scores spread over the scale", () => {
		const post = raw0.games.map((g) => rate(raw0, g.gid).post!.score);
		const pre = raw0.games.map((g) => rate(raw0, g.gid).pre.score);
		// (the fixture plants story lines in most games, so its pre-game hype sits higher than a real league's)
		for (const v of [post, pre]) {
			const s = [...v].sort((a, b) => a - b);
			const q = (p: number) => s[Math.floor(p * (s.length - 1))]!;
			expect(q(0.9) - q(0.1)).toBeGreaterThanOrEqual(30);
			// (calibrated on a real league; the synthetic fixture's tails are thinner)
			expect(q(0.95)).toBeGreaterThanOrEqual(65);
			if (v === post) {
				expect(q(0.05)).toBeLessThanOrEqual(30);
			}
		}
	});

	test("the scale: monotone, 0 at the bottom, 100 at the top", () => {
		let last = -1;
		for (let x = -100; x <= 300; x += 0.5) {
			const s = postScore(x);
			expect(s).toBeGreaterThanOrEqual(last);
			last = s;
		}
		expect(postScore(-1000)).toBe(0);
		expect(postScore(1000)).toBe(100);
		expect(preScore(1000)).toBe(100);
		// rarity grows with the value, and the era scale matters
		expect(rarity("ast", 21)).toBeGreaterThan(rarity("ast", 15));
		expect(rarity("ast", 12, 1.5)).toBeGreaterThan(rarity("ast", 12));
	});
});

describe("stars out", () => {
	test("an injured star who sat out lowers the hype and is named", () => {
		const gm = regular[200]!;
		const bl = gm.teams[0].players[0]!;
		const raw: HRaw = {
			...raw0,
			games: raw0.games.map((g) =>
				g.gid === gm.gid
					? {
							...g,
							teams: [
								{
									...g.teams[0],
									players: g.teams[0].players.map((p) =>
										p.pid === bl.pid ? { ...p, inj: true, min: 0 } : p,
									),
								},
								g.teams[1],
							],
						}
					: g,
			),
		};
		raw.players = raw0.players.map((p) =>
			p.pid === bl.pid
				? { ...p, ovrBySeason: { ...p.ovrBySeason, [SEASON]: 95 } }
				: p,
		);
		const h = hypeForGame(raw, targetOfGame(storedGame(raw, gm.gid)!))!;
		const r = h.pre.reasons.find((x) => x.k === "injury");
		expect(r?.pts).toBeLessThan(0);
		expect(r?.text).toContain(bl.name);
		expect(h.pre.reasons.every((x) => !x.text.includes("undefined"))).toBe(
			true,
		);
	});
});
