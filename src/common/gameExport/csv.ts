// Per-game download, CSV option: the box score, the play-by-play, the shot chart and the lineups as CSV files (zipped by the UI). Pure:
// reads the file the worker built (worker/util/gameExport) plus the play-by-play lines the UI adds.
import { toCSV } from "../playerExport.ts";

const BOX_KEYS = [
	"gs",
	"min",
	"pts",
	"fg",
	"fga",
	"tp",
	"tpa",
	"ft",
	"fta",
	"orb",
	"drb",
	"ast",
	"tov",
	"stl",
	"blk",
	"ba",
	"pf",
	"pm",
] as const;

type Team = { tid: number; abbrev: string };

const teamAbbrev = (teams: Team[], t: number | undefined) =>
	t === undefined ? "" : (teams[t]?.abbrev ?? "");

const minutes = (sec: number) => Math.round((sec / 60) * 10) / 10;

export const gameExportCsvFiles = (file: {
	teams: Team[];
	game: { teams: { tid: number; players: Record<string, any>[] }[] };
	playByPlay?: {
		lines?: {
			period: number;
			clock?: string;
			team?: string;
			text: string;
			score: Record<string, number>;
		}[];
	} | null;
	teamContext?: {
		lineups?: { groups?: any[] | null; onOff?: any[] | null } | null;
	}[];
	playerContext?: {
		pid: number;
		name: string;
		t: number;
		shotChart?: any[] | null;
	}[];
}) => {
	const { teams } = file;
	const names = new Map<number, string>();
	for (const t of file.game.teams) {
		for (const p of t.players) {
			names.set(p.pid, p.name);
		}
	}
	const nameOf = (pid: number | null | undefined) =>
		pid === null || pid === undefined ? "" : (names.get(pid) ?? String(pid));

	const files: { name: string; text: string }[] = [];

	// Box score: one row per player
	const keys = BOX_KEYS.filter((k) =>
		file.game.teams.some((t) => t.players.some((p) => p[k] !== undefined)),
	);
	const box: unknown[][] = [["team", "pid", "name", "pos", ...keys]];
	for (const [i, t] of file.game.teams.entries()) {
		for (const p of t.players) {
			box.push([
				teamAbbrev(teams, i),
				p.pid,
				p.name,
				p.pos,
				...keys.map((k) =>
					k === "min" && typeof p.min === "number"
						? Math.round(p.min * 10) / 10
						: p[k],
				),
			]);
		}
	}
	files.push({ name: "box_score.csv", text: toCSV(box) });

	// Play-by-play
	const lines = file.playByPlay?.lines;
	if (lines && lines.length > 0) {
		const home = teams[0]?.abbrev ?? "";
		const away = teams[1]?.abbrev ?? "";
		const rows: unknown[][] = [
			["period", "clock", "team", `score_${home}`, `score_${away}`, "text"],
		];
		for (const l of lines) {
			rows.push([
				l.period,
				l.clock ?? "",
				l.team ?? "",
				l.score[home] ?? "",
				l.score[away] ?? "",
				l.text,
			]);
		}
		files.push({ name: "play_by_play.csv", text: toCSV(rows) });
	}

	// Shot chart
	const shots = (file.playerContext ?? []).flatMap((p) =>
		(p.shotChart ?? []).map((s) => ({ ...s, pid: p.pid, t: p.t })),
	);
	if (shots.length > 0) {
		shots.sort((a, b) => a.n - b.n);
		const rows: unknown[][] = [
			[
				"n",
				"period",
				"clock",
				"team",
				"pid",
				"name",
				"zone",
				"sub_zone",
				"play_type",
				"pts",
				"made",
				"blocked",
				"assisted",
				"assister",
				"transition",
				"putback",
				"poss_sec",
				"xfg",
				"contest",
				"defender",
				"score_home",
				"score_away",
			],
		];
		for (const s of shots) {
			rows.push([
				s.n,
				s.period,
				s.clock,
				teamAbbrev(teams, s.t),
				s.pid,
				nameOf(s.pid),
				s.zoneName,
				s.subZone ?? "",
				s.playType ?? "",
				s.pts,
				s.made ? 1 : 0,
				s.blocked ? 1 : 0,
				s.assisted ? 1 : 0,
				nameOf(s.pidAst),
				s.transition ? 1 : 0,
				s.putback ? 1 : 0,
				s.possSec ?? "",
				s.xfg ?? "",
				s.contest ?? "",
				nameOf(s.defender),
				s.score?.[0],
				s.score?.[1],
			]);
		}
		files.push({ name: "shot_chart.csv", text: toCSV(rows) });
	}

	// Lineups: five-man groups, and each player's on/off
	const groups: unknown[][] = [
		[
			"team",
			"players",
			"min",
			"pts_for",
			"pts_against",
			"plus_minus",
			"poss",
			"net_rtg",
		],
	];
	const onOff: unknown[][] = [
		[
			"team",
			"pid",
			"name",
			"on_min",
			"on_plus_minus",
			"on_net_rtg",
			"off_min",
			"off_plus_minus",
			"off_net_rtg",
			"net_diff",
		],
	];
	for (const [i, tc] of (file.teamContext ?? []).entries()) {
		for (const l of tc.lineups?.groups ?? []) {
			groups.push([
				teamAbbrev(teams, i),
				(l.pids as number[]).map(nameOf).join(" / "),
				l.min,
				l.ptsFor,
				l.ptsAgainst,
				l.pm,
				l.poss,
				l.netRtg ?? "",
			]);
		}
		for (const o of tc.lineups?.onOff ?? []) {
			onOff.push([
				teamAbbrev(teams, i),
				o.pid,
				nameOf(o.pid),
				minutes(o.on.sec),
				o.on.pm,
				o.on.netRtg ?? "",
				minutes(o.off.sec),
				o.off.pm,
				o.off.netRtg ?? "",
				o.netDiff ?? "",
			]);
		}
	}
	if (groups.length > 1) {
		files.push(
			{ name: "lineups.csv", text: toCSV(groups) },
			{ name: "on_off.csv", text: toCSV(onOff) },
		);
	}

	return files;
};
