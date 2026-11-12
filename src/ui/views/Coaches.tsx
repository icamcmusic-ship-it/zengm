// League → Coaches: every head coach (or all staff, or the coaches looking for a job) in a sortable table with filters, the season's
// coaching carousel and the Coach of the Year history. The dense detail lives on the coach's page and in Coach's notes
import { useState } from "react";
import { MoreLinks } from "../components/MoreLinks.tsx";
import { DataTable } from "../components/DataTable/index.tsx";
import type { Col, DataTableRow } from "../components/DataTable/index.tsx";
import {
	CoachLink,
	HotSeatBadge,
	SystemsOffNote,
	Term,
	formatSalary,
} from "../components/CoachUi.tsx";
import useTitleBar from "../hooks/useTitleBar.tsx";
import { helpers } from "../util/helpers.ts";
import type { View } from "../../common/types.ts";
import { COACH_TERMS, roleNoun } from "../../common/staffText.ts";
import { CoachesTabs } from "./CoachNotes.tsx";

const MOVE_TEXT = {
	hired: "hired",
	fired: "fired",
	reSigned: "re-signed",
	left: "let go (contract expired)",
	retired: "retired",
};

const MOVE_COLOR = {
	hired: "success",
	fired: "danger",
	reSigned: "info",
	left: "secondary",
	retired: "secondary",
};

type Show = "head" | "staff" | "available";

const HOT_SEATS = ["Safe", "Some pressure", "Warm", "Red hot"];
// Sort order: the hottest seat first
const HOT_SEAT_ORDER: Record<string, number> = {
	"Red hot": 3,
	Warm: 2,
	"Some pressure": 1,
	Safe: 0,
};

const numberCol = (title: string, desc?: string): Col => ({
	title,
	desc,
	sortSequence: ["desc", "asc"],
	sortType: "number",
});

const Coaches = ({
	carousel,
	coachSystems,
	coy,
	currentSeason,
	defenseNames,
	offenseNames,
	rows: allRows,
	season,
	teams,
	userAbbrev,
	userTid,
}: View<"coaches">) => {
	useTitleBar({
		title: "Coaches",
		dropdown: {
			fields: [
				{
					key: "season",
					options: { type: "seasons" },
					value: season,
				},
			],
			view: "coaches",
		},
	});

	const isCurrent = season === currentSeason;
	const [showState, setShow] = useState<Show>("head");
	const show: Show = isCurrent ? showState : "head";
	const [team, setTeam] = useState("");
	const [offense, setOffense] = useState("");
	const [defense, setDefense] = useState("");
	const [hotSeat, setHotSeat] = useState("");

	const filtered = allRows.filter((c) => {
		if (show === "head" && c.status !== "head") {
			return false;
		}
		if (show === "staff" && c.status === "available") {
			return false;
		}
		if (show === "available" && c.status !== "available") {
			return false;
		}
		if (show !== "available" && team !== "" && c.seasonAbbrev !== team) {
			return false;
		}
		if (offense !== "" && c.offenseKey !== offense) {
			return false;
		}
		if (defense !== "" && c.defenseKey !== defense) {
			return false;
		}
		if (hotSeat !== "" && show === "head" && c.hotSeatText !== hotSeat) {
			return false;
		}
		return true;
	});

	const showJob = show !== "head";
	const showTeam = show !== "available";
	const showRecord = show === "head";
	const showHotSeat = coachSystems && show === "head" && isCurrent;
	const showFit = coachSystems && isCurrent && show !== "staff";
	const fitDesc =
		show === "available"
			? `Scheme fit with your roster (${userAbbrev}) if you hired him as head coach. ${COACH_TERMS.fit.text}`
			: `Scheme fit of his roster. ${COACH_TERMS.fit.text}`;

	const cols: Col[] = [
		...(showTeam ? [{ title: "Team" } as Col] : []),
		{ title: "Coach", sortType: "name" },
		...(showJob
			? [
					{
						title: show === "available" ? "Best Job" : "Job",
						desc:
							show === "available"
								? "The job his ratings suit best"
								: undefined,
					} as Col,
				]
			: []),
		{ title: "Age", sortType: "number" },
		...(showRecord
			? [
					{
						title: "Record",
						desc: `${season} regular season record`,
						sortType: "record",
						sortSequence: ["desc", "asc"],
					} as Col,
				]
			: []),
		...(coachSystems
			? [
					{ title: "Offense", desc: COACH_TERMS.systems.text } as Col,
					{ title: "Defense", desc: COACH_TERMS.systems.text } as Col,
				]
			: [
					{
						title: "Style",
						desc: "Pace, shot selection, defense, rotation",
					} as Col,
				]),
		...(showFit ? [numberCol("Fit", fitDesc)] : []),
		...(coachSystems
			? [numberCol("Rep", `Reputation. ${COACH_TERMS.reputation.text}`)]
			: []),
		...(showHotSeat
			? [
					{
						title: "Job Security",
						desc: COACH_TERMS.hotSeat.text,
						sortSequence: ["desc", "asc"],
						sortType: "number",
					} as Col,
				]
			: []),
		numberCol("Ovr", `Overall at his job. ${COACH_TERMS.ovr.text}`),
		{
			title: "Career",
			desc: "Career record as a head coach",
			sortType: "record",
			sortSequence: ["desc", "asc"],
		},
		numberCol("Titles", "Championships as a head coach"),
		numberCol("Awards", "Coach of the Year awards"),
		numberCol(
			show === "available" ? "Asking" : "Salary",
			show === "available"
				? "Salary per season he asks for at his best job"
				: "Salary per season",
		),
	];

	const rows: DataTableRow[] = filtered.map((c) => ({
		key: `${c.cid}-${c.seasonTid}`,
		data: [
			...(showTeam
				? [
						{
							value: (
								<a
									href={helpers.leagueUrl([
										"staff",
										`${c.seasonAbbrev}_${c.seasonTid}`,
									])}
								>
									{c.seasonAbbrev}
								</a>
							),
							sortValue: c.seasonAbbrev,
							searchValue: c.seasonAbbrev,
						},
					]
				: []),
			{
				value: <CoachLink cid={c.cid} name={c.name} />,
				sortValue: c.name,
				searchValue: c.name,
			},
			...(showJob
				? [
						show === "available"
							? helpers.upperCaseFirstLetter(roleNoun(c.bestRole))
							: c.roleName,
					]
				: []),
			c.age,
			...(showRecord
				? [c.seasonWon !== undefined ? `${c.seasonWon}-${c.seasonLost}` : ""]
				: []),
			...(coachSystems
				? [
						{
							value:
								c.status === "head" && isCurrent && c.offenseName ? (
									<a
										href={helpers.leagueUrl([
											"coach_notes",
											`${c.seasonAbbrev}_${c.seasonTid}`,
										])}
									>
										{c.offenseName}
									</a>
								) : (
									(c.offenseName ?? "")
								),
							sortValue: c.offenseName ?? "",
							searchValue: c.offenseName ?? "",
						},
						c.defenseName ?? "",
					]
				: [c.styleText]),
			...(showFit
				? [
						{
							value:
								c.fit !== undefined ? (
									<span title={c.fitText}>
										{c.fit}
										{c.install !== undefined && c.install < 100 ? (
											<span
												className="text-body-secondary small ms-1"
												title={`Systems ${c.install}% installed`}
											>
												({c.install}%)
											</span>
										) : null}
									</span>
								) : null,
							sortValue: c.fit ?? null,
							searchValue: c.fit ?? "",
						},
					]
				: []),
			...(coachSystems
				? [
						{
							value: c.systems ? (
								<span title={c.systems.reputationText}>
									{c.systems.reputation}
								</span>
							) : null,
							sortValue: c.systems?.reputation ?? null,
							searchValue: c.systems?.reputation ?? "",
						},
					]
				: []),
			...(showHotSeat
				? [
						{
							value: <HotSeatBadge text={c.hotSeatText} />,
							sortValue: c.hotSeatText
								? HOT_SEAT_ORDER[c.hotSeatText]! + (c.hotSeat ?? 0)
								: null,
							searchValue: c.hotSeatText,
						},
					]
				: []),
			c.ovr,
			c.headSeasons > 0 ? `${c.headWon}-${c.headLost}` : "",
			c.titles,
			c.numAwards,
			{
				value: formatSalary(
					c.status === "available" ? c.demand : c.contract.amount,
				),
				sortValue: c.status === "available" ? c.demand : c.contract.amount,
				searchValue: formatSalary(
					c.status === "available" ? c.demand : c.contract.amount,
				),
			},
		],
		classNames: {
			"table-info": c.seasonTid === userTid && c.status !== "available",
		},
	}));

	const select = (
		label: string,
		value: string,
		set: (value: string) => void,
		options: [string, string][],
		any: string,
	) => (
		<select
			className="form-select form-select-sm w-auto"
			value={value}
			onChange={(event) => set(event.target.value)}
			aria-label={label}
		>
			<option value="">{any}</option>
			{options.map(([key, name]) => (
				<option key={key} value={key}>
					{name}
				</option>
			))}
		</select>
	);

	const numFilters =
		Number(team !== "" && showTeam) +
		Number(offense !== "") +
		Number(defense !== "") +
		Number(hotSeat !== "" && showHotSeat);

	return (
		<>
			<MoreLinks type="league" page="coaches" />
			{coachSystems ? <CoachesTabs active="coaches" /> : <SystemsOffNote />}

			<div
				className="d-flex flex-wrap gap-2 mb-2 align-items-center"
				data-testid="coaches-filters"
			>
				{isCurrent ? (
					<div className="btn-group" role="group" aria-label="Show">
						{(
							[
								["head", "Head coaches"],
								["staff", "All staff"],
								["available", "Available"],
							] as const
						).map(([key, name]) => (
							<button
								key={key}
								className={`btn btn-sm ${show === key ? "btn-primary" : "btn-light-bordered"}`}
								onClick={() => setShow(key)}
							>
								{name}
							</button>
						))}
					</div>
				) : null}
				{showTeam
					? select(
							"Team",
							team,
							setTeam,
							teams.map((t) => [t.abbrev, t.abbrev]),
							"All teams",
						)
					: null}
				{coachSystems
					? select(
							"Offense system",
							offense,
							setOffense,
							Object.entries(offenseNames),
							"Any offense",
						)
					: null}
				{coachSystems
					? select(
							"Defense system",
							defense,
							setDefense,
							Object.entries(defenseNames),
							"Any defense",
						)
					: null}
				{showHotSeat
					? select(
							"Job security",
							hotSeat,
							setHotSeat,
							HOT_SEATS.map((x) => [x, x]),
							"Any job security",
						)
					: null}
				{numFilters > 0 ? (
					<button
						className="btn btn-sm btn-link p-0"
						onClick={() => {
							setTeam("");
							setOffense("");
							setDefense("");
							setHotSeat("");
						}}
					>
						Clear filters
					</button>
				) : null}
				<span className="text-body-secondary">
					{filtered.length} coach{filtered.length === 1 ? "" : "es"}
				</span>
			</div>
			<p className="text-body-secondary small mb-2">
				{show === "available"
					? "Coaches without a job. Hire them from your Coaching Staff page. Fit is with your roster."
					: isCurrent
						? "Click a column to sort; hover a column name for what it means."
						: `The head coaches of ${season}, with the team, record and systems of that season.`}{" "}
				{coachSystems ? (
					<>
						<Term term="systems" /> · <Term term="fit" /> ·{" "}
						<Term term="reputation" /> · <Term term="hotSeat" />
					</>
				) : null}
			</p>

			<DataTable
				cols={cols}
				defaultSort={[0, "asc"]}
				defaultStickyCols={window.mobile ? 0 : showTeam ? 2 : 1}
				name={`Coaches:${show}:${coachSystems ? "s" : "n"}:${isCurrent ? "c" : "p"}`}
				rows={rows}
			/>

			<div className="row mt-3">
				<div className="col-md-7 mb-3">
					<h2>Coaching carousel, {season}</h2>
					{carousel.length === 0 ? (
						<p>No coaching moves this season.</p>
					) : (
						<ul className="list-unstyled mb-0" data-testid="coaching-carousel">
							{carousel.map((m, i) => (
								<li key={i} className="mb-1">
									<span
										className={`badge text-bg-${MOVE_COLOR[m.type]} me-1`}
										style={{ minWidth: 62 }}
									>
										{m.type === "reSigned"
											? "Re-signed"
											: m.type === "left"
												? "Let go"
												: helpers.upperCaseFirstLetter(m.type)}
									</span>
									<a
										href={helpers.leagueUrl(["staff", `${m.abbrev}_${m.tid}`])}
									>
										{m.abbrev}
									</a>{" "}
									{MOVE_TEXT[m.type]} <CoachLink cid={m.cid} name={m.name} />{" "}
									<span className="text-body-secondary">({m.roleName})</span>
								</li>
							))}
						</ul>
					)}
				</div>
				<div className="col-md-5 mb-3">
					<h2>Coach of the Year</h2>
					{coy.length === 0 ? (
						<p>Awarded after the playoffs.</p>
					) : (
						<ul className="list-unstyled mb-0">
							{coy.map((a) => (
								<li key={a.season} className="mb-1">
									<a href={helpers.leagueUrl(["coaches", a.season])}>
										{a.season}
									</a>
									: <CoachLink cid={a.cid} name={a.name} />{" "}
									<span className="text-body-secondary">({a.abbrev})</span>
								</li>
							))}
						</ul>
					)}
				</div>
			</div>
		</>
	);
};

export default Coaches;
