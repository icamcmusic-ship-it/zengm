// "Export team season": everything the team's pages show about one season, built from the same worker views and stores the pages
// use, so the pages' hidden information rules apply: ratings, archetypes and badges as the user's scouts see them (from the player
// export, getPlayersForExport) and none of them under the no visible ratings challenge (team rating, scheme fit and coach ratings
// too); a GM's leanings in words, the numbers only in God Mode; the defensive scheme, players' shot profiles and the owner's mood
// only for the user's own team, like the pages. Basketball-only parts (lineups, shot profile, coaching staff, GMs) are skipped with
// the reason in other sports. See common/teamExport.ts for the format.
import { PHASE, PHASE_TEXT, PLAYER } from "../../../common/constants.ts";
import { shotZones, sumAdv } from "../../../common/advStats.ts";
import { DEFENSE_NAMES, OFFENSE_NAMES } from "../../../common/coachSystems.ts";
import { getCols } from "../../../common/getCols.ts";
import { MAX_BADGES } from "../../../common/tieredBadges/definitions.ts";
import {
	GM_TRAIT_INFO,
	GM_TRAIT_KEYS,
	gmHotSeatLabel,
	gmTraitLabel,
} from "../../../common/gmPersonality.ts";
import {
	exportShowsRatings,
	type ExportTable,
} from "../../../common/playerExport.ts";
import { stripHtml } from "../../../common/playerProfileExport.ts";
import { statDescription } from "../../../common/seasonExport.ts";
import {
	DEF_SCHEME_DESCRIPTIONS,
	DEF_SCHEME_NAMES,
	SHOT_PROFILE_NAMES,
	aiDefScheme,
} from "../../../common/shotProfiles.ts";
import {
	TEAM_COLUMN_DESCRIPTIONS,
	TEAM_EXPORT_FORMAT,
	TEAM_EXPORT_SCHEMA_VERSION,
	TEAM_SECTIONS,
	computeSplits,
	type SplitGame,
	type TeamFact,
	type TeamSeasonExport,
	type TeamSection,
	type TeamSectionKey,
} from "../../../common/teamExport.ts";
import type { Conditions, Game, Gm, Team } from "../../../common/types.ts";
import { isCollege } from "../../core/college/isCollege.ts";
import { gmEnabled, userOwnsTeam } from "../../core/gm/index.ts";
import { league } from "../../core/index.ts";
import { getHeadCoachForSeason } from "../../core/staff/data.ts";
import { getTeamStaff, staffEnabled } from "../../core/staff/index.ts";
import { idb } from "../../db/index.ts";
import lineupsView from "../../views/lineups.ts";
import rosterView from "../../views/roster.ts";
import { augmentOwnerMoods } from "../../views/ownerMoodSeasons.ts";
import { formatCoach } from "../../views/staffShared.ts";
import { g, helpers } from "../index.ts";
import { featureOn } from "../nativeFeatures.ts";
import { getPlayersForExport } from "../playerExport.ts";

const runView = async (
	view: { load: (args: any) => unknown },
	inputs: Record<string, unknown>,
	conditions: Conditions,
): Promise<any> => {
	const out: any = await view.load({
		inputs,
		updateEvents: new Set(["firstRun"]),
		prevInputs: undefined,
		prevOutput: {},
		conditions,
	});
	if (!out || out.errorMessage) {
		return undefined;
	}
	return out;
};

const fact = (label: string, value: unknown): TeamFact[] =>
	value === undefined || value === null || value === ""
		? []
		: [{ label, value: String(value) }];

const r1 = (x: number | undefined) =>
	x === undefined || !Number.isFinite(x) ? "" : Math.round(x * 10) / 10;
const pct = (num: number, den: number) =>
	den > 0 ? Math.round((1000 * num) / den) / 10 : "";
const winpText = (won: number, lost: number, tied = 0, otl = 0) => {
	const gp = won + lost + tied + otl;
	return gp > 0 ? ((won + 0.5 * tied) / gp).toFixed(3).replace(/^0/, "") : "";
};
const recordText = (r: {
	won: number;
	lost: number;
	tied?: number;
	otl?: number;
}) =>
	[r.won, r.lost, ...(r.tied ? [r.tied] : []), ...(r.otl ? [r.otl] : [])].join(
		"-",
	);
const capitalize = (s: string) =>
	s ? `${s[0]!.toUpperCase()}${s.slice(1)}` : s;

const statTitle = (key: string) => {
	try {
		return getCols([`stat:${key}`])[0]!.title;
	} catch {
		return key;
	}
};
const ratingCol = (key: string) => {
	try {
		const col = getCols([`rating:${key}`])[0]!;
		return { title: col.title, desc: col.desc ?? col.title };
	} catch {
		return { title: key, desc: key };
	}
};

const section = (
	key: TeamSectionKey,
	rest: Partial<Omit<TeamSection, "key" | "title">> = {},
): TeamSection => ({
	key,
	title: TEAM_SECTIONS.find((s) => s.key === key)!.label,
	notes: [],
	facts: [],
	tables: [],
	...rest,
});

const basketballOnlyReason = (label: string) =>
	`${label} is only in Basketball GM.`;

// Which sections apply, for the dialog (the export skips the same ones with the same reasons)
export const getTeamSeasonExportSections = async ({
	tid,
	season,
}: {
	tid: number;
	season: number;
}) => {
	const reasons: Partial<Record<TeamSectionKey, string>> = {};
	for (const s of TEAM_SECTIONS) {
		if (s.basketball && __SPORT !== "basketball") {
			reasons[s.key] = basketballOnlyReason(s.label);
		}
	}
	const ts = await idb.merged.teamSeasons.getByTidSeason(tid, season);
	if (!ts) {
		for (const s of TEAM_SECTIONS) {
			reasons[s.key] = "The team didn't play that season.";
		}
	}
	return TEAM_SECTIONS.map(({ key, label }) => ({
		key,
		label,
		reason: reasons[key],
	}));
};

// The team's games of the season (box scores that are still stored)
const teamGames = async (tid: number, season: number) =>
	(
		await idb.merged.games.getAll(
			{ season },
			{
				filter: (gm) =>
					gm.season === season &&
					(gm.teams[0].tid === tid || gm.teams[1].tid === tid),
			},
		)
	).sort((a, b) => (a.day ?? 0) - (b.day ?? 0) || a.gid - b.gid);

const gmForSeason = (t: Team, season: number): Gm | undefined => {
	for (const gm of [t.gm, ...(t.formerGms ?? [])]) {
		if (gm?.seasons.some((row) => row.season === season && row.tid === t.tid)) {
			return gm;
		}
	}
	return season === g.get("season") ? t.gm : undefined;
};

export const getTeamSeasonExport = async (
	{
		tid,
		season,
		sections: wanted,
	}: {
		tid: number;
		season: number;
		// Default: all of them
		sections?: TeamSectionKey[];
	},
	conditions: Conditions = {},
): Promise<TeamSeasonExport | undefined> => {
	const teamSeason = await idb.merged.teamSeasons.getByTidSeason(tid, season);
	if (!teamSeason) {
		return undefined;
	}
	const roster = await runView(
		rosterView,
		{ tid, season, playoffs: "regularSeason" },
		conditions,
	);
	if (!roster) {
		return undefined;
	}
	const want = new Set<TeamSectionKey>(
		wanted ?? TEAM_SECTIONS.map((s) => s.key),
	);
	const currentSeason = g.get("season");
	const isCurrent = season === currentSeason;
	const college = isCollege();
	const challengeNoRatings = !!g.get("challengeNoRatings");
	// Team-level numbers from ratings (team rating, scheme fit) follow the challenge like an active player's ratings
	const showRatings = !challengeNoRatings;
	const godMode = !!g.get("godMode");
	const userTids = g.get("userTids");
	const isUserTeam = userTids.includes(tid);
	const confs = g.get("confs", season);
	const divs = g.get("divs", season);
	const teamDoc = await idb.cache.teams.get(tid);
	const abbrev = (t: number) =>
		g.get("teamInfoCache")[t]?.abbrev ?? (t < 0 ? "ASG" : "");

	const sections: TeamSeasonExport["sections"] = {};
	const skipped: TeamSeasonExport["skipped"] = [];
	const dict: TeamSeasonExport["dataDictionary"] = {};
	const extraDesc: Record<string, string> = {};

	const otherSportSkip = (key: TeamSectionKey) => {
		const info = TEAM_SECTIONS.find((s) => s.key === key)!;
		if (info.basketball && __SPORT !== "basketball") {
			if (want.has(key)) {
				skipped.push({ key, reason: basketballOnlyReason(info.label) });
			}
			return true;
		}
		return !want.has(key);
	};

	// Games: splits, notable games, the feats' days
	const games: Game[] =
		want.has("splits") || want.has("results")
			? await teamGames(tid, season)
			: [];
	const teamSeasons = await idb.merged.teamSeasons.getAll({ season });
	const oppWinp = new Map(
		teamSeasons.map((ts) => {
			const gp = ts.won + ts.lost + ts.tied + ts.otl;
			return [ts.tid, gp > 0 ? (ts.won + 0.5 * ts.tied) / gp : 0.5];
		}),
	);
	const splitGames: SplitGame[] = games
		.filter((gm) => gm.teams[0].tid >= 0 && gm.teams[1].tid >= 0 && !gm.nit)
		.map((gm) => {
			const i = gm.teams[0].tid === tid ? 0 : 1;
			const t = gm.teams[i];
			const o = gm.teams[i === 0 ? 1 : 0];
			const tie = gm.won.pts === gm.lost.pts && gm.won.sPts === gm.lost.sPts;
			return {
				gid: gm.gid,
				day: gm.day ?? null,
				playoffs: !!gm.playoffs,
				home: i === 0,
				neutral: !!gm.neutralSite,
				pts: t.pts,
				oppPts: o.pts,
				result: tie ? "T" : gm.won.tid === tid ? "W" : "L",
				overtimes: gm.overtimes ?? 0,
				oppTid: o.tid,
				oppWinp: oppWinp.get(o.tid) ?? 0.5,
			};
		});

	const t = roster.t;
	const sa = t.seasonAttrs;
	const record = recordText({
		won: sa.won,
		lost: sa.lost,
		tied: sa.tied,
		otl: sa.otl,
	});
	const roundsWonText = capitalize(stripHtml(String(t.roundsWonText ?? "")));
	const players: any[] = roster.players;

	// ---------- Overview ----------
	if (want.has("overview")) {
		const gp = t.stats?.gp ?? 0;
		sections.overview = section("overview", {
			facts: [
				...fact("Team", `${sa.region} ${sa.name}`),
				...fact("Season", season),
				...fact(
					"Conference",
					confs.find((c) => c.cid === teamSeason.cid)?.name,
				),
				...fact("Division", divs.find((d) => d.did === teamSeason.did)?.name),
				...fact("Record", record),
				...fact("Win%", winpText(sa.won, sa.lost, sa.tied, sa.otl)),
				...fact(
					roster.playoffsByConf ? "Conference rank" : "League rank",
					t.rank,
				),
				...fact("Games behind", t.rank === 1 ? 0 : t.gb),
				...fact("Playoffs", roundsWonText),
				...fact(
					"Margin of victory",
					gp > 0 ? r1((t.stats.pts - t.stats.oppPts) / gp) : undefined,
				),
				...fact("Average age", r1(sa.avgAge)),
				...fact(
					"Team rating",
					showRatings && typeof t.ovr === "number" ? t.ovr : undefined,
				),
				...fact(
					isCurrent ? "Payroll" : "End of season payroll",
					!college && roster.payroll !== undefined
						? helpers.formatCurrency(roster.payroll / 1000, "M")
						: undefined,
				),
				...fact("Roster size", players.length),
			],
			notes: [
				...(isCurrent &&
				g.get("phase") >= PHASE.REGULAR_SEASON &&
				g.get("phase") <= PHASE.PLAYOFFS
					? ["The season is still being played: numbers so far."]
					: []),
				...(sa.note ? [`Team note: ${sa.note}`] : []),
			],
			data: {
				record: {
					won: sa.won,
					lost: sa.lost,
					tied: sa.tied,
					otl: sa.otl,
				},
				rank: t.rank,
				gb: t.gb,
				playoffRoundsWon: sa.playoffRoundsWon,
				playoffs: roundsWonText,
				pts: t.stats?.pts,
				oppPts: t.stats?.oppPts,
				gp,
				avgAge: sa.avgAge,
				ovr: showRatings ? t.ovr : undefined,
				payroll: college ? undefined : roster.payroll,
			},
		});
	}

	// ---------- Roster ----------
	if (want.has("roster")) {
		const pids = players.map((p) => p.pid);
		const cards = await getPlayersForExport({ pids, season });
		const byPid = new Map(cards.map((c) => [c.pid, c]));
		const statKeys: string[] = roster.stats.filter(
			(key: string) => key !== "keyStats",
		);
		const hasKeyStats = roster.stats.includes("keyStats");
		for (const key of statKeys) {
			extraDesc[statTitle(key)] = statDescription(key);
		}
		if (hasKeyStats) {
			extraDesc["Key stats"] = "Key stats line, as on the roster page";
		}
		const shown = (p: any) =>
			exportShowsRatings(challengeNoRatings, p.tid, PLAYER.RETIRED);
		const badgeLabel = __SPORT === "basketball" ? "Badges" : "Skills";
		const anyRatings = players.some(shown);
		const cols = [
			"Name",
			"Pos",
			"Age",
			"Jersey",
			"Yrs w/ team",
			...(college ? [] : ["Contract ($K/yr)", "Contract exp"]),
			"Injury",
			...(anyRatings ? ["Ovr", "Pot"] : []),
			...(anyRatings && __SPORT === "basketball" ? ["Archetype"] : []),
			...(anyRatings ? [badgeLabel] : []),
			"Awards",
			...statKeys.map(statTitle),
			...(hasKeyStats ? ["Key stats"] : []),
		];
		const rows: (string | number)[][] = [];
		const data: unknown[] = [];
		const ratingKeys = new Set<string>();
		for (const p of players) {
			const card = byPid.get(p.pid);
			const show = shown(p) && !!card?.ratings;
			const badges = show
				? (__SPORT === "basketball" ? card!.badges : card!.skills).slice(
						0,
						MAX_BADGES,
					)
				: [];
			if (show) {
				for (const key of Object.keys(card!.ratings!)) {
					if (key !== "ovr" && key !== "pot") {
						ratingKeys.add(key);
					}
				}
			}
			const contract =
				!college && p.contract && p.contract.amount > 0
					? {
							amount: Math.round(p.contract.amount * 1000),
							exp: p.contract.exp,
						}
					: undefined;
			const injury =
				p.injury?.gamesRemaining > 0
					? `${p.injury.type} (${p.injury.gamesRemaining} games)`
					: "";
			const awards = (p.awards ?? []).map((a: any) => a.type).join(", ");
			rows.push([
				p.name ?? `${p.firstName} ${p.lastName}`,
				p.ratings.pos,
				p.age,
				p.stats.jerseyNumber ?? "",
				p.stats.yearsWithTeam ?? "",
				...(college ? [] : [contract?.amount ?? "", contract?.exp ?? ""]),
				injury,
				...(anyRatings
					? [show ? p.ratings.ovr : "", show ? p.ratings.pot : ""]
					: []),
				...(anyRatings && __SPORT === "basketball"
					? [show ? (card!.archetype ?? "") : ""]
					: []),
				...(anyRatings ? [badges.join(", ")] : []),
				awards,
				...statKeys.map((key) => r1(p.stats[key])),
				...(hasKeyStats ? [p.stats.keyStats ?? ""] : []),
			]);
			data.push({
				pid: p.pid,
				name: p.name ?? `${p.firstName} ${p.lastName}`,
				pos: p.ratings.pos,
				age: p.age,
				jerseyNumber: p.stats.jerseyNumber,
				yearsWithTeam: p.stats.yearsWithTeam,
				contract,
				injury: injury || undefined,
				ovr: show ? p.ratings.ovr : undefined,
				pot: show ? p.ratings.pot : undefined,
				archetype: show ? card!.archetype : undefined,
				badges: show && __SPORT === "basketball" ? badges : undefined,
				skills: show && __SPORT !== "basketball" ? badges : undefined,
				ratings: show ? card!.ratings : undefined,
				awards: (p.awards ?? []).map((a: any) => a.type),
				stats: Object.fromEntries(
					[...statKeys, ...(hasKeyStats ? ["keyStats"] : [])].map((key) => [
						key,
						p.stats[key],
					]),
				),
			});
		}
		const tables: ExportTable[] = [
			{ section: "Roster", title: "Players", cols, rows },
		];
		if (ratingKeys.size > 0) {
			const keys = [...ratingKeys];
			const titles = keys.map((key) => {
				const c = ratingCol(key);
				extraDesc[c.title] = `${c.desc} (as scouted)`;
				return c.title;
			});
			tables.push({
				section: "Roster",
				title: "Ratings (as scouted)",
				cols: ["Name", "Pos", "Ovr", "Pot", ...titles],
				rows: players
					.filter((p) => shown(p) && byPid.get(p.pid)?.ratings)
					.map((p) => {
						const r = byPid.get(p.pid)!.ratings!;
						return [
							p.name ?? `${p.firstName} ${p.lastName}`,
							p.ratings.pos,
							r.ovr ?? "",
							r.pot ?? "",
							...keys.map((key) => r[key] ?? ""),
						];
					}),
			});
		}
		sections.roster = section("roster", {
			notes: [
				anyRatings
					? "Ratings, archetypes and badges are as your scouts see them (not exact values), like the player pages."
					: "Ratings, archetypes and badges are hidden (no visible ratings challenge), like the player pages.",
				...(isCurrent
					? []
					: [
							"Past season: everyone who played for the team that season, with that season's ratings and stats (archetypes are the current ones).",
						]),
			],
			tables,
			data: { players: data },
		});
	}

	// ---------- Lineups and on/off ----------
	if (!otherSportSkip("lineups")) {
		const notes: string[] = [];
		const tables: ExportTable[] = [];
		const data: Record<string, unknown> = {};
		if (!featureOn("advStats")) {
			notes.push(
				"Lineup data isn't stored: Advanced Tracking Stats is turned off in this league.",
			);
		} else {
			for (const playoffs of ["regularSeason", "playoffs"] as const) {
				const view = await runView(
					lineupsView,
					{ tid, season, playoffs },
					conditions,
				);
				const type = playoffs === "playoffs" ? "Playoffs" : "Regular season";
				const lineups: any[] = (view?.lineups ?? [])
					.toSorted((a: any, b: any) => b.min - a.min)
					.slice(0, 10);
				if (lineups.length > 0) {
					tables.push({
						section: "Lineups",
						title: `Most-used lineups (${type.toLowerCase()})`,
						cols: [
							"Lineup",
							"MIN",
							"+/-",
							"Poss for",
							"Poss against",
							"ORtg",
							"DRtg",
							"Net",
						],
						rows: lineups.map((l) => [
							l.players.map((p: any) => p.name).join(", "),
							r1(l.min),
							l.pm,
							l.possFor,
							l.possAgainst,
							r1(l.ortg),
							r1(l.drtg),
							r1(l.net),
						]),
					});
				}
				const onOff: any[] = (view?.onOff ?? []).toSorted(
					(a: any, b: any) => b.min - a.min,
				);
				if (onOff.length > 0) {
					tables.push({
						section: "Lineups",
						title: `On/off (${type.toLowerCase()})`,
						cols: [
							"Name",
							"Pos",
							"GP",
							"MIN",
							"On ORtg",
							"On DRtg",
							"On Net",
							"Off Net",
							"On-Off",
						],
						rows: onOff.map((p) => [
							p.name,
							p.pos,
							p.gp,
							r1(p.min),
							r1(p.onOrtg),
							r1(p.onDrtg),
							r1(p.onNet),
							r1(p.offNet),
							r1(p.onOffNet),
						]),
					});
				}
				if (lineups.length > 0 || onOff.length > 0) {
					data[playoffs] = {
						team: view?.team,
						lineups: lineups.map((l) => ({
							players: l.players.map((p: any) => ({
								pid: p.pid,
								name: p.name,
								pos: p.pos,
							})),
							min: l.min,
							pm: l.pm,
							ptsFor: l.ptsFor,
							ptsAgainst: l.ptsAgainst,
							possFor: l.possFor,
							possAgainst: l.possAgainst,
							ortg: l.ortg,
							drtg: l.drtg,
							net: l.net,
						})),
						onOff: onOff.map((p) => ({
							pid: p.pid,
							name: p.name,
							pos: p.pos,
							gp: p.gp,
							min: p.min,
							onOrtg: p.onOrtg,
							onDrtg: p.onDrtg,
							onNet: p.onNet,
							offNet: p.offNet,
							onOffNet: p.onOffNet,
						})),
					};
				}
			}
			if (tables.length === 0) {
				notes.push(
					"No lineup data is stored for this team-season (no games tracked yet, or the season was played before Advanced Tracking Stats was on).",
				);
			} else {
				notes.push(
					"Lineups are the most-used five-man units the game keeps (the 60 most used during the season, 40 after the playoffs); the top 10 by minutes are here.",
				);
			}
		}
		sections.lineups = section("lineups", { notes, tables, data });
	}

	// ---------- Shot profile ----------
	if (!otherSportSkip("shotProfile")) {
		const notes: string[] = [];
		const tables: ExportTable[] = [];
		const facts: TeamFact[] = [];
		const data: Record<string, unknown> = {};
		const statRows = await idb.merged.teamStats.getAll({ tid, season });
		const ts: any = statRows.find((row) => !row.playoffs);
		if (ts && ts.gp > 0) {
			const efg = (fg: number, tp: number, fga: number) =>
				pct(fg + 0.5 * tp, fga);
			const tsp = (pts: number, fga: number, fta: number) =>
				pct(pts, 2 * (fga + 0.44 * fta));
			facts.push(
				...fact("FG%", pct(ts.fg, ts.fga)),
				...fact("3P%", pct(ts.tp, ts.tpa)),
				...fact("FT%", pct(ts.ft, ts.fta)),
				...fact("3PA rate (3PA / FGA, %)", pct(ts.tpa, ts.fga)),
				...fact("FTA rate (FTA / FGA, %)", pct(ts.fta, ts.fga)),
				...fact("eFG%", efg(ts.fg, ts.tp, ts.fga)),
				...fact("TS%", tsp(ts.pts, ts.fga, ts.fta)),
				...fact("Opponent eFG%", efg(ts.oppFg, ts.oppTp, ts.oppFga)),
				...fact("Opponent 3PA rate (%)", pct(ts.oppTpa, ts.oppFga)),
			);
			// Shot locations (box score totals, team and opponents)
			const locs = [
				["At rim", "fgAtRim", "fgaAtRim", 2],
				["Low post", "fgLowPost", "fgaLowPost", 2],
				["Mid-range", "fgMidRange", "fgaMidRange", 2],
				["Three", "tp", "tpa", 3],
			] as const;
			const locRows = (opp: boolean) => {
				const k = (key: string) =>
					opp ? `opp${key[0]!.toUpperCase()}${key.slice(1)}` : key;
				const total = locs.reduce((sum, l) => sum + (ts[k(l[2])] ?? 0), 0);
				return locs.map(([name, fg, fga, value]) => {
					const m = ts[k(fg)] ?? 0;
					const a = ts[k(fga)] ?? 0;
					return [
						name,
						a,
						m,
						pct(m, a),
						pct(a, total),
						a > 0 ? Math.round((100 * m * value) / a) / 100 : "",
					];
				});
			};
			const locCols = ["Zone", "FGA", "FGM", "FG%", "Share of FGA", "Pts/shot"];
			tables.push(
				{
					section: "Shot profile",
					title: "Shot locations",
					cols: locCols,
					rows: locRows(false),
				},
				{
					section: "Shot profile",
					title: "Opponent shot locations",
					cols: locCols,
					rows: locRows(true),
				},
			);
			data.locations = {
				team: locRows(false).map((row) =>
					Object.fromEntries(locCols.map((c, i) => [c, row[i]])),
				),
				opponents: locRows(true).map((row) =>
					Object.fromEntries(locCols.map((c, i) => [c, row[i]])),
				),
			};
		} else {
			notes.push("No team stats for this season yet.");
		}

		// Shot zones (Advanced Tracking Stats with Shot Zones): the team's players' zone tables added up
		if (featureOn("advStats")) {
			const pl = await idb.merged.players.getAll({ statsTid: tid });
			const advRows = pl.flatMap((p) =>
				p.stats.filter(
					(row) => row.tid === tid && row.season === season && !row.playoffs,
				),
			);
			const zones = shotZones(sumAdv(advRows));
			if (zones) {
				tables.push({
					section: "Shot profile",
					title: "Shot zones",
					cols: [
						"Zone",
						"Group",
						"FGA",
						"FGM",
						"FG%",
						"Share of FGA",
						"Pts/shot",
					],
					rows: zones.zones.map((z) => [
						z.name,
						z.group,
						z.fga,
						z.fgm,
						pct(z.fgm, z.fga),
						pct(z.fga, zones.fga),
						z.fga > 0 ? Math.round((100 * z.fgm * z.pts) / z.fga) / 100 : "",
					]),
				});
				facts.push(
					...fact(
						"Expected FG% of its shots (shot quality)",
						zones.xfgp !== undefined ? r1(zones.xfgp * 100) : undefined,
					),
					...fact("FG% on located shots", r1(zones.fgp * 100)),
				);
				data.zones = {
					fga: zones.fga,
					fgm: zones.fgm,
					xfgp: zones.xfgp,
					zones: zones.zones.map((z) => ({
						key: z.key,
						name: z.name,
						group: z.group,
						fga: z.fga,
						fgm: z.fgm,
						freq: z.freq,
						fgp: z.fgp,
					})),
				};
			} else {
				notes.push(
					"No shot zones recorded for this team-season (Shot Zones was off, or no games yet).",
				);
			}
		} else {
			notes.push(
				"Shot zones need Advanced Tracking Stats, which is turned off in this league.",
			);
		}

		// Defensive scheme and players' shot profiles: the user's team, this season (the Coaching Staff and Roster pages)
		if (!featureOn("shotProfiles")) {
			notes.push(
				"Defensive scheme: Shot Profiles & Defensive Schemes is turned off in this league.",
			);
		} else if (!isUserTeam || !isCurrent) {
			notes.push(
				!isUserTeam
					? "Defensive scheme and shot profiles are only shown for your own team."
					: "Defensive scheme and shot profiles are only kept for the current season.",
			);
		} else {
			const healthy = (await idb.cache.players.indexGetAll("playersByTid", tid))
				.filter((p) => p.injury.gamesRemaining === 0)
				.toSorted((a, b) => b.valueNoPot - a.valueNoPot);
			const auto = aiDefScheme(healthy.map((p) => p.ratings.at(-1) as any));
			const scheme = teamDoc?.defScheme ?? auto;
			facts.push(
				...fact(
					"Defensive scheme",
					`${DEF_SCHEME_NAMES[scheme]}${teamDoc?.defScheme ? "" : " (coach's pick)"}`,
				),
				...fact("Scheme description", DEF_SCHEME_DESCRIPTIONS[scheme]),
			);
			data.defScheme = {
				scheme,
				name: DEF_SCHEME_NAMES[scheme],
				coachPicks: !teamDoc?.defScheme,
			};
			tables.push({
				section: "Shot profile",
				title: "Players' shot profiles",
				cols: ["Name", "Shot profile"],
				rows: players.map((p) => [
					p.name ?? `${p.firstName} ${p.lastName}`,
					p.shotProfile
						? SHOT_PROFILE_NAMES[
								p.shotProfile as keyof typeof SHOT_PROFILE_NAMES
							]
						: "Auto (coach picks)",
				]),
			});
		}
		sections.shotProfile = section("shotProfile", {
			notes,
			facts,
			tables,
			data,
		});
	}

	// ---------- Splits ----------
	if (want.has("splits")) {
		const otl = !!g.get("otl", season);
		const rows = computeSplits(splitGames, {
			otl,
			football: __SPORT === "football",
		});
		const ties = rows.some((row) => row.tied > 0);
		const otls = rows.some((row) => row.otl > 0);
		const cols = [
			"Split",
			"GP",
			"W",
			"L",
			...(ties ? ["T"] : []),
			...(otls ? ["OTL"] : []),
			"Win%",
			"PTS/G",
			"OPP PTS/G",
			"MOV",
		];
		sections.splits = section("splits", {
			notes: [
				...(splitGames.length === 0
					? [
							"No box scores are stored for this team-season (League Settings: how many seasons of box scores to keep), so there are no splits.",
						]
					: []),
				"Rest is the days between the team's games (a back-to-back is games on consecutive days). Opponents are split by their win% that season. Games have days, not dates, so a month is a block of 30 days (4 weeks in football).",
			],
			tables:
				splitGames.length > 0
					? [
							{
								section: "Splits",
								title: "Splits",
								cols,
								rows: rows.map((row) => [
									row.group === "Overall" || row.group === "Playoffs"
										? row.split
										: `${row.group}: ${row.split}`,
									row.gp,
									row.won,
									row.lost,
									...(ties ? [row.tied] : []),
									...(otls ? [row.otl] : []),
									winpText(row.won, row.lost, row.tied, row.otl),
									row.ptsPerGame,
									row.oppPtsPerGame,
									row.margin,
								]),
							},
						]
					: [],
			data: { splits: rows },
		});
	}

	// ---------- Staff and front office ----------
	if (want.has("staff")) {
		const notes: string[] = [];
		const facts: TeamFact[] = [];
		const tables: ExportTable[] = [];
		const data: Record<string, unknown> = {};

		// Coaching
		if (__SPORT !== "basketball") {
			notes.push("Coaching staffs are only in Basketball GM.");
		} else if (!staffEnabled()) {
			notes.push("Coaching staff is turned off in this league.");
		} else {
			const head = await getHeadCoachForSeason(tid, season);
			if (head) {
				const c = formatCoach(head);
				const row = head.stats.find(
					(s) => s.season === season && s.tid === tid && s.role === "head",
				);
				const seasonRecord = row
					? recordText(row)
					: isCurrent
						? record
						: undefined;
				facts.push(
					...fact("Head coach", c.name),
					...fact("Head coach age", c.age),
					...fact("Head coach record this season", seasonRecord),
					...fact(
						"Head coach career record",
						recordText({ won: c.headWon, lost: c.headLost }),
					),
					...fact("Head coach titles", c.titles),
					...fact("Head coach style", c.styleText),
					...fact(
						"Offense system",
						row?.off ? OFFENSE_NAMES[row.off] : c.systems?.offense,
					),
					...fact(
						"Defense system",
						row?.def ? DEFENSE_NAMES[row.def] : c.systems?.defense,
					),
					...fact("Head coach ovr", showRatings ? c.ovr : undefined),
				);
				data.headCoach = {
					cid: c.cid,
					name: c.name,
					age: c.age,
					seasonRecord,
					career: { won: c.headWon, lost: c.headLost, seasons: c.headSeasons },
					titles: c.titles,
					style: c.styleText,
					offense: row?.off ? OFFENSE_NAMES[row.off] : c.systems?.offense,
					defense: row?.def ? DEFENSE_NAMES[row.def] : c.systems?.defense,
					ovr: showRatings ? c.ovr : undefined,
				};
			} else {
				notes.push("No head coach is recorded for this team-season.");
			}
			if (isCurrent && t.coachSystem) {
				if (showRatings) {
					facts.push(
						...fact(
							"Scheme fit",
							`${t.coachSystem.fit} (${t.coachSystem.fitText})`,
						),
						...fact("System installed (%)", t.coachSystem.install),
					);
					data.schemeFit = {
						fit: t.coachSystem.fit,
						fitText: t.coachSystem.fitText,
						install: t.coachSystem.install,
					};
				} else {
					notes.push(
						"Scheme fit is hidden (no visible ratings challenge): it comes from the players' ratings.",
					);
				}
			}
			if (isCurrent) {
				const staff = await getTeamStaff(tid);
				const coaches = Object.values(staff).filter((c) => c !== undefined);
				if (coaches.length > 0) {
					const formatted = coaches.map((c) => formatCoach(c));
					tables.push({
						section: "Staff",
						title: "Coaching staff",
						cols: [
							"Role",
							"Name",
							"Age",
							...(showRatings ? ["Coach ovr"] : []),
						],
						rows: formatted.map((c) => [
							c.roleName,
							c.name,
							c.age,
							...(showRatings ? [c.ovr] : []),
						]),
					});
					data.staff = formatted.map((c) => ({
						role: c.role,
						roleName: c.roleName,
						name: c.name,
						age: c.age,
						ovr: showRatings ? c.ovr : undefined,
					}));
				}
			} else {
				notes.push(
					"The rest of the coaching staff is only shown for the current season.",
				);
			}
		}

		// General manager
		if (__SPORT !== "basketball" || college) {
			notes.push(
				college
					? "There are no general managers in college leagues."
					: "AI GM personalities are only in Basketball GM.",
			);
		} else if (!gmEnabled()) {
			notes.push("AI GM personalities are turned off in this league.");
		} else if (isCurrent && userOwnsTeam(tid)) {
			facts.push(...fact("General manager", "You"));
			data.gm = { user: true };
		} else {
			const gm = teamDoc ? gmForSeason(teamDoc, season) : undefined;
			if (gm) {
				const rowsWithTeam = gm.seasons.filter((row) => row.tid === tid);
				const row = rowsWithTeam.find((r) => r.season === season);
				const won = rowsWithTeam.reduce((sum, r) => sum + r.won, 0);
				const lost = rowsWithTeam.reduce((sum, r) => sum + r.lost, 0);
				const current = teamDoc?.gm?.gmid === gm.gmid;
				facts.push(
					...fact("General manager", `${gm.firstName} ${gm.lastName}`),
					...fact("GM record with the team", recordText({ won, lost })),
					...fact("GM record this season", row ? recordText(row) : undefined),
					...fact(
						"GM preseason expectation (wins)",
						row?.expWon !== undefined
							? Math.round(row.expWon)
							: current && isCurrent && gm.expWon !== undefined
								? Math.round(gm.expWon)
								: undefined,
					),
					...fact(
						"GM job security",
						current && isCurrent ? gmHotSeatLabel(gm.hotSeat) : undefined,
					),
				);
				tables.push({
					section: "Staff",
					title: "GM leanings",
					cols: ["Trait", "Leaning", ...(godMode ? ["Value"] : [])],
					rows: GM_TRAIT_KEYS.map((key) => [
						GM_TRAIT_INFO[key].name,
						gmTraitLabel(key, gm.traits[key]),
						...(godMode ? [Math.round(gm.traits[key] * 100) / 100] : []),
					]),
				});
				data.gm = {
					gmid: gm.gmid,
					name: `${gm.firstName} ${gm.lastName}`,
					recordWithTeam: { won, lost },
					season: row
						? { won: row.won, lost: row.lost, expWon: row.expWon }
						: undefined,
					jobSecurity:
						current && isCurrent ? gmHotSeatLabel(gm.hotSeat) : undefined,
					leanings: Object.fromEntries(
						GM_TRAIT_KEYS.map((key) => [
							key,
							gmTraitLabel(key, gm.traits[key]),
						]),
					),
					// Only in God Mode, like the pages show bars rather than numbers
					traits: godMode ? gm.traits : undefined,
					hotSeat: godMode && current ? gm.hotSeat : undefined,
				};
			} else {
				notes.push("No general manager is recorded for this team-season.");
			}
		}

		// Finances (Team Finances page)
		if (college) {
			notes.push("No finances in college leagues.");
		} else {
			const rev = teamSeason.revenues as Record<string, number | undefined>;
			const exp = teamSeason.expenses as Record<string, number | undefined>;
			const revTotal = Object.values(rev).reduce<number>(
				(sum, x) => sum + (x ?? 0),
				0,
			);
			const expTotal = Object.values(exp).reduce<number>(
				(sum, x) => sum + (x ?? 0),
				0,
			);
			const items = [
				...Object.entries(rev).map(([key, value]) => [
					`Revenue: ${key}`,
					Math.round(value ?? 0),
				]),
				["Revenue: total", Math.round(revTotal)],
				...Object.entries(exp).map(([key, value]) => [
					`Expense: ${key}`,
					Math.round(value ?? 0),
				]),
				["Expense: total", Math.round(expTotal)],
				["Profit", Math.round(revTotal - expTotal)],
			];
			tables.push({
				section: "Staff",
				title: "Finances",
				cols: ["Item", "Amount ($K)"],
				rows: items,
			});
			facts.push(
				...fact(
					"Average attendance",
					teamSeason.gpHome > 0
						? Math.round(teamSeason.att / teamSeason.gpHome)
						: undefined,
				),
				...fact("Hype", r1(teamSeason.hype)),
				...fact("Population (M)", r1(teamSeason.pop)),
				...fact("Cash ($M)", r1(teamSeason.cash / 1000)),
			);
			data.finances = {
				revenues: rev,
				expenses: exp,
				revenue: revTotal,
				expense: expTotal,
				profit: revTotal - expTotal,
				expenseLevels: teamSeason.expenseLevels,
				att: teamSeason.att,
				gpHome: teamSeason.gpHome,
				hype: teamSeason.hype,
				pop: teamSeason.pop,
				cash: teamSeason.cash,
			};
		}

		// Owner mood (Owner page: the user's own team only)
		if (college) {
			// (no owner in college leagues)
		} else if (!isUserTeam) {
			notes.push("Owner mood is only shown for your own team.");
		} else if (teamSeason.ownerMood) {
			const [mood] = await augmentOwnerMoods({
				tid,
				moods: [teamSeason.ownerMood],
				seasons: [season],
			});
			const m = mood!;
			tables.push({
				section: "Staff",
				title: "Owner mood",
				cols: ["Component", "This season", "Cumulative"],
				rows: (["wins", "playoffs", "money"] as const)
					.map((key) => [
						capitalize(key),
						m.deltas ? r1(m.deltas[key]) : "",
						r1(m[key]),
					])
					.concat([
						[
							"Total",
							m.deltas
								? r1(m.deltas.wins + m.deltas.playoffs + m.deltas.money)
								: "",
							r1(m.total),
						],
					]),
			});
			data.ownerMood = {
				wins: m.wins,
				playoffs: m.playoffs,
				money: m.money,
				total: m.total,
				deltas: m.deltas,
			};
		} else {
			notes.push(
				"The owner hasn't judged this season yet (owner mood is set after the playoffs).",
			);
		}
		sections.staff = section("staff", { notes, facts, tables, data });
	}

	// ---------- Results ----------
	if (want.has("results")) {
		const facts: TeamFact[] = [
			...fact("Regular season", record),
			...fact(
				roster.playoffsByConf ? "Conference rank" : "League rank",
				t.rank,
			),
			...fact("Playoffs", roundsWonText),
		];
		const tables: ExportTable[] = [];
		const data: Record<string, unknown> = {};

		// Playoff series
		const ps = await idb.merged.playoffSeries.get(season);
		const numRounds = g.get("numGamesPlayoffSeries", season).length;
		const seriesRows: (string | number)[][] = [];
		if (ps) {
			for (const [round, matchups] of ps.series.entries()) {
				for (const m of matchups) {
					const us =
						m.home.tid === tid
							? m.home
							: m.away?.tid === tid
								? m.away
								: undefined;
					const them = us === m.home ? m.away : m.home;
					if (!us || !them) {
						continue;
					}
					const done = us.won + them.won;
					const name =
						round === numRounds - 1 ? "Finals" : `Round ${round + 1}`;
					seriesRows.push([
						name,
						abbrev(them.tid),
						us.seed,
						them.seed,
						done === 0
							? "Not started"
							: us.won > them.won
								? `Won ${us.won}-${them.won}`
								: us.won < them.won
									? `Lost ${us.won}-${them.won}`
									: `Tied ${us.won}-${them.won}`,
					]);
				}
			}
			for (const tournament of ps.playIns ?? []) {
				for (const m of tournament) {
					const us =
						m.home.tid === tid
							? m.home
							: m.away.tid === tid
								? m.away
								: undefined;
					const them = us === m.home ? m.away : m.home;
					if (!us || us.pts === undefined) {
						continue;
					}
					seriesRows.unshift([
						"Play-in",
						abbrev(them.tid),
						us.seed,
						them.seed,
						`${(us.pts ?? 0) > (them.pts ?? 0) ? "Won" : "Lost"} ${us.pts}-${them.pts}`,
					]);
				}
			}
		}
		if (seriesRows.length > 0) {
			tables.push({
				section: "Results",
				title: "Playoff series",
				cols: ["Round", "Opponent", "Seed", "Opp seed", "Result"],
				rows: seriesRows,
			});
			const seed = seriesRows.find((row) => row[0] !== "Play-in")?.[2];
			facts.push(...fact("Playoff seed", seed));
		}
		data.playoffSeries = seriesRows.map((row) => ({
			round: row[0],
			opponent: row[1],
			seed: row[2],
			oppSeed: row[3],
			result: row[4],
		}));

		// Awards: players' awards that season, and team honors
		const awardRows: (string | number)[][] = [];
		for (const p of players) {
			for (const a of p.awards ?? []) {
				awardRows.push([p.name ?? `${p.firstName} ${p.lastName}`, a.type]);
			}
		}
		const awardsDoc: any = await idb.merged.awards.get(season);
		if (awardsDoc?.bestRecord?.tid === tid) {
			awardRows.unshift(["(team)", "Best record"]);
		}
		// (an array, or an object keyed by conference in some leagues)
		const bestRecordConfs: any[] = Object.values(
			awardsDoc?.bestRecordConfs ?? {},
		);
		for (const conf of bestRecordConfs) {
			if (conf?.tid === tid) {
				awardRows.unshift(["(team)", "Best record in the conference"]);
			}
		}
		if (
			sa.playoffRoundsWon >= 0 &&
			sa.playoffRoundsWon === numRounds &&
			numRounds > 0
		) {
			awardRows.unshift([
				"(team)",
				college ? "National champions" : "League champions",
			]);
		}
		if (awardRows.length > 0) {
			tables.push({
				section: "Results",
				title: "Awards",
				cols: ["Player", "Award"],
				rows: awardRows,
			});
		}
		data.awards = awardRows.map(([player, award]) => ({ player, award }));

		// Notable games
		const gameRow = (category: string, gm: SplitGame) => [
			category,
			gm.day ?? "",
			abbrev(gm.oppTid),
			gm.neutral ? "Neutral" : gm.home ? "Home" : "Road",
			`${gm.pts}-${gm.oppPts}`,
			gm.result,
			gm.overtimes,
			gm.gid,
		];
		const notable: (string | number)[][] = [];
		const reg = splitGames.filter((gm) => !gm.playoffs);
		const best = <T>(xs: T[], f: (x: T) => number) =>
			xs.reduce<T | undefined>(
				(a, x) => (a === undefined || f(x) > f(a) ? x : a),
				undefined,
			);
		const wins = splitGames.filter((gm) => gm.result === "W");
		const losses = splitGames.filter((gm) => gm.result === "L");
		const biggestWin = best(wins, (gm) => gm.pts - gm.oppPts);
		if (biggestWin) {
			notable.push(gameRow("Biggest win", biggestWin));
		}
		const worstLoss = best(losses, (gm) => gm.oppPts - gm.pts);
		if (worstLoss) {
			notable.push(gameRow("Worst loss", worstLoss));
		}
		const mostPts = best(reg, (gm) => gm.pts);
		if (mostPts) {
			notable.push(gameRow("Most points scored", mostPts));
		}
		const fewestAllowed = best(reg, (gm) => -gm.oppPts);
		if (fewestAllowed) {
			notable.push(gameRow("Fewest points allowed", fewestAllowed));
		}
		const bestWinVsGood = best(
			wins.filter((gm) => gm.oppWinp >= 0.6),
			(gm) => gm.oppWinp,
		);
		if (bestWinVsGood) {
			notable.push(gameRow("Win over the best opponent", bestWinVsGood));
		}
		for (const gm of splitGames
			.filter((x) => x.overtimes > 0)
			.toSorted((a, b) => b.overtimes - a.overtimes)
			.slice(0, 3)) {
			notable.push(gameRow("Overtime", gm));
		}
		// The last game of each won or lost playoff series
		const lastPlayoff = splitGames.filter((gm) => gm.playoffs).at(-1);
		if (lastPlayoff) {
			notable.push(gameRow("Last playoff game", lastPlayoff));
		}
		if (notable.length > 0) {
			tables.push({
				section: "Results",
				title: "Notable games",
				cols: [
					"Category",
					"Day",
					"Opponent",
					"Site",
					"Score",
					"Result",
					"OT",
					"Game id",
				],
				rows: notable,
			});
		}
		data.notableGames = notable.map((row) => ({
			category: row[0],
			day: row[1],
			opponent: row[2],
			site: row[3],
			score: row[4],
			result: row[5],
			overtimes: row[6],
			gid: row[7],
		}));

		// Statistical feats (Statistical Feats page)
		const feats = (await idb.merged.playerFeats.getAll({ season })).filter(
			(f) => f.tid === tid,
		);
		const dayOf = new Map(games.map((gm) => [gm.gid, gm.day]));
		if (feats.length > 0) {
			const statsText = (stats: any) =>
				Object.entries(stats ?? {})
					.filter(([, v]) => typeof v === "number" && v !== 0)
					.map(([k, v]) => `${r1(v as number)} ${statTitle(k)}`)
					.join(", ");
			tables.push({
				section: "Results",
				title: "Statistical feats",
				cols: [
					"Player",
					"Day",
					"Opponent",
					"Result",
					"Score",
					"Stats",
					"Game id",
				],
				rows: feats.map((f) => [
					f.name,
					dayOf.get(f.gid) ?? "",
					abbrev(f.oppTid),
					f.result,
					f.score,
					statsText(f.stats),
					f.gid,
				]),
			});
			data.feats = feats.map((f) => ({
				pid: f.pid,
				name: f.name,
				gid: f.gid,
				day: dayOf.get(f.gid),
				opponent: abbrev(f.oppTid),
				playoffs: f.playoffs,
				result: f.result,
				score: f.score,
				stats: f.stats,
			}));
		}
		const notes: string[] = [];
		if (games.length === 0) {
			notes.push(
				"No box scores are stored for this team-season, so there are no notable games.",
			);
		}
		sections.results = section("results", { notes, facts, tables, data });
	}

	// Under the challenge, nothing taken from a page carries ratings (defense in depth: the parts above already leave them out). Not
	// the roster, where a retired player who played that season keeps his ratings, like the player pages
	if (challengeNoRatings) {
		for (const s of Object.values(sections)) {
			if (s.key !== "roster") {
				s.data = scrubTeamRatings(s.data);
			}
		}
	}

	// Data dictionary: every table column of every section
	for (const [key, s] of Object.entries(sections) as [
		TeamSectionKey,
		TeamSection,
	][]) {
		const cols: Record<string, string> = {};
		for (const table of s.tables) {
			for (const col of table.cols) {
				cols[col] =
					TEAM_COLUMN_DESCRIPTIONS[col] ??
					extraDesc[col] ??
					statDescription(col);
			}
		}
		cols["(facts)"] =
			"label/value pairs in the section's facts file, as the pages word them";
		dict[key] = cols;
	}

	const phase = g.get("phase");
	return {
		format: TEAM_EXPORT_FORMAT,
		schemaVersion: TEAM_EXPORT_SCHEMA_VERSION,
		exportedAt: new Date().toISOString(),
		generator: `${__SPORT === "basketball" ? "Basketball" : __SPORT} GM`,
		league: {
			lid: g.get("lid"),
			name: (await league.getName()) || `League ${g.get("lid")}`,
			sport: __SPORT,
			currentSeason,
			phase,
			phaseName: (PHASE_TEXT as Record<number, string>)[phase] ?? String(phase),
			college,
			userTids,
		},
		visibility: {
			ratingsShown: showRatings,
			challengeNoRatings,
			godMode,
			userTeam: isUserTeam,
			note: showRatings
				? "Ratings, archetypes and badges are as your scouts see them (not exact values), like the pages. GM leanings are words unless God Mode is on."
				: "Ratings, archetypes, badges, team rating, scheme fit and coach ratings are hidden (no visible ratings challenge), like the pages.",
		},
		team: {
			tid,
			season,
			abbrev: teamSeason.abbrev,
			region: teamSeason.region,
			name: teamSeason.name,
			conf: confs.find((c) => c.cid === teamSeason.cid)?.name ?? "",
			div: divs.find((d) => d.did === teamSeason.did)?.name ?? "",
		},
		skipped,
		sections,
		dataDictionary: dict,
	};
};

const TEAM_RATING_KEYS = new Set([
	"ovr",
	"pot",
	"ratings",
	"badges",
	"skills",
	"archetype",
	"fit",
	"fitText",
	"schemeFit",
]);
const scrubTeamRatings = <T>(value: T): T => {
	if (Array.isArray(value)) {
		return value.map((x) => scrubTeamRatings(x)) as T;
	}
	if (value && typeof value === "object") {
		const out: Record<string, unknown> = {};
		for (const [key, v] of Object.entries(value)) {
			if (!TEAM_RATING_KEYS.has(key)) {
				out[key] = scrubTeamRatings(v);
			}
		}
		return out as T;
	}
	return value;
};
