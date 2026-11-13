import { useState, type ReactNode } from "react";
import useTitleBar from "../hooks/useTitleBar.tsx";
import type { View } from "../../common/types.ts";
import type {
	DelegationArea,
	DelegationLevel,
	FocusKey,
	SuggestionAction,
} from "../../common/staffDepth/types.ts";
import { PRIORITY_NAMES } from "../../common/staffDepth/regions.ts";
import { helpers } from "../util/helpers.ts";
import { toWorker } from "../util/toWorker.ts";

const AREAS: { key: DelegationArea; name: string; what: string }[] = [
	{
		key: "scouting",
		name: "Scouting assignments",
		what: "which scouts cover which regions",
	},
	{
		key: "development",
		name: "Development plans",
		what: "each player's offseason focus",
	},
	{ key: "hiring", name: "Staff hiring", what: "filling open coaching jobs" },
	{ key: "board", name: "Draft board", what: "the weekly board update" },
];

const LEVELS: { key: DelegationLevel; name: string; title: string }[] = [
	{ key: "auto", name: "Auto", title: "The staff decides" },
	{
		key: "suggest",
		name: "Suggest",
		title: "The staff proposes, you approve here",
	},
	{ key: "manual", name: "Manual", title: "You decide" },
];

const act = async (action: SuggestionAction, suggestionId?: string) => {
	await toWorker("main", "staffDepthAction", {
		type: "apply",
		action,
		suggestionId,
	});
};

const Recommendation = ({
	rec,
}: {
	rec: { id: string; title: string; text: string; action?: SuggestionAction };
}) => {
	const [done, setDone] = useState(false);
	return (
		<div
			className="border-start border-3 border-primary ps-2 mt-2"
			data-testid="staff-rec"
		>
			<div className="small text-body-secondary">Recommended</div>
			<div className="fw-bold">{rec.title}</div>
			{rec.text ? <div className="small">{rec.text}</div> : null}
			{rec.action ? (
				<button
					className="btn btn-sm btn-primary mt-1"
					disabled={done}
					onClick={async () => {
						await act(rec.action!);
						setDone(true);
					}}
				>
					{done ? "Done" : "Accept"}
				</button>
			) : null}
		</div>
	);
};

const Card = ({
	title,
	children,
	testid,
}: {
	title: string;
	children: ReactNode;
	testid?: string;
}) => (
	<div className="col-12 col-lg-6" data-testid={testid}>
		<div className="card h-100">
			<div className="card-header fw-bold">{title}</div>
			<div className="card-body">{children}</div>
		</div>
	</div>
);

const signed = (x: number) => (x > 0 ? `+${x}` : `${x}`);

const StaffReport = ({
	season,
	scoutingOn,
	coachingOn,
	delegation,
	suggestions,
	scouting,
	development,
	fit,
	conditioning,
}: View<"staffReport">) => {
	useTitleBar({ title: `${season} Staff Report` });
	return (
		<>
			<p>
				What your staff sees, and one recommended action per area. Nothing here
				needs your input: with every area on <b>Auto</b> the staff runs it.{" "}
				{scoutingOn ? (
					<>
						<a href={helpers.leagueUrl(["scouting_department"])}>Scouts</a> ·{" "}
						<a href={helpers.leagueUrl(["pro_scouting"])}>Pro scouting</a> ·{" "}
						<a href={helpers.leagueUrl(["draft_board"])}>Draft board</a> ·{" "}
					</>
				) : null}
				<a href={helpers.leagueUrl(["staff"])}>Coaching staff</a>
			</p>

			<div className="card mb-3" data-testid="staff-delegation">
				<div className="card-header fw-bold">Delegation</div>
				<div className="card-body">
					<div className="row g-2">
						{AREAS.map((area) => {
							const disabled =
								(!scoutingOn &&
									(area.key === "scouting" || area.key === "board")) ||
								(!coachingOn && area.key === "development");
							return (
								<div key={area.key} className="col-12 col-md-6 col-xl-3">
									<div className="fw-bold small">{area.name}</div>
									<div className="small text-body-secondary mb-1">
										{area.what}
									</div>
									<div className="btn-group btn-group-sm" role="group">
										{LEVELS.map((level) => (
											<button
												key={level.key}
												title={level.title}
												disabled={disabled}
												className={`btn ${delegation[area.key] === level.key ? "btn-primary" : "btn-light-bordered"}`}
												onClick={() =>
													toWorker("main", "staffDepthAction", {
														type: "settings",
														settings: {
															delegation: { [area.key]: level.key },
														},
													})
												}
											>
												{level.name}
											</button>
										))}
									</div>
								</div>
							);
						})}
					</div>
				</div>
			</div>

			{suggestions.length > 0 ? (
				<div className="card mb-3" data-testid="staff-proposals">
					<div className="card-header fw-bold">
						Waiting for your approval ({suggestions.length})
					</div>
					<ul className="list-group list-group-flush">
						{suggestions.map((s) => (
							<li key={s.id} className="list-group-item">
								<div className="fw-bold">{s.title}</div>
								<div className="small text-break">{s.text}</div>
								<div className="mt-1 d-flex gap-2">
									<button
										className="btn btn-sm btn-primary"
										onClick={() => act(s.action, s.id)}
									>
										Approve
									</button>
									<button
										className="btn btn-sm btn-light-bordered"
										onClick={() =>
											toWorker("main", "staffDepthAction", {
												type: "dismiss",
												id: s.id,
											})
										}
									>
										Dismiss
									</button>
								</div>
							</li>
						))}
					</ul>
				</div>
			) : null}

			<div className="row g-3">
				{scouting ? (
					<Card title="Scouting" testid="staff-scouting">
						<p className="mb-2">
							Director of Scouting <b>{scouting.director.name}</b> (
							{scouting.director.quality.toLowerCase()}, age{" "}
							{scouting.director.age}). Priority:{" "}
							<select
								className="form-select form-select-sm d-inline-block w-auto"
								value={scouting.priority}
								onChange={(event) =>
									toWorker("main", "staffDepthAction", {
										type: "settings",
										settings: { priority: event.target.value as any },
									})
								}
							>
								{Object.entries(PRIORITY_NAMES).map(([key, name]) => (
									<option key={key} value={key}>
										{key === "auto"
											? `Auto (now: ${PRIORITY_NAMES[scouting.effectivePriority]})`
											: name}
									</option>
								))}
							</select>
						</p>
						<div className="fw-bold small">Top targets</div>
						<ol className="mb-2 ps-3 small">
							{scouting.tops.map((p) => (
								<li key={p.pid}>
									<a href={helpers.leagueUrl(["player_scouting", p.pid])}>
										{p.name}
									</a>{" "}
									{p.pos}, {p.region} · confidence {p.confidence.toLowerCase()}{" "}
									({p.looks} looks)
								</li>
							))}
						</ol>
						<div className="fw-bold small">Coverage</div>
						<div className="d-flex flex-wrap gap-1 mb-1">
							{scouting.regions.map((r) => (
								<span
									key={r.region}
									className={`badge ${r.coverage < 0.18 ? "text-bg-danger" : r.coverage < 0.3 ? "text-bg-warning" : "text-bg-success"}`}
									title={`${r.prospects} prospects, ${r.importance}% of the class's top talent; ${r.scouts.join(", ") || "no scout"}`}
								>
									{r.name}: {r.label}
								</span>
							))}
						</div>
						<div className="small">
							Blind spots:{" "}
							{scouting.blindSpots.length > 0
								? scouting.blindSpots.join(", ")
								: "none that matter"}
						</div>
						{scouting.boardLog.length > 0 ? (
							<div className="small mt-2">
								<div className="fw-bold">Latest board changes</div>
								{scouting.boardLog.slice(0, 1).map((entry, i) => (
									<div key={i}>{entry.lines.join(" · ")}</div>
								))}
							</div>
						) : null}
						<Recommendation rec={scouting.rec} />
					</Card>
				) : null}

				{development ? (
					<Card title="Development" testid="staff-development">
						{development.rows.length > 0 ? (
							<>
								<p className="small mb-1">
									{development.season} offseason: average change in the
									worked-on skills <b>{signed(development.avgFocus ?? 0)}</b>.
								</p>
								<div className="table-responsive">
									<table className="table table-sm small mb-2">
										<thead>
											<tr>
												<th>Player</th>
												<th>Worked on</th>
												<th>Skills</th>
												<th>Ovr</th>
											</tr>
										</thead>
										<tbody>
											{development.rows.slice(0, 10).map((r) => (
												<tr key={r.pid}>
													<td>
														<a href={helpers.leagueUrl(["player", r.pid])}>
															{r.name}
														</a>
													</td>
													<td>
														{
															development.focuses.find((f) => f.key === r.focus)
																?.name
														}
													</td>
													<td className="text-nowrap">
														{r.focusBefore} → {r.focusAfter}
													</td>
													<td className="text-nowrap">
														{r.ovrBefore} → {r.ovrAfter}
													</td>
												</tr>
											))}
										</tbody>
									</table>
								</div>
							</>
						) : (
							<p className="small">
								No development report yet: plans run at the next preseason.
							</p>
						)}
						<div className="d-flex flex-wrap align-items-center gap-2 small mb-1">
							<span className="fw-bold">
								Plans for {development.planSeason}
							</span>
							<span>Team priority:</span>
							<select
								className="form-select form-select-sm w-auto"
								value={development.devPriority ?? ""}
								onChange={(event) =>
									toWorker("main", "staffDepthAction", {
										type: "settings",
										settings: {
											devPriority: (event.target.value || null) as any,
										},
									})
								}
							>
								<option value="">None (each player's need)</option>
								{development.focuses.map((f) => (
									<option key={f.key} value={f.key}>
										{f.name}
									</option>
								))}
							</select>
						</div>
						<div className="table-responsive" style={{ maxHeight: 260 }}>
							<table className="table table-sm small mb-0">
								<tbody>
									{development.plans.map((p) => (
										<tr key={p.pid}>
											<td>
												{p.name}{" "}
												<span className="text-body-secondary">
													{p.pos}, {p.age}
												</span>
											</td>
											<td>
												<select
													className="form-select form-select-sm"
													style={{ minWidth: 150 }}
													value={p.override ?? ""}
													onChange={(event) =>
														toWorker("main", "staffDepthAction", {
															type: "devOverride",
															pid: p.pid,
															focus: (event.target.value ||
																null) as FocusKey | null,
														})
													}
												>
													<option value="">
														{p.focus
															? `Staff: ${development.focuses.find((f) => f.key === p.focus)?.name}`
															: "No plan"}
													</option>
													{development.focuses.map((f) => (
														<option key={f.key} value={f.key}>
															{f.name}
														</option>
													))}
												</select>
											</td>
										</tr>
									))}
								</tbody>
							</table>
						</div>
						<Recommendation rec={development.rec} />
					</Card>
				) : null}

				<Card title="System fit" testid="staff-fit">
					{fit.systems ? (
						<p className="small mb-1">
							{fit.systems.off}: <b>{fit.systems.offFit.toLowerCase()}</b>.{" "}
							{fit.systems.def}: <b>{fit.systems.defFit.toLowerCase()}</b>. The
							roster would fit {fit.systems.bestOff} and {fit.systems.bestDef}{" "}
							best.
						</p>
					) : null}
					<p className="small mb-1">
						Weakest area against the league: <b>{fit.weakest.name}</b> (
						{signed(fit.weakest.gap)}).{" "}
						{fit.needs.length > 0
							? `Positional needs: ${fit.needs.join(", ")}.`
							: "No positional need."}
					</p>
					<Recommendation rec={fit.rec} />
				</Card>

				<Card title="Injuries and conditioning" testid="staff-conditioning">
					<p className="small mb-1">
						{conditioning.coach ? (
							<>
								Strength & conditioning: <b>{conditioning.coach.name}</b>{" "}
								(conditioning {conditioning.coach.rating})
								{conditioning.injuryFactor !== undefined
									? `, in-game injury rate ×${conditioning.injuryFactor.toFixed(2)}`
									: ""}
								.
							</>
						) : coachingOn ? (
							"No strength & conditioning coach."
						) : (
							"Coaching Staff Depth is off: no conditioning staff."
						)}{" "}
						{conditioning.old} of {conditioning.numPlayers} players are 30 or
						older.
					</p>
					<p className="small mb-1">
						{conditioning.injured.length === 0
							? "Nobody is injured."
							: `Injured: ${conditioning.injured
									.map((p) => `${p.name} (${p.type}, ${p.games} games)`)
									.join(", ")}.`}
					</p>
					<Recommendation rec={conditioning.rec} />
				</Card>
			</div>
		</>
	);
};

export default StaffReport;
