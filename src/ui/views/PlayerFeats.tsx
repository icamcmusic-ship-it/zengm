import { DataTable } from "../components/DataTable/index.tsx";
import useTitleBar from "../hooks/useTitleBar.tsx";
import { helpers } from "../util/helpers.ts";
import { getCols } from "../../common/getCols.ts";
import type { View } from "../../common/types.ts";
import { bySport } from "../../common/sportFunctions.ts";
import { wrappedPlayerNameLabels } from "../components/PlayerNameLabels.tsx";
import type { DataTableRow } from "../components/DataTable/index.tsx";
import { useLocal } from "../util/local.ts";
import { useState } from "react";
import { featLeaders } from "../../common/featKinds.ts";
import type { Col } from "../components/DataTable/index.tsx";

const PlayerFeats = ({
	feats: allFeats,
	kindOptions,
	typeOptions,
	quarterLengthFactor,
	season,
	stats,
	team,
}: View<"playerFeats">) => {
	useTitleBar({
		title: "Statistical Feats",
		dropdown: {
			fields: [
				{
					key: "team",
					options: { type: "teams", all: true, watch: true },
					value: team,
				},
				{
					key: "season",
					options: { type: "seasons", all: true },
					value: season,
				},
			],
			view: "playerFeats",
		},
	});
	const { userTid } = useLocal(["userTid"]);

	// Feat type and game type filters, and the per-player leaderboard
	const [kind, setKind] = useState("all");
	const [gameType, setGameType] = useState("all");
	const [tab, setTab] = useState<"games" | "leaders">("games");
	const kindValid = kind === "all" || kindOptions.some((k) => k.key === kind);
	const typeValid =
		gameType === "all" || typeOptions.some((t) => t.key === gameType);
	const feats = allFeats.filter(
		(feat) =>
			(!kindValid || kind === "all" || feat.kinds.includes(kind as any)) &&
			(!typeValid || gameType === "all" || feat.type === gameType),
	);

	const cols = getCols([
		"Name",
		"Pos",
		"Team",
		...stats.map((stat) => `stat:${stat}`),
		"Opp",
		"Result",
		"Season",
		"Type",
	]);

	const rows: DataTableRow<"player">[] = feats.map((p) => {
		const result = `${p.result} ${p.score}`;

		return {
			key: p.fid,
			// A deleted player has no player page or stats to show
			metadata: p.deleted
				? undefined
				: {
						type: "player",
						pid: p.pid,
						season: p.season,
						playoffs: p.type === "playoffs" ? "playoffs" : "regularSeason",
					},
			data: [
				p.deleted
					? { value: p.name, sortValue: p.name, searchValue: p.name }
					: wrappedPlayerNameLabels({
							pid: p.pid,
							season: typeof season === "number" ? season : undefined,
							legacyName: p.name,
						}),
				p.pos,
				<a
					href={helpers.leagueUrl(["roster", `${p.abbrev}_${p.tid}`, p.season])}
				>
					{p.abbrev}
				</a>,
				...stats.map((stat) => helpers.roundStat(p.stats[stat], stat, true)),
				<a
					href={helpers.leagueUrl([
						"roster",
						`${p.oppAbbrev}_${p.oppTid}`,
						p.season,
					])}
				>
					{p.oppAbbrev}
				</a>,
				{
					value: (
						<a
							href={helpers.leagueUrl([
								"game_log",
								p.abbrev === undefined ? "special" : `${p.abbrev}_${p.tid}`,
								p.season,
								p.gid,
							])}
						>
							{result}
						</a>
					),
					sortValue: Number.parseInt(p.score.split("-")[0]!),
					searchValue: result,
				},
				p.season,
				p.type === "allStar"
					? "All-Star"
					: p.type === "playoffs"
						? "Playoffs"
						: p.type === "nit"
							? "NIT"
							: "Regular season",
			],
			classNames: {
				"table-info": p.tid === userTid,
			},
		};
	});

	const superCols =
		__SPORT === "football"
			? [
					{
						title: "",
						colspan: 3,
					},
					{
						title: "Passing",
						colspan: 4,
					},
					{
						title: "Rushing",
						colspan: 3,
					},
					{
						title: "Receiving",
						colspan: 3,
					},
					{
						title: "Defense",
						colspan: 7,
					},
					{
						title: "Returns",
						colspan: 2,
					},
					{
						title: "",
						colspan: 4,
					},
				]
			: undefined;

	const scaleMinimum = (amount: number) => {
		return Math.ceil(amount * quarterLengthFactor);
	};

	const scaleSpecial = (name: string, description: string, amount: number) => {
		const scaledAmount = scaleMinimum(amount);
		if (scaledAmount === amount) {
			return name;
		}

		return `scaled ${name} (${scaledAmount}+ ${description})`;
	};

	return (
		<>
			{bySport({
				baseball: (
					<p>
						This lists all games where a player got {scaleMinimum(3)} home runs,{" "}
						{scaleMinimum(5)} hits, {scaleMinimum(6)} RBIs, {scaleMinimum(4)}{" "}
						runs, {scaleMinimum(3)} stolen bases, {scaleMinimum(15)} strikeouts,
						a no hitter, a shutout, or hit for the cycle
						{quarterLengthFactor !== 1
							? " (cutoffs are scaled due to a non-default period length)"
							: null}
						. Statistical feats from your players are{" "}
						<span className="text-info">highlighted in blue</span>.
					</p>
				),
				basketball: (
					<p>
						This lists all games where a player got a{" "}
						{scaleSpecial("triple double", "in 3 stats", 10)}, a{" "}
						{scaleSpecial("5x5", "pts/reb/ast/stl/blk", 5)}, {scaleMinimum(50)}{" "}
						points, {scaleMinimum(25)} rebounds, {scaleMinimum(20)} assists,{" "}
						{scaleMinimum(10)} steals, {scaleMinimum(10)} blocks, or{" "}
						{scaleMinimum(10)} threes
						{quarterLengthFactor !== 1
							? " (cutoffs are scaled for the game length and players on the court)"
							: null}
						. Cutoffs are higher in overtime games. Statistical feats from your
						players are <span className="text-info">highlighted in blue</span>.
					</p>
				),
				football: (
					<p>
						All games where a player got {scaleMinimum(400)} passing yards,{" "}
						{scaleMinimum(6)} passing TDs, {scaleMinimum(150)} rushing yards,{" "}
						{scaleMinimum(3)} rushing TDs, {scaleMinimum(150)} receiving yards,{" "}
						{scaleMinimum(3)} receiving TDs, {scaleMinimum(3)} sacks,{" "}
						{scaleMinimum(2)} interceptions, {scaleMinimum(2)} fumble
						recoveries, {scaleMinimum(2)} forced fumbles, {scaleMinimum(2)}{" "}
						defensive TDs, {scaleMinimum(2)} return TDs, {scaleMinimum(4)}{" "}
						rushing/receiving TDs, {scaleMinimum(200)} rushing/receiving yards,
						or {scaleMinimum(5)} total TDs (where passing ones count half) are
						listed here. If you changed quarter length to a non-default value in
						God Mode, the cuttoffs are scaled. Statistical feats from your
						players are <span className="text-info">highlighted in blue</span>.
					</p>
				),
				hockey: (
					<p>
						All games where a player got a{" "}
						{scaleSpecial("hat trick", "goals", 3)}, {scaleMinimum(4)}+ points,
						or a shutout are listed here. If you changed quarter length to a
						non-default value in God Mode, the cuttoffs are scaled. Statistical
						feats from your players are{" "}
						<span className="text-info">highlighted in blue</span>.
					</p>
				),
			})}

			<div className="d-flex flex-wrap align-items-center gap-2 mb-3">
				<div className="btn-group" role="group">
					<button
						className={`btn btn-sm ${tab === "games" ? "btn-primary" : "btn-light-bordered"}`}
						onClick={() => setTab("games")}
					>
						Games
					</button>
					<button
						className={`btn btn-sm ${tab === "leaders" ? "btn-primary" : "btn-light-bordered"}`}
						data-testid="feats-leaders-tab"
						onClick={() => setTab("leaders")}
					>
						Leaderboard
					</button>
				</div>
				{kindOptions.length > 0 ? (
					<select
						className="form-select form-select-sm w-auto"
						aria-label="Feat type"
						data-testid="feats-kind"
						value={kindValid ? kind : "all"}
						onChange={(event) => setKind(event.target.value)}
					>
						<option value="all">All feats</option>
						{kindOptions.map((k) => (
							<option key={k.key} value={k.key}>
								{k.name}
							</option>
						))}
					</select>
				) : null}
				{typeOptions.length > 1 ? (
					<select
						className="form-select form-select-sm w-auto"
						aria-label="Games"
						data-testid="feats-game-type"
						value={typeValid ? gameType : "all"}
						onChange={(event) => setGameType(event.target.value)}
					>
						<option value="all">All games</option>
						{typeOptions.map((t) => (
							<option key={t.key} value={t.key}>
								{t.name}
							</option>
						))}
					</select>
				) : null}
			</div>

			{tab === "games" ? (
				<DataTable
					cols={cols}
					defaultSort={[23, "desc"]}
					defaultStickyCols={window.mobile ? 0 : 1}
					name="PlayerFeats"
					rows={rows}
					superCols={superCols}
					pagination
				/>
			) : (
				<FeatLeaderboard
					feats={feats}
					kindOptions={kind === "all" || !kindValid ? kindOptions : []}
					season={season}
					userTid={userTid}
				/>
			)}
		</>
	);
};

// Feats per player for the feats shown (team, season and filters), with a count of each feat type
const FeatLeaderboard = ({
	feats,
	kindOptions,
	season,
	userTid,
}: {
	feats: View<"playerFeats">["feats"];
	kindOptions: View<"playerFeats">["kindOptions"];
	season: View<"playerFeats">["season"];
	userTid: number;
}) => {
	const { teamInfoCache } = useLocal(["teamInfoCache"]);
	const leaders = featLeaders(feats);

	const cols: Col[] = [
		...getCols(["#", "Name", "Team"]),
		{
			title: "Feats",
			desc: "Statistical feats",
			sortSequence: ["desc", "asc"],
			sortType: "number",
		},
		...kindOptions.map((k): Col => ({
			title: k.short,
			desc: k.name,
			sortSequence: ["desc", "asc"],
			sortType: "number",
		})),
		{
			title: "Seasons",
			desc: "First and last season with a feat",
			sortType: "number",
		},
	];

	const rows: DataTableRow[] = leaders.map((p, i) => {
		const abbrev = teamInfoCache[p.tid]?.abbrev;
		return {
			key: p.pid,
			data: [
				i + 1,
				p.deleted ? (
					p.name
				) : (
					<a href={helpers.leagueUrl(["player", p.pid])}>{p.name}</a>
				),
				abbrev ? (
					<a
						href={helpers.leagueUrl([
							"roster",
							`${abbrev}_${p.tid}`,
							typeof season === "number" ? season : p.last,
						])}
					>
						{abbrev}
					</a>
				) : (
					""
				),
				p.count,
				...kindOptions.map((k) => p.byKind[k.key] ?? 0),
				{
					value: p.first === p.last ? `${p.first}` : `${p.first}-${p.last}`,
					sortValue: p.last,
				},
			],
			classNames: {
				"table-info": p.tid === userTid,
			},
		};
	});

	return (
		<div data-testid="feats-leaderboard">
			<DataTable
				cols={cols}
				defaultSort={[3, "desc"]}
				defaultStickyCols={window.mobile ? 0 : 2}
				name="PlayerFeatsLeaders"
				rows={rows}
				pagination
			/>
		</div>
	);
};

export default PlayerFeats;
