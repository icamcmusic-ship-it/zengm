// Team → Coaching Staff: the head coach (systems, scheme fit, installation, job security, reputation), the assistants by job, what the
// staff does for the team, and (for your own team) hiring with recommendations, a side by side comparison and confirm dialogs
import { useRef, useState, type ReactNode } from "react";
import useTitleBar from "../../hooks/useTitleBar.tsx";
import { helpers } from "../../util/helpers.ts";
import { toWorker } from "../../util/toWorker.ts";
import { showNotification } from "../../util/showNotification.ts";
import type { CoachRole, View } from "../../../common/types.ts";
import { COACH_ROLE_NAMES } from "../../../common/staff.ts";
import {
	COACH_ROLE_INFO,
	devLevelWord,
	roleNoun,
	hotSeatColor,
	ratingWord,
} from "../../../common/staffText.ts";
import { strengthNames } from "../../../common/coachSystems.ts";
import { Modal } from "../../components/Modal.tsx";
import {
	CoachLink,
	CoachPortrait,
	GradeBadge,
	Meter,
	RatingBars,
	SystemsOffNote,
	Term,
	formatSalary,
	recordText,
} from "../../components/CoachUi.tsx";
import {
	CompareModal,
	type Candidate,
	type Head,
	type StaffCoach,
} from "./CompareModal.tsx";
import { Market } from "./Market.tsx";

type StaffActionArgs =
	| { type: "hire"; cid: number; role: CoachRole; years: number }
	| { type: "fire"; cid: number }
	| { type: "extend"; cid: number; years: number };

const formatPct = (x: number) => `${x >= 0 ? "+" : ""}${(100 * x).toFixed(1)}%`;

// Returns true when the action went through
const action = async (args: StaffActionArgs) => {
	try {
		const result = await toWorker("main", "staffAction", args);
		if (result.buyout) {
			showNotification({
				type: "info",
				text: `Paid a buyout of ${formatSalary(result.buyout)}.`,
			});
		}
		return true;
	} catch (error) {
		showNotification({
			type: "error",
			text: (error as Error).message,
		});
		return false;
	}
};

type Pending =
	| { type: "fire"; coach: StaffCoach; role: CoachRole }
	| { type: "extend"; coach: StaffCoach; role: CoachRole }
	| {
			type: "hire";
			candidate: Candidate;
			role: CoachRole;
			replace: StaffCoach | undefined;
	  };

const YearsSelect = ({
	years,
	setYears,
}: {
	years: number;
	setYears: (years: number) => void;
}) => (
	<label className="d-flex align-items-center gap-2 mb-3">
		Contract length
		<select
			className="form-select form-select-sm w-auto"
			value={years}
			onChange={(event) => setYears(Number(event.target.value))}
			data-testid="staff-contract-years"
		>
			{[1, 2, 3, 4, 5].map((y) => (
				<option key={y} value={y}>
					{y} season{y > 1 ? "s" : ""}
				</option>
			))}
		</select>
	</label>
);

const Staff = ({
	abbrev,
	budget,
	canExtend,
	candidates,
	coachSystems,
	colors,
	devRank,
	head,
	isUser,
	level,
	levelLastThree,
	name,
	numGames,
	numTeams,
	payroll,
	progEffect,
	progEffectNow,
	record,
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
	const [pending, setPending] = useState<Pending | undefined>();
	const [busy, setBusy] = useState(false);
	const [compare, setCompare] = useState<
		{ cid: number; role: CoachRole } | undefined
	>();
	const marketRef = useRef<HTMLHeadingElement>(null);

	const slotOf = (role: CoachRole) => slots.find((s) => s.role === role)!;
	const headSlot = slotOf("head");
	const assistants = slots.filter((s) => s.role !== "head");
	const halfSeason = Math.round(numGames / 2);

	const showMarket = (role: CoachRole) => {
		setMarketRole(role);
		// After the state update has rendered
		setTimeout(() => {
			marketRef.current?.scrollIntoView({ behavior: "smooth", block: "start" });
		}, 50);
	};

	const compareCandidate = compare
		? candidates[compare.role].find((c) => c.cid === compare.cid)
		: undefined;

	const confirm = async () => {
		if (!pending || busy) {
			return;
		}
		setBusy(true);
		try {
			if (pending.type === "fire") {
				if (await action({ type: "fire", cid: pending.coach.cid })) {
					setMarketRole(pending.role);
				}
			} else if (pending.type === "extend") {
				await action({ type: "extend", cid: pending.coach.cid, years });
			} else {
				const fired =
					!pending.replace ||
					(await action({ type: "fire", cid: pending.replace.cid }));
				if (fired) {
					await action({
						type: "hire",
						cid: pending.candidate.cid,
						role: pending.role,
						years,
					});
				}
			}
		} finally {
			setBusy(false);
			setPending(undefined);
			setCompare(undefined);
		}
	};

	// What a pending action does, spelled out
	const confirmContent = ():
		| { title: string; body: ReactNode; ok: string; okClass: string }
		| undefined => {
		if (!pending) {
			return undefined;
		}
		if (pending.type === "fire") {
			const c = pending.coach;
			return {
				title: `Fire ${c.name}?`,
				ok: `Fire ${c.name}`,
				okClass: "btn-danger",
				body: (
					<ul className="mb-0 ps-3">
						<li>
							{c.buyout > 0 ? (
								<>
									You pay a <b>buyout of {formatSalary(c.buyout)}</b> now: half
									of what is left on his contract (
									{formatSalary(c.contract.amount)} per season through{" "}
									{c.contract.exp}). It is a coaching expense, not salary cap
									money.
								</>
							) : (
								<>No buyout: nothing is left on his contract.</>
							)}
						</li>
						<li>
							The {roleNoun(pending.role)} job is <b>vacant</b> until you hire
							someone. A vacant job counts as a poor coach:{" "}
							{c.levelIfVacant !== level ? (
								<>
									your development level would go from {level} to{" "}
									<b>{c.levelIfVacant}</b>.
								</>
							) : (
								<>your development level would stay at {level}.</>
							)}
						</li>
						{pending.role === "head" && coachSystems ? (
							<li>
								Without a head coach your team plays <b>without a system</b>.
								Whoever you hire brings his own systems, which start{" "}
								{head?.installStart ?? 35}% installed and take about half a
								season ({halfSeason} games) to be fully in.
							</li>
						) : null}
						<li>
							He goes back on the market, where you or another team can hire
							him. If the job is still open in the preseason, a coach is hired
							for you.
						</li>
					</ul>
				),
			};
		}
		if (pending.type === "extend") {
			const c = pending.coach;
			return {
				title: `Extend ${c.name}?`,
				ok: "Extend contract",
				okClass: "btn-primary",
				body: (
					<>
						<YearsSelect years={years} setYears={setYears} />
						<ul className="mb-0 ps-3">
							<li>
								A new contract at <b>{formatSalary(c.demand)} per season</b> (he
								makes {formatSalary(c.contract.amount)} now), {years} more
								season
								{years > 1 ? "s" : ""} after his current deal, which runs
								through {c.contract.exp}.
							</li>
							<li>
								The salary follows his overall rating as{" "}
								{roleNoun(pending.role)} ({c.ovr}). It is a coaching expense,
								not salary cap money.
							</li>
							<li>
								A longer contract means a bigger buyout if you fire him later.
							</li>
						</ul>
					</>
				),
			};
		}
		const c = pending.candidate;
		const old = pending.replace;
		const o = c.outlook;
		return {
			title: old ? `Replace ${old.name} with ${c.name}?` : `Hire ${c.name}?`,
			ok: old ? `Fire ${old.name} and hire ${c.name}` : `Hire ${c.name}`,
			okClass: "btn-success",
			body: (
				<>
					<YearsSelect years={years} setYears={setYears} />
					<ul className="mb-0 ps-3">
						<li>
							{c.name} becomes your {roleNoun(pending.role)} on a{" "}
							<b>
								{years}-season contract at {formatSalary(c.demand)} per season
							</b>{" "}
							({formatSalary(c.demand * years)} in all), paid as a coaching
							expense, not against the salary cap.
						</li>
						{old ? (
							<li>
								{old.name} is fired:{" "}
								{old.buyout > 0 ? (
									<>
										you pay a <b>buyout of {formatSalary(old.buyout)}</b> now.
									</>
								) : (
									<>no buyout is owed.</>
								)}
							</li>
						) : null}
						{o ? (
							<>
								<li>
									<b>Systems:</b> {o.offenseName} on offense, {o.defenseName} on
									defense
									{head && pending.role === "head" ? (
										<>
											{" "}
											(now {head.offenseName} / {head.defenseName})
										</>
									) : null}
									. Scheme fit with your roster:{" "}
									<b>
										{o.fit} ({o.fitText})
									</b>
									{head && pending.role === "head" ? (
										<>, now {head.fit}</>
									) : null}
									.
								</li>
								<li>
									<b>Installation period:</b> his systems start {o.installStart}
									% installed and are fully in after about half a season (
									{halfSeason} games). Until then your team's tendencies are
									muted and it shoots slightly worse.
								</li>
							</>
						) : null}
						<li>
							Development level: {level} → <b>{c.levelIfHired}</b>
							{c.levelIfHired > level
								? " (players improve a little faster)"
								: c.levelIfHired < level
									? " (players improve a little slower)"
									: ""}
							.
						</li>
					</ul>
				</>
			),
		};
	};
	const confirmInfo = confirmContent();

	const actionButtons = (c: StaffCoach, role: CoachRole) =>
		isUser ? (
			<div className="d-flex flex-wrap gap-1 mt-2">
				<button
					className="btn btn-sm btn-light-bordered"
					onClick={() => showMarket(role)}
					data-testid={`staff-replace-${role}`}
				>
					Compare / Replace
				</button>
				{canExtend || c.contract.exp <= season ? (
					<button
						className="btn btn-sm btn-light-bordered"
						onClick={() => setPending({ type: "extend", coach: c, role })}
						data-testid={`staff-extend-${role}`}
					>
						Extend
					</button>
				) : null}
				<button
					className="btn btn-sm btn-danger"
					onClick={() => setPending({ type: "fire", coach: c, role })}
					data-testid={`staff-fire-${role}`}
				>
					Fire
				</button>
			</div>
		) : null;

	const vacantCard = (role: CoachRole) => (
		<div className="text-danger">
			<b>Vacant.</b>{" "}
			{isUser
				? "Hire someone, or a coach is hired for you before the regular season."
				: null}
			{isUser ? (
				<div className="mt-2">
					<button
						className="btn btn-sm btn-success"
						onClick={() => showMarket(role)}
						data-testid={`staff-hire-${role}`}
					>
						Hire a {roleNoun(role)}
					</button>
				</div>
			) : null}
		</div>
	);

	const contractLine = (c: StaffCoach) => (
		<div>
			<Term term="contract">Contract</Term>: {formatSalary(c.contract.amount)}{" "}
			per season through {c.contract.exp}
			{c.contract.exp <= season ? (
				<span className="text-warning"> (expires after the playoffs)</span>
			) : null}
		</div>
	);

	const hc = headSlot.coach;
	const h: Head | undefined = head;

	return (
		<>
			{!coachSystems ? <SystemsOffNote /> : null}

			{/* (clear the Download CSV menu, which floats at the top right, so the cards get the full width on a phone) */}
			<div className="row" style={{ clear: "both" }}>
				<div className="col-xl-7 mb-3">
					<div className="card h-100" data-testid="staff-head-card">
						<div className="card-body">
							<h2 className="card-title h5 text-body-secondary mb-2">
								Head coach · {region} {name}
							</h2>
							{!hc ? (
								vacantCard("head")
							) : (
								<>
									<div className="d-flex gap-3">
										<CoachPortrait
											face={hc.face}
											colors={colors}
											age={hc.age}
											seed={hc.cid}
											width={window.mobile ? 72 : 96}
										/>
										<div className="flex-grow-1" style={{ minWidth: 0 }}>
											<h3 className="mb-1">
												<CoachLink cid={hc.cid} name={hc.name} />
											</h3>
											<div>
												Age {hc.age}
												{h && h.tenure > 0
													? ` · ${helpers.ordinal(h.tenure + 1)} season here`
													: " · first season here"}
											</div>
											<div>
												{record ? (
													<>
														This season:{" "}
														<b>
															{record.won}-{record.lost}
														</b>
														{h?.expectedWins !== undefined ? (
															<span className="text-body-secondary">
																{" "}
																(expected about {h.expectedWins} wins)
															</span>
														) : null}
														{" · "}
													</>
												) : null}
												Career: {recordText(hc)}
											</div>
											{contractLine(hc)}
											<div className="mt-1">
												<Term term="ovr">Overall</Term>: <b>{hc.ovr}</b>{" "}
												<GradeBadge value={hc.ovr} />
											</div>
											{actionButtons(hc, "head")}
										</div>
									</div>

									{h ? (
										<>
											<div className="mt-3" data-testid="staff-head-systems">
												<div className="mb-1">
													<Term term="systems">
														<b>Systems</b>
													</Term>
												</div>
												<div>
													<span className="badge text-bg-primary me-1">
														Offense
													</span>
													<b>{h.offenseName}</b>
													<div className="small text-body-secondary mb-2">
														{h.offenseDescription}
													</div>
												</div>
												<div>
													<span className="badge text-bg-dark me-1">
														Defense
													</span>
													<b>{h.defenseName}</b>
													<div className="small text-body-secondary">
														{h.defenseDescription}
													</div>
												</div>
											</div>
											<div className="row mt-3">
												<div className="col-md-6">
													<Meter
														testId="staff-fit"
														label={<Term term="fit" />}
														value={h.fit}
														word={h.fitText}
														note={
															<>
																Offense fit {h.offFit} · defense fit {h.defFit}.
																{h.helping.length > 0 ? (
																	<div>
																		<span className="text-success">
																			Helping:
																		</span>{" "}
																		{h.helping.map((p, i) => (
																			<span key={p.pid}>
																				{i > 0 ? ", " : ""}
																				<a
																					href={helpers.leagueUrl([
																						"player",
																						p.pid,
																					])}
																				>
																					{p.name}
																				</a>{" "}
																				({p.score})
																			</span>
																		))}
																	</div>
																) : null}
																{h.hurting.length > 0 ? (
																	<div>
																		<span className="text-danger">
																			Hurting:
																		</span>{" "}
																		{h.hurting.map((p, i) => (
																			<span key={p.pid}>
																				{i > 0 ? ", " : ""}
																				<a
																					href={helpers.leagueUrl([
																						"player",
																						p.pid,
																					])}
																				>
																					{p.name}
																				</a>{" "}
																				({p.score})
																			</span>
																		))}
																	</div>
																) : null}
																{h.bestOffenseName !== h.offenseName ||
																h.bestDefenseName !== h.defenseName ? (
																	<div>
																		This roster would fit best:{" "}
																		{h.bestOffenseName} ({h.bestOffenseFit}) /{" "}
																		{h.bestDefenseName} ({h.bestDefenseFit}).
																	</div>
																) : (
																	<div>
																		These are the systems this roster fits best.
																	</div>
																)}
															</>
														}
													/>
													<Meter
														testId="staff-install"
														label={<Term term="install" />}
														value={h.install}
														valueText={`${h.install}%`}
														color={h.install >= 100 ? "success" : "info"}
														word={
															h.install >= 100
																? "Fully installed"
																: "Installing"
														}
														note={
															h.install < 100
																? `New systems: fully in after about half a season (${halfSeason} games).`
																: undefined
														}
													/>
												</div>
												<div className="col-md-6">
													<Meter
														testId="staff-hot-seat"
														label={<Term term="hotSeat" />}
														value={Math.round(100 * (1 - h.hotSeat))}
														color={hotSeatColor(h.hotSeatText)}
														word={h.hotSeatText}
														note={
															isUser
																? "Only you can fire your own coach."
																: undefined
														}
													/>
													{hc.systems ? (
														<Meter
															testId="staff-reputation"
															label={<Term term="reputation" />}
															value={hc.systems.reputation}
															word={hc.systems.reputationText}
														/>
													) : null}
													<div className="small">
														<Term term="philosophy">
															{h.describe.philosophy}
														</Term>
														{" · "}
														<Term term="personality">
															{h.describe.personality}
														</Term>
														{" · "}
														{h.describe.background}
														{h.mentor ? (
															<div>
																<Term term="tree">Learned under</Term>{" "}
																<CoachLink
																	cid={h.mentor.cid}
																	name={h.mentor.name}
																/>
															</div>
														) : null}
													</div>
												</div>
											</div>
											<div className="mt-2">
												<a
													href={helpers.leagueUrl([
														"coach_notes",
														`${abbrev}_${tid}`,
													])}
												>
													Coach's notes: tendencies, fit with every system,
													coaching tree
												</a>
											</div>
										</>
									) : (
										<div className="mt-3">
											<div className="mb-1">
												<Term term="ratings">
													<b>Ratings</b>
												</Term>
											</div>
											<RatingBars ratings={hc.ratings} />
											<div className="mt-2">Style: {hc.styleText}</div>
										</div>
									)}
								</>
							)}
						</div>
					</div>
				</div>

				<div className="col-xl-5 mb-3">
					<div className="card h-100" data-testid="staff-impact-card">
						<div className="card-body">
							<h2 className="card-title h5 text-body-secondary mb-2">
								What the staff does for the team
							</h2>
							{budget ? (
								<Meter
									testId="staff-dev-level"
									label={<Term term="devLevel">Player development level</Term>}
									value={level}
									word={devLevelWord(level)}
									note={
										<>
											{helpers.ordinal(devRank)} of {numTeams} staffs. Players'
											yearly progression: <b>{formatPct(progEffectNow)}</b> at
											this level. Progression uses the 3-season average, level{" "}
											{levelLastThree} ({formatPct(progEffect)}).
										</>
									}
								/>
							) : (
								<p>
									The budget is disabled in this league, so every team gets the
									league average development effect.
								</p>
							)}
							<div className="table-responsive mb-3">
								<table className="table table-sm mb-0">
									<thead>
										<tr>
											<th>Who</th>
											<th title="Share of the staff's player development">
												Share
											</th>
											<th>Rating</th>
										</tr>
									</thead>
									<tbody>
										{(
											[
												["dev", "50%", "dev"],
												["head", "30%", "dev"],
												["off", "10%", "dev"],
												["def", "10%", "dev"],
											] as const
										).map(([role, share, key]) => {
											const c = slotOf(role).coach;
											return (
												<tr key={role}>
													<td>{COACH_ROLE_NAMES[role]}</td>
													<td>{share}</td>
													<td>
														{c ? (
															<>
																{role === "head"
																	? Math.round(
																			(2 * c.ratings.dev + c.ratings.mot) / 3,
																		)
																	: c.ratings[key]}{" "}
																<span className="text-body-secondary">
																	·{" "}
																	{ratingWord(
																		role === "head"
																			? Math.round(
																					(2 * c.ratings.dev + c.ratings.mot) /
																						3,
																				)
																			: c.ratings[key],
																	)}
																</span>
															</>
														) : (
															<span className="text-danger">Vacant (30)</span>
														)}
													</td>
												</tr>
											);
										})}
									</tbody>
								</table>
							</div>
							{h ? (
								<>
									<div className="mb-1">
										<Term term="strengths">
											<b>On game day</b>
										</Term>
									</div>
									{(
										Object.keys(strengthNames) as (keyof typeof strengthNames)[]
									)
										.filter((key) => key !== "dev")
										.map((key) => (
											<Meter
												key={key}
												label={strengthNames[key]}
												value={h.strengths[key]}
												word={ratingWord(h.strengths[key])}
											/>
										))}
								</>
							) : null}
							<div>
								Staff payroll: <b>{formatSalary(payroll)}</b> per season, paid
								as coaching expenses (not against the salary cap). See{" "}
								<a
									href={helpers.leagueUrl([
										"team_finances",
										`${abbrev}_${tid}`,
									])}
								>
									team finances
								</a>{" "}
								and <a href={helpers.leagueUrl(["coaches"])}>all coaches</a>.
							</div>
						</div>
					</div>
				</div>
			</div>

			<h2>Assistant coaches</h2>
			<div className="row">
				{assistants.map(({ role, roleName, coach: c }) => {
					const info = COACH_ROLE_INFO[role];
					return (
						<div className="col-md-4 mb-3" key={role}>
							<div className="card h-100" data-testid={`staff-card-${role}`}>
								<div className="card-body">
									<h3 className="card-title h5 mb-1">{roleName}</h3>
									<div className="small text-body-secondary mb-2">
										{coachSystems ? info.doesSystems : info.does}
									</div>
									{!c ? (
										vacantCard(role)
									) : (
										<>
											<div className="d-flex gap-2 mb-2">
												<CoachPortrait
													face={c.face}
													colors={colors}
													age={c.age}
													seed={c.cid}
													width={56}
												/>
												<div style={{ minWidth: 0 }}>
													<div className="fw-bold">
														<CoachLink cid={c.cid} name={c.name} />
													</div>
													<div>Age {c.age}</div>
													<div>
														<Term term="ovr">Overall</Term>: <b>{c.ovr}</b>{" "}
														<GradeBadge value={c.ovr} />
													</div>
												</div>
											</div>
											<RatingBars
												ratings={c.ratings}
												highlight={info.keyRating}
											/>
											<div className="mt-2 small">{contractLine(c)}</div>
											{actionButtons(c, role)}
										</>
									)}
								</div>
							</div>
						</div>
					);
				})}
			</div>

			{isUser ? (
				<>
					<h2 ref={marketRef} style={{ scrollMarginTop: 60 }}>
						Hire a coach
					</h2>
					<p className="text-body-secondary">
						Coaches without a job. Pick a job, compare a candidate with the
						coach you have, then hire him: if the job is taken, your current
						coach is fired first (you pay his buyout). After the playoffs every
						offseason, teams fire and hire coaches and expiring contracts end.
					</p>
					<Market
						key={marketRole}
						candidates={candidates}
						coachSystems={coachSystems}
						colors={colors}
						head={h}
						level={level}
						onCompare={(c) => setCompare({ cid: c.cid, role: marketRole })}
						onHire={(c) =>
							setPending({
								type: "hire",
								candidate: c,
								role: marketRole,
								replace: slotOf(marketRole).coach,
							})
						}
						role={marketRole}
						setRole={setMarketRole}
						slots={slots}
					/>
				</>
			) : null}

			{compare && !pending ? (
				<CompareModal
					candidate={compareCandidate}
					colors={colors}
					current={slotOf(compare.role).coach}
					currentHead={h}
					level={level}
					onHide={() => setCompare(undefined)}
					onHire={(c) =>
						setPending({
							type: "hire",
							candidate: c,
							role: compare.role,
							replace: slotOf(compare.role).coach,
						})
					}
					role={compare.role}
					roleName={COACH_ROLE_NAMES[compare.role]}
				/>
			) : null}

			<Modal
				show={!!confirmInfo}
				onHide={() => (busy ? undefined : setPending(undefined))}
			>
				{confirmInfo ? (
					<>
						<Modal.Header closeButton>
							<Modal.Title>{confirmInfo.title}</Modal.Title>
						</Modal.Header>
						<Modal.Body data-testid="staff-confirm">
							{confirmInfo.body}
						</Modal.Body>
						<Modal.Footer>
							<button
								className="btn btn-secondary"
								disabled={busy}
								onClick={() => setPending(undefined)}
							>
								Cancel
							</button>
							<button
								className={`btn ${confirmInfo.okClass}`}
								disabled={busy}
								onClick={confirm}
								data-testid="staff-confirm-ok"
							>
								{confirmInfo.ok}
							</button>
						</Modal.Footer>
					</>
				) : null}
			</Modal>
		</>
	);
};

export default Staff;
