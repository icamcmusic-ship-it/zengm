// College mode: the user's recruiting board (docs/college-mode.md)
import useTitleBar from "../hooks/useTitleBar.tsx";
import { helpers } from "../util/helpers.ts";
import { toWorker } from "../util/toWorker.ts";
import type { View } from "../../common/types.ts";
import { Stars } from "./College/common.tsx";
import { useState } from "react";

const CollegeRecruiting = ({
	autoRecruit,
	canEdit,
	recruits,
	region,
	scholarships,
	signed,
	signingDayPassed,
	userOpenings,
	userPrestige,
}: View<"collegeRecruiting">) => {
	useTitleBar({ title: "Recruiting" });
	const [filter, setFilter] = useState<"all" | "targets" | "interested">("all");
	const [limit, setLimit] = useState(100);

	const numTargets = recruits.filter((r) => r.userTarget !== undefined).length;
	const shown = recruits.filter((r) =>
		filter === "targets"
			? r.userTarget !== undefined
			: filter === "interested"
				? r.interest !== "None" && r.interest !== "Low"
				: true,
	);

	const toggleTarget = async (pid: number, target: boolean) => {
		await toWorker("main", "collegeSetTarget", { pid, target });
	};

	return (
		<>
			<p>
				{region} has prestige <b>{userPrestige}</b>.{" "}
				{signingDayPassed ? (
					<>
						Signing day is over. Your class is below; next year's recruiting
						class appears in the preseason.
					</>
				) : (
					<>
						You have <b>{userOpenings}</b> open scholarship
						{userOpenings === 1 ? "" : "s"} for next season (of {scholarships}),
						counting this year's seniors as gone. Recruits sign on signing day
						(the last phase of the offseason): the best ones choose first,
						between the schools that still have a scholarship, by prestige, how
						much a school needs their position and the attention they get. Your
						targets get your staff's attention (the first{" "}
						{Math.max(1, userOpenings)} the most). Players leaving early for the
						pros or the portal open more spots; walk-ons fill whatever is left.
					</>
				)}
			</p>
			<div className="form-check form-switch mb-3">
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
					Auto recruit: your staff picks the targets on signing day (the best
					recruits who are interested, at positions of need). Turn it off to
					choose them yourself.
				</label>
			</div>

			{signed.length > 0 ? (
				<>
					<h2>Your signing class</h2>
					<div className="table-responsive">
						<table
							className="table table-sm table-striped"
							style={{ maxWidth: 560 }}
						>
							<thead>
								<tr>
									<th>Player</th>
									<th>Stars</th>
									<th>Rk</th>
									<th>Pos</th>
									<th className="text-end">Ovr</th>
									<th className="text-end">Pot</th>
								</tr>
							</thead>
							<tbody>
								{signed.map((p) => (
									<tr key={p.pid}>
										<td className="text-nowrap">
											<a href={helpers.leagueUrl(["player", p.pid])}>
												{p.name}
											</a>
											{p.walkOn ? (
												<span className="badge bg-secondary ms-1">Walk-on</span>
											) : null}
										</td>
										<td>
											<Stars stars={p.stars} />
										</td>
										<td>{p.walkOn ? "" : p.rank}</td>
										<td>{p.pos}</td>
										<td className="text-end">{p.ovr}</td>
										<td className="text-end">{p.pot}</td>
									</tr>
								))}
							</tbody>
						</table>
					</div>
				</>
			) : null}

			{recruits.length > 0 ? (
				<>
					<h2>Recruiting class</h2>
					<div className="d-flex flex-wrap gap-2 align-items-center mb-2">
						<div
							className="btn-group btn-group-sm"
							role="group"
							aria-label="Filter"
						>
							{(
								[
									["all", "All"],
									["interested", "Interested"],
									["targets", `Targets (${numTargets})`],
								] as const
							).map(([key, label]) => (
								<button
									key={key}
									type="button"
									className={`btn ${filter === key ? "btn-primary" : "btn-light-bordered"}`}
									onClick={() => setFilter(key)}
								>
									{label}
								</button>
							))}
						</div>
						{canEdit && !autoRecruit ? (
							<button
								type="button"
								className="btn btn-sm btn-light-bordered"
								onClick={async () => {
									await toWorker("main", "collegeAutoTargets", undefined);
								}}
							>
								Pick targets for me
							</button>
						) : null}
					</div>
					<div className="table-responsive">
						<table className="table table-sm table-striped table-hover">
							<thead>
								<tr>
									<th title="Your target priority">Target</th>
									<th>Rk</th>
									<th>Player</th>
									<th>Stars</th>
									<th>Pos</th>
									<th>Hgt</th>
									<th>From</th>
									<th className="text-end">Ovr</th>
									<th className="text-end">Pot</th>
									<th>Interest</th>
								</tr>
							</thead>
							<tbody>
								{shown.slice(0, limit).map((r) => (
									<tr
										key={r.pid}
										className={
											r.userTarget !== undefined ? "table-info" : undefined
										}
									>
										<td className="text-nowrap">
											<button
												type="button"
												className={`btn btn-sm ${r.userTarget !== undefined ? "btn-primary" : "btn-light-bordered"}`}
												disabled={!canEdit || autoRecruit}
												onClick={() =>
													toggleTarget(r.pid, r.userTarget === undefined)
												}
												aria-label={
													r.userTarget !== undefined
														? "Remove target"
														: "Add target"
												}
											>
												{r.userTarget !== undefined ? `#${r.userTarget}` : "+"}
											</button>
										</td>
										<td>{r.rank}</td>
										<td className="text-nowrap">
											<a href={helpers.leagueUrl(["player", r.pid])}>
												{r.name}
											</a>
										</td>
										<td>
											<Stars stars={r.stars} />
										</td>
										<td>{r.pos}</td>
										<td className="text-nowrap">
											{Math.floor(r.hgt / 12)}'{r.hgt % 12}"
										</td>
										<td className="text-nowrap">{r.state}</td>
										<td className="text-end">{r.ovr}</td>
										<td className="text-end">{r.pot}</td>
										<td>{r.interest}</td>
									</tr>
								))}
							</tbody>
						</table>
					</div>
					{shown.length > limit ? (
						<button
							type="button"
							className="btn btn-light-bordered"
							onClick={() => setLimit(limit + 200)}
						>
							Show more
						</button>
					) : null}
				</>
			) : signed.length === 0 ? (
				<p>No recruiting class yet.</p>
			) : null}
		</>
	);
};

export default CollegeRecruiting;
