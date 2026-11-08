import { Fragment, type ReactNode } from "react";
import useTitleBar from "../hooks/useTitleBar.tsx";
import { helpers } from "../util/helpers.ts";
import { useLocal } from "../util/local.ts";
import type { View } from "../../common/types.ts";
import { DataTable, type Col } from "../components/DataTable/index.tsx";
import { TradeGradeBadge } from "../components/TradeGradeBadge.tsx";
import type {
	GradeItem,
	GradeSide,
	GradeTrade,
	ReportCard,
	SideRef,
} from "../../common/valueGrades/tradeGrader.ts";
import { EVEN } from "../../common/valueGrades/tradeGrader.ts";
import { PHASE } from "../../common/constants.ts";

const TABS = [
	{ id: "best", label: "Biggest wins & losses" },
	{ id: "cards", label: "Report cards" },
	{ id: "team", label: "Team report" },
	{ id: "season", label: "By season" },
] as const;

const n1 = (v: number | null | undefined) =>
	v === null || v === undefined ? "?" : v.toFixed(1);
const sgn = (v: number | null | undefined) =>
	v === null || v === undefined
		? "?"
		: `${v > 0 ? "+" : v < 0 ? "−" : ""}${Math.abs(v).toFixed(1)}`;
const netClass = (v: number | null | undefined) =>
	v === null || v === undefined
		? undefined
		: v > 0
			? "text-success"
			: v < 0
				? "text-danger"
				: undefined;

const col = (title: string, o: Partial<Col> = {}): Col => ({
	title,
	sortSequence: ["desc", "asc"],
	...o,
});

const useTeams = () => {
	const { teamInfoCache } = useLocal(["teamInfoCache"]);
	const abbrev = (tid: number) => teamInfoCache[tid]?.abbrev ?? "???";
	const full = (tid: number) => {
		const t = teamInfoCache[tid];
		return t ? `${t.region} ${t.name}` : "???";
	};
	const teamPart = (tid: number) => `${abbrev(tid)}_${tid}`;
	return { abbrev, full, teamPart };
};

const roundName = (r: number) => helpers.ordinal(r);

const ItemView = ({
	item,
	abbrev,
}: {
	item: GradeItem;
	abbrev: (tid: number) => string;
}) => {
	const ws = (
		<span className="text-body-secondary">
			{" "}
			{item.total === null
				? "WS unknown"
				: `${n1(item.total)}${item.partial ? "*" : ""}`}
			{item.living && item.kind === "player" ? " · still there" : null}
		</span>
	);
	const player =
		item.pid !== null ? (
			<a href={helpers.leagueUrl(["player", item.pid])}>{item.name}</a>
		) : (
			item.name
		);
	if (item.kind === "player") {
		return (
			<span className="text-nowrap-md">
				{player}
				{ws}
			</span>
		);
	}
	const p = item.pick!;
	const label = `${p.season} ${roundName(p.round)}${p.no ? ` (#${p.no})` : ""}${
		p.originalTid >= 0 ? ` ${abbrev(p.originalTid)}` : ""
	}`;
	let tail: ReactNode;
	if (item.how === "drafted") {
		tail = (
			<>
				{" → "}
				{player}
				{ws}
			</>
		);
	} else if (item.how === "flipped") {
		tail = (
			<span className="text-body-secondary">
				{item.name ? (
					<>
						{" → "}
						{player}
					</>
				) : null}{" "}
				{item.flipEid !== null ? (
					<a href={helpers.leagueUrl(["trade_summary", item.flipEid])}>
						traded on
					</a>
				) : (
					"picked by another team"
				)}
			</span>
		);
	} else if (item.how === "pending") {
		tail = <span className="text-body-secondary"> not used yet</span>;
	} else {
		tail = <span className="text-body-secondary"> fate unknown</span>;
	}
	return (
		<span>
			<span className="fw-semibold">{label}</span>
			{tail}
		</span>
	);
};

const Items = ({
	side,
	abbrev,
}: {
	side: GradeSide;
	abbrev: (tid: number) => string;
}) => {
	if (side.items.length === 0) {
		return <span className="text-body-secondary">nothing</span>;
	}
	return (
		<>
			{side.items.map((x, k) => (
				<Fragment key={k}>
					{k > 0 ? "; " : null}
					<ItemView item={x} abbrev={abbrev} />
				</Fragment>
			))}
		</>
	);
};

const gradeTitle = (s: GradeSide) =>
	s.grade
		? `${Math.round(s.grade.share * 100)}% of the win shares in the deal${s.open ? " (still playing out)" : ""}`
		: undefined;

const seasonLabel = (season: number, phase: number) =>
	`${season}${phase > PHASE.PLAYOFFS ? " off" : ""}`;

const SidesTable = ({
	name,
	sides,
	noTeam,
	defaultSort,
}: {
	name: string;
	sides: GradeSide[];
	noTeam?: boolean;
	defaultSort: [number, "asc" | "desc"];
}) => {
	const { abbrev, teamPart } = useTeams();
	const cols: Col[] = [
		col("Grade", { sortType: "number" }),
		...(noTeam ? [] : [col("Team", { sortSequence: ["asc", "desc"] })]),
		col("Season", { sortType: "number" }),
		col("With", { sortSequence: ["asc", "desc"] }),
		col("Got (WS for them)", { noSearch: false, sortSequence: [] }),
		col("Then", {
			sortType: "number",
			desc: "Win shares the arrivals produced in the season the trade was made for",
		}),
		col("After", {
			sortType: "number",
			desc: "Win shares in the seasons after",
		}),
		col("Total", { sortType: "number" }),
		col("Gave", {
			sortType: "number",
			desc: "Win shares what they traded away produced for the other team",
		}),
		col("Net", { sortType: "number" }),
	];
	const rows = sides.map((s) => ({
		key: `${s.eid}-${s.i}`,
		data: [
			{
				value: <TradeGradeBadge grade={s.grade?.g} title={gradeTitle(s)} />,
				sortValue: s.grade ? s.grade.share : -1,
				searchValue: s.grade?.g ?? "",
			},
			...(noTeam
				? []
				: [
						<a
							key="t"
							href={helpers.leagueUrl([
								"trade_grader",
								"team",
								teamPart(s.tid),
							])}
						>
							{abbrev(s.tid)}
						</a>,
					]),
			{
				value: (
					<a
						href={helpers.leagueUrl(["trade_summary", s.eid])}
						title={
							s.phase > PHASE.PLAYOFFS
								? `Offseason trade: win shares counted from ${s.season + 1}`
								: "In-season trade"
						}
					>
						{seasonLabel(s.season, s.phase)}
					</a>
				),
				sortValue: s.eid,
			},
			abbrev(s.partner),
			{
				value: <Items side={s} abbrev={abbrev} />,
				searchValue: s.items.map((x) => x.name ?? "").join(" "),
			},
			{ value: s.unknown ? "?" : n1(s.got.now), sortValue: s.got.now },
			{ value: s.unknown ? "?" : n1(s.got.later), sortValue: s.got.later },
			{
				value: (
					<b>{s.unknown ? "?" : `${n1(s.got.total)}${s.partial ? "*" : ""}`}</b>
				),
				sortValue: s.got.total,
			},
			{
				value: n1(s.net === null ? null : s.gave.total),
				sortValue: s.gave.total,
			},
			{
				value: <span className={netClass(s.net)}>{sgn(s.net)}</span>,
				sortValue: s.net,
			},
		],
	}));
	return (
		<DataTable
			cols={cols}
			defaultSort={defaultSort}
			name={name}
			pagination={rows.length > 15}
			rows={rows}
			small
		/>
	);
};

const SideRefLink = ({ r }: { r: SideRef | null }) => {
	if (!r) {
		return <>–</>;
	}
	return (
		<>
			<a href={helpers.leagueUrl(["trade_summary", r.eid])}>
				{seasonLabel(r.season, r.phase)}
			</a>{" "}
			<span className={netClass(r.net)}>{sgn(r.net)}</span>
		</>
	);
};

const CardsTable = ({
	name,
	cards,
	noCount,
}: {
	name: string;
	cards: ReportCard[];
	noCount?: boolean;
}) => {
	const { abbrev, full, teamPart } = useTeams();
	const cols: Col[] = [
		col("Team", { sortSequence: ["asc", "desc"] }),
		col("Grade", {
			sortType: "number",
			desc: "Average grade over its graded trades (A+ = 4.3, B = 3.0, F = 0)",
		}),
		...(noCount ? [] : [col("Trades", { sortType: "number" })]),
		col("W-L-E", {
			sortType: "number",
			desc: `Won, lost and even (within ${EVEN} WS)`,
		}),
		col("Got", { sortType: "number" }),
		col("Gave", { sortType: "number" }),
		col("Net WS", { sortType: "number" }),
		col("Best trade", { sortSequence: [] }),
		col("Worst trade", { sortSequence: [] }),
	];
	const rows = cards.map((c) => ({
		key: c.tid,
		data: [
			{
				value: (
					<a
						href={helpers.leagueUrl(["trade_grader", "team", teamPart(c.tid)])}
					>
						{full(c.tid)}
					</a>
				),
				sortValue: abbrev(c.tid),
			},
			{
				value: (
					<>
						<TradeGradeBadge
							grade={c.grade}
							title={c.gpa !== null ? `GPA ${c.gpa.toFixed(2)}` : undefined}
						/>{" "}
						<span className="text-body-secondary">
							{c.gpa !== null ? c.gpa.toFixed(2) : ""}
						</span>
					</>
				),
				sortValue: c.gpa ?? -1,
			},
			...(noCount ? [] : [{ value: c.n, sortValue: c.n }]),
			{ value: `${c.won}-${c.lost}-${c.even}`, sortValue: c.won - c.lost },
			{ value: n1(c.got), sortValue: c.got },
			{ value: n1(c.gave), sortValue: c.gave },
			{
				value: <b className={netClass(c.net)}>{sgn(c.net)}</b>,
				sortValue: c.net,
			},
			<SideRefLink key="b" r={c.best} />,
			<SideRefLink key="w" r={c.worst} />,
		],
	}));
	return (
		<DataTable
			cols={cols}
			defaultSort={[noCount ? 5 : 6, "desc"]}
			name={name}
			rows={rows}
			small
		/>
	);
};

const NetBars = ({
	years,
	label,
}: {
	years: { season: number; net: number }[];
	label: string;
}) => {
	const max = Math.max(1, ...years.map((y) => Math.abs(y.net)));
	return (
		<div role="img" aria-label={label} style={{ maxWidth: 560 }}>
			{years.map((y) => (
				<div key={y.season} className="d-flex align-items-center mb-1">
					<span className="me-2 text-body-secondary" style={{ width: "3em" }}>
						{y.season}
					</span>
					<span
						className="position-relative flex-grow-1 bg-body-tertiary rounded"
						style={{ height: 14 }}
					>
						<span
							className={`position-absolute rounded ${y.net >= 0 ? "bg-success" : "bg-danger"}`}
							style={{
								top: 0,
								bottom: 0,
								width: `${Math.max(1, (Math.abs(y.net) / max) * 50)}%`,
								[y.net >= 0 ? "left" : "right"]: "50%",
							}}
						/>
						<span
							className="position-absolute border-start border-secondary"
							style={{ left: "50%", top: -2, bottom: -2 }}
						/>
					</span>
					<span
						className={`ms-2 text-end ${netClass(y.net)}`}
						style={{ width: "3.5em" }}
					>
						{sgn(y.net)}
					</span>
				</div>
			))}
		</div>
	);
};

const SideCell = ({ s }: { s: GradeSide }) => {
	const { abbrev, teamPart } = useTeams();
	return (
		<div>
			<div>
				<TradeGradeBadge grade={s.grade?.g} title={gradeTitle(s)} />{" "}
				<a href={helpers.leagueUrl(["trade_grader", "team", teamPart(s.tid)])}>
					{abbrev(s.tid)}
				</a>{" "}
				<span className="text-body-secondary">
					{s.unknown ? "?" : n1(s.got.total)} WS
				</span>
			</div>
			<div className="small">
				<Items side={s} abbrev={abbrev} />
			</div>
		</div>
	);
};

const SeasonTrades = ({
	trades,
	season,
}: {
	trades: GradeTrade[];
	season: number;
}) => {
	const cols: Col[] = [
		col("Gap", {
			sortType: "number",
			desc: "Net win shares between the sides",
		}),
		col("Side", { sortSequence: [] }),
		col("Side", { sortSequence: [] }),
		col("", { sortSequence: [] }),
	];
	const gap = (t: GradeTrade) =>
		t.sides[0].net === null ? -1 : Math.abs(t.sides[0].net);
	const rows = trades.map((t) => ({
		key: t.eid,
		data: [
			{ value: gap(t) < 0 ? "?" : n1(gap(t)), sortValue: gap(t) },
			<SideCell key="a" s={t.sides[0]} />,
			<SideCell key="b" s={t.sides[1]} />,
			<a key="l" href={helpers.leagueUrl(["trade_summary", t.eid])}>
				Summary
			</a>,
		],
	}));
	return (
		<DataTable
			cols={cols}
			defaultSort={[0, "desc"]}
			name={`TradeGraderSeason`}
			pagination={rows.length > 20}
			rows={rows}
			small
			title={undefined}
			key={season}
		/>
	);
};

const TradeGrader = (props: View<"tradeGrader">) => {
	const {
		tab,
		team,
		season,
		numTrades,
		numSides,
		graded,
		partial,
		open,
		wins,
		losses,
		cards,
		teamCard,
		teamRank,
		teamSides,
		seasonTrades,
	} = props;
	const { full, teamPart } = useTeams();

	useTitleBar({
		title: "Trade Grader",
		dropdown: {
			view: "tradeGrader",
			params: { tab },
			fields: [
				{
					key: "team",
					options: { type: "teams", all: tab !== "team" },
					value: team,
				},
				{
					key: "season",
					options: { type: "seasons", all: tab !== "season" },
					value: season,
				},
			],
		},
	});

	const teamUrl = team === "all" ? "all" : teamPart(team);
	const where =
		(team !== "all" ? ` for the ${full(team)}` : "") +
		(season !== "all" ? ` in ${season}` : team === "all" ? ", all-time" : "");

	let body: ReactNode = null;
	if (numTrades === 0) {
		body = <p>No two-team trades in the event log yet.</p>;
	} else if (tab === "best") {
		body =
			wins.length === 0 && losses.length === 0 ? (
				<p>No graded trades match these filters.</p>
			) : (
				<>
					<h2>Biggest wins{where}</h2>
					<p className="text-body-secondary">
						Most win shares gained over what was given up.
					</p>
					<SidesTable
						name="TradeGraderWins"
						sides={wins}
						defaultSort={[9, "desc"]}
					/>
					<h2 className="mt-3">Biggest losses{where}</h2>
					<p className="text-body-secondary">
						Most win shares given away over what came back.
					</p>
					<SidesTable
						name="TradeGraderLosses"
						sides={losses}
						defaultSort={[9, "asc"]}
					/>
				</>
			);
	} else if (tab === "cards") {
		body =
			cards.length === 0 ? (
				<p>No graded trades match these filters.</p>
			) : (
				<>
					<p className="text-body-secondary">
						Each team's graded trades: its average grade, how many it won, lost
						or broke even on, and the win shares it got against what it gave up.
						Click a team for its full report.
					</p>
					<CardsTable name="TradeGraderCards" cards={cards} />
				</>
			);
	} else if (tab === "team" && team !== "all") {
		const c = teamCard;
		if (!c) {
			body = <p>The {full(team)} made no logged trades.</p>;
		} else {
			const line = (label: string, r: SideRef | null) => {
				if (!r) {
					return null;
				}
				const s = teamSides.find((x) => x.eid === r.eid && x.i === r.i);
				return (
					<li className="mb-2">
						<b>{label}:</b>{" "}
						<a href={helpers.leagueUrl(["trade_summary", r.eid])}>
							{r.season}
							{r.phase > PHASE.PLAYOFFS ? " offseason" : ""}
						</a>{" "}
						with the {full(r.partner)} <TradeGradeBadge grade={r.g} />{" "}
						<span className={netClass(r.net)}>{sgn(r.net)} WS</span>
						{s ? (
							<div className="small text-body-secondary">
								Got <Items side={s} abbrev={(tid) => full(tid)} />
							</div>
						) : null}
					</li>
				);
			};
			const years = season === "all" ? c.bySeason : [];
			body = (
				<>
					<div className="d-flex flex-wrap gap-4 mb-3">
						<div>
							<div className="text-body-secondary small">Trade grade</div>
							<div className="fs-3">
								<TradeGradeBadge grade={c.grade} />
							</div>
							<div className="small text-body-secondary">
								{c.gpa !== null
									? `GPA ${c.gpa.toFixed(2)} over ${c.graded} graded`
									: "no graded trades"}
							</div>
						</div>
						<div>
							<div className="text-body-secondary small">Record</div>
							<div className="fs-3">
								{c.won}-{c.lost}-{c.even}
							</div>
							<div className="small text-body-secondary">won-lost-even</div>
						</div>
						<div>
							<div className="text-body-secondary small">Net win shares</div>
							<div className={`fs-3 ${netClass(c.net)}`}>{sgn(c.net)}</div>
							<div className="small text-body-secondary">
								{n1(c.got)} got, {n1(c.gave)} given up
							</div>
						</div>
						<div>
							<div className="text-body-secondary small">League rank</div>
							<div className="fs-3">
								{teamRank ? helpers.ordinal(teamRank.rank) : "–"}
							</div>
							<div className="small text-body-secondary">
								{teamRank ? `of ${teamRank.of} by net WS` : null}
							</div>
						</div>
					</div>
					{c.best || c.worst ? (
						<>
							<h2>Best and worst</h2>
							<ul className="list-unstyled">
								{line("Best", c.best)}
								{c.worst && c.worst.eid !== c.best?.eid
									? line("Worst", c.worst)
									: null}
							</ul>
						</>
					) : null}
					{years.length > 1 ? (
						<>
							<h2>Net win shares by season</h2>
							<p className="text-body-secondary">
								Per season the trades were made for; green when the deals came
								out ahead.
							</p>
							<NetBars
								years={years}
								label={`Net trade win shares by season for the ${full(team)}`}
							/>
						</>
					) : null}
					<h2 className="mt-3">
						Every trade{season !== "all" ? ` in ${season}` : ""}
					</h2>
					{teamSides.length === 0 ? (
						<p>No trades{season !== "all" ? ` in ${season}` : ""}.</p>
					) : (
						<SidesTable
							name="TradeGraderTeam"
							sides={teamSides}
							noTeam
							defaultSort={[1, "desc"]}
						/>
					)}
				</>
			);
		}
	} else if (tab === "season" && season !== "all") {
		body =
			seasonTrades.length === 0 ? (
				<p>
					No trades in {season}
					{team !== "all" ? " for this team" : ""}.
				</p>
			) : (
				<>
					<h2>Trades of {season}</h2>
					<p className="text-body-secondary">
						Most lopsided first. In-season trades count the win shares from{" "}
						{season} on; offseason ones from {season + 1}.
					</p>
					<SeasonTrades trades={seasonTrades} season={season} />
					{cards.length > 1 ? (
						<>
							<h2 className="mt-3">Who won {season}'s trades</h2>
							<CardsTable name="TradeGraderSeasonCards" cards={cards} noCount />
						</>
					) : null}
				</>
			);
	}

	return (
		<>
			<p>
				Every trade graded A+ to F for each side by the regular-season win
				shares what it received produced for it: players from the trade until
				they left, and a draft pick as the player it was used on, while he
				played there. An even trade is a B for both sides. A pick traded on
				before it was used counts in the later trade instead.{" "}
				{graded.toLocaleString()} of {numSides.toLocaleString()} sides graded
				{partial
					? "; * marks win shares missing for some seasons, ? where none are on record"
					: ""}
				. {open > 0 ? `${open} trades are still playing out.` : null} See also{" "}
				<a href={helpers.leagueUrl(["contract_value"])}>Contract Value</a>.
			</p>
			<ul className="nav nav-pills mb-3 flex-wrap">
				{TABS.map((t) => (
					<li key={t.id} className="nav-item">
						<a
							className={`nav-link${t.id === tab ? " active" : ""}`}
							href={helpers.leagueUrl([
								"trade_grader",
								t.id,
								t.id === "team" && team === "all"
									? teamPart(props.userTid)
									: teamUrl,
								t.id === "season" ? String(season) : "all",
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

export default TradeGrader;
