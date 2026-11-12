import { useState } from "react";
import clsx from "clsx";
import { PHASE_TEXT } from "../../common/constants.ts";
import type { AccuracyRow } from "../../common/rumors/logic.ts";
import {
	RUMOR_LEVELS,
	RUMOR_STATUS_NAMES,
	RUMOR_TYPES,
	RUMOR_TYPE_NAMES,
	rumorLevel,
	type Rumor,
	type RumorStatus,
} from "../../common/rumors/types.ts";
import type { View } from "../../common/types.ts";
import { MoreLinks } from "../components/MoreLinks.tsx";
import { RumorText } from "../components/RumorText.tsx";
import useTitleBar from "../hooks/useTitleBar.tsx";
import { helpers } from "../util/helpers.ts";

const STATUS_CLASS: Record<RumorStatus, string> = {
	open: "text-bg-secondary",
	confirmed: "text-bg-success",
	busted: "text-bg-danger",
};

const when = (moment: { season: number; phase: number }) =>
	`${moment.season} ${(PHASE_TEXT as Record<number, string>)[moment.phase] ?? ""}`.trim();

const pct = (x: number | undefined) =>
	x === undefined ? "-" : `${Math.round(x * 100)}%`;

export const RumorItem = ({
	rumor,
	compact,
}: {
	rumor: Rumor;
	compact?: boolean;
}) => {
	const level = rumorLevel(rumor.confidence);
	return (
		<div
			className={clsx(
				"list-group-item px-2",
				rumor.user && "list-group-item-info",
			)}
			data-testid="rumor"
			data-status={rumor.status}
			data-type={rumor.type}
		>
			<div>
				<span className={clsx("badge me-1", STATUS_CLASS[rumor.status])}>
					{RUMOR_STATUS_NAMES[rumor.status]}
				</span>
				<RumorText text={rumor.text} />
				{rumor.outcome ? (
					<span
						className={
							rumor.status === "confirmed" ? "text-success" : "text-danger"
						}
					>
						{" "}
						<RumorText text={rumor.outcome} />
					</span>
				) : null}
			</div>
			{compact ? null : (
				<div className="small text-body-secondary">
					{RUMOR_TYPE_NAMES[rumor.type]} · {when(rumor)} ·{" "}
					<span title="How likely it was to come true when it was reported">
						{level.name} ({pct(rumor.confidence)})
					</span>
					{rumor.resolved ? <> · resolved {when(rumor.resolved)}</> : null}
				</div>
			)}
		</div>
	);
};

const AccuracyTable = ({
	title,
	rows,
	showExpected,
}: {
	title: string;
	rows: AccuracyRow[];
	showExpected?: boolean;
}) => (
	<div className="col-md-4 col-sm-6 mb-3">
		<div className="table-responsive">
			<table
				className="table table-sm table-striped table-borderless mb-0"
				data-csv-table={`Rumor accuracy ${title.toLowerCase()}`}
			>
				<thead>
					<tr>
						<th>{title}</th>
						<th className="text-end" title="Came true / resolved">
							True
						</th>
						<th className="text-end" title="Share that came true">
							%
						</th>
						{showExpected ? (
							<th
								className="text-end"
								title="Average confidence when the rumors were reported"
							>
								Claimed
							</th>
						) : null}
					</tr>
				</thead>
				<tbody>
					{rows.map((row) => (
						<tr key={row.key}>
							<td>{row.name}</td>
							<td className="text-end">
								{row.confirmed}/{row.confirmed + row.busted}
							</td>
							<td className="text-end">{pct(row.rate)}</td>
							{showExpected ? (
								<td className="text-end">{pct(row.expected)}</td>
							) : null}
						</tr>
					))}
				</tbody>
			</table>
		</div>
	</div>
);

const PAGE_SIZE = 60;

const Rumors = ({ accuracy, rumors, teams, userTid }: View<"rumors">) => {
	useTitleBar({ title: "Rumors" });

	const [team, setTeam] = useState<"all" | "user" | number>("all");
	const [type, setType] = useState("all");
	const [status, setStatus] = useState("all");
	const [numShown, setNumShown] = useState(PAGE_SIZE);

	const filtered = rumors.filter((r) => {
		if (type !== "all" && r.type !== type) {
			return false;
		}
		if (status !== "all" && r.status !== status) {
			return false;
		}
		if (team === "user") {
			return r.user || r.tids.includes(userTid) || r.fromTid === userTid;
		}
		if (team !== "all") {
			return r.tids.includes(team) || r.fromTid === team;
		}
		return true;
	});

	const resolved = accuracy.bySeason.reduce(
		(sum, row) => sum + row.confirmed + row.busted,
		0,
	);
	const confirmed = accuracy.bySeason.reduce(
		(sum, row) => sum + row.confirmed,
		0,
	);

	return (
		<>
			<MoreLinks type="trade" page="rumors" />
			<p className="text-body-secondary" style={{ maxWidth: 800 }}>
				What people around the league are saying, from what AI teams are
				actually planning. Some rumors come true and some don't: each one has a
				confidence (
				{RUMOR_LEVELS.map((level) => level.name.toLowerCase()).join(", ")}) and
				is marked when it resolves.
			</p>

			<div className="d-flex flex-wrap gap-2 mb-3">
				<select
					className="form-select form-select-sm w-auto"
					aria-label="Team"
					value={String(team)}
					onChange={(event) => {
						const value = event.target.value;
						setTeam(
							value === "all" || value === "user"
								? value
								: Number.parseInt(value),
						);
						setNumShown(PAGE_SIZE);
					}}
				>
					<option value="all">All teams</option>
					<option value="user">My team</option>
					{teams
						.filter((t) => !t.disabled)
						.toSorted((a, b) =>
							`${a.region} ${a.name}`.localeCompare(`${b.region} ${b.name}`),
						)
						.map((t) => (
							<option key={t.tid} value={t.tid}>
								{t.region} {t.name}
							</option>
						))}
				</select>
				<select
					className="form-select form-select-sm w-auto"
					aria-label="Type"
					value={type}
					onChange={(event) => {
						setType(event.target.value);
						setNumShown(PAGE_SIZE);
					}}
				>
					<option value="all">All types</option>
					{RUMOR_TYPES.map((key) => (
						<option key={key} value={key}>
							{RUMOR_TYPE_NAMES[key]}
						</option>
					))}
				</select>
				<select
					className="form-select form-select-sm w-auto"
					aria-label="Status"
					value={status}
					onChange={(event) => {
						setStatus(event.target.value);
						setNumShown(PAGE_SIZE);
					}}
				>
					<option value="all">Any status</option>
					{helpers.keys(RUMOR_STATUS_NAMES).map((key) => (
						<option key={key} value={key}>
							{RUMOR_STATUS_NAMES[key]}
						</option>
					))}
				</select>
			</div>

			<div className="row">
				<div className="col-xl-7 col-lg-8 mb-3">
					{filtered.length === 0 ? (
						<p data-testid="no-rumors">
							{rumors.length === 0
								? "No rumors yet. They start once the season is under way."
								: "No rumors match these filters."}
						</p>
					) : (
						<div className="list-group list-group-flush">
							{filtered.slice(0, numShown).map((rumor) => (
								<RumorItem key={rumor.rid} rumor={rumor} />
							))}
						</div>
					)}
					{filtered.length > numShown ? (
						<button
							type="button"
							className="btn btn-light-bordered mt-2"
							onClick={() => {
								setNumShown(numShown + PAGE_SIZE);
							}}
						>
							Show more ({filtered.length - numShown})
						</button>
					) : null}
				</div>
			</div>

			<h2>Track record</h2>
			{resolved === 0 ? (
				<p className="text-body-secondary">No rumor has been resolved yet.</p>
			) : (
				<>
					<p data-testid="rumor-accuracy">
						{confirmed} of {resolved} resolved rumors came true (
						{pct(confirmed / resolved)}). "Claimed" is the average confidence
						when they were reported, so a well calibrated rumor mill has the two
						columns close to each other.
					</p>
					<div className="row">
						<AccuracyTable
							title="Confidence"
							rows={accuracy.byLevel}
							showExpected
						/>
						<AccuracyTable title="Type" rows={accuracy.byType} showExpected />
						<AccuracyTable title="Season" rows={accuracy.bySeason} />
					</div>
				</>
			)}
		</>
	);
};

export default Rumors;
