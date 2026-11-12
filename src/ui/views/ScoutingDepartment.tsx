import useTitleBar from "../hooks/useTitleBar.tsx";
import type { View } from "../../common/types.ts";
import { helpers } from "../util/helpers.ts";
import { StaffFace } from "../components/StaffFace.tsx";

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
