import { useState, type ReactNode } from "react";
import useTitleBar from "../hooks/useTitleBar.tsx";
import { helpers } from "../util/helpers.ts";
import { useLocal } from "../util/local.ts";
import type { View } from "../../common/types.ts";
import { DataTable, type Col } from "../components/DataTable/index.tsx";
import type {
	Deal,
	Metric,
	ValueRow,
} from "../../common/valueGrades/contractValue.ts";
import { MIN_CY } from "../../common/valueGrades/contractValue.ts";

const TABS = [
	{ id: "seasons", label: "Best & worst seasons" },
	{ id: "deals", label: "Contracts" },
	{ id: "dead", label: "Dead money" },
	{ id: "teams", label: "Team efficiency" },
	{ id: "bargains", label: "Bargains by season" },
	{ id: "albatross", label: "Albatross deals" },
	{ id: "cyear", label: "Contract year" },
] as const;

const METRICS: { id: Metric; label: string; title: string }[] = [
	{
		id: "surplus",
		label: "Surplus WS",
		title: "Win shares above what the league gets for that money on average",
	},
	{
		id: "perM",
		label: "WS per $M",
		title: "Win shares per million dollars of salary",
	},
	{
		id: "index",
		label: "Value index",
		title:
			"Win shares per dollar against the league's rate that season (100 = average)",
	},
];

const n1 = (v: number | null | undefined) =>
	v === null || v === undefined ? "–" : v.toFixed(1);
const sgn = (v: number | null | undefined, d = 1) =>
	v === null || v === undefined
		? "–"
		: `${v > 0 ? "+" : v < 0 ? "−" : ""}${Math.abs(v).toFixed(d)}`;
const idx = (v: number | null | undefined) =>
	v === null || v === undefined ? "–" : String(Math.round(v * 100));
const money = (k: number) => helpers.formatCurrency(k / 1000, "M");
const f3 = (v: number | null | undefined) =>
	v === null || v === undefined ? "–" : v.toFixed(3).replace(/^(-?)0\./, "$1.");

const IndexCell = ({ v }: { v: number | null | undefined }) => (
	<span
		className={
			v === null || v === undefined
				? undefined
				: v >= 1
					? "text-success"
					: "text-danger"
		}
		title="Value index: win shares per dollar against the league rate (100 = average)"
	>
		{idx(v)}
	</span>
);

const col = (title: string, o: Partial<Col> = {}): Col => ({
	title,
	sortSequence: ["desc", "asc"],
	...o,
});

const useTeams = () => {
	const { teamInfoCache } = useLocal(["teamInfoCache"]);
	const abbrev = (tid: number) =>
		tid >= 0 ? (teamInfoCache[tid]?.abbrev ?? "???") : "–";
	const teamLink = (tid: number, season?: number, label?: ReactNode) =>
		tid >= 0 && teamInfoCache[tid] ? (
			<a
				href={helpers.leagueUrl([
					"roster",
					`${teamInfoCache[tid].abbrev}_${tid}`,
					...(season !== undefined ? [season] : []),
				] as any)}
			>
				{label ?? teamInfoCache[tid].abbrev}
			</a>
		) : (
			"–"
		);
	const full = (tid: number) => {
		const t = teamInfoCache[tid];
		return t ? `${t.region} ${t.name}` : "???";
	};
	return { abbrev, teamLink, full };
};

const playerLink = (pid: number, name: string) => (
	<a href={helpers.leagueUrl(["player", pid])}>{name}</a>
);

const years = (start: number, end: number) =>
	`${start}${end !== start ? `–${String(end).slice(-2)}` : ""}`;

const SeasonsTable = ({
	name,
	rows,
	metric,
	desc,
}: {
	name: string;
	rows: ValueRow[];
	metric: Metric;
	desc: boolean;
}) => {
	const { teamLink, abbrev } = useTeams();
	const cols: Col[] = [
		col("Player", { sortSequence: ["asc", "desc"] }),
		col("Season", { sortType: "number" }),
		col("Team", { sortSequence: ["asc", "desc"] }),
		col("Salary", { sortType: "number" }),
		col("MIN", { sortType: "number" }),
		col("WS", { sortType: "number" }),
		col("WS/$M", { sortType: "number" }),
		col("Surplus", {
			sortType: "number",
			desc: "WS minus what the league average rate buys with that salary",
		}),
		col("Value", {
			sortType: "number",
			desc: "Value index: win shares per dollar against the league rate (100 = average)",
		}),
	];
	const data = rows.map((r) => ({
		key: `${r.pid}-${r.season}`,
		data: [
			{
				value: playerLink(r.pid, r.name),
				sortValue: r.name,
				searchValue: r.name,
			},
			r.season,
			{ value: teamLink(r.tid, r.season), sortValue: abbrev(r.tid) },
			{ value: money(r.amount), sortValue: r.amount },
			Math.round(r.min),
			{ value: n1(r.ws), sortValue: r.ws },
			{ value: r.perM.toFixed(2), sortValue: r.perM },
			{
				value: (
					<span className={r.surplus >= 0 ? "text-success" : "text-danger"}>
						{sgn(r.surplus)}
					</span>
				),
				sortValue: r.surplus,
			},
			{ value: <IndexCell v={r.index} />, sortValue: r.index },
		],
	}));
	const sortCol = metric === "surplus" ? 7 : metric === "perM" ? 6 : 8;
	return (
		<DataTable
			cols={cols}
			defaultSort={[sortCol, desc ? "desc" : "asc"]}
			name={name}
			pagination={data.length > 15}
			rows={data}
			small
		/>
	);
};

const HOW: Record<string, string> = {
	freeAgent: "Signed",
	reSign: "Re-signed",
	rookie: "Rookie deal",
	unknown: "–",
};

const DealsTable = ({
	name,
	deals,
	metric,
	desc,
	cost,
}: {
	name: string;
	deals: (Deal & { cost?: number })[];
	metric: Metric | "cost";
	desc: boolean;
	cost?: boolean;
}) => {
	const { abbrev } = useTeams();
	const cols: Col[] = [
		col("Player", { sortSequence: ["asc", "desc"] }),
		col("Team", { sortSequence: ["asc", "desc"] }),
		col("Years", { sortType: "number" }),
		col("Deal", { sortSequence: ["asc", "desc"] }),
		col("Per year", { sortType: "number" }),
		col("Paid", {
			sortType: "number",
			desc: "Paid so far (completed seasons)",
		}),
		col("WS", { sortType: "number" }),
		col("WS/$M", { sortType: "number" }),
		col("Surplus", { sortType: "number" }),
		col("Value", {
			sortType: "number",
			desc: "Value index: win shares per dollar against the league rate (100 = average)",
		}),
		...(cost
			? [
					col("Dead $", {
						sortType: "number",
						desc: "Paid or owed after he was released",
					}),
					col("Over value", {
						sortType: "number",
						desc: "Paid beyond what the same win shares cost at the league rate, plus dead money",
					}),
				]
			: []),
	];
	const data = deals.map((c) => ({
		key: `${c.pid}-${c.start}`,
		data: [
			{
				value: playerLink(c.pid, c.name),
				sortValue: c.name,
				searchValue: c.name,
			},
			c.tids.map(abbrev).join(" "),
			{
				value: (
					<>
						{years(c.start, c.exp)}
						{c.ongoing ? (
							<span className="badge text-bg-secondary ms-1">ongoing</span>
						) : null}
						{c.released ? (
							<span className="badge text-bg-warning ms-1">released</span>
						) : null}
					</>
				),
				sortValue: c.start,
			},
			HOW[c.type] ?? "–",
			{ value: money(c.amount), sortValue: c.amount },
			{ value: money(c.paid), sortValue: c.paid },
			{ value: n1(c.ws), sortValue: c.ws },
			{ value: c.perM === null ? "–" : c.perM.toFixed(2), sortValue: c.perM },
			{
				value: (
					<span className={c.surplus >= 0 ? "text-success" : "text-danger"}>
						{sgn(c.surplus)}
					</span>
				),
				sortValue: c.surplus,
			},
			{ value: <IndexCell v={c.index} />, sortValue: c.index },
			...(cost
				? [
						{ value: c.dead > 0 ? money(c.dead) : "–", sortValue: c.dead },
						{
							value: <b className="text-danger">{money(c.cost ?? 0)}</b>,
							sortValue: c.cost ?? 0,
						},
					]
				: []),
		],
	}));
	const sortCol =
		metric === "cost"
			? 11
			: metric === "surplus"
				? 8
				: metric === "perM"
					? 7
					: 9;
	return (
		<DataTable
			cols={cols}
			defaultSort={[sortCol, desc ? "desc" : "asc"]}
			name={name}
			pagination={data.length > 15}
			rows={data}
			small
		/>
	);
};

const Stat = ({
	label,
	value,
	sub,
}: {
	label: string;
	value: ReactNode;
	sub?: ReactNode;
}) => (
	<div>
		<div className="text-body-secondary small">{label}</div>
		<div className="fs-4">{value}</div>
		{sub ? <div className="small text-body-secondary">{sub}</div> : null}
	</div>
);

const ContractValue = (props: View<"contractValue">) => {
	const { tab, team, season, lastDone, currentSeason, unknownCount, hasData } =
		props;
	const [metric, setMetric] = useState<Metric>("surplus");
	const { teamLink, abbrev, full } = useTeams();
	const { teamInfoCache } = useLocal(["teamInfoCache"]);

	useTitleBar({
		title: "Contract Value",
		dropdown: {
			view: "contractValue",
			params: { tab },
			fields: [
				{
					key: "team",
					options: { type: "teams", all: true },
					value: team,
				},
				{
					key: "season",
					options: { type: "seasons", all: true },
					value: season,
				},
			],
		},
	});

	const teamUrl =
		team === "all" ? "all" : `${teamInfoCache[team]?.abbrev ?? "???"}_${team}`;
	const filterText =
		(team !== "all" ? ` (${full(team)})` : "") +
		(season !== "all" ? ` in ${season}` : "");

	const metricPicker = (
		<div
			className="btn-group mb-2 flex-wrap"
			role="group"
			aria-label="Value measure"
		>
			{METRICS.map((m) => (
				<button
					key={m.id}
					type="button"
					className={`btn btn-sm ${m.id === metric ? "btn-primary" : "btn-outline-primary"}`}
					onClick={() => setMetric(m.id)}
					title={m.title}
				>
					{m.label}
				</button>
			))}
		</div>
	);
	const metricNote = (
		<p className="text-body-secondary small mb-2">
			{METRICS.find((m) => m.id === metric)!.title}.
			{metric !== "surplus"
				? tab === "seasons"
					? " Best needs 1,000+ minutes; worst looks only at big contracts (top 15% of salaries that season)."
					: " Best needs 3,000+ minutes; worst looks at the top 20% of salaries."
				: null}
		</p>
	);

	let body: ReactNode = null;
	if (!hasData) {
		body = <p>No completed season with salaries and stats yet.</p>;
	} else if (tab === "seasons" && props.bySeasonRows) {
		const r = props.bySeasonRows[metric];
		body = (
			<>
				{metricPicker}
				{metricNote}
				<div className="row">
					<div className="col-xl-6">
						<h2>Best value seasons{filterText}</h2>
						<SeasonsTable
							key={`b-${metric}`}
							name="ContractValueBestSeasons"
							rows={r.best}
							metric={metric}
							desc
						/>
					</div>
					<div className="col-xl-6">
						<h2>Worst value seasons{filterText}</h2>
						<SeasonsTable
							key={`w-${metric}`}
							name="ContractValueWorstSeasons"
							rows={r.worst}
							metric={metric}
							desc={false}
						/>
					</div>
				</div>
			</>
		);
	} else if (tab === "deals" && props.byDeals) {
		const r = props.byDeals[metric];
		body = (
			<>
				{metricPicker}
				{metricNote}
				<p className="text-body-secondary small">
					Each signed contract, counting the completed seasons he played on it
					(two or more to be listed). A released player's contract stops at the
					release; what the team still paid him after that is dead money.
				</p>
				<h2>Best contracts{filterText}</h2>
				<DealsTable
					key={`b-${metric}`}
					name="ContractValueBestDeals"
					deals={r.best}
					metric={metric}
					desc
				/>
				<h2 className="mt-3">Worst contracts{filterText}</h2>
				<DealsTable
					key={`w-${metric}`}
					name="ContractValueWorstDeals"
					deals={r.worst}
					metric={metric}
					desc={false}
				/>
			</>
		);
	} else if (
		tab === "dead" &&
		props.deadTeams &&
		props.deadGroups &&
		props.deadTotals
	) {
		const t = props.deadTotals;
		body =
			props.deadGroups.length === 0 && props.deadTeams.length === 0 ? (
				<p>No released player was paid or owed money{filterText}.</p>
			) : (
				<>
					<div className="d-flex flex-wrap gap-4 mb-3">
						<Stat
							label="Releases with money owed"
							value={t.releases.toLocaleString()}
						/>
						<Stat
							label="Dead money paid"
							value={money(t.paid)}
							sub={`through ${lastDone}`}
						/>
						<Stat
							label="Still owed"
							value={money(t.owed)}
							sub="this season and later"
						/>
					</div>
					<h2>Dead money by team</h2>
					<DataTable
						cols={[
							col("Team", { sortSequence: ["asc", "desc"] }),
							col("Still owed", { sortType: "number" }),
							col("Paid so far", { sortType: "number" }),
							col("Total", { sortType: "number" }),
							col("Releases", { sortType: "number" }),
						]}
						defaultSort={[1, "desc"]}
						name="ContractValueDeadTeams"
						rows={props.deadTeams.map((r) => ({
							key: r.tid,
							data: [
								{ value: teamLink(r.tid), sortValue: abbrev(r.tid) },
								{
									value:
										r.owed > 0 ? (
											<>
												<b>{money(r.owed)}</b>
												<div className="small text-body-secondary">
													{r.owedPlayers} player{r.owedPlayers === 1 ? "" : "s"}
													, through {r.lastOwed}
												</div>
											</>
										) : (
											"–"
										),
									sortValue: r.owed,
								},
								{ value: money(r.paid), sortValue: r.paid },
								{ value: money(r.total), sortValue: r.total },
								r.releases,
							],
						}))}
						small
					/>
					<h2 className="mt-3">Dead money by team-season{filterText}</h2>
					<p className="text-body-secondary small">
						Salary paid (or still owed) to players a team released, for seasons
						he didn't play for it, through the end of his deal. % of payroll is
						the share of everything the team paid that season.
					</p>
					<DataTable
						cols={[
							col("Team", { sortSequence: ["asc", "desc"] }),
							col("Season", { sortType: "number" }),
							col("Dead money", { sortType: "number" }),
							col("% of payroll", { sortType: "number" }),
							col("Players", { sortSequence: [] }),
						]}
						defaultSort={[2, "desc"]}
						name="ContractValueDeadGroups"
						pagination={props.deadGroups.length > 20}
						rows={props.deadGroups.map((g) => ({
							key: `${g.tid}-${g.season}`,
							data: [
								{ value: teamLink(g.tid), sortValue: abbrev(g.tid) },
								{
									value: (
										<>
											{g.season}
											{g.owed ? (
												<span className="badge text-bg-secondary ms-1">
													owed
												</span>
											) : null}
										</>
									),
									sortValue: g.season,
								},
								{ value: <b>{money(g.total)}</b>, sortValue: g.total },
								{
									value:
										g.share === null ? "–" : `${(100 * g.share).toFixed(1)}%`,
									sortValue: g.share,
								},
								{
									value: (
										<>
											{g.players.map((p, i) => (
												<span key={p.pid}>
													{i > 0 ? ", " : null}
													{playerLink(p.pid, p.name)}{" "}
													<span className="text-body-secondary">
														{money(p.amount)}
													</span>
												</span>
											))}
										</>
									),
									searchValue: g.players.map((p) => p.name).join(" "),
								},
							],
						}))}
						small
					/>
				</>
			);
	} else if (tab === "teams" && props.teams) {
		const rows = props.teams;
		const mine = team !== "all" ? rows.find((r) => r.tid === team) : undefined;
		body =
			rows.length === 0 ? (
				<p>No team payrolls on record{filterText}.</p>
			) : (
				<>
					{mine ? (
						<div className="d-flex flex-wrap gap-4 mb-3">
							<Stat
								label="Payroll efficiency"
								value={helpers.ordinal(mine.rank)}
								sub={`of ${rows.length} teams${season !== "all" ? ` in ${season}` : ""}`}
							/>
							<Stat
								label="Value index"
								value={<IndexCell v={mine.index} />}
								sub="100 = league rate"
							/>
							<Stat
								label="Paid"
								value={money(mine.payroll)}
								sub={`${mine.seasons} season${mine.seasons === 1 ? "" : "s"}`}
							/>
							<Stat
								label="Win shares bought"
								value={n1(mine.ws)}
								sub={`${sgn(mine.surplus)} vs the league rate`}
							/>
						</div>
					) : null}
					<h2>
						Payroll efficiency
						{season !== "all" ? `, ${season}` : ", every season on record"}
					</h2>
					<p className="text-body-secondary small">
						Win shares each team got for what it paid its players, against what
						the league's average rate buys with the same money that season
						(value index: 100 = average, 120 = 20% more wins per dollar). Dead
						money paid to released players is shown apart.
					</p>
					<DataTable
						cols={[
							col("#", { sortType: "number" }),
							col("Team", { sortSequence: ["asc", "desc"] }),
							col("Value", {
								sortType: "number",
								desc: "Value index (100 = league rate)",
							}),
							col("Paid", { sortType: "number" }),
							col("WS", { sortType: "number" }),
							col("vs rate", {
								sortType: "number",
								desc: "Win shares above what the league rate buys with that payroll",
							}),
							col("Dead $", { sortType: "number" }),
							col("Win%", { sortType: "number" }),
							...(season === "all"
								? [
										col("Seasons", { sortType: "number" }),
										col("Best / worst year", { sortSequence: [] }),
									]
								: []),
						]}
						defaultSort={[2, "desc"]}
						name="ContractValueTeams"
						rows={rows.map((r) => ({
							key: r.tid,
							classNames: r.tid === team ? "table-info" : undefined,
							data: [
								r.rank,
								{ value: teamLink(r.tid), sortValue: abbrev(r.tid) },
								{ value: <IndexCell v={r.index} />, sortValue: r.index },
								{ value: money(r.payroll), sortValue: r.payroll },
								{ value: n1(r.ws), sortValue: r.ws },
								{
									value: (
										<span
											className={
												r.surplus >= 0 ? "text-success" : "text-danger"
											}
										>
											{sgn(r.surplus)}
										</span>
									),
									sortValue: r.surplus,
								},
								{ value: r.dead > 0 ? money(r.dead) : "–", sortValue: r.dead },
								{
									value: r.winp === null ? "–" : helpers.roundWinp(r.winp),
									sortValue: r.winp,
								},
								...(season === "all"
									? [
											r.seasons,
											<span key="bw">
												<span className="text-success">
													{r.best.season} ({idx(r.best.index)})
												</span>
												{" · "}
												<span className="text-danger">
													{r.worst.season} ({idx(r.worst.index)})
												</span>
											</span>,
										]
									: []),
							],
						}))}
						small
					/>
					{props.teamYears && props.teamYears.length > 0 ? (
						<>
							<h2 className="mt-3">Season by season</h2>
							<DataTable
								cols={[
									col("Season", { sortType: "number" }),
									col("Value", { sortType: "number" }),
									col("Paid", { sortType: "number" }),
									col("WS", { sortType: "number" }),
									col("Dead $", { sortType: "number" }),
									col("Record", { sortType: "number" }),
								]}
								defaultSort={[0, "desc"]}
								name="ContractValueTeamYears"
								pagination={props.teamYears.length > 15}
								rows={props.teamYears.map((t) => ({
									key: t.season,
									data: [
										{
											value: teamLink(t.tid, t.season, t.season),
											sortValue: t.season,
										},
										{ value: <IndexCell v={t.index} />, sortValue: t.index },
										{ value: money(t.payroll), sortValue: t.payroll },
										{ value: n1(t.ws), sortValue: t.ws },
										{
											value: t.dead > 0 ? money(t.dead) : "–",
											sortValue: t.dead,
										},
										{
											value: t.won === null ? "–" : `${t.won}-${t.lost}`,
											sortValue: t.won,
										},
									],
								}))}
								small
							/>
						</>
					) : null}
				</>
			);
	} else if (tab === "bargains" && props.bargains) {
		const list = props.bargains;
		const pc = (r: ValueRow | null) =>
			r ? (
				<>
					{playerLink(r.pid, r.name)} {abbrev(r.tid)}
					<div className="small text-body-secondary">
						{money(r.amount)} · {n1(r.ws)} WS
					</div>
				</>
			) : (
				"–"
			);
		body =
			list.length === 0 ? (
				<p>No completed seasons with salaries match these filters.</p>
			) : (
				<>
					<h2>Biggest bargain of each season{filterText}</h2>
					<p className="text-body-secondary small">
						The player-season with the most win shares above what the league
						rate buys for his salary, and the worst big-money season (top 15% of
						salaries).
					</p>
					<DataTable
						cols={[
							col("Season", { sortType: "number" }),
							col("Biggest bargain", { sortSequence: [] }),
							col("Surplus", { sortType: "number" }),
							col("Worst big contract", { sortSequence: [] }),
							col("Surplus", { sortType: "number" }),
						]}
						defaultSort={[0, "desc"]}
						name="ContractValueBargains"
						pagination={list.length > 20}
						rows={list.map((x) => ({
							key: x.season,
							data: [
								x.season,
								{ value: pc(x.best), searchValue: x.best?.name ?? "" },
								{
									value: <b className="text-success">{sgn(x.best?.surplus)}</b>,
									sortValue: x.best?.surplus ?? null,
								},
								{ value: pc(x.worst), searchValue: x.worst?.name ?? "" },
								{
									value: x.worst ? (
										<span className="text-danger">{sgn(x.worst.surplus)}</span>
									) : (
										"–"
									),
									sortValue: x.worst?.surplus ?? null,
								},
							],
						}))}
						small
					/>
					{season !== "all" && list[0] ? (
						<>
							<h2 className="mt-3">Top bargains of {season}</h2>
							<ol>
								{list[0].top.map((r) => (
									<li key={r.pid}>
										{playerLink(r.pid, r.name)} {abbrev(r.tid)}{" "}
										<span className="text-body-secondary">
											{money(r.amount)}, {n1(r.ws)} WS,
										</span>{" "}
										<b className="text-success">{sgn(r.surplus)} WS</b>
									</li>
								))}
							</ol>
						</>
					) : null}
				</>
			);
	} else if (tab === "albatross" && props.albatross) {
		const list = props.albatross;
		body =
			list.length === 0 ? (
				<p>
					No big contract with two completed seasons fell short of the league
					rate{filterText}.
				</p>
			) : (
				<>
					<div className="d-flex flex-wrap gap-4 mb-3">
						<Stat
							label="Albatross contracts"
							value={list.length.toLocaleString()}
							sub="top 20% salaries, under the league rate"
						/>
						<Stat
							label="Money over value"
							value={money(props.albatrossTotal)}
							sub="paid beyond what the production was worth"
						/>
						<Stat
							label="Worst"
							value={playerLink(list[0]!.pid, list[0]!.name)}
							sub={money(list[0]!.cost)}
						/>
					</div>
					<p className="text-body-secondary small">
						Big deals ranked by money over value: what was paid beyond what the
						same win shares cost at the league's rate those seasons, plus dead
						money paid or owed after a release. Only completed seasons count.
					</p>
					<DealsTable
						name="ContractValueAlbatross"
						deals={list}
						metric="cost"
						desc
						cost
					/>
				</>
			);
	} else if (tab === "cyear" && props.cyear) {
		const r = props.cyear;
		const cols: Col[] = [
			col("Player", { sortSequence: ["asc", "desc"] }),
			col("Team", { sortSequence: ["asc", "desc"] }),
			col("Last year", { sortType: "number" }),
			col("Age", { sortType: "number" }),
			col("Deal", { sortType: "number" }),
			col("Before", {
				sortType: "number",
				desc: "WS/48 in the deal's earlier seasons",
			}),
			col("Contract yr", {
				sortType: "number",
				desc: "WS/48 in the last season of the deal",
			}),
			col("Change", { sortType: "number" }),
			col("Next yr", {
				sortType: "number",
				desc: "WS/48 the season after (the new deal)",
			}),
		];
		const toRows = (rows: typeof r.jumps) =>
			rows.map((x) => ({
				key: `${x.deal.pid}-${x.season}`,
				data: [
					{
						value: playerLink(x.deal.pid, x.deal.name),
						sortValue: x.deal.name,
						searchValue: x.deal.name,
					},
					{ value: teamLink(x.tid, x.season), sortValue: abbrev(x.tid) },
					x.season,
					x.age,
					{
						value: `${money(x.deal.amount)} × ${x.deal.years}`,
						sortValue: x.deal.years,
					},
					{ value: f3(x.before), sortValue: x.before },
					{ value: f3(x.final), sortValue: x.final },
					{
						value: (
							<span className={x.d >= 0 ? "text-success" : "text-danger"}>
								{sgn(x.d, 3).replace(/(\D)0\./, "$1.")}
							</span>
						),
						sortValue: x.d,
					},
					{ value: f3(x.after), sortValue: x.after },
				],
			}));
		body =
			r.n === 0 ? (
				<p>
					No finished multi-year deal with {MIN_CY}+ minutes in its last season
					and before it{filterText}.
				</p>
			) : (
				<>
					<div className="d-flex flex-wrap gap-4 mb-3">
						<Stat
							label="Contract years"
							value={r.n.toLocaleString()}
							sub="last seasons of multi-year deals"
						/>
						<Stat
							label="Better than the deal's earlier years"
							value={`${Math.round((100 * r.up) / r.n)}%`}
							sub={`${r.up} of ${r.n}`}
						/>
						<Stat
							label="WS/48"
							value={`${f3(r.meanBefore)} → ${f3(r.meanFinal)}`}
							sub="earlier years → contract year"
						/>
						{r.nAfter > 0 ? (
							<Stat
								label="The season after"
								value={`${f3(r.meanFinalWithAfter)} → ${f3(r.meanAfter)}`}
								sub={`${Math.round((100 * r.drop) / r.nAfter)}% dropped off (${r.nAfter} players)`}
							/>
						) : null}
					</div>
					<p className="text-body-secondary small">
						Win shares per 48 minutes in the last season of a deal, against the
						earlier seasons of the same deal ({MIN_CY}+ minutes in each). Young
						players improve anyway and veterans decline anyway, so read the
						season after too: a real contract-year push fades once the new deal
						is signed.
					</p>
					<h2>Biggest contract-year jumps</h2>
					<DataTable
						cols={cols}
						defaultSort={[7, "desc"]}
						name="ContractValueCyJumps"
						pagination={r.jumps.length > 15}
						rows={toRows(r.jumps)}
						small
					/>
					<h2 className="mt-3">Biggest contract-year slumps</h2>
					<DataTable
						cols={cols}
						defaultSort={[7, "asc"]}
						name="ContractValueCySlumps"
						pagination={r.slumps.length > 15}
						rows={toRows(r.slumps)}
						small
					/>
				</>
			);
	}

	return (
		<>
			<p>
				What teams paid their players against the regular-season win shares they
				got back. The league rate is the win shares per dollar the whole league
				got that season
				{props.rate !== null
					? ` (${props.rate.toFixed(2)} WS per $1M in ${season})`
					: ""}
				; a value index of 100 is that rate. Only completed seasons count
				{lastDone < currentSeason
					? ` (${currentSeason} is still being played)`
					: ""}
				.
				{unknownCount > 0
					? ` ${unknownCount.toLocaleString()} player-season${unknownCount === 1 ? "" : "s"} with no win shares on record ${unknownCount === 1 ? "is" : "are"} left out (unknown, not zero).`
					: null}{" "}
				See also <a href={helpers.leagueUrl(["trade_grader"])}>Trade Grader</a>.
			</p>
			<ul className="nav nav-pills mb-3 flex-wrap">
				{TABS.map((t) => (
					<li key={t.id} className="nav-item">
						<a
							className={`nav-link${t.id === tab ? " active" : ""}`}
							href={helpers.leagueUrl([
								"contract_value",
								t.id,
								teamUrl,
								String(season),
							])}
						>
							{t.label}
						</a>
					</li>
				))}
			</ul>
			{body}
		</>
	);
};

export default ContractValue;
