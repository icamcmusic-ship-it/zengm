import { useState } from "react";
import useTitleBar from "../../hooks/useTitleBar.tsx";
import { helpers } from "../../util/helpers.ts";
import { toWorker } from "../../util/toWorker.ts";
import { showNotification } from "../../util/showNotification.ts";
import type { CoachRole, View } from "../../../common/types.ts";
import { COACH_RATING_NAMES, COACH_ROLES } from "../../../common/staff.ts";

type StaffActionArgs =
	| { type: "hire"; cid: number; role: CoachRole; years: number }
	| { type: "fire"; cid: number }
	| { type: "extend"; cid: number; years: number };

type CoachRow = View<"staff">["freeAgents"]["head"][number];

export const RatingsCells = ({ c }: { c: CoachRow }) => (
	<>
		<td>{c.ratings.dev}</td>
		<td>{c.ratings.off}</td>
		<td>{c.ratings.def}</td>
		<td>{c.ratings.mot}</td>
	</>
);

export const RatingsHeaders = () => (
	<>
		<th title={COACH_RATING_NAMES.dev}>Dev</th>
		<th title={COACH_RATING_NAMES.off}>Off</th>
		<th title={COACH_RATING_NAMES.def}>Def</th>
		<th title={COACH_RATING_NAMES.mot}>Mot</th>
	</>
);

const coachLink = (c: { cid: number; name: string }) => (
	<a href={helpers.leagueUrl(["coach", c.cid])}>{c.name}</a>
);

const formatPct = (x: number) => `${x >= 0 ? "+" : ""}${(100 * x).toFixed(1)}%`;

const action = async (args: StaffActionArgs) => {
	try {
		const result = await toWorker("main", "staffAction", args);
		if (result.buyout) {
			showNotification({
				type: "info",
				text: `Paid a buyout of ${helpers.formatCurrency(result.buyout / 1000, "M")}.`,
			});
		}
	} catch (error) {
		showNotification({
			type: "error",
			text: (error as Error).message,
		});
	}
};

const Staff = ({
	abbrev,
	budget,
	canExtend,
	freeAgents,
	isUser,
	level,
	levelLastThree,
	name,
	payroll,
	progEffect,
	progEffectNow,
	region,
	season,
	slots,
	tid,
}: View<"staff">) => {
	useTitleBar({
		title: "Coaching Staff",
		dropdown: {
			fields: [{ key: "team", options: { type: "teams" }, value: tid }],
			view: "staff",
		},
	});

	const [marketRole, setMarketRole] = useState<CoachRole>(
		slots.find((s) => !s.coach)?.role ?? "head",
	);
	const [years, setYears] = useState(3);
	const vacant = new Set(slots.filter((s) => !s.coach).map((s) => s.role));

	return (
		<>
			<p>
				{region} {name} staff payroll:{" "}
				<b>{helpers.formatCurrency(payroll / 1000, "M")}</b> per season (paid as
				coaching expenses, not against the salary cap).{" "}
				{budget ? (
					<>
						Player development level <b>{level}</b> (progression effect{" "}
						{formatPct(progEffectNow)}); 3-season average used for progs:{" "}
						{levelLastThree} ({formatPct(progEffect)}).
					</>
				) : (
					"The budget is disabled in this league, so every team gets the league average development effect."
				)}{" "}
				See also <a href={helpers.leagueUrl(["coaches"])}>all coaches</a> and{" "}
				<a href={helpers.leagueUrl(["team_finances", `${abbrev}_${tid}`])}>
					team finances
				</a>
				.
			</p>

			<div className="table-responsive">
				<table className="table table-striped table-sm table-hover">
					<thead>
						<tr>
							<th>Job</th>
							<th>Coach</th>
							<th>Age</th>
							<th>Ovr</th>
							<RatingsHeaders />
							<th>Style</th>
							<th>Contract</th>
							<th>Head coach record</th>
							{isUser ? <th /> : null}
						</tr>
					</thead>
					<tbody>
						{slots.map(({ role, roleName, coach: c }) => (
							<tr key={role}>
								<td>{roleName}</td>
								{c ? (
									<>
										<td>{coachLink(c)}</td>
										<td>{c.age}</td>
										<td>
											<b>{c.ovr}</b>
										</td>
										<RatingsCells c={c} />
										<td>{c.styleText}</td>
										<td>
											{helpers.formatCurrency(c.contract.amount / 1000, "M")}{" "}
											thru {c.contract.exp}
										</td>
										<td>
											{c.headSeasons > 0
												? `${c.headWon}-${c.headLost}${c.titles > 0 ? `, ${c.titles} title${c.titles > 1 ? "s" : ""}` : ""}`
												: null}
										</td>
										{isUser ? (
											<td className="text-nowrap">
												{canExtend || c.contract.exp <= season ? (
													<button
														className="btn btn-sm btn-light-bordered me-1"
														title={`New contract at ${helpers.formatCurrency(c.demand / 1000, "M")} per season`}
														onClick={() =>
															action({ type: "extend", cid: c.cid, years })
														}
													>
														Extend {years}y
													</button>
												) : null}
												<button
													className="btn btn-sm btn-danger"
													title={`Buyout: ${helpers.formatCurrency(c.buyout / 1000, "M")}`}
													onClick={async () => {
														if (
															window.confirm(
																`Fire ${c.name}? You will pay a buyout of ${helpers.formatCurrency(c.buyout / 1000, "M")}.`,
															)
														) {
															await action({ type: "fire", cid: c.cid });
															setMarketRole(role);
														}
													}}
												>
													Fire
												</button>
											</td>
										) : null}
									</>
								) : (
									<td colSpan={isUser ? 11 : 10} className="text-danger">
										Vacant
										{isUser
											? " - hire someone below, or one will be hired for you before the regular season"
											: null}
									</td>
								)}
							</tr>
						))}
					</tbody>
				</table>
			</div>

			{isUser ? (
				<>
					<h2>Coaching market</h2>
					<p>
						Coaches without a job. Contracts that expire this season end after
						the playoffs unless you extend them. Every offseason after the
						playoffs, teams fire and hire coaches.
					</p>
					<div className="d-flex flex-wrap gap-2 mb-2 align-items-center">
						<div className="btn-group">
							{COACH_ROLES.map((role) => (
								<button
									key={role}
									className={`btn btn-sm ${marketRole === role ? "btn-primary" : "btn-light-bordered"}`}
									onClick={() => setMarketRole(role)}
								>
									{slots.find((s) => s.role === role)!.roleName}
									{vacant.has(role) ? " (vacant)" : ""}
								</button>
							))}
						</div>
						<label className="d-flex align-items-center gap-1">
							Contract years
							<select
								className="form-select form-select-sm"
								value={years}
								onChange={(event) => setYears(Number(event.target.value))}
							>
								{[1, 2, 3, 4, 5].map((y) => (
									<option key={y} value={y}>
										{y}
									</option>
								))}
							</select>
						</label>
					</div>
					<div className="table-responsive">
						<table className="table table-striped table-sm table-hover">
							<thead>
								<tr>
									<th>Coach</th>
									<th>Age</th>
									<th>Ovr</th>
									<RatingsHeaders />
									<th>Style</th>
									<th>Asking</th>
									<th>Head coach record</th>
									<th />
								</tr>
							</thead>
							<tbody>
								{freeAgents[marketRole].map((c) => (
									<tr key={c.cid}>
										<td>{coachLink(c)}</td>
										<td>{c.age}</td>
										<td>
											<b>{c.ovr}</b>
										</td>
										<RatingsCells c={c} />
										<td>{c.styleText}</td>
										<td>{helpers.formatCurrency(c.demand / 1000, "M")}</td>
										<td>
											{c.headSeasons > 0 ? `${c.headWon}-${c.headLost}` : null}
										</td>
										<td>
											<button
												className="btn btn-sm btn-success"
												disabled={!vacant.has(marketRole)}
												title={
													vacant.has(marketRole)
														? undefined
														: "Fire your current coach for this job first"
												}
												onClick={() =>
													action({
														type: "hire",
														cid: c.cid,
														role: marketRole,
														years,
													})
												}
											>
												Hire
											</button>
										</td>
									</tr>
								))}
							</tbody>
						</table>
					</div>
				</>
			) : null}
		</>
	);
};

export default Staff;
