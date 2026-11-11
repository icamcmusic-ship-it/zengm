import clsx from "clsx";
import useTitleBar from "../hooks/useTitleBar.tsx";
import { helpers } from "../util/helpers.ts";
import type { View } from "../../common/types.ts";
import { strengthNames } from "../../common/coachSystems.ts";

// The sub-tabs of the Coaches page
export const CoachesTabs = ({ active }: { active: "coaches" | "notes" }) => {
	return (
		<ul className="nav nav-pills mb-3" data-testid="coaches-tabs">
			<li className="nav-item">
				<a
					className={clsx("nav-link", { active: active === "coaches" })}
					href={helpers.leagueUrl(["coaches"])}
				>
					Head coaches
				</a>
			</li>
			<li className="nav-item">
				<a
					className={clsx("nav-link", { active: active === "notes" })}
					href={helpers.leagueUrl(["coach_notes"])}
				>
					Coach's notes
				</a>
			</li>
		</ul>
	);
};

const Bar = ({ value }: { value: number }) => (
	<div className="progress" style={{ height: 8, width: 120 }}>
		<div
			className={clsx(
				"progress-bar",
				value >= 60 ? "bg-success" : value >= 40 ? "bg-info" : "bg-warning",
			)}
			style={{ width: `${Math.max(0, Math.min(100, value))}%` }}
		/>
	</div>
);

const CoachNotes = ({
	abbrev,
	coach,
	defenseNames,
	name,
	offenseNames,
	region,
	tid,
	trends,
}: View<"coachNotes">) => {
	useTitleBar({
		title: "Coach's Notes",
		dropdown: {
			fields: [{ key: "team", options: { type: "teams" }, value: tid }],
			view: "coachNotes",
		},
	});

	return (
		<>
			<CoachesTabs active="notes" />
			{!coach ? (
				<p>
					The {region} {name} have no head coach right now.
				</p>
			) : (
				<div className="row">
					<div className="col-lg-7 mb-3">
						<h2>
							<a href={helpers.leagueUrl(["coach", coach.cid])}>{coach.name}</a>
							,{" "}
							<a href={helpers.leagueUrl(["staff", `${abbrev}_${tid}`])}>
								{region} {name}
							</a>
						</h2>
						<p className="mb-1" data-testid="coach-notes-systems">
							<b>Offense:</b> {coach.offenseName} · <b>Defense:</b>{" "}
							{coach.defenseName}
						</p>
						<p className="text-body-secondary small mb-1">
							{coach.offenseDescription}
						</p>
						<p className="text-body-secondary small">
							{coach.defenseDescription}
						</p>
						<h3>Tendencies</h3>
						<ul>
							<li>Glass: {coach.describe.glass}</li>
							<li>Fouls: {coach.describe.fouls}</li>
							<li>Closing time: {coach.describe.closing}</li>
							<li>Timeouts: {coach.describe.timeouts}</li>
							<li>Minutes: {coach.describe.youth}</li>
							<li>Back-to-backs: {coach.describe.rest}</li>
						</ul>
						<h3>Identity</h3>
						<ul>
							<li>Philosophy: {coach.describe.philosophy}</li>
							<li>Personality: {coach.describe.personality}</li>
							<li>Background: {coach.describe.background}</li>
							<li>
								Adaptability: {coach.adapt}
								{coach.adapt < 25
									? " (stubborn: runs his system no matter the roster)"
									: coach.adapt >= 70
										? " (adapts to his roster)"
										: ""}
							</li>
						</ul>
						<h3>Strengths</h3>
						<table className="table table-sm" style={{ maxWidth: 320 }}>
							<tbody>
								{(
									Object.keys(strengthNames) as (keyof typeof strengthNames)[]
								).map((key) => (
									<tr key={key}>
										<td>{strengthNames[key]}</td>
										<td>{coach.strengths[key]}</td>
										<td className="align-middle">
											<Bar value={coach.strengths[key]} />
										</td>
									</tr>
								))}
							</tbody>
						</table>
					</div>
					<div className="col-lg-5 mb-3">
						<h3>Scheme fit</h3>
						<p data-testid="coach-notes-fit">
							Roster fit: <b>{coach.fit}</b> ({coach.fitText}) · offense{" "}
							{coach.offFit}, defense {coach.defFit}
							<br />
							<span className="text-body-secondary small">
								{coach.install < 100
									? `New system, ${coach.install}% installed (it takes about half a season).`
									: "System fully installed."}
							</span>
						</p>
						<div className="d-flex gap-4 flex-wrap">
							<table className="table table-sm w-auto">
								<thead>
									<tr>
										<th>Offense</th>
										<th>Fit</th>
									</tr>
								</thead>
								<tbody>
									{coach.offFits.map((row) => (
										<tr
											key={row.system}
											className={clsx({
												"fw-bold": row.system === coach.offense,
											})}
										>
											<td>{row.name}</td>
											<td>{row.score}</td>
										</tr>
									))}
								</tbody>
							</table>
							<table className="table table-sm w-auto">
								<thead>
									<tr>
										<th>Defense</th>
										<th>Fit</th>
									</tr>
								</thead>
								<tbody>
									{coach.defFits.map((row) => (
										<tr
											key={row.system}
											className={clsx({
												"fw-bold": row.system === coach.defense,
											})}
										>
											<td>{row.name}</td>
											<td>{row.score}</td>
										</tr>
									))}
								</tbody>
							</table>
						</div>
						<h3>Reputation</h3>
						<p>
							{coach.reputation} ({coach.reputationText}) · Hot seat:{" "}
							{coach.hotSeatText}
						</p>
						<h3>Coaching tree</h3>
						{coach.tree.up.length === 0 && coach.tree.down.length === 0 ? (
							<p>No coaching tree yet.</p>
						) : (
							<ul>
								{coach.tree.up.map((m) => (
									<li key={m.cid}>
										Learned under{" "}
										<a href={helpers.leagueUrl(["coach", m.cid])}>{m.name}</a>
									</li>
								))}
								{coach.tree.down.map((m) => (
									<li key={m.cid}>
										Protégé:{" "}
										<a href={helpers.leagueUrl(["coach", m.cid])}>{m.name}</a>
									</li>
								))}
							</ul>
						)}
					</div>
				</div>
			)}

			<h2>League trends</h2>
			<p className="text-body-secondary small">
				Head coaches by system. Systems that win get copied by new coaches.
			</p>
			<div className="table-responsive">
				<table className="table table-sm table-striped">
					<thead>
						<tr>
							<th>Season</th>
							{Object.entries(offenseNames).map(([key, name]) => (
								<th key={key} title={name}>
									{name.split(" ")[0]}
								</th>
							))}
							{Object.entries(defenseNames).map(([key, name]) => (
								<th key={key} title={name}>
									{name.split(" ").at(-1)}
								</th>
							))}
						</tr>
					</thead>
					<tbody>
						{trends.map((row) => (
							<tr key={row.season}>
								<td>{row.season}</td>
								{Object.keys(offenseNames).map((key) => (
									<td key={key}>{row.off[key] ?? 0}</td>
								))}
								{Object.keys(defenseNames).map((key) => (
									<td key={key}>{row.def[key] ?? 0}</td>
								))}
							</tr>
						))}
					</tbody>
				</table>
			</div>
		</>
	);
};

export default CoachNotes;
