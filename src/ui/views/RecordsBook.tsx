import clsx from "clsx";
import { MoreLinks } from "../components/MoreLinks.tsx";
import useTitleBar from "../hooks/useTitleBar.tsx";
import { helpers } from "../util/helpers.ts";
import { useLocal } from "../util/local.ts";
import type { View } from "../../common/types.ts";
import type { RBEntry, RBList } from "../../common/recordsBook.ts";

type TeamInfo = { abbrev: string; region: string; name: string };

const fmtValue = (list: Pick<RBList, "d" | "pct">, v: number) =>
	list.pct
		? helpers.roundWinp(v)
		: list.d > 0
			? v.toFixed(list.d)
			: helpers.numberWithCommas(v);

export const ActiveMark = () => (
	<span
		className="badge rounded-pill text-bg-success ms-1"
		title="Active player"
		style={{ fontSize: "0.65em" }}
	>
		active
	</span>
);

const Who = ({ e, teams }: { e: RBEntry; teams: TeamInfo[] }) => {
	const t = teams[e.tid];
	const teamUrl = t
		? helpers.leagueUrl(["roster", `${t.abbrev}_${e.tid}`, e.season])
		: undefined;
	if (e.pid === undefined) {
		return (
			<>
				<a href={teamUrl}>{t ? `${t.region} ${t.name}` : `Team ${e.tid}`}</a>
				{e.ongoing ? (
					<span className="badge text-bg-warning ms-1">ongoing</span>
				) : null}
			</>
		);
	}
	return (
		<>
			<a href={helpers.leagueUrl(["player", e.pid])}>{e.name}</a>
			{e.active ? <ActiveMark /> : null}
			{t ? (
				<span className="text-body-secondary ms-1 small">
					<a className="text-body-secondary" href={teamUrl}>
						{t.abbrev}
					</a>
					{e.oppTid !== undefined && teams[e.oppTid]
						? ` vs ${teams[e.oppTid]!.abbrev}`
						: null}
				</span>
			) : null}
		</>
	);
};

const When = ({ e, teams }: { e: RBEntry; teams: TeamInfo[] }) => {
	if (e.season === undefined) {
		return null;
	}
	const t = teams[e.tid];
	if (e.gid !== undefined && e.pid !== undefined && t) {
		return (
			<a
				href={helpers.leagueUrl([
					"game_log",
					`${t.abbrev}_${e.tid}`,
					e.season,
					e.gid,
				])}
			>
				{e.season}
			</a>
		);
	}
	return <>{e.season}</>;
};

const ListCard = ({ list, teams }: { list: RBList; teams: TeamInfo[] }) => {
	return (
		<div className="col-md-6 col-xl-4 mb-3">
			<div
				className={clsx("card h-100", {
					"border-warning": list.broken,
				})}
			>
				<div className="card-header d-flex align-items-center py-1 px-2">
					<span className="fw-bold">{list.label}</span>
					{list.broken ? (
						<span
							className="badge text-bg-warning ms-auto"
							title={
								list.broken.prev
									? `Previous record: ${fmtValue(list, list.broken.prev.v)}${list.broken.prev.name ? ` by ${list.broken.prev.name}` : ""}${list.broken.prev.season !== undefined ? ` (${list.broken.prev.season})` : ""}`
									: "First record"
							}
						>
							Broken this season
						</span>
					) : null}
				</div>
				{list.rows.length === 0 ? (
					<div className="card-body py-2 px-2 text-body-secondary small">
						Nothing on record yet.
					</div>
				) : (
					<table className="table table-sm table-borderless mb-0 small">
						<tbody>
							{list.rows.map((e, i) => (
								<tr key={i} className={clsx({ "table-warning": e.thisSeason })}>
									<td
										className="text-body-secondary text-end"
										style={{ width: 24 }}
									>
										{i + 1}
									</td>
									<td>
										<Who e={e} teams={teams} />
									</td>
									<td className="text-body-secondary">
										<When e={e} teams={teams} />
									</td>
									<td className="text-end fw-bold">{fmtValue(list, e.v)}</td>
								</tr>
							))}
						</tbody>
					</table>
				)}
				{list.broken?.prev ? (
					<div className="card-footer py-1 px-2 small text-body-secondary">
						Broke {fmtValue(list, list.broken.prev.v)} by{" "}
						{list.broken.prev.pid !== undefined
							? list.broken.prev.name
							: teams[list.broken.prev.tid]?.abbrev}
						{list.broken.prev.season !== undefined
							? ` (${list.broken.prev.season})`
							: null}
					</div>
				) : null}
				{list.history && list.history.length > 1 ? (
					<details className="card-footer py-1 px-2 small">
						<summary className="text-body-secondary">
							Record progression ({list.history.length})
						</summary>
						<ul className="list-unstyled mb-0">
							{list.history
								.slice()
								.reverse()
								.map((e, i) => (
									<li key={i}>
										{e.season}: <Who e={e} teams={teams} />{" "}
										<span className="fw-bold">{fmtValue(list, e.v)}</span>
									</li>
								))}
						</ul>
					</details>
				) : null}
			</div>
		</div>
	);
};

const RecordsBook = ({ sections, tid }: View<"recordsBook">) => {
	useTitleBar({
		title: "Records Book",
		dropdown: {
			fields: [
				{
					key: "team",
					options: { type: "teams", all: true },
					value: tid,
				},
			],
			view: "recordsBook",
		},
	});
	const { teamInfoCache } = useLocal(["teamInfoCache"]);
	const teams = teamInfoCache as TeamInfo[];

	const broken = sections.flatMap((s) =>
		s.lists.filter((l) => l.broken).map((l) => ({ s, l })),
	);

	return (
		<>
			<MoreLinks type="league" page="records_book" />
			<p>
				{tid === "all" ? "League" : "Franchise"} records for the regular season,
				playoffs and single games, with{" "}
				<span className="badge rounded-pill text-bg-success">active</span>{" "}
				players and{" "}
				<span className="px-1 bg-warning-subtle">this season's</span> marks
				highlighted. Franchise totals (wins, titles, playoff appearances) are on{" "}
				<a href={helpers.leagueUrl(["team_records"])}>Team Records</a>, award
				counts on{" "}
				<a href={helpers.leagueUrl(["awards_records"])}>Awards Records</a> and
				triple-doubles and other feats on{" "}
				<a href={helpers.leagueUrl(["player_feats"])}>Statistical Feats</a>.
			</p>
			<p>
				Jump to:{" "}
				{sections.map((s, i) => (
					<span key={s.id}>
						{i > 0 ? " · " : null}
						<a href={`#rb-${s.id}`}>{s.title}</a>
					</span>
				))}
			</p>
			{broken.length > 0 ? (
				<div className="alert alert-warning">
					<b>Broken this season:</b>{" "}
					{broken.map(({ s, l }, i) => (
						<span key={l.id}>
							{i > 0 ? "; " : null}
							{s.title.toLowerCase()} {l.label.toLowerCase()} (
							{l.rows[0]!.name ?? teams[l.rows[0]!.tid]?.abbrev},{" "}
							{fmtValue(l, l.rows[0]!.v)})
						</span>
					))}
				</div>
			) : null}
			{sections.map((s) => (
				<section key={s.id} id={`rb-${s.id}`} className="mb-2">
					<h2>{s.title}</h2>
					{s.note ? (
						<p className="text-body-secondary small">{s.note}</p>
					) : null}
					<div className="row">
						{s.lists.map((l) => (
							<ListCard key={l.id} list={l} teams={teams} />
						))}
					</div>
				</section>
			))}
		</>
	);
};

export default RecordsBook;
