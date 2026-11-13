// Front Office Budget (League Extra): the department sliders inside the finances form, and the season review. Formulas in
// common/frontOffice.ts, data from worker/core/frontOffice (getFinancesInfo)
import { MAX_LEVEL, levelToEffect } from "../../../common/budgetLevels.ts";
import {
	FRONT_OFFICE_DEPTS,
	FRONT_OFFICE_DEPT_NAMES,
	deptAmount,
	deptEffectLine,
	overspendMoodPenalty,
	type FrontOfficeDept,
} from "../../../common/frontOffice.ts";
import type { View } from "../../../common/types.ts";
import { HelpPopover } from "../../components/HelpPopover.tsx";
import { helpers } from "../../util/helpers.ts";
import { gradientStyleFactory } from "../../util/gradientStyleFactory.ts";

export type FrontOfficeInfo = NonNullable<View<"teamFinances">["frontOffice"]>;

const gradientStyle = gradientStyleFactory(-0.9, -0.05, 0.05, 0.9);

const DEPT_HELP: Record<FrontOfficeDept, string> = {
	scouting:
		"The size and quality of your scouting department (Scouting Reports) and how far off your view of draft prospects' ratings is. With Draft Lottery Night & Combine, a department at level 55+ (3-season average) reads the draft combine early, from the playoffs.",
	analytics:
		"Narrower, more accurate projection ranges for players you could trade for or sign (Trade, Free Agents), and with Coaching Systems your head coach's game management and minutes plan.",
	health:
		"Shorter injuries (the health budget), fewer in-game injuries and faster recovery for players 30 and older.",
	travel:
		"Takes part of the endurance penalty of travel, back-to-backs and 3 games in 4 nights off your players (Load, Fatigue & Venue, Injury Depth); without those, a small endurance boost.",
	coaching: "Player progression.",
	facilities: "Player mood and ticket demand (builds slowly).",
};

const ordinal = (n: number) => helpers.ordinal(n);

export const FrontOfficeDepartments = ({
	disabledKeys,
	formDisabled,
	info,
	salaryCap,
	setLevel,
	values,
	expenseLevelsLastThree,
	numTeams,
}: {
	disabledKeys: Partial<Record<FrontOfficeDept, string>>;
	formDisabled: boolean;
	info: FrontOfficeInfo;
	salaryCap: number;
	setLevel: (dept: FrontOfficeDept, value: string) => void;
	values: Record<FrontOfficeDept, string>;
	expenseLevelsLastThree: Record<
		"scouting" | "coaching" | "health" | "facilities",
		number
	>;
	numTeams: number;
}) => {
	const levelInts = {} as Record<FrontOfficeDept, number>;
	let planned = 0;
	for (const dept of FRONT_OFFICE_DEPTS) {
		const x = Math.round(helpers.localeParseFloat(values[dept]));
		levelInts[dept] = Number.isNaN(x)
			? info.levels[dept]
			: helpers.bound(x, 1, MAX_LEVEL);
		if (dept !== "coaching" || !info.coachingOutsideEnvelope) {
			planned += deptAmount(dept, levelInts[dept], salaryCap);
		}
	}
	const envelope = info.envelope;
	const over = planned - envelope;
	const penalty = overspendMoodPenalty(planned, envelope);
	const pctOfEnvelope = Math.round((100 * planned) / envelope);
	const lastThree: Record<FrontOfficeDept, number> = {
		...expenseLevelsLastThree,
		...info.lastThree,
	};
	const options = {
		scouts: info.scouts,
		combine: info.combine,
		scheduleLoad: info.scheduleLoad,
		injuryDepth: info.injuryDepth,
		coachSystems: info.coachSystems,
	};

	return (
		<div data-testid="front-office">
			<h2>
				Front office budget{" "}
				<HelpPopover title="Front office budget">
					<p>
						Your owner funds the front office with an envelope that grows with
						your market (level {info.targetLevel} in every department). Move
						money between departments freely; spending over the envelope costs
						owner mood (money) at the end of the season, on top of the lower
						profit.
						{info.coachingOutsideEnvelope
							? " Your coaching staff's salaries are not part of it."
							: null}
					</p>
					<p>
						Levels go from 1 to {MAX_LEVEL}. 34 is the league-average spend and
						neutral; above it there are diminishing returns. Effects use your
						spending over the past 3 seasons.
					</p>
				</HelpPopover>
			</h2>
			<div className="mb-3">
				<div className="d-flex flex-wrap justify-content-between gap-2">
					<div>
						Planned: <b>{helpers.formatCurrency(planned / 1000, "M")}</b> of{" "}
						{helpers.formatCurrency(envelope / 1000, "M")} per season
					</div>
					<div className={penalty > 0 ? "text-danger" : "text-body-secondary"}>
						{over > 0
							? `${helpers.formatCurrency(over / 1000, "M")} over budget${penalty > 0 ? "" : " (within what the owner allows)"}`
							: `${helpers.formatCurrency(-over / 1000, "M")} unspent`}
					</div>
				</div>
				<div
					className="progress mt-1"
					role="progressbar"
					aria-label="Front office budget used"
					aria-valuenow={pctOfEnvelope}
					aria-valuemin={0}
					aria-valuemax={150}
					style={{ height: 10 }}
				>
					<div
						className={`progress-bar ${penalty > 0 ? "bg-danger" : over > 0 ? "bg-warning" : "bg-success"}`}
						style={{
							width: `${Math.min(100, (100 * planned) / (1.5 * envelope))}%`,
						}}
					/>
				</div>
				<div className="small text-body-secondary mt-1">
					{pctOfEnvelope}% of the envelope
					{penalty > 0
						? `, owner money mood about −${penalty.toFixed(2)} per season`
						: ""}
					. This season so far:{" "}
					{helpers.formatCurrency(info.seasonSpend / 1000, "M")} of{" "}
					{helpers.formatCurrency(info.seasonEnvelope / 1000, "M")}.
				</div>
			</div>
			<div className="d-flex flex-column gap-3">
				{FRONT_OFFICE_DEPTS.map((dept) => {
					const disabledReason = disabledKeys[dept];
					const disabled = formDisabled || disabledReason !== undefined;
					const level = levelInts[dept];
					const levelThree = lastThree[dept];
					return (
						<div key={dept} data-testid={`fo-dept-${dept}`}>
							<div className="d-flex flex-wrap align-items-baseline gap-2">
								<h3 className="mb-0">{FRONT_OFFICE_DEPT_NAMES[dept]}</h3>
								<HelpPopover title={FRONT_OFFICE_DEPT_NAMES[dept]}>
									{DEPT_HELP[dept]}
								</HelpPopover>
								<span className="ms-auto small text-body-secondary">
									{ordinal(info.ranks[dept])} of {numTeams} (league avg{" "}
									{Math.round(info.leagueAvg[dept])})
								</span>
							</div>
							<div className="d-flex align-items-center gap-2">
								<input
									type="range"
									className="form-range flex-grow-1"
									min={1}
									max={MAX_LEVEL}
									step={1}
									value={level}
									disabled={disabled}
									aria-label={`${FRONT_OFFICE_DEPT_NAMES[dept]} level`}
									onChange={(event) => {
										setLevel(dept, event.target.value);
									}}
								/>
								<input
									type="text"
									inputMode="numeric"
									className="form-control form-control-sm text-center"
									style={{ width: 56 }}
									value={values[dept]}
									disabled={disabled}
									aria-label={`${FRONT_OFFICE_DEPT_NAMES[dept]} level value`}
									onChange={(event) => {
										setLevel(dept, event.target.value);
									}}
								/>
							</div>
							<div className="small">
								<span
									className="px-1 rounded"
									style={gradientStyle(levelToEffect(levelThree))}
								>
									{deptEffectLine(dept, levelThree, options)}
								</span>
								{level !== levelThree ? (
									<span className="text-body-secondary">
										{" "}
										(at {level} for 3 seasons:{" "}
										{deptEffectLine(dept, level, options)})
									</span>
								) : null}
							</div>
							<div className="small text-body-secondary">
								{disabledReason ??
									`${helpers.formatCurrency(
										deptAmount(dept, level, salaryCap) / 1000,
										"M",
									)} per season, 3-season level ${levelThree}`}
							</div>
						</div>
					);
				})}
			</div>
		</div>
	);
};

const signed = (x: number, digits = 0) => {
	const r = Number(x.toFixed(digits));
	return `${r > 0 ? "+" : ""}${r.toFixed(digits)}`;
};

const ReviewRow = ({
	title,
	value,
	detail,
	good,
}: {
	title: string;
	value: string;
	detail: string;
	good: boolean | undefined;
}) => (
	<div className="col-12 col-sm-4">
		<div className="border rounded p-2 h-100">
			<div className="small text-body-secondary">{title}</div>
			<div
				className={`fs-4 fw-bold ${
					good === undefined ? "" : good ? "text-success" : "text-danger"
				}`}
			>
				{value}
			</div>
			<div className="small">{detail}</div>
		</div>
	</div>
);

export const FrontOfficeReview = ({ info }: { info: FrontOfficeInfo }) => {
	// Early in a season, last season's review is more interesting
	const review =
		info.review && info.review.gp >= 10
			? info.review
			: (info.prevReview ?? info.review);
	if (!review) {
		return null;
	}
	const m = review.measured;
	const injurySaved = m.durationGamesSaved + m.injuryGamesAvoided;
	const fatigueShare =
		m.fatiguePenalty > 0 ? (100 * m.fatigueSaved) / m.fatiguePenalty : 0;
	const scouting = review.scouting;

	return (
		<div className="mb-3" data-testid="front-office-review">
			<h2>
				What your spending bought, {review.season}{" "}
				<HelpPopover title="What your spending bought">
					<p>
						Measured in your games so far ({review.gp} played), each compared
						with the same events at league-average spending (level 34).
					</p>
					<p>
						Injury games: the shorter durations of the injuries that happened
						(same random draws, average health budget), plus the injuries the
						medical staff's lower injury rate avoided, times their length.
						Scouting: your average rating error on the current draft prospects,
						and what the same misses would be at an average budget. Travel
						fatigue: the endurance penalties of travel, back-to-backs and 3 in 4
						nights your players had, and the part your sports science staff took
						off.
					</p>
				</HelpPopover>
			</h2>
			<div className="row g-2">
				<ReviewRow
					title="Injury games saved"
					value={signed(injurySaved)}
					good={Math.abs(injurySaved) < 0.5 ? undefined : injurySaved > 0}
					detail={`${m.injuries} injur${m.injuries === 1 ? "y" : "ies"} (${m.injuryGames} games): ${signed(m.durationGamesSaved)} games from shorter recoveries, ${signed(m.injuriesAvoided, 1)} injuries from the injury rate`}
				/>
				<ReviewRow
					title="Prospect rating error"
					value={scouting ? `${scouting.error.toFixed(1)} ovr` : "–"}
					good={
						scouting && Math.abs(scouting.error - scouting.errorAvg) >= 0.05
							? scouting.error < scouting.errorAvg
							: undefined
					}
					detail={
						scouting
							? `vs ${scouting.errorAvg.toFixed(1)} at an average scouting budget (${scouting.prospects} prospects)`
							: "Only your own team's scouting is known"
					}
				/>
				<ReviewRow
					title="Travel fatigue saved"
					value={`${signed(m.fatigueSaved, 1)}%`}
					good={
						Math.abs(m.fatigueSaved) < 0.05 ? undefined : m.fatigueSaved > 0
					}
					detail={
						m.fatigueGames > 0
							? `endurance over ${m.fatigueGames} tired games (${signed(fatigueShare)}% of the ${m.fatiguePenalty.toFixed(1)}% penalty)`
							: "No travel, back-to-back or 3-in-4 fatigue yet"
					}
				/>
			</div>
		</div>
	);
};
