import useTitleBar from "../hooks/useTitleBar.tsx";
import type { View } from "../../common/types.ts";
import { helpers } from "../util/helpers.ts";
import { StaffFace } from "../components/StaffFace.tsx";
import { toWorker } from "../util/toWorker.ts";
import {
	PRIORITY_NAMES,
	REGION_NAMES,
	SCOUT_REGIONS,
} from "../../common/staffDepth/regions.ts";
import type { ScoutRegion } from "../../common/staffDepth/types.ts";

type Depth = NonNullable<View<"scoutingDepartment">["depth"]>;

const OUR_GUY_WORDS = {
	star: "became a star",
	bust: "busted",
	solid: "solid pro",
};

// Scouting Director & Regions: the Director, the priority, the region plan and scout careers
const DirectorPanel = ({ depth }: { depth: Depth }) => (
	<div className="card mb-3" data-testid="scouting-director">
		<div className="card-body">
			<div className="d-flex flex-wrap gap-3 align-items-center mb-2">
				<div>
					<div className="small text-body-secondary">Director of Scouting</div>
					<div className="fw-bold fs-6">{depth.director.name}</div>
					<div className="small">
						{depth.director.quality} · age {depth.director.age} · since{" "}
						{depth.director.since}
						{depth.director.how === "promoted"
							? " (promoted from scout)"
							: depth.director.how === "poached"
								? " (hired away from a rival)"
								: ""}
					</div>
				</div>
				{depth.isUser ? (
					<div>
						<label
							className="small text-body-secondary d-block"
							htmlFor="scouting-priority"
						>
							Priority
						</label>
						<select
							id="scouting-priority"
							className="form-select form-select-sm"
							value={depth.priority}
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
										? `Auto (now: ${PRIORITY_NAMES[depth.effectivePriority]})`
										: name}
								</option>
							))}
						</select>
					</div>
				) : null}
				{depth.isUser ? (
					<div className="small">
						Assignments:{" "}
						<b>
							{depth.delegation === "auto"
								? "the Director's (Auto)"
								: depth.delegation === "suggest"
									? "kept, the Director suggests changes"
									: "yours (Manual)"}
						</b>
						<br />
						<a href={helpers.leagueUrl(["staff_report"])}>Staff Report</a>
					</div>
				) : null}
			</div>
			<div className="table-responsive">
				<table
					className="table table-sm small mb-0"
					data-testid="scouting-regions"
				>
					<thead>
						<tr>
							<th>Region</th>
							<th title="Share of the class's top talent">Talent</th>
							<th>Coverage</th>
						</tr>
					</thead>
					<tbody>
						{depth.regions.map((r) => (
							<tr key={r.region}>
								<td>{r.name}</td>
								<td>{r.importance}%</td>
								<td>
									<span
										className={`badge ${r.coverage < 0.18 ? "text-bg-danger" : r.coverage < 0.3 ? "text-bg-warning" : "text-bg-success"}`}
									>
										{r.label}
									</span>{" "}
									{r.coverage.toFixed(2)}
								</td>
							</tr>
						))}
					</tbody>
				</table>
			</div>
		</div>
	</div>
);

const ScoutCareer = ({
	s,
	isUser,
}: {
	s: Depth["scouts"][number];
	isUser: boolean;
}) => (
	<div className="mt-1" data-testid="scout-career">
		<div>
			{s.experience} years in scouting
			{s.second ? `, also ${s.second.toLowerCase()}` : ""} · reputation:{" "}
			{s.reputationLabel}
		</div>
		<div className="d-flex align-items-center gap-1">
			Region:{" "}
			{isUser ? (
				<select
					className="form-select form-select-sm w-auto"
					value={s.region}
					onChange={(event) =>
						toWorker("main", "staffDepthAction", {
							type: "scoutRegion",
							scoutId: s.id,
							region: event.target.value as ScoutRegion,
						})
					}
				>
					{SCOUT_REGIONS.map((r) => (
						<option key={r} value={r}>
							{REGION_NAMES[r]}
						</option>
					))}
				</select>
			) : (
				<b>{REGION_NAMES[s.region]}</b>
			)}
		</div>
		{s.ourGuys.length > 0 ? (
			<div>
				Our guy:{" "}
				{s.ourGuys.map((g, i) => (
					<span key={`${g.pid}-${g.season}`}>
						{i > 0 ? ", " : ""}
						<a href={helpers.leagueUrl(["player", g.pid])}>{g.name}</a> (
						{g.season}
						{g.judged ? `, ${OUR_GUY_WORDS[g.judged]}` : ""})
					</span>
				))}
			</div>
		) : null}
	</div>
);

// A team's scouting department (Scouting Reports setting)
const ScoutingDepartment = ({
	tid,
	level,
	quality,
	qualityValue,
	scouts,
	former,
	moves,
	track,
	pending,
	teams,
	userTid,
	depth,
}: View<"scoutingDepartment">) => {
	const team = teams.find((t) => t.tid === tid);
	useTitleBar({
		title: "Scouting Department",
		dropdown: {
			fields: [{ key: "team", options: { type: "teams" }, value: tid }],
			view: "scoutingDepartment",
		},
	});

	return (
		<>
			<p data-testid="scouting-dept-summary">
				{team ? team.name : "Team"}: a <b>{quality.toLowerCase()}</b> department
				({qualityValue}/100) of {scouts.length} scouts, from a scouting budget
				level of {Math.round(level)}.{" "}
				{tid === userTid
					? "Your scouts write every scouting report you see. A bigger scouting budget means more scouts and better ones: tighter grades, earlier red flags and better comparisons."
					: "Every team has a department; AI teams' GMs read their own scouts' grades."}
			</p>

			{depth ? <DirectorPanel depth={depth} /> : null}

			<div className="row g-3 mb-3" data-testid="scouting-dept-scouts">
				{scouts.map((s) => (
					<div key={s.id} className="col-12 col-sm-6 col-lg-4">
						<div className="border rounded p-2 d-flex gap-2 h-100">
							{s.face ? (
								<div style={{ width: 70, flexShrink: 0 }}>
									<StaffFace face={s.face} seed={s.id} age={s.age} />
								</div>
							) : null}
							<div className="small">
								<div className="fw-bold fs-6">{s.name}</div>
								<div>
									{s.specialtyName} · {s.qualityLabel}
								</div>
								<div className="text-body-secondary">
									{s.biasName} · age {s.age} · since {s.since}
								</div>
								{s.accuracy ? (
									<div>
										Hit rate {s.accuracy.hitRate}% on {s.accuracy.calls} judged
										calls
										{s.accuracy.best ? (
											<div className="text-success-emphasis">
												Best: {s.accuracy.best}
											</div>
										) : null}
										{s.accuracy.worst ? (
											<div className="text-danger-emphasis">
												Miss: {s.accuracy.worst}
											</div>
										) : null}
									</div>
								) : (
									<div className="text-body-secondary">
										{s.calls > 0
											? `${s.calls} draft calls, none old enough to judge`
											: "No draft calls on file yet"}
									</div>
								)}
								{depth?.scouts.find((x) => x.id === s.id) ? (
									<ScoutCareer
										s={depth.scouts.find((x) => x.id === s.id)!}
										isUser={depth.isUser}
									/>
								) : null}
							</div>
						</div>
					</div>
				))}
			</div>

			<h2>Track record</h2>
			{track.length === 0 ? (
				<p className="text-body-secondary">
					Nothing to judge yet. Our take on every prospect is filed at the draft
					and judged after four seasons (or when he retires).
					{pending > 0 ? ` ${pending} calls are waiting.` : ""}
				</p>
			) : (
				<ul data-testid="scouting-dept-track">
					{track.map((t) => (
						<li
							key={t.pid}
							className={t.hit ? undefined : "text-danger-emphasis"}
						>
							<a href={helpers.leagueUrl(["player_scouting", t.pid])}>
								{t.name}
							</a>{" "}
							({t.season}): {t.text}
						</li>
					))}
				</ul>
			)}

			{depth && depth.log.length > 0 ? (
				<>
					<h2>Careers</h2>
					<ul data-testid="scouting-careers">
						{depth.log.map((m, i) => (
							<li key={i}>
								{m.season}: {m.text}
							</li>
						))}
					</ul>
				</>
			) : null}

			<div className="row">
				<div className="col-12 col-md-6">
					<h2>Comings and goings</h2>
					{moves.length === 0 ? (
						<p className="text-body-secondary">No changes yet.</p>
					) : (
						<ul>
							{moves.map((m, i) => (
								<li key={i}>
									{m.season}: {m.text}
								</li>
							))}
						</ul>
					)}
				</div>
				<div className="col-12 col-md-6">
					<h2>Former scouts</h2>
					{former.length === 0 ? (
						<p className="text-body-secondary">None yet.</p>
					) : (
						<ul>
							{former.map((s) => (
								<li key={s.id}>
									{s.name} ({s.specialtyName.toLowerCase()}, {s.since}-{s.until}
									){s.accuracy ? `: hit rate ${s.accuracy.hitRate}%` : ""}
								</li>
							))}
						</ul>
					)}
				</div>
			</div>
		</>
	);
};

export default ScoutingDepartment;
