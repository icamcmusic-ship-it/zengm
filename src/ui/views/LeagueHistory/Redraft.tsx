import useTitleBar from "../../hooks/useTitleBar.tsx";
import { helpers } from "../../util/helpers.ts";
import { realtimeUpdate } from "../../util/realtimeUpdate.ts";
import {
	DataTable,
	type DataTableRow,
} from "../../components/DataTable/index.tsx";
import { getCols } from "../../../common/getCols.ts";
import type { View } from "../../../common/types.ts";
import { frivolitiesMenu } from "../Frivolities.tsx";
import { HistoryLoading, PlayerLink } from "./common.tsx";

type Loaded = Extract<View<"redraft">, { loading: false }>;
type Entry = NonNullable<Loaded["cls"]>["entries"][number];

const pickText = (x: { pick: number | null }) =>
	x.pick !== null ? `#${x.pick}` : "undrafted";

const moveText = (delta: number) =>
	delta > 0 ? `▲${delta}` : delta < 0 ? `▼${-delta}` : "=";

const EntryList = ({ xs, kind }: { xs: Entry[]; kind: "steal" | "bust" }) => {
	if (xs.length === 0) {
		return (
			<p className="text-body-secondary">
				{kind === "steal"
					? "No late pick has climbed into the redraft's first round yet."
					: "No top 10 pick has fallen out of the redraft's first half yet."}
			</p>
		);
	}
	return (
		<ol className="ps-4">
			{xs.map((x) => (
				<li key={`${x.year}-${x.pid}`} className="mb-1">
					<span
						className={`fw-bold me-1 ${kind === "steal" ? "text-success" : "text-danger"}`}
					>
						{kind === "steal" ? `+${x.delta}` : `−${x.slot - x.pick!}`}
					</span>
					<PlayerLink pid={x.pid} name={x.name} />{" "}
					<span className="text-body-secondary small">
						<a href={helpers.leagueUrl(["frivolities", "redraft", x.year])}>
							{x.year}
						</a>
						: went {pickText(x)}, redraft #{x.slot}, {x.ws.toFixed(1)} WS
					</span>
				</li>
			))}
		</ol>
	);
};

const ClassTable = ({ cls }: { cls: NonNullable<Loaded["cls"]> }) => {
	const cols = getCols([
		{
			title: "Redraft",
			desc: "Slot in the redraft by career win shares",
			sortType: "number",
		},
		"Name",
		{ title: "Went", desc: "Original overall pick", sortType: "number" },
		{ title: "Team", desc: "Team that drafted him", sortType: "string" },
		{
			title: "Move",
			desc: "Original pick minus redraft slot: ▲ means he deserved to go earlier",
			sortType: "number",
		},
		{
			title: "WS",
			desc: "Career regular season win shares",
			sortType: "number",
		},
		{ title: "AS", desc: "All-Star selections", sortType: "number" },
	]);
	const rows: DataTableRow[] = cls.entries.map((x) => ({
		key: x.pid,
		data: [
			{ value: <b>#{x.slot}</b>, sortValue: x.slot, searchValue: x.slot },
			{
				value: (
					<>
						<PlayerLink pid={x.pid} name={x.name} />
						{x.hof ? <span className="badge bg-danger ms-1">HOF</span> : null}
					</>
				),
				sortValue: x.name,
				searchValue: x.name,
			},
			{ value: pickText(x), sortValue: x.pick ?? 999 },
			x.abbrev !== undefined ? (
				<a href={helpers.leagueUrl(["draft_history", cls.year])}>{x.abbrev}</a>
			) : (
				""
			),
			{
				value: (
					<span
						className={
							x.delta >= 5 ? "text-success" : x.delta <= -5 ? "text-danger" : ""
						}
					>
						{moveText(x.delta)}
					</span>
				),
				sortValue: x.delta,
			},
			{
				value: x.played ? x.ws.toFixed(1) : "never played",
				sortValue: x.played ? x.ws : null,
			},
			x.allStar,
		],
	}));
	return (
		<DataTable
			cols={cols}
			defaultSort={[0, "asc"]}
			name="Redraft"
			pagination={rows.length > 30}
			rows={rows}
			small
		/>
	);
};

const RedraftLoaded = (props: Loaded) => {
	const {
		cls,
		mature,
		ones,
		partialYears,
		requested,
		steals,
		busts,
		year,
		years,
	} = props;
	useTitleBar({
		title: year !== undefined ? `${year} Redraft` : "Redraft",
		customMenu: frivolitiesMenu,
	});

	if (years.length === 0 || !cls) {
		return (
			<p>
				Nobody has been drafted yet, so there is nothing to redraft. Upcoming
				prospects are on the{" "}
				<a href={helpers.leagueUrl(["draft_scouting"])}>Draft Scouting</a> page.
			</p>
		);
	}

	const right = ones.filter(
		(o) => o.actual && o.redraft && o.actual.pid === o.redraft.pid,
	).length;

	const onesCols = getCols([
		{ title: "Class", sortType: "number" },
		{ title: "Went #1", sortType: "name" },
		{ title: "Redraft #1", sortType: "name" },
		{
			title: "Right?",
			desc: "Was the No. 1 pick the class's best player?",
			sortType: "string",
		},
	]);
	const onesRows: DataTableRow[] = ones.map((o) => ({
		key: o.year,
		data: [
			{
				value: (
					<a href={helpers.leagueUrl(["frivolities", "redraft", o.year])}>
						{o.year}
					</a>
				),
				sortValue: o.year,
			},
			o.actual ? (
				<>
					<PlayerLink pid={o.actual.pid} name={o.actual.name} />{" "}
					<span className="text-body-secondary small">
						{o.actual.ws.toFixed(1)} WS, redraft #{o.actual.slot}
					</span>
				</>
			) : (
				<span className="text-body-secondary">not in league</span>
			),
			o.redraft ? (
				<>
					<PlayerLink pid={o.redraft.pid} name={o.redraft.name} />{" "}
					<span className="text-body-secondary small">
						{o.redraft.ws.toFixed(1)} WS, went {pickText(o.redraft)}
					</span>
				</>
			) : (
				"–"
			),
			o.actual && o.redraft && o.actual.pid === o.redraft.pid ? "Yes" : "No",
		],
	}));

	return (
		<>
			<p>
				Every draft class re-ordered by what the players became: career regular
				season win shares, the pick each one went at and the slot he would go at
				today. More:{" "}
				<a href={helpers.leagueUrl(["draft_history", cls.year])}>
					{cls.year} Draft History
				</a>
			</p>

			<div className="d-flex align-items-center gap-2 mb-3">
				<label htmlFor="redraft-class" className="mb-0">
					Draft class
				</label>
				<select
					id="redraft-class"
					className="form-select form-select-sm"
					style={{ width: "auto" }}
					value={cls.year}
					onChange={(event) => {
						realtimeUpdate(
							[],
							helpers.leagueUrl(["frivolities", "redraft", event.target.value]),
						);
					}}
				>
					{[...years].reverse().map((y) => (
						<option key={y} value={y}>
							{y}
							{partialYears.includes(y) ? " (partial)" : ""}
						</option>
					))}
				</select>
			</div>

			{requested !== undefined && requested !== cls.year ? (
				<p className="alert alert-info">
					No player drafted in {requested} is in this league; showing the{" "}
					{cls.year} class.
				</p>
			) : null}
			{cls.partial ? (
				<p className="alert alert-warning">
					This class was drafted before the league began, so only players still
					active then exist. The redraft ranks the survivors only.
				</p>
			) : cls.developing ? (
				<p className="alert alert-info">
					Only {cls.seasonsSince} season{cls.seasonsSince === 1 ? "" : "s"}{" "}
					played since this draft: the redraft is careers so far and will move.
				</p>
			) : null}

			<div className="mb-2">
				<b>Steals:</b>{" "}
				{cls.steals.length > 0 ? (
					cls.steals.map((x, i) => (
						<span key={x.pid}>
							{i > 0 ? ", " : ""}
							<PlayerLink pid={x.pid} name={x.name} />{" "}
							<span className="text-success small">
								{pickText(x)} → #{x.slot}
							</span>
						</span>
					))
				) : (
					<span className="text-body-secondary">none yet</span>
				)}
			</div>
			<div className="mb-3">
				<b>Busts:</b>{" "}
				{cls.busts.length > 0 ? (
					cls.busts.map((x, i) => (
						<span key={x.pid}>
							{i > 0 ? ", " : ""}
							<PlayerLink pid={x.pid} name={x.name} />{" "}
							<span className="text-danger small">
								{pickText(x)} → #{x.slot}
							</span>
						</span>
					))
				) : (
					<span className="text-body-secondary">none yet</span>
				)}
			</div>

			<ClassTable key={cls.year} cls={cls} />

			<h2 className="mt-4">All-time</h2>
			{ones.length === 0 ? (
				<p>
					No class drafted in this league has {mature} seasons in the books yet,
					so there are no all-time steals or busts to rank.
				</p>
			) : (
				<>
					<p className="text-body-secondary">
						Classes with {mature}+ seasons played since the draft. Classes
						drafted before the league began are partial and left out.
					</p>
					<div className="row">
						<div className="col-md-6">
							<h3>Biggest steals</h3>
							<p className="small text-body-secondary">
								Redraft first-rounders who went latest: places climbed from the
								original pick (undrafted players count from the end of the
								draft).
							</p>
							<EntryList xs={steals} kind="steal" />
						</div>
						<div className="col-md-6">
							<h3>Biggest busts</h3>
							<p className="small text-body-secondary">
								Top 10 picks who fall furthest in the redraft, out of the top
								half of its first round.
							</p>
							<EntryList xs={busts} kind="bust" />
						</div>
					</div>

					<h3 className="mt-3">Who should have gone first</h3>
					<p className="small text-body-secondary">
						The No. 1 pick was the class's best player {right} time
						{right === 1 ? "" : "s"} in {ones.length} class
						{ones.length === 1 ? "" : "es"} (
						{Math.round((100 * right) / ones.length)}%).
					</p>
					<DataTable
						cols={onesCols}
						defaultSort={[0, "desc"]}
						name="RedraftOnes"
						pagination={onesRows.length > 20}
						rows={onesRows}
						small
					/>
				</>
			)}
		</>
	);
};

const RedraftLoading = ({ progress }: { progress: string }) => {
	useTitleBar({ title: "Redraft", customMenu: frivolitiesMenu });
	return <HistoryLoading progress={progress} />;
};

const Redraft = (props: View<"redraft">) => {
	if (props.loading) {
		return <RedraftLoading progress={props.progress} />;
	}
	return <RedraftLoaded {...props} />;
};

export default Redraft;
