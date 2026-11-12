// College mode: the recruiting board shared by the Recruiting and Transfer Portal pages (docs/college-mode.md)
import { useState, type ReactNode } from "react";
import { helpers } from "../../util/helpers.ts";
import { toWorker } from "../../util/toWorker.ts";
import {
	ACTIONS,
	COMMIT_THRESHOLD,
	PITCHES,
	PITCH_NAMES,
	type Pitch,
	type RecruitAction,
} from "../../../common/college/interest.ts";
import type { CollegeRecruitingState } from "../../../common/college/types.ts";

export type BoardRow = {
	pid: number;
	name: string;
	pos: string;
	hgt: number;
	ovr: number;
	pot: number;
	scout: number;
	wants: { key: Pitch; weight: number | undefined }[];
	grades: Record<Pitch, number>;
	interest: number;
	offered: boolean;
	visited: boolean;
	actedThisWeek: boolean;
	nil: number;
	top: {
		tid: number;
		abbrev: string;
		region: string;
		interest: number;
		offered: boolean;
	}[];
	commit?: number;
	commitAbbrev?: string;
};

const gradeLetter = (grade: number) =>
	grade >= 0.8
		? "A"
		: grade >= 0.6
			? "B"
			: grade >= 0.4
				? "C"
				: grade >= 0.2
					? "D"
					: "F";

const Bar = ({
	label,
	value,
	max,
	user,
	offered,
}: {
	label: string;
	value: number;
	max: number;
	user?: boolean;
	offered?: boolean;
}) => (
	<div className="d-flex align-items-center gap-1" style={{ lineHeight: 1.1 }}>
		<span
			className={user ? "fw-bold" : undefined}
			style={{ width: 42, flexShrink: 0, fontSize: "0.75rem" }}
			title={offered ? "Offered a scholarship" : undefined}
		>
			{label}
			{offered ? "*" : ""}
		</span>
		<div
			className="bg-body-secondary position-relative"
			style={{ width: 70, height: 8, flexShrink: 0 }}
		>
			<div
				className={user ? "bg-primary" : "bg-secondary"}
				style={{
					width: `${Math.min(100, (100 * value) / max)}%`,
					height: "100%",
				}}
			/>
			<div
				className="position-absolute top-0 border-start border-danger"
				style={{ left: `${(100 * COMMIT_THRESHOLD) / max}%`, height: "100%" }}
				title="Commitment threshold"
			/>
		</div>
		<span style={{ fontSize: "0.75rem" }}>{value}</span>
	</div>
);

export const InterestBars = ({
	row,
	userAbbrev,
}: {
	row: BoardRow;
	userAbbrev: string;
}) => {
	const max = Math.max(
		COMMIT_THRESHOLD * 1.5,
		row.interest,
		...row.top.map((t) => t.interest),
	);
	return (
		<div>
			<Bar
				label={userAbbrev}
				value={row.interest}
				max={max}
				user
				offered={row.offered}
			/>
			{row.top.map((t) => (
				<Bar
					key={t.tid}
					label={t.abbrev}
					value={t.interest}
					max={max}
					offered={t.offered}
				/>
			))}
		</div>
	);
};

const Wants = ({ row }: { row: BoardRow }) => {
	if (row.wants.length === 0) {
		return <span className="text-body-secondary">Scout him</span>;
	}
	return (
		<div style={{ fontSize: "0.8rem" }}>
			{row.wants.slice(0, 3).map((w) => (
				<div key={w.key} className="text-nowrap">
					{PITCH_NAMES[w.key]}
					{w.weight !== undefined ? ` ${Math.round(w.weight * 100)}%` : ""}{" "}
					<span
						className="text-body-secondary"
						title="Your school's grade on this"
					>
						({gradeLetter(row.grades[w.key])})
					</span>
				</div>
			))}
		</div>
	);
};

export const RecruitingHeader = ({
	autoRecruit,
	offerLimit,
	offers,
	openSpots,
	state,
	children,
}: {
	autoRecruit: boolean;
	offerLimit: number;
	offers: number;
	openSpots: number;
	state: CollegeRecruitingState | undefined;
	children?: ReactNode;
}) => (
	<div className="d-flex flex-wrap gap-3 align-items-center mb-2">
		{state ? (
			<>
				<span data-testid="recruiting-points">
					Points this week: <b>{state.points}</b> / {state.budget}
				</span>
				<span>
					NIL left: <b>${state.nil}k</b> / ${state.nilBudget}k
				</span>
				<span>
					Official visits left: <b>{state.officialVisits}</b>
				</span>
			</>
		) : null}
		<span>
			Open scholarships: <b>{openSpots}</b>
		</span>
		<span>
			Offers: <b>{offers}</b> / {offerLimit}
		</span>
		<div className="form-check form-switch mb-0">
			<input
				className="form-check-input"
				type="checkbox"
				id="auto-recruit"
				checked={autoRecruit}
				onChange={async () => {
					await toWorker("main", "collegeSetAutoRecruit", !autoRecruit);
				}}
			/>
			<label className="form-check-label" htmlFor="auto-recruit">
				Auto recruit
			</label>
		</div>
		{children}
	</div>
);

export const RecruitBoard = <T extends BoardRow>({
	rows,
	canEdit,
	autoRecruit,
	userAbbrev,
	extraColumns,
	retain,
	emptyText,
}: {
	rows: T[];
	canEdit: boolean;
	autoRecruit: boolean;
	userAbbrev: string;
	// Columns after the player's name: header and cell
	extraColumns: { title: string; render: (row: T) => ReactNode }[];
	// Show the retention pitch for these rows
	retain?: (row: T) => boolean;
	emptyText: string;
}) => {
	const [pitch, setPitch] = useState<Pitch | "best">("best");
	const [message, setMessage] = useState<string | undefined>();
	const [status, setStatus] = useState<
		"all" | "board" | "offered" | "committed"
	>("all");
	const [pos, setPos] = useState("all");
	const [limit, setLimit] = useState(50);

	const disabled = !canEdit || autoRecruit;

	const act = async (row: T, action: RecruitAction | "nil" | "withdraw") => {
		let usedPitch: Pitch | undefined;
		if (pitch === "best") {
			// The pitch he cares most about that the school does well, from what scouting showed (else the school's best grade)
			let best = -1;
			for (const key of PITCHES) {
				const weight =
					row.wants.find((w) => w.key === key)?.weight ??
					(row.wants.some((w) => w.key === key) ? 0.35 : 1 / 6);
				const value = weight * row.grades[key];
				if (value > best) {
					best = value;
					usedPitch = key;
				}
			}
		} else {
			usedPitch = pitch;
		}
		const error = await toWorker("main", "collegeRecruitAction", {
			pid: row.pid,
			action,
			pitch: usedPitch,
		});
		setMessage(error ?? undefined);
	};

	const shown = rows.filter((row) => {
		if (pos !== "all") {
			const group =
				row.pos === "C" || row.pos === "FC"
					? "C"
					: row.pos.includes("F")
						? "F"
						: "G";
			if (group !== pos) {
				return false;
			}
		}
		if (status === "board") {
			return row.interest > 0 || row.offered;
		}
		if (status === "offered") {
			return row.offered;
		}
		if (status === "committed") {
			return row.commit !== undefined;
		}
		return true;
	});

	const button = (
		row: T,
		action: RecruitAction | "nil" | "withdraw",
		label: string,
		extraDisabled = false,
	) => (
		<button
			type="button"
			className="btn btn-sm btn-light-bordered px-1 py-0"
			disabled={disabled || extraDisabled}
			onClick={() => act(row, action)}
			title={
				action in ACTIONS
					? `${ACTIONS[action as RecruitAction].name}: ${ACTIONS[action as RecruitAction].cost} points`
					: action === "nil"
						? "Promise $5k of NIL money"
						: "Withdraw the offer"
			}
		>
			{label}
		</button>
	);

	return (
		<>
			<div className="d-flex flex-wrap gap-2 align-items-center mb-2">
				<div
					className="btn-group btn-group-sm"
					role="group"
					aria-label="Filter"
				>
					{(
						[
							["all", "All"],
							["board", "My board"],
							["offered", "Offered"],
							["committed", "Committed"],
						] as const
					).map(([key, label]) => (
						<button
							key={key}
							type="button"
							className={`btn ${status === key ? "btn-primary" : "btn-light-bordered"}`}
							onClick={() => setStatus(key)}
						>
							{label}
						</button>
					))}
				</div>
				<select
					className="form-select form-select-sm"
					style={{ width: "auto" }}
					aria-label="Position"
					value={pos}
					onChange={(event) => setPos(event.target.value)}
				>
					<option value="all">All positions</option>
					<option value="G">Guards</option>
					<option value="F">Forwards</option>
					<option value="C">Centers</option>
				</select>
				<label className="d-flex align-items-center gap-1 mb-0">
					Pitch
					<select
						className="form-select form-select-sm"
						style={{ width: "auto" }}
						value={pitch}
						onChange={(event) => setPitch(event.target.value as any)}
					>
						<option value="best">Best for him</option>
						{PITCHES.map((key) => (
							<option key={key} value={key}>
								{PITCH_NAMES[key]}
							</option>
						))}
					</select>
				</label>
			</div>
			{message ? (
				<div className="alert alert-warning py-1" role="alert">
					{message}
				</div>
			) : null}
			{autoRecruit && canEdit ? (
				<p className="text-body-secondary">
					Auto recruit is on: your staff spends your points every week. Turn it
					off to recruit yourself.
				</p>
			) : null}
			{shown.length === 0 ? (
				<p>{emptyText}</p>
			) : (
				<div className="table-responsive">
					<table className="table table-sm table-striped table-hover align-middle">
						<thead>
							<tr>
								<th>Player</th>
								{extraColumns.map((col) => (
									<th key={col.title}>{col.title}</th>
								))}
								<th>Pos</th>
								<th className="text-end" title="Your staff's estimate">
									Ovr
								</th>
								<th className="text-end" title="Your staff's estimate">
									Pot
								</th>
								<th>Wants</th>
								<th>Interest (you, top 3)</th>
								<th>Status</th>
								<th>Actions</th>
							</tr>
						</thead>
						<tbody>
							{shown.slice(0, limit).map((row) => (
								<tr key={row.pid} data-testid={`recruit-${row.pid}`}>
									<td className="text-nowrap">
										<a href={helpers.leagueUrl(["player", row.pid])}>
											{row.name}
										</a>
									</td>
									{extraColumns.map((col) => (
										<td key={col.title} className="text-nowrap">
											{col.render(row)}
										</td>
									))}
									<td>{row.pos}</td>
									<td className="text-end">
										{row.ovr}
										{row.scout < 2 ? (
											<span className="text-body-secondary">?</span>
										) : null}
									</td>
									<td className="text-end">{row.pot}</td>
									<td>
										<Wants row={row} />
									</td>
									<td>
										<InterestBars row={row} userAbbrev={userAbbrev} />
									</td>
									<td className="text-nowrap">
										{row.commit !== undefined ? (
											<span
												className={`badge ${row.top.length >= 0 && row.commitAbbrev === userAbbrev ? "bg-success" : "bg-secondary"}`}
											>
												{row.commitAbbrev}
											</span>
										) : row.offered ? (
											<span className="badge bg-info text-dark">Offered</span>
										) : null}
										{row.nil > 0 ? (
											<span className="ms-1 small">${row.nil}k</span>
										) : null}
									</td>
									<td>
										<div
											className="d-flex flex-wrap gap-1"
											style={{ minWidth: 170 }}
										>
											{button(row, "scout", "Scout", row.scout >= 2)}
											{button(row, "contact", "Contact", row.actedThisWeek)}
											{button(row, "homeVisit", "Visit", row.actedThisWeek)}
											{button(row, "officialVisit", "Official", row.visited)}
											{row.offered
												? button(row, "withdraw", "Withdraw")
												: button(row, "offer", "Offer")}
											{button(row, "nil", "NIL+")}
											{retain?.(row)
												? button(row, "retain", "Retain", row.actedThisWeek)
												: null}
										</div>
									</td>
								</tr>
							))}
						</tbody>
					</table>
				</div>
			)}
			{shown.length > limit ? (
				<button
					type="button"
					className="btn btn-light-bordered"
					onClick={() => setLimit(limit + 100)}
				>
					Show more
				</button>
			) : null}
		</>
	);
};
