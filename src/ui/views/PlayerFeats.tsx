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
	ledger,
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
	const [tab, setTab] = useState<"games" | "leaders" | "team" | "streaks">(
		"games",
	);
	const kindValid = kind === "all" || kindOptions.some((k) => k.key === kind);
	const typeValid =
		gameType === "all" || typeOptions.some((t) => t.key === gameType);
	const feats = allFeats.filter(
		(feat) =>
			(!kindValid || kind === "all" || feat.kinds.includes(kind as any)) &&
			(!typeValid || gameType === "all" || feat.type === gameType),
	);

	const cols: Col[] = [
		...getCols([
			"Name",
			"Pos",
			"Team",
			...stats.map((stat) => `stat:${stat}`),
			"Opp",
			"Result",
			"Season",
			"Type",
		]),
		// Feat Rarity & Streaks: the era-normalized feat score and the notes from when it happened
		...(ledger
			? [
					{
						title: "Feat Score",
						desc: "Feat score: the line scaled to a reference era (the league's scoring, rebounding, ... that season) and to the game's length and players on the court, weighted like a game score",
						sortSequence: ["desc", "asc"],
						sortType: "number",
					} satisfies Col,
					{
						title: "Notes",
						desc: "Rarity, career highs and streaks when it happened",
						sortType: "string",
					} satisfies Col,
				]
			: []),
	];

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
				...(ledger
					? [
							{
								value: p.fs ?? "",
								sortValue: p.fs ?? -Infinity,
							},
							{
								value: p.notes ? (
									<span className="small">{p.notes.join("; ")}</span>
								) : (
									""
								),
								sortValue: p.notes?.join("; ") ?? "",
								searchValue: p.notes?.join("; ") ?? "",
							},
						]
					: []),
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
					{ledger ? (
						<>
							<button
								className={`btn btn-sm ${tab === "team" ? "btn-primary" : "btn-light-bordered"}`}
								data-testid="feats-team-tab"
								onClick={() => setTab("team")}
							>
								Team feats
							</button>
							<button
								className={`btn btn-sm ${tab === "streaks" ? "btn-primary" : "btn-light-bordered"}`}
								data-testid="feats-streaks-tab"
								onClick={() => setTab("streaks")}
							>
								Streaks
							</button>
						</>
					) : null}
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

			{tab === "team" && ledger ? (
				<TeamFeats ledger={ledger} userTid={userTid} />
			) : tab === "streaks" && ledger ? (
				<Streaks ledger={ledger} userTid={userTid} />
			) : tab === "games" ? (
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

type Ledger = NonNullable<View<"playerFeats">["ledger"]>;

// Feat Rarity & Streaks: team feats (150+ points, 25+ threes, 30-point comebacks), newest first
const TeamFeats = ({
	ledger,
	userTid,
}: {
	ledger: Ledger;
	userTid: number;
}) => {
	const cols: Col[] = [
		{ title: "Team", sortType: "string" },
		{ title: "Feat", sortType: "string" },
		{ title: "Value", sortSequence: ["desc", "asc"], sortType: "number" },
		{ title: "Opp", sortType: "string" },
		{ title: "Score", sortType: "string" },
		{ title: "Season", sortType: "number" },
		{ title: "Type", sortType: "string" },
		{ title: "Notes", sortType: "string" },
	];
	const rows: DataTableRow[] = ledger.teamFeats.map((tf, i) => ({
		key: i,
		data: [
			<a
				href={helpers.leagueUrl([
					"roster",
					`${tf.abbrev}_${tf.tid}`,
					tf.season,
				])}
			>
				{tf.abbrev}
			</a>,
			tf.name,
			tf.value,
			tf.oppAbbrev ?? "",
			{
				value: (
					<a
						href={helpers.leagueUrl([
							"game_log",
							`${tf.abbrev}_${tf.tid}`,
							tf.season,
							tf.gid,
						])}
					>
						{tf.score}
					</a>
				),
				sortValue: tf.score,
			},
			tf.season,
			tf.playoffs ? "Playoffs" : "Regular season",
			tf.rarity ?? "",
		],
		classNames: { "table-info": tf.tid === userTid },
	}));
	return (
		<div data-testid="feats-team">
			<p className="text-body-secondary small">
				Games where a team scored 150+ points or made 25+ threes, or won after
				trailing by 30+ at the end of a period (cutoffs scale with the game's
				length and players on the court). Kept as games are played (the last
				300).
			</p>
			{rows.length === 0 ? (
				<p>None yet.</p>
			) : (
				<DataTable
					cols={cols}
					defaultSort={[5, "desc"]}
					name="PlayerFeatsTeam"
					rows={rows}
					pagination
				/>
			)}
		</div>
	);
};

// Feat Rarity & Streaks: running streaks and the longest ever
const Streaks = ({ ledger, userTid }: { ledger: Ledger; userTid: number }) => {
	const { teamInfoCache } = useLocal(["teamInfoCache"]);
	return (
		<div data-testid="feats-streaks">
			<p className="text-body-secondary small">
				Consecutive regular season games played with a triple-double, a
				double-double or 30+ points (cutoffs scale like the feats').
			</p>
			<h3 className="h5">Active streaks</h3>
			{ledger.running.length === 0 ? (
				<p>None right now.</p>
			) : (
				<ul>
					{ledger.running.map((r) => (
						<li
							key={`${r.pid}-${r.kind}`}
							className={r.tid === userTid ? "text-info" : undefined}
						>
							<a href={helpers.leagueUrl(["player", r.pid])}>{r.name}</a>
							{teamInfoCache[r.tid]?.abbrev
								? ` (${teamInfoCache[r.tid]!.abbrev})`
								: ""}
							: {r.n} straight {r.kindName}
						</li>
					))}
				</ul>
			)}
			<div className="row">
				{ledger.longest.map((group) => (
					<div className="col-md-4" key={group.kind}>
						<h3 className="h5">Longest: {group.kindName}</h3>
						{group.rows.length === 0 ? (
							<p>None yet.</p>
						) : (
							<ol>
								{group.rows.map((r) => (
									<li key={`${r.pid}-${r.from}`}>
										{r.exists ? (
											<a href={helpers.leagueUrl(["player", r.pid])}>
												{r.name}
											</a>
										) : (
											r.name
										)}
										{r.abbrev ? ` (${r.abbrev})` : ""}: {r.n} games,{" "}
										{r.from === r.to ? r.from : `${r.from}-${r.to}`}
									</li>
								))}
							</ol>
						)}
					</div>
				))}
			</div>
		</div>
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
