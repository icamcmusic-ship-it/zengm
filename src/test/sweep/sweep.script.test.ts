// @ts-nocheck (node-only diagnostic script)
/* eslint-disable no-undef */
// Runtime bug sweep: creates leagues the way the New League page does and auto plays them through every phase (all teams by the
// AI), then checks the stored data and renders every worker view. Opt in with
//   RUN_SWEEP=1 npx vitest run --project basketball src/test/sweep/sweep.script.test.ts
// SWEEP_CONFIGS=random,real,college,unusual picks the leagues (default all), SWEEP_SEASONS the random league's seasons (default 6),
// SWEEP_OUT=<file> writes the JSON report there (default: printed). SWEEP_VIEWS=0 skips the view renders.
import "fake-indexeddb/auto";
import { appendFileSync, writeFileSync } from "node:fs";
import { assert, test } from "vitest";
import {
	LEAGUE_DATABASE_VERSION,
	PHASE,
	PLAYER,
} from "../../common/constants.ts";
import { defaultGameAttributes } from "../../common/defaultGameAttributes.ts";
import { makeSeededRandom } from "../../common/random.ts";
import { last } from "../../common/utils.ts";
import { getCurrentContract } from "../../common/contracts.ts";
import { getCollegeLeagueTeams } from "../../common/college/teams.ts";
import { getCollegeSettings } from "../../common/college/settings.ts";
import {
	game,
	league,
	realRosters,
	season as seasonCore,
	team,
} from "../../worker/core/index.ts";
import { startAutoPlay } from "../../worker/core/league/autoPlay.ts";
import * as views from "../../worker/views/index.ts";
import { idb } from "../../worker/db/index.ts";
import { getDefaultSettings } from "../../worker/views/newLeague.ts";
import { g, helpers, local, lock } from "../../worker/util/index.ts";

// Progress and findings, as they happen (SWEEP_LOG=<file>, else stdout)
const log = (...args: unknown[]) => {
	const line = args
		.map((a) => (typeof a === "string" ? a : String(a)))
		.join(" ");
	if (process.env.SWEEP_LOG) {
		appendFileSync(process.env.SWEEP_LOG, `${line}\n`);
	} else {
		process.stdout.write(`${line}\n`);
	}
};

type Issue = { config: string; kind: string; where: string; detail: string };

const SKIP_VIEWS = new Set([
	"account",
	"accountUpdateCard",
	"resetPassword",
	// Fetches remote files
	"exportLeague",
	// Football/hockey only (not routed in basketball)
	"depth",
]);

// Views whose route always has a type: every type
const TYPE_VARIANTS: Record<string, string[]> = {
	most: "busts college country earnings games_injured games_no_playoffs goat goat_season hall_of_good hall_of_shame jersey_number no_mvp no_ring oldest oldest_former_players oldest_mvp oldest_peaks one_team progs progs_career retired_jersey_numbers rookies steals teams traded worst_injuries youngest_mvp youngest_peaks".split(
		" ",
	),
	frivolitiesTrades: ["biggest", "lopsided"],
	frivolitiesTeamSeasons:
		"best best_non_playoff old_champ worst worst_champ worst_finals worst_playoff young_champ".split(
			" ",
		),
};

const isBad = (x: number) =>
	Number.isNaN(x) || x === Infinity || x === -Infinity;

// Paths to NaN/Infinity numbers and "undefined"/"NaN" in strings inside a value
const scan = (
	value: unknown,
	path: string,
	out: string[],
	opts: { strings: boolean; infinityOk?: boolean },
	seen = new Set<unknown>(),
	depth = 0,
) => {
	if (out.length > 20 || depth > 14) {
		return;
	}
	if (typeof value === "number") {
		if (Number.isNaN(value) || (!opts.infinityOk && isBad(value))) {
			out.push(`${path}=${value}`);
		}
	} else if (typeof value === "string") {
		if (
			opts.strings &&
			/(^|\W)(NaN|undefined|null|\[object Object])(\W|$)/.test(value)
		) {
			out.push(`${path}="${value.slice(0, 200)}"`);
		}
	} else if (value && typeof value === "object") {
		if (seen.has(value)) {
			return;
		}
		seen.add(value);
		if (value instanceof Map) {
			for (const [k, v] of value) {
				scan(v, `${path}.${String(k)}`, out, opts, seen, depth + 1);
			}
		} else if (value instanceof Set) {
			// skip
		} else if (ArrayBuffer.isView(value)) {
			for (let i = 0; i < (value as any).length; i++) {
				scan((value as any)[i], `${path}[${i}]`, out, opts, seen, depth + 1);
			}
		} else if (Array.isArray(value)) {
			for (let i = 0; i < value.length; i++) {
				scan(value[i], `${path}[${i}]`, out, opts, seen, depth + 1);
			}
		} else {
			for (const k of Object.keys(value)) {
				scan((value as any)[k], `${path}.${k}`, out, opts, seen, depth + 1);
			}
		}
	}
};

const newsTextScan = (text: string) => {
	const problems: string[] = [];
	if (/\b(undefined|NaN|null)\b|\[object Object]/.test(text)) {
		problems.push("undefined/NaN/null");
	}
	// Glued words: a lowercase letter right before an uppercase one after a sentence end without a space ("game.The"), or two
	// words glued at a tag boundary
	if (/[a-z][!.?][A-Z][a-z]/.test(text)) {
		problems.push("glued sentence");
	}
	if (/ {2,}/.test(text.replace(/\n/g, ""))) {
		problems.push("double space");
	}
	if (/ [,.:;](\s|$)/.test(text)) {
		problems.push("space before punctuation");
	}
	return problems;
};

const loadView = async (id: string, params: Record<string, unknown>) => {
	const view = (views as any)[id];
	const inputs = view.processInputs ? view.processInputs(params, {}) : {};
	if (inputs && typeof inputs.redirectUrl === "string") {
		return { redirectUrl: inputs.redirectUrl };
	}
	return await lock.runView(() =>
		view.load({
			inputs,
			updateEvents: new Set(["firstRun"]),
			// As on a page's first load
			prevInputs: undefined,
			prevOutput: {},
			conditions: {},
		}),
	);
};

const createLeague = async ({
	lid,
	name,
	settings,
	realLeague,
	getLeagueOptions,
	teamsFromInput,
	confs,
	divs,
	tid = 0,
}: any) => {
	await league.createStream(realLeague ?? {}, {
		confs: confs ?? last(defaultGameAttributes.confs).value,
		divs: divs ?? last(defaultGameAttributes.divs).value,
		fromFile: {
			gameAttributes: realLeague?.gameAttributes,
			hasRookieContracts: true,
			maxGid: undefined,
			startingSeason: realLeague?.startingSeason,
			teams: realLeague?.teams,
			version: LEAGUE_DATABASE_VERSION,
		},
		getLeagueOptions,
		keptKeys: new Set(
			realLeague
				? [...Object.keys(realLeague), "startingSeason", "version"]
				: [],
		),
		lid,
		name,
		setLeagueCreationStatus: () => {},
		settings,
		shuffleRosters: false,
		startingSeasonFromInput: realLeague
			? String(realLeague.startingSeason)
			: "2025",
		teamsFromInput:
			teamsFromInput ??
			realLeague?.teams ??
			helpers.addPopRank(helpers.getTeamsDefault()),
		tid,
	});
	await league.loadGameAttributes();
	local.autoPlayUntil = undefined;
};

const STORES_TO_SCAN = [
	"players",
	"teamSeasons",
	"teamStats",
	"games",
	"playoffSeries",
	"awards",
	"events",
	"messages",
	"teams",
	"draftPicks",
	"coaches",
	"draftLotteryResults",
	"allStars",
] as const;

const sweepLeague = async ({
	config,
	issues,
	seasons,
	extraChecks,
}: {
	config: string;
	issues: Issue[];
	seasons: number;
	extraChecks?: () => Promise<void>;
}) => {
	const add = (kind: string, where: string, detail: string) => {
		issues.push({ config, kind, where, detail });
		if (issues.length < 2000) {
			log(`[sweep:${config}] ${kind} @ ${where}: ${detail}`);
		}
	};
	const where = () => `s${g.get("season")} p${g.get("phase")}`;

	const checkState = async (label: string) => {
		const userTids = g.get("userTids");
		const teams = (await idb.cache.teams.getAll()).filter((t) => !t.disabled);
		const phase = g.get("phase");
		const isCollege = g.get("leagueType") === "college";
		// Rosters within limits (the regular season and playoffs only: the offseason is allowed to be over/under)
		// (not right at the start of the regular season: the AI's rosters are trimmed before the first game)
		if (phase === PHASE.PLAYOFFS || phase === PHASE.AFTER_TRADE_DEADLINE) {
			for (const t of teams) {
				const n = (await idb.cache.players.indexGetAll("playersByTid", t.tid))
					.length;
				if (n > g.get("maxRosterSize") || n < g.get("minRosterSize")) {
					add(
						"roster size",
						`${label} ${where()}`,
						`${t.abbrev} has ${n} (min ${g.get("minRosterSize")}, max ${g.get("maxRosterSize")})`,
					);
				}
			}
		}
		// Hard cap: payroll can be over only from contracts signed before (here, check new signings did not push over)
		const players = await idb.cache.players.getAll();
		const pids = new Set<number>();
		for (const p of players) {
			if (pids.has(p.pid)) {
				add("duplicate pid", label, String(p.pid));
			}
			pids.add(p.pid);
			// (with a hard cap, this year's draft picks sign in the re-signing phase)
			const unsignedPick =
				p.draft.year === g.get("season") &&
				phase >= PHASE.DRAFT &&
				phase <= PHASE.RESIGN_PLAYERS;
			if (p.tid >= 0 && !isCollege && !unsignedPick && !getCurrentContract(p)) {
				add("no contract", `${label} ${where()}`, `pid ${p.pid} tid ${p.tid}`);
			}
			if (p.tid >= 0 && !teams.some((t) => t.tid === p.tid)) {
				add(
					"player on inactive team",
					`${label} ${where()}`,
					`pid ${p.pid} tid ${p.tid}`,
				);
			}
		}
		if (g.get("salaryCapType") === "hard" && !isCollege) {
			for (const t of teams) {
				const payroll = await team.getPayroll(t.tid);
				if (payroll > g.get("salaryCap") * 1.25) {
					add(
						"hard cap",
						`${label} ${where()}`,
						`${t.abbrev} payroll ${payroll} cap ${g.get("salaryCap")}`,
					);
				}
			}
		}
		// Staff
		if (g.get("coachingStaff")) {
			const coaches = await idb.cache.coaches.getAll();
			const cids = new Set<number>();
			for (const c of coaches) {
				if (cids.has(c.cid)) {
					add("duplicate cid", label, String(c.cid));
				}
				cids.add(c.cid);
			}
			if (phase === PHASE.REGULAR_SEASON) {
				for (const t of teams) {
					if (!coaches.some((c) => c.tid === t.tid && c.role === "head")) {
						add("no head coach", `${label} ${where()}`, t.abbrev);
					}
				}
			}
		}
		const gmids = new Set<number>();
		for (const t of teams) {
			if (t.gm) {
				if (gmids.has(t.gm.gmid)) {
					add(
						"duplicate gmid",
						`${label} ${where()}`,
						`${t.gm.gmid} (${t.abbrev})`,
					);
				}
				gmids.add(t.gm.gmid);
			} else if (
				g.get("featureGmPersonalities") &&
				!userTids.includes(t.tid) &&
				phase === PHASE.REGULAR_SEASON &&
				!isCollege
			) {
				add("no AI GM", `${label} ${where()}`, t.abbrev);
			}
		}
		void userTids;
	};

	const scanStores = async (label: string) => {
		await idb.cache.flush();
		for (const store of STORES_TO_SCAN) {
			let rows: any[];
			try {
				rows = await idb.league.getAll(store);
			} catch (error) {
				add("store read", store, String(error));
				continue;
			}
			let count = 0;
			for (const row of rows) {
				const out: string[] = [];
				scan(row, store, out, {
					strings: store !== "players",
					infinityOk: true,
				});
				if (out.length > 0) {
					count += 1;
					if (count <= 5) {
						add(
							"bad value in store",
							`${label} ${store}`,
							`${JSON.stringify(row.pid ?? row.tid ?? row.gid ?? row.eid ?? row.mid ?? row.season)}: ${out.slice(0, 5).join("; ")}`,
						);
					}
				}
			}
			if (count > 5) {
				add("bad value in store", `${label} ${store}`, `${count} rows total`);
			}
		}
		// Messages and events: text problems
		for (const m of await idb.league.getAll("messages")) {
			for (const prob of newsTextScan(m.text ?? "")) {
				add("message text", label, `${prob}: ${(m.text ?? "").slice(0, 300)}`);
			}
		}
		let evCount = 0;
		for (const e of await idb.league.getAll("events")) {
			const text = (e.text ?? "").replace(/<[^>]+>/g, "");
			for (const prob of newsTextScan(text)) {
				evCount += 1;
				if (evCount <= 25) {
					add("event text", label, `${e.type} ${prob}: ${text.slice(0, 300)}`);
				}
			}
		}
		// Consistency of the season just finished
		const finished =
			g.get("phase") >= PHASE.DRAFT_LOTTERY
				? g.get("season")
				: g.get("season") - 1;
		const isCollege = g.get("leagueType") === "college";
		const teamSeasons = (await idb.league.getAll("teamSeasons")).filter(
			(ts) => ts.season === finished,
		);
		const gpCounts = new Map<number, number>();
		for (const ts of teamSeasons) {
			const gp = ts.won + ts.lost + (ts.tied ?? 0) + (ts.otl ?? 0);
			gpCounts.set(gp, (gpCounts.get(gp) ?? 0) + 1);
		}
		log(
			`[sweep:${config}] season ${finished}: ${teamSeasons.length} team seasons, games played ${JSON.stringify(Object.fromEntries(gpCounts))}, active teams ${g.get("numActiveTeams")}`,
		);
		if (!isCollege && gpCounts.size > 1) {
			add(
				"unequal games played",
				label,
				`season ${finished}: ${JSON.stringify(Object.fromEntries(gpCounts))}`,
			);
		}
		const series = (await idb.league.getAll("playoffSeries")).find(
			(ps) => ps.season === finished,
		);
		if (series) {
			const numRounds = series.series.length;
			const champs = teamSeasons.filter(
				(ts) => ts.playoffRoundsWon === numRounds,
			);
			if (champs.length !== 1) {
				add(
					"champion count",
					label,
					`season ${finished}: ${champs.length} teams with ${numRounds} rounds won`,
				);
			}
			const finals = series.series.at(-1)?.[0];
			if (finals) {
				const winner =
					finals.home.won > finals.away.won ? finals.home.tid : finals.away.tid;
				if (champs[0] && champs[0].tid !== winner) {
					add(
						"champion mismatch",
						label,
						`season ${finished}: teamSeasons ${champs[0].tid}, series ${winner}`,
					);
				}
			}
		} else if (!isCollege) {
			add("no playoff series", label, `season ${finished}`);
		}
		// Box scores: the players' points add up to the team's
		let boxChecked = 0;
		for (const game of await idb.league.getAll("games")) {
			if (game.season !== finished) {
				continue;
			}
			boxChecked += 1;
			for (const t of game.teams) {
				const sum = t.players.reduce((acc, p) => acc + (p.pts ?? 0), 0);
				if (sum !== t.pts) {
					add(
						"box score sum",
						label,
						`gid ${game.gid} tid ${t.tid}: players ${sum}, team ${t.pts}`,
					);
					break;
				}
			}
		}
		// Player stats: games played within the season
		// (college: the conference tournaments are regular season games too)
		const maxGp = g.get("numGames") + (isCollege ? 6 : 0);
		for (const p of await idb.league.getAll("players")) {
			for (const row of p.stats) {
				if (row.season === finished && !row.playoffs && row.gp > maxGp + 3) {
					add(
						"player gp",
						label,
						`pid ${p.pid} season ${finished} tid ${row.tid} gp ${row.gp} > ${maxGp}`,
					);
				}
				if (row.season === finished && row.gp > 0 && row.min / row.gp > 60) {
					add(
						"player min",
						label,
						`pid ${p.pid} season ${finished} min/g ${row.min / row.gp}`,
					);
				}
			}
		}
		log(
			`[sweep:${config}] season ${finished}: ${boxChecked} box scores checked`,
		);

		// Awards each season
		const awards = await idb.league.getAll("awards");
		const seasonsDone = new Set(awards.map((a) => a.season));
		for (let s = g.get("startingSeason"); s < g.get("season"); s++) {
			if (!seasonsDone.has(s)) {
				add("missing awards", label, `season ${s}`);
			}
		}
		for (const a of awards) {
			if (!Array.isArray(a.awards) || a.awards.length < 5) {
				add(
					"awards incomplete",
					label,
					`season ${a.season}: ${JSON.stringify(a).slice(0, 300)}`,
				);
			}
		}
	};

	const views0 = Object.keys(views).filter((id) => !SKIP_VIEWS.has(id));
	const renderViews = async (label: string) => {
		if (process.env.SWEEP_VIEWS === "0") {
			return;
		}
		const season = g.get("season");
		const userTid = g.get("userTid");
		const t = await idb.cache.teams.get(userTid);
		const somePlayer = (
			await idb.cache.players.indexGetAll("playersByTid", userTid)
		)[0];
		const coaches = await idb.cache.coaches.getAll();
		const games = await idb.cache.games.getAll();
		const lastGame = games.at(-1);
		const variants: Record<string, unknown>[] = [
			{},
			{ season: String(season - 1) },
			{
				abbrev: t?.abbrev,
				tid: String(userTid),
				team: t?.abbrev,
				season: String(season),
			},
			{ pid: somePlayer ? String(somePlayer.pid) : undefined },
			{ cid: coaches[0] ? String(coaches[0].cid) : undefined },
			{
				gid: lastGame ? String(lastGame.gid) : undefined,
				season: String(season),
				abbrev: t?.abbrev,
			},
			{ playoffs: "playoffs", season: String(season), team: t?.abbrev },
		];
		const tradeEvent = (await idb.cache.events.getAll())
			.filter((e) => e.type === "trade")
			.at(-1);
		const seenErrors = new Set<string>();
		let numRendered = 0;
		const errorMessages = new Map<string, number>();
		for (const id of views0) {
			let viewVariants = variants;
			if (TYPE_VARIANTS[id]) {
				viewVariants = TYPE_VARIANTS[id].map((type) => ({
					type,
					team: "all",
					arg: "1",
				}));
			} else if (id === "tradeSummary") {
				viewVariants = tradeEvent ? [{ eid: String(tradeEvent.eid) }] : [];
			}
			for (const params of viewVariants) {
				const key = `${id} ${JSON.stringify(params)}`;
				let out: any;
				try {
					out = await loadView(id, params);
				} catch (error) {
					const errKey = `${id} ${String(error)}`;
					if (seenErrors.has(errKey)) {
						continue;
					}
					seenErrors.add(errKey);
					add(
						"view threw",
						`${label} ${where()} ${key}`,
						String(error?.stack ?? error)
							.split("\n")
							.slice(0, 6)
							.join(" | "),
					);
					continue;
				}
				numRendered += 1;
				if (out && typeof out.errorMessage === "string") {
					const k = `${id}: ${out.errorMessage.replace(/<[^>]+>/g, "").slice(0, 80)}`;
					errorMessages.set(k, (errorMessages.get(k) ?? 0) + 1);
				}
				const bad: string[] = [];
				scan(out, id, bad, { strings: true, infinityOk: true });
				// (the tracking award variables are NaN without data by design, shown as a dash; React keys may hold "null")
				for (let i = bad.length - 1; i >= 0; i--) {
					if (/(VsExp|con36)=NaN$/.test(bad[i]) || /\.key="/.test(bad[i])) {
						bad.splice(i, 1);
					}
				}
				if (bad.length > 0) {
					const errKey = `${id} bad ${bad[0].replace(/\[\d+]/g, "[]")}`;
					if (!seenErrors.has(errKey)) {
						seenErrors.add(errKey);
						add(
							"view bad value",
							`${label} ${where()} ${key}`,
							bad.slice(0, 6).join("; "),
						);
					}
				}
			}
		}
		log(
			`[sweep:${config}] views ${label} ${where()}: ${numRendered} rendered, error messages: ${[...errorMessages.keys()].join(" / ")}`,
		);
		// Newspaper text
		try {
			const out: any = await loadView("newspaper", {});
			const text = JSON.stringify(out);
			if (/\bundefined\b|\bNaN\b/.test(text)) {
				add(
					"newspaper",
					label,
					text.match(/.{0,80}(undefined|NaN).{0,80}/)?.[0] ?? "",
				);
			}
			const strings: string[] = [];
			const collect = (v: any) => {
				if (typeof v === "string") {
					strings.push(v);
				} else if (v && typeof v === "object") {
					for (const k of Object.keys(v)) {
						collect(v[k]);
					}
				}
			};
			collect(out);
			let n = 0;
			for (const s of strings) {
				if (s.length < 30) {
					continue;
				}
				for (const prob of newsTextScan(s)) {
					n += 1;
					if (n <= 15) {
						add(
							"newspaper text",
							`${label} ${where()}`,
							`${prob}: ${s.slice(0, 300)}`,
						);
					}
				}
			}
		} catch (error) {
			add("newspaper threw", label, String(error));
		}
		// Power rankings and odds
		try {
			const pr: any = await loadView("powerRankings", {});
			for (const row of pr.teams ?? []) {
				const bad: string[] = [];
				scan(row, "pr", bad, { strings: false });
				if (bad.length) {
					add("power rankings", `${label} ${where()}`, bad.join("; "));
				}
			}
			const ranks = (pr.teams ?? [])
				.map((t) => t.powerRankings?.rank)
				.sort((a, b) => a - b);
			for (let i = 0; i < ranks.length; i++) {
				if (ranks[i] !== i + 1) {
					add(
						"power rankings",
						`${label} ${where()}`,
						`ranks ${ranks.join(",")}`,
					);
					break;
				}
			}
		} catch (error) {
			add("powerRankings threw", label, String(error));
		}
		try {
			const st: any = await loadView("standings", {});
			const odds = st.seasonOdds;
			if (odds) {
				let title = 0;
				let playoffs = 0;
				const rounds: number[] = [];
				for (const t of odds.teams) {
					title += t.title;
					playoffs += t.playoffs;
					const seedSum = t.seeds.reduce((a, b) => a + b, 0);
					if (seedSum > 1.0001 || Math.abs(seedSum - t.playoffs) > 0.0001) {
						add(
							"odds",
							`${label} ${where()}`,
							`tid ${t.tid} seeds sum ${seedSum} playoffs ${t.playoffs}`,
						);
					}
					t.roundsWon.forEach((x, i) => {
						rounds[i] = (rounds[i] ?? 0) + x;
					});
					for (let i = 1; i < t.roundsWon.length; i++) {
						if (t.roundsWon[i] > t.roundsWon[i - 1] + 1e-9) {
							add(
								"odds",
								`${label} ${where()}`,
								`tid ${t.tid} roundsWon not decreasing ${t.roundsWon}`,
							);
							break;
						}
					}
				}
				log(
					`[sweep:${config}] odds ${where()} title ${title.toFixed(3)} playoffs ${playoffs.toFixed(2)} rounds ${rounds.map((x) => x.toFixed(2)).join(",")}`,
				);
				if (Math.abs(title - 1) > 0.01) {
					add("odds", `${label} ${where()}`, `title odds sum ${title}`);
				}
				for (let i = 0; i < rounds.length; i++) {
					const expected = 2 ** (rounds.length - 1 - i);
					if (Math.abs(rounds[i] - expected) > 0.01) {
						add(
							"odds",
							`${label} ${where()}`,
							`round ${i} winners sum ${rounds[i]} (expected ${expected})`,
						);
					}
				}
			}
		} catch (error) {
			add("standings threw", label, String(error));
		}
	};

	// Play through, one phase at a time
	const PHASES = [
		// (not the trade deadline: the auto play dialog doesn't offer it, and the day's sim goes on past it)
		PHASE.REGULAR_SEASON,
		PHASE.PLAYOFFS,
		PHASE.DRAFT_LOTTERY,
		PHASE.DRAFT,
		PHASE.AFTER_DRAFT,
		PHASE.RESIGN_PLAYERS,
		PHASE.FREE_AGENCY,
		PHASE.PRESEASON,
	];
	await checkState("start");
	await renderViews("start");
	const start = g.get("season");
	for (let i = 0; i < seasons; i++) {
		const season = start + i;
		for (const target of PHASES) {
			const targetSeason = target === PHASE.PRESEASON ? season + 1 : season;
			if (
				g.get("season") > targetSeason ||
				(g.get("season") === targetSeason && g.get("phase") >= target)
			) {
				continue;
			}
			const t0 = Date.now();
			try {
				await startAutoPlay(targetSeason, target, {});
			} catch (error) {
				add(
					"auto play threw",
					`to s${targetSeason} p${target} at ${where()}`,
					String(error?.stack ?? error)
						.split("\n")
						.slice(0, 8)
						.join(" | "),
				);
				throw error;
			}
			log(
				`[sweep:${config}] reached ${where()} (target s${targetSeason} p${target}) in ${((Date.now() - t0) / 1000).toFixed(0)}s`,
			);
			// Auto play resolves from inside the phase change, while the day's sim is still unwinding: let it finish
			for (let k = 0; k < 500; k++) {
				if (
					!lock.get("gameSim") &&
					!lock.get("newPhase") &&
					!lock.get("drafting")
				) {
					break;
				}
				await new Promise((resolve) => setTimeout(resolve, 10));
			}
			for (const key of ["gameSim", "newPhase", "drafting"] as const) {
				if (lock.get(key)) {
					add("lock left set", where(), key);
				}
			}
			await checkState(`after p${target}`);
			const firstOrLast = i === 0 || i === seasons - 1;
			// Mid-season and mid-playoffs, as the play menu does it (a number of days)
			if (target === PHASE.REGULAR_SEASON || target === PHASE.PLAYOFFS) {
				const days =
					target === PHASE.REGULAR_SEASON
						? Math.max(
								1,
								Math.floor((await seasonCore.getDaysLeftSchedule()) / 2),
							)
						: 4;
				try {
					await game.play(days, {});
				} catch (error) {
					add(
						"game.play threw",
						where(),
						String(error?.stack ?? error)
							.split("\n")
							.slice(0, 8)
							.join(" | "),
					);
					throw error;
				}
				log(`[sweep:${config}] played ${days} days, now ${where()}`);
				await checkState(`mid p${target}`);
				await renderViews(`mid p${target}`);
			}
			// Render the views at a few more points: the draft, free agency, the preseason
			if (
				firstOrLast &&
				(target === PHASE.DRAFT ||
					target === PHASE.FREE_AGENCY ||
					target === PHASE.PRESEASON)
			) {
				await renderViews(`after p${target}`);
			}
		}
		await scanStores(`after season ${season}`);
		// Draft classes complete
		const prospects = await idb.cache.players.indexGetAll(
			"playersByTid",
			PLAYER.UNDRAFTED,
		);
		if (
			g.get("leagueType") !== "college" &&
			g.get("draftType") !== "freeAgents"
		) {
			for (const s of [
				g.get("season"),
				g.get("season") + 1,
				g.get("season") + 2,
			]) {
				const n = prospects.filter((p) => p.draft.year === s).length;
				const needed = g.get("numDraftRounds") * g.get("numActiveTeams");
				if (n < needed) {
					add(
						"draft class short",
						`after season ${season}`,
						`class ${s}: ${n} < ${needed}`,
					);
				}
			}
		}
		await extraChecks?.();
	}
};

const runConfig = async (
	config: string,
	issues: Issue[],
	f: () => Promise<void>,
) => {
	const t0 = Date.now();
	try {
		await f();
	} catch (error) {
		issues.push({
			config,
			kind: "config threw",
			where: `s${g.get("season")} p${g.get("phase")}`,
			detail: String(error?.stack ?? error)
				.split("\n")
				.slice(0, 10)
				.join(" | "),
		});
		log(`[sweep:${config}] THREW`, error);
	} finally {
		local.autoPlayUntil = undefined;
		log(`[sweep:${config}] done in ${((Date.now() - t0) / 1000).toFixed(0)}s`);
	}
};

test.skipIf(!process.env.RUN_SWEEP)(
	"runtime sweep",
	async () => {
		const configs = (
			process.env.SWEEP_CONFIGS ?? "random,real,college,unusual"
		).split(",");
		const issues: Issue[] = [];

		// console.error/warn from anywhere in the game
		const origError = console.error;
		const origWarn = console.warn;
		let currentConfig = "";
		const consoleCounts = new Map<string, number>();
		const record =
			(kind: string) =>
			(...args: unknown[]) => {
				const msg = args
					.map((a) =>
						a instanceof Error
							? (a.stack ?? a.message).split("\n").slice(0, 4).join(" | ")
							: typeof a === "string"
								? a
								: JSON.stringify(a)?.slice(0, 300),
					)
					.join(" ");
				const key = `${currentConfig} ${kind}: ${msg.slice(0, 400)}`;
				consoleCounts.set(key, (consoleCounts.get(key) ?? 0) + 1);
			};
		console.error = record("console.error");
		console.warn = record("console.warn");
		// (self test: the capture works)
		console.warn("sweep console capture self test");
		const origRandom = Math.random;
		try {
			if (configs.includes("random")) {
				currentConfig = "random";
				Math.random = makeSeededRandom(Number(process.env.SWEEP_SEED ?? 1));
				await runConfig("random", issues, async () => {
					await createLeague({
						lid: 100,
						name: "sweep random",
						settings: getDefaultSettings(),
					});
					await sweepLeague({
						config: "random",
						issues,
						seasons: Number(process.env.SWEEP_SEASONS ?? 6),
					});
				});
			}
			if (configs.includes("real")) {
				currentConfig = "real";
				Math.random = makeSeededRandom(2);
				await runConfig("real", issues, async () => {
					const getLeagueOptions = {
						type: "real",
						season: Number(process.env.SWEEP_REAL_SEASON ?? 2025),
						phase: PHASE.PRESEASON,
						randomDebuts: false,
						randomDebutsKeepCurrent: false,
						realDraftRatings: "rookie",
						realStats: "none",
						includePlayers: true,
					};
					const realLeague = await realRosters.getLeague(getLeagueOptions);
					await createLeague({
						lid: 101,
						name: "sweep real",
						settings: getDefaultSettings(),
						realLeague,
						getLeagueOptions,
					});
					await sweepLeague({ config: "real", issues, seasons: 1 });
				});
			}
			if (configs.includes("college")) {
				currentConfig = "college";
				Math.random = makeSeededRandom(3);
				await runConfig("college", issues, async () => {
					const { teams, confs, divs } = getCollegeLeagueTeams("power");
					await createLeague({
						lid: 102,
						name: "sweep college",
						settings: {
							...getDefaultSettings(),
							...getCollegeSettings("power"),
						},
						teamsFromInput: teams.map((t) => ({ ...t, popRank: 1 })),
						confs,
						divs,
					});
					await sweepLeague({ config: "college", issues, seasons: 1 });
				});
			}
			if (configs.includes("unusual")) {
				currentConfig = "unusual";
				Math.random = makeSeededRandom(4);
				await runConfig("unusual", issues, async () => {
					const confs = [{ cid: 0, name: "League" }];
					const divs = [{ did: 0, cid: 0, name: "Division" }];
					await createLeague({
						lid: 103,
						name: "sweep unusual",
						settings: {
							...getDefaultSettings(),
							numPlayersOnCourt: 3,
							numPeriods: 4,
							quarterLength: 6,
							threePointers: false,
							numGames: 20,
							numGamesDiv: null,
							numGamesConf: null,
							salaryCapType: "hard",
							numGamesPlayoffSeries: [1, 3, 3, 5],
							autoExpandProb: 1,
							autoExpandNumTeams: 2,
							autoExpandMaxNumTeams: 32,
						},
						confs,
						divs,
						teamsFromInput: helpers
							.addPopRank(helpers.getTeamsDefault())
							.map((t) => ({ ...t, cid: 0, did: 0 })),
					});
					// A contraction in the second season
					await idb.cache.scheduledEvents.add({
						type: "contraction",
						season: g.get("season") + 1,
						phase: PHASE.DRAFT_LOTTERY,
						info: { tid: 5 },
					});
					await sweepLeague({ config: "unusual", issues, seasons: 2 });
				});
			}
		} finally {
			console.error = origError;
			console.warn = origWarn;
			Math.random = origRandom;
		}
		const report = {
			issues,
			console: [...consoleCounts.entries()].map(([k, n]) => `${n}x ${k}`),
		};
		const json = JSON.stringify(report, null, 1);
		if (process.env.SWEEP_OUT) {
			writeFileSync(process.env.SWEEP_OUT, json);
		}
		log(
			`[sweep] ${issues.length} issues, ${consoleCounts.size} distinct console messages`,
		);
		for (const line of report.console.slice(0, 200)) {
			log(`[sweep console] ${line}`);
		}
		assert.isAtLeast(issues.length, 0);
	},
	6 * 60 * 60 * 1000,
);
