// The Owner page (Owner's Office League extra): the owner, his traits and mood, this season's goals and requests, and the projected call
// on your job. Data: worker/views/owner.ts
import clsx from "clsx";
import { useState } from "react";
import useTitleBar from "../hooks/useTitleBar.tsx";
import { HelpPopover } from "../components/HelpPopover.tsx";
import { helpers } from "../util/helpers.ts";
import { showNotification } from "../util/showNotification.ts";
import { toWorker } from "../util/toWorker.ts";
import type { View } from "../../common/types.ts";
import { OWNER_PROJECTS } from "../../common/ownerOffice.ts";
import OwnerMoodsChart from "./Message/OwnerMoodsChart.tsx";
import OwnerMoodBreakdown from "./Message/OwnerMoodBreakdown.tsx";

const money = (thousands: number) =>
	helpers.formatCurrency(thousands / 1000, "M", 1);

const signed = (x: number) => `${x >= 0 ? "+" : ""}${x.toFixed(2)}`;

const OUTLOOK_CLASS = {
	grace: "bg-secondary",
	safe: "bg-success",
	warm: "bg-warning text-dark",
	hot: "bg-danger",
	fired: "bg-dark",
} as const;

const STATUS_CLASS = {
	open: "text-body-secondary",
	met: "text-success",
	missed: "text-danger",
	overridden: "text-warning",
} as const;

const COMPONENT_NAMES = {
	wins: "regular season",
	playoffs: "playoffs",
	money: "finances",
} as const;

const TraitBar = ({ value }: { value: number }) => (
	<div className="progress" style={{ height: 8, width: 120 }}>
		<div
			className="progress-bar bg-info"
			style={{ width: `${Math.round(value * 100)}%` }}
		/>
	</div>
);

const Owner = ({
	activeProject,
	adjustments,
	challengeFiredLuxuryTax,
	challengeFiredMissPlayoffs,
	completedProjects,
	evaluations,
	franchiseName,
	goals,
	godMode,
	gracePeriodEnd,
	multiTeam,
	name,
	ownerMoods,
	ownerType,
	pendingSale,
	progress,
	projection,
	region,
	requests,
	requestsActive,
	season,
	since,
	teamName,
	traits,
	yearsOwned,
}: View<"owner">) => {
	useTitleBar({ title: "Owner" });
	const [busy, setBusy] = useState(false);

	const override = async (id: number) => {
		setBusy(true);
		const error = await toWorker("main", "overrideOwnerMandate", { id });
		setBusy(false);
		if (error) {
			showNotification({ type: "error", text: error });
		}
	};

	const payrollJudged = Math.max(
		progress.payroll,
		progress.seasonAvgPayroll ?? 0,
	);
	const winPace =
		progress.gp > 0
			? Math.round(
					((progress.won + 0.5 * progress.tied) / progress.gp) *
						progress.numGames,
				)
			: undefined;
	const profitPace =
		progress.gp > 0 && progress.gp < progress.numGames
			? (progress.profit * progress.numGames) / progress.gp
			: progress.profit;
	const currentTotal = projection.moodBefore
		? projection.moodBefore.wins +
			projection.moodBefore.playoffs +
			projection.moodBefore.money
		: undefined;

	return (
		<>
			<div className="row">
				<div className="col-lg-6 mb-3">
					<h2>{name}</h2>
					<p className="mb-1">
						Owner of the {region} {teamName} since {since} ({yearsOwned}{" "}
						{yearsOwned === 1 ? "season" : "seasons"}).
					</p>
					{ownerType ? (
						<p className="mb-1">
							<b>{ownerType.name}</b> owner: {ownerType.description}{" "}
							<span className="text-body-secondary">
								(mood weights: regular season ×{ownerType.moodWeights.wins},
								playoffs ×{ownerType.moodWeights.playoffs}, finances ×
								{ownerType.moodWeights.money})
							</span>
						</p>
					) : null}
					{pendingSale ? (
						<div className="alert alert-warning mt-2 mb-0">
							The team is being sold. A new <b>{pendingSale.name}</b> owner
							takes over in the {pendingSale.season} preseason:{" "}
							{pendingSale.description} A new owner forgives his predecessor's
							grudges and makes no demands in his first season.
						</div>
					) : null}
				</div>
				<div className="col-lg-6 mb-3">
					<h2>
						Your job{" "}
						<HelpPopover title="Your job">
							<p>
								A projection of this season's evaluation on the current pace:
								wins and profit scaled to a full season, the playoffs from your
								winning percentage until they are known, the luxury tax your
								payroll would owe now, the budget meeting goals and any settled
								requests. Open requests are not counted until they are settled.
							</p>
							<p>
								Safe: more than 1 above the firing line. Warm seat: within 1.
								Hot seat: within 0.35. Likely fired: at or below it.
							</p>
						</HelpPopover>
					</h2>
					<p>
						<span
							className={clsx("badge fs-5", OUTLOOK_CLASS[projection.outlook])}
						>
							{projection.outlookName}
						</span>
					</p>
					<table className="table table-sm table-nonfluid mb-1">
						<tbody>
							{currentTotal !== undefined ? (
								<tr>
									<th>Owner mood now</th>
									<td>{currentTotal.toFixed(2)}</td>
								</tr>
							) : null}
							<tr>
								<th>
									{projection.evaluated
										? `After the ${season} evaluation`
										: `Projected after the ${season} evaluation`}
								</th>
								<td>
									{projection.projectedTotal.toFixed(2)}{" "}
									<span className="text-body-secondary">
										(regular season {signed(projection.deltas.wins)}, playoffs{" "}
										{signed(projection.deltas.playoffs)}, finances{" "}
										{signed(projection.deltas.money)})
									</span>
								</td>
							</tr>
							<tr>
								<th>Firing line</th>
								<td>{projection.line.toFixed(2)}</td>
							</tr>
						</tbody>
					</table>
					{godMode ? (
						<p className="text-body-secondary">
							God Mode is on, so the owner can't fire you.
						</p>
					) : !projection.canFire ? (
						<p className="text-body-secondary">
							The owner can't fire you before the {projection.canFireSeason}{" "}
							evaluation
							{projection.canFireSeason > gracePeriodEnd
								? " (he is patient: one extra season after the grace period)"
								: ""}
							.
						</p>
					) : null}
					{challengeFiredLuxuryTax || challengeFiredMissPlayoffs ? (
						<p className="text-danger">
							Challenge mode: you're fired if you{" "}
							{[
								challengeFiredLuxuryTax ? "pay the luxury tax" : undefined,
								challengeFiredMissPlayoffs ? "miss the playoffs" : undefined,
							]
								.filter(Boolean)
								.join(" or ")}
							, whatever his mood.
						</p>
					) : null}
				</div>
			</div>

			<div className="row">
				<div className="col-lg-6 mb-3">
					<h3>Personality</h3>
					<table className="table table-sm table-nonfluid">
						<tbody>
							{traits.map((trait) => (
								<tr key={trait.key}>
									<th>
										{trait.name}{" "}
										<HelpPopover title={trait.name}>
											{trait.description}
										</HelpPopover>
									</th>
									<td className="align-middle">
										<TraitBar value={trait.value} />
									</td>
									<td>{trait.label}</td>
								</tr>
							))}
						</tbody>
					</table>
				</div>
				<div className="col-lg-6 mb-3">
					<h3>{season} budget meeting</h3>
					{goals ? (
						<table className="table table-sm table-nonfluid">
							<tbody>
								<tr>
									<th>Wins</th>
									<td>
										{goals.winTarget} of {progress.numGames}
									</td>
									<td>
										{helpers.formatRecord(progress)}
										{winPace !== undefined && progress.gp < progress.numGames
											? `, on pace for ${winPace}`
											: null}{" "}
										<span
											className={
												(winPace ?? progress.won) >= goals.winTarget
													? "text-success"
													: "text-danger"
											}
										>
											{(winPace ?? progress.won) >= goals.winTarget
												? "on track"
												: "behind"}
										</span>
									</td>
								</tr>
								<tr>
									<th>Payroll ceiling</th>
									<td>
										{money(goals.maxPayroll)}{" "}
										{goals.taxWilling ? "(will pay some tax)" : "(no tax)"}
									</td>
									<td>
										Now {money(progress.payroll)}
										{progress.seasonAvgPayroll !== undefined
											? `, season average ${money(progress.seasonAvgPayroll)}`
											: null}{" "}
										<span
											className={
												payrollJudged <= goals.maxPayroll
													? "text-success"
													: "text-danger"
											}
										>
											{payrollJudged <= goals.maxPayroll ? "on track" : "over"}
										</span>
									</td>
								</tr>
								<tr>
									<th>Profit</th>
									<td>{helpers.formatCurrency(goals.profitTarget, "M", 1)}</td>
									<td>
										{helpers.formatCurrency(progress.profit, "M", 1)} so far
										{progress.gp > 0 && progress.gp < progress.numGames
											? `, on pace for ${helpers.formatCurrency(profitPace, "M", 1)}`
											: null}{" "}
										<span className="text-body-secondary">
											(before luxury tax and revenue sharing, not counting
											project payments)
										</span>
									</td>
								</tr>
							</tbody>
						</table>
					) : (
						<p>
							{multiTeam
								? "No budget meeting goals in multi-team mode."
								: "The owner sets this season's goals at the next preseason."}
						</p>
					)}
					{activeProject ? (
						<p>
							<b>{activeProject.name}</b> under way: {money(activeProject.paid)}{" "}
							of {money(activeProject.cost)} paid, opens in the{" "}
							{activeProject.finishSeason} preseason.
						</p>
					) : (
						<p>
							No arena or facilities project under way.{" "}
							<a href={helpers.leagueUrl(["team_finances"])}>
								Start one on Team Finances.
							</a>
						</p>
					)}
					{completedProjects.length > 0 ? (
						<p className="text-body-secondary">
							Completed projects:{" "}
							{completedProjects
								.map((c) => `${OWNER_PROJECTS[c.type].name} (${c.season})`)
								.join(", ")}
						</p>
					) : null}
				</div>
			</div>

			<h3>
				Requests and ultimatums{" "}
				<HelpPopover title="Requests and ultimatums">
					<p>
						A few times a season at most (more often for a meddling owner), the
						owner makes requests, ultimatums and mandates, each with an explicit
						stake in his mood. Requests are judged when they come due (the trade
						deadline or the end of the season). Mandates are moves he made
						himself: you can override them for a mood cost.
					</p>
					<p>
						Trading or releasing the franchise player during the season also
						costs owner mood, more for an owner loyal to his stars. Together
						these move the mood at most -0.5 / +0.2 a season.
					</p>
				</HelpPopover>
			</h3>
			{requests.length === 0 ? (
				<p>
					{requestsActive
						? "No requests so far this season."
						: "The owner isn't making requests this season (grace period, a new owner's first season, God Mode, auto play or multi-team mode)."}
				</p>
			) : (
				<div className="table-responsive">
					<table className="table table-sm table-striped">
						<thead>
							<tr>
								<th>Request</th>
								<th>Stake</th>
								<th>Status</th>
								<th />
							</tr>
						</thead>
						<tbody>
							{requests.map((r) => (
								<tr key={r.id}>
									<td>
										<b>{r.title}</b>
										{r.mandate ? (
											<span className="badge bg-secondary ms-1">Mandate</span>
										) : null}
										<div className="small">{r.description}</div>
									</td>
									<td>
										{r.mandate
											? `${(-r.penalty).toFixed(2)} if overridden`
											: `${r.reward > 0 ? `+${r.reward.toFixed(2)} / ` : ""}${(-r.penalty).toFixed(2)}`}
										<div className="small text-body-secondary">
											{COMPONENT_NAMES[r.component]}
										</div>
									</td>
									<td className={STATUS_CLASS[r.status]}>
										{r.status === "open"
											? `Open (due ${r.due === "tradeDeadline" ? "at the trade deadline" : "at season end"})`
											: r.status === "met"
												? "Done"
												: r.status === "missed"
													? "Missed"
													: "Overridden"}
										{r.note ? (
											<div className="small text-body-secondary">{r.note}</div>
										) : null}
									</td>
									<td>
										{r.mandate && r.status === "open" ? (
											<button
												type="button"
												className="btn btn-sm btn-outline-danger"
												disabled={busy}
												onClick={() => override(r.id)}
											>
												Override
											</button>
										) : null}
									</td>
								</tr>
							))}
						</tbody>
					</table>
				</div>
			)}
			{adjustments.length > 0 ? (
				<p>
					This season's owner mood from requests so far:{" "}
					{adjustments.map((a) => `${a.text} ${signed(a.delta)}`).join("; ")}.
				</p>
			) : null}
			{franchiseName ? (
				<p className="text-body-secondary">
					Franchise player at the start of the season: {franchiseName}.
				</p>
			) : null}

			<h3 className="mt-3">Mood over time</h3>
			{ownerMoods.length > 1 ? (
				<OwnerMoodsChart ownerMoods={ownerMoods} />
			) : (
				<p>Not enough evaluated seasons yet for a chart.</p>
			)}
			{ownerMoods.length > 0 ? (
				<OwnerMoodBreakdown ownerMoods={ownerMoods} />
			) : null}

			<h3 className="mt-3">Evaluations</h3>
			{evaluations.length === 0 ? (
				<p>No stored evaluations yet.</p>
			) : (
				<div className="table-responsive">
					<table className="table table-sm table-striped table-nonfluid">
						<thead>
							<tr>
								<th>Season</th>
								<th>Regular season</th>
								<th>Playoffs</th>
								<th>Finances</th>
								<th>Judged profit</th>
								<th>Requests</th>
								<th>Mood after</th>
							</tr>
						</thead>
						<tbody>
							{evaluations.map((e) => (
								<tr key={e.season}>
									<td>{e.season}</td>
									<td>{signed(e.cappedDeltas.wins)}</td>
									<td>{signed(e.cappedDeltas.playoffs)}</td>
									<td>{signed(e.cappedDeltas.money)}</td>
									<td>
										{helpers.formatCurrency(e.profit, "M", 1)} vs{" "}
										{helpers.formatCurrency(e.expectedProfit, "M", 1)}
									</td>
									<td>
										{e.adjustments && e.adjustments.length > 0
											? signed(
													e.adjustments.reduce((sum, a) => sum + a.delta, 0),
												)
											: "-"}
									</td>
									<td>
										{e.mood
											? (e.mood.wins + e.mood.playoffs + e.mood.money).toFixed(
													2,
												)
											: "-"}
										{!e.applied ? (
											<span className="text-body-secondary">
												{" "}
												(not counted)
											</span>
										) : null}
									</td>
								</tr>
							))}
						</tbody>
					</table>
				</div>
			)}
		</>
	);
};

export default Owner;
