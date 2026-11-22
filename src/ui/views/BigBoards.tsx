import { DataTable } from "../components/DataTable/index.tsx";
import type { Col } from "../components/DataTable/index.tsx";
import useTitleBar from "../hooks/useTitleBar.tsx";
import type { View } from "../../common/types.ts";
import { helpers } from "../util/helpers.ts";

type Props = View<"bigBoards">;

const Move = ({ move }: { move: number | null }) => {
	if (move === null || move === 0) {
		return null;
	}
	return (
		<span
			className={`small ms-1 ${move > 0 ? "text-success" : "text-danger"}`}
			title={`${move > 0 ? "Up" : "Down"} ${Math.abs(move)} since the last edition`}
		>
			{move > 0 ? "▲" : "▼"}
			{Math.abs(move)}
		</span>
	);
};

const OutletCards = ({ outlets }: { outlets: Props["outlets"] }) => (
	<div className="row g-2 mb-3">
		{outlets.map((o) => (
			<div key={o.id} className="col-12 col-sm-6 col-lg-4 col-xl">
				<div className="card h-100">
					<div className="card-body p-2">
						<div className="fw-bold">{o.name}</div>
						<div className="small">
							<span className="badge text-bg-secondary">{o.lean}</span>{" "}
							<span className="text-body-secondary">({o.short})</span>
						</div>
						<div className="small text-body-secondary mt-1">
							{o.description}
						</div>
						{o.top ? (
							<div className="small mt-1">
								No. 1:{" "}
								<a href={helpers.leagueUrl(["player_pre_draft", o.top.pid])}>
									{o.top.text}
								</a>
							</div>
						) : null}
					</div>
				</div>
			</div>
		))}
	</div>
);

const TrackRecord = ({
	history,
	keys,
	averages,
	numTeams,
	outcomeSeasons,
}: Pick<
	Props,
	"history" | "keys" | "averages" | "numTeams" | "outcomeSeasons"
>) => {
	if (history.length === 0) {
		return (
			<p className="text-body-secondary">
				No track record yet: each outlet's final board is kept when a draft
				starts, scored against the first round right after the draft and against
				how the class turned out {outcomeSeasons} seasons later.
			</p>
		);
	}
	const draftKeys = keys.filter((k) => k.key !== "draft");
	const cell = (x: { mae: number; hits: number } | undefined) =>
		x ? (
			<>
				{x.mae}
				<span className="text-body-secondary small"> ({x.hits})</span>
			</>
		) : (
			<span className="text-body-secondary">-</span>
		);
	const bestIn = (
		row: Partial<Record<string, { mae: number }>> | undefined,
		list: typeof keys,
	) => {
		let best: string | undefined;
		for (const k of list) {
			const x = row?.[k.key];
			if (x && (!best || x.mae < row![best]!.mae)) {
				best = k.key;
			}
		}
		return best;
	};
	const table = (
		kind: "draft" | "outcome",
		list: typeof keys,
		caption: string,
	) => {
		const rows = history.filter((h) => h[kind]);
		return (
			<div className="table-responsive mb-3">
				<table className="table table-sm table-striped table-hover mb-0">
					<caption className="caption-top">{caption}</caption>
					<thead>
						<tr>
							<th>Class</th>
							{list.map((k) => (
								<th key={k.key} className="text-nowrap">
									{k.name}
								</th>
							))}
						</tr>
					</thead>
					<tbody>
						{rows.length === 0 ? (
							<tr>
								<td colSpan={list.length + 1} className="text-body-secondary">
									No class has been judged yet.
								</td>
							</tr>
						) : (
							rows.map((h) => {
								const best = bestIn(h[kind], list);
								return (
									<tr key={h.season}>
										<td>
											<a href={helpers.leagueUrl(["big_boards", h.season])}>
												{h.season}
											</a>
										</td>
										{list.map((k) => (
											<td
												key={k.key}
												className={k.key === best ? "table-success" : undefined}
											>
												{cell(h[kind]?.[k.key])}
											</td>
										))}
									</tr>
								);
							})
						)}
						{rows.length > 1 ? (
							<tr className="fw-bold">
								<td>Average</td>
								{list.map((k) => (
									<td key={k.key}>{cell(averages[kind][k.key])}</td>
								))}
							</tr>
						) : null}
					</tbody>
				</table>
			</div>
		);
	};
	return (
		<>
			{table(
				"draft",
				draftKeys,
				`Calling the draft: average spots off over the first-round picks (in parentheses: first-rounders in its top ${numTeams}). Lower is better.`,
			)}
			{table(
				"outcome",
				keys,
				`Calling the outcome, ${outcomeSeasons} seasons later: average spots off over its top ${numTeams} from where each player finished in his class (best ovr in his first ${outcomeSeasons} seasons; in parentheses: hits in its top 10). Lower is better.`,
			)}
		</>
	);
};

const BigBoards = (props: Props) => {
	const {
		edition,
		history,
		numTeams,
		outlets,
		prevEdition,
		rows,
		season,
		seasons,
		stored,
	} = props;
	useTitleBar({ title: `${season} Big Boards` });

	const showPick = rows.some((r) => r.pick);
	const cols: Col[] = [
		{
			title: "Cons",
			desc: "Consensus rank: average rank over the outlets",
			sortType: "number",
		},
		{ title: "Name", sortType: "name" },
		{ title: "Pos" },
		{ title: "Age", sortType: "number" },
		{ title: "School/Club" },
		...outlets.map((o): Col => ({
			title: o.short,
			desc: `${o.name} (${o.lean.toLowerCase()} lean)`,
			sortType: "number",
		})),
		{
			title: "Spread",
			desc: "Best to worst rank over the outlets: a big spread means the outlets disagree",
			sortType: "number",
			sortSequence: ["desc", "asc"],
		},
		{
			title: "You",
			desc: stored
				? "Your board when the draft started"
				: "Your board: your Draft Board's ranks, then your scouts' list",
			sortType: "number",
		},
		...(showPick
			? [
					{
						title: "Pick",
						desc: "Actual draft pick",
						sortType: "number",
					} as Col,
				]
			: []),
	];

	const tableRows = rows.map((r) => ({
		key: r.pid,
		data: [
			r.consensus.rank,
			{
				value: (
					<a href={helpers.leagueUrl(["player_pre_draft", r.pid])}>{r.name}</a>
				),
				sortValue: r.name,
				searchValue: r.name,
			},
			r.pos,
			r.age,
			r.school,
			...r.ranks.map((rank, i) => ({
				value:
					rank === null ? (
						""
					) : (
						<>
							{rank}
							<Move move={r.moves[i] ?? null} />
						</>
					),
				sortValue: rank,
				classNames:
					rank !== null && Math.abs(rank - r.consensus.rank) >= 10
						? rank < r.consensus.rank
							? "table-success"
							: "table-danger"
						: undefined,
			})),
			r.consensus.spread,
			{
				value: r.your ?? "",
				sortValue: r.your,
				classNames:
					r.your !== null && Math.abs(r.your - r.consensus.rank) >= 10
						? r.your < r.consensus.rank
							? "table-success"
							: "table-danger"
						: undefined,
			},
			...(showPick
				? [
						r.pick
							? {
									value: `${r.pick.overall} ${r.pick.abbrev}`,
									sortValue: r.pick.overall,
								}
							: { value: "", sortValue: 9999 },
					]
				: []),
		],
	}));

	return (
		<>
			<p>
				Draft outlets publish their own big boards, each with its own lean,
				updated during the season.{" "}
				{edition ? (
					<>
						Edition: <b>{edition}</b>
						{prevEdition
							? ` (arrows: moves since the ${prevEdition} edition)`
							: ""}
						.
					</>
				) : null}{" "}
				Green and red cells are 10+ spots higher or lower than the consensus.
				{stored
					? " These are the final boards, kept when the draft started."
					: null}
			</p>
			{seasons.length > 1 ? (
				<div className="mb-2 small">
					Class:{" "}
					{seasons.map((s, i) => (
						<span key={s}>
							{i > 0 ? " · " : null}
							{s === season ? (
								<b>{s}</b>
							) : (
								<a href={helpers.leagueUrl(["big_boards", s])}>{s}</a>
							)}
						</span>
					))}
				</div>
			) : null}
			<OutletCards outlets={outlets} />
			{rows.length === 0 ? (
				<p>No prospects in the {season} class.</p>
			) : (
				<DataTable
					cols={cols}
					defaultSort={[0, "asc"]}
					name="BigBoards"
					rows={tableRows}
					pagination={false}
				/>
			)}
			<h2 className="mt-3">Outlet track record</h2>
			<TrackRecord
				history={history}
				keys={props.keys}
				averages={props.averages}
				numTeams={numTeams}
				outcomeSeasons={props.outcomeSeasons}
			/>
		</>
	);
};

export default BigBoards;
