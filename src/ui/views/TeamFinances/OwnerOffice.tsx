// Owner's Office (League Extra): the owner's budget meeting goals and arena/facilities projects on Team Finances. Formulas:
// common/ownerOffice.ts, data from worker/core/ownerOffice (getFinancesInfo)
import { useState } from "react";
import type { OwnerProjectType } from "../../../common/ownerOffice.ts";
import type { View } from "../../../common/types.ts";
import { HelpPopover } from "../../components/HelpPopover.tsx";
import { helpers } from "../../util/helpers.ts";
import { showNotification } from "../../util/showNotification.ts";
import { toWorker } from "../../util/toWorker.ts";
import { useLocal } from "../../util/local.ts";

export type OwnerOfficeInfo = NonNullable<View<"teamFinances">["ownerOffice"]>;

const money = (thousands: number) =>
	helpers.formatCurrency(thousands / 1000, "M", 1);

const Status = ({ ok }: { ok: boolean }) => (
	<span className={ok ? "text-success" : "text-danger"}>
		{ok ? "on track" : "behind"}
	</span>
);

export const OwnerOffice = ({
	info,
	own,
	disabled,
}: {
	info: OwnerOfficeInfo;
	own: boolean;
	disabled: boolean;
}) => {
	const { numGames, season } = useLocal(["numGames", "season"]);
	const [starting, setStarting] = useState(false);
	const goals = info.goals;
	// The owner judges the season average payroll (or the payroll now, if higher)
	const seasonAvgPayroll =
		goals?.payrollTrack && goals.payrollTrack.n > 0
			? goals.payrollTrack.sum / goals.payrollTrack.n
			: undefined;

	const start = async (type: OwnerProjectType) => {
		setStarting(true);
		const error = await toWorker("main", "startOwnerProject", { type });
		setStarting(false);
		if (error) {
			showNotification({ type: "error", text: error });
		} else {
			showNotification({ type: "success", text: "Project started." });
		}
	};

	return (
		<div className="mb-3">
			<h2>
				Owner's Office{" "}
				<HelpPopover title="Owner's Office">
					<p>
						Each preseason the owner sets goals and a payroll ceiling from your
						market size, cash and last season. Results against them count a
						little in his end-of-season review.
					</p>
					<p>
						Projects are paid from cash every regular season game (an expense in
						profit, but the owner approved them, so they don't count against you
						in his review or his profit target). When finished they raise your
						facilities level (which wears off by 1 level a season), and a new
						arena adds seats.
					</p>
				</HelpPopover>
			</h2>
			<div className="row">
				<div className="col-md-6">
					<h3>{season} budget meeting</h3>
					{goals ? (
						<table className="table table-sm table-nonfluid">
							<tbody>
								<tr>
									<th>Payroll ceiling</th>
									<td>
										{money(goals.maxPayroll)}{" "}
										{goals.taxWilling ? "(will pay some tax)" : "(no tax)"}
									</td>
									<td>
										Now {money(info.payroll)}
										{seasonAvgPayroll !== undefined
											? `, season average ${money(seasonAvgPayroll)}`
											: null}{" "}
										<Status
											ok={
												Math.max(info.payroll, seasonAvgPayroll ?? 0) <=
												goals.maxPayroll
											}
										/>
									</td>
								</tr>
								<tr>
									<th>Profit target</th>
									<td>
										{helpers.formatCurrency(goals.profitTarget, "M", 1)} (not
										counting project payments)
									</td>
									<td />
								</tr>
								<tr>
									<th>Win target</th>
									<td>
										{goals.winTarget} of {numGames}
									</td>
									<td>Won {info.won}</td>
								</tr>
							</tbody>
						</table>
					) : info.noGoalsReason === "multiTeam" ? (
						<p>
							No budget meeting goals in multi-team mode, where the owner
							doesn't review you.
						</p>
					) : info.noGoalsReason === "college" ? (
						<p>
							No budget meeting goals in college, where you're judged against
							your program's expectations.
						</p>
					) : (
						<p>The owner sets this season's goals at the next preseason.</p>
					)}
				</div>
				<div className="col-md-6">
					<h3>Arena & facilities</h3>
					<p>
						Facilities bonus from projects: +{info.facilitiesBonus} levels.
						Project spending this season: {money(info.projectExpenses)}.
					</p>
					{info.active ? (
						<p>
							<b>{info.active.name}</b> under way: {money(info.active.paid)} of{" "}
							{money(info.active.cost)} paid, opens in the{" "}
							{info.active.finishSeason} preseason.
						</p>
					) : own ? (
						<table className="table table-sm table-nonfluid">
							<tbody>
								{info.options.map((option) => (
									<tr key={option.type}>
										<td>
											<b>{option.name}</b>
											<br />
											<span className="text-body-secondary">
												{option.description} +{option.facilities} facilities
												{option.capacityFactor !== 1
													? `, +${Math.round((option.capacityFactor - 1) * 100)}% seats`
													: ""}
											</span>
										</td>
										<td>
											{money(option.cost)} over {option.seasons} seasons
										</td>
										<td>
											<button
												type="button"
												className="btn btn-sm btn-secondary"
												disabled={
													disabled ||
													starting ||
													info.cash < info.minCashShare * option.cost
												}
												onClick={() => start(option.type)}
											>
												Start
											</button>
										</td>
									</tr>
								))}
							</tbody>
						</table>
					) : (
						<p>No project under way.</p>
					)}
					{info.completed.length > 0 ? (
						<p className="text-body-secondary">
							Completed:{" "}
							{info.completed
								.map(
									(c) =>
										`${info.options.find((o) => o.type === c.type)?.name ?? c.type} (${c.season})`,
								)
								.join(", ")}
						</p>
					) : null}
				</div>
			</div>
		</div>
	);
};
