// Side by side: a candidate for a coaching job against the coach who has it now
import clsx from "clsx";
import type { ReactNode } from "react";
import { Modal } from "../../components/Modal.tsx";
import {
	CoachPortrait,
	TermHelp,
	formatSalary,
	recordText,
} from "../../components/CoachUi.tsx";
import { COACH_RATING_NAMES } from "../../../common/staff.ts";
import {
	COACH_ROLE_INFO,
	ratingWord,
	type CoachTerm,
} from "../../../common/staffText.ts";
import { strengthNames } from "../../../common/coachSystems.ts";
import type { CoachRatings, CoachRole, View } from "../../../common/types.ts";

type Slot = View<"staff">["slots"][number];
export type StaffCoach = NonNullable<Slot["coach"]>;
export type Candidate = View<"staff">["candidates"]["head"][number];
export type Head = NonNullable<View<"staff">["head"]>;

// One row: the current coach's value, the candidate's, and which is better (higher unless lowerIsBetter)
const Row = ({
	a,
	b,
	aText,
	bText,
	label,
	lowerIsBetter,
	term,
}: {
	a?: number;
	b?: number;
	aText?: ReactNode;
	bText?: ReactNode;
	label: ReactNode;
	lowerIsBetter?: boolean;
	term?: CoachTerm;
}) => {
	const diff = a !== undefined && b !== undefined ? b - a : 0;
	const better = lowerIsBetter ? -diff : diff;
	return (
		<tr>
			<th scope="row" className="fw-normal text-body-secondary">
				{label}
				{term ? <TermHelp term={term} /> : null}
			</th>
			<td className={clsx({ "fw-bold": better < 0 })}>{aText ?? a ?? "—"}</td>
			<td
				className={clsx({
					"fw-bold": better > 0,
					"text-success": better > 0,
					"text-danger": better < 0,
				})}
			>
				{bText ?? b ?? "—"}
				{a !== undefined && b !== undefined && diff !== 0 ? (
					<span className="small ms-1">
						({diff > 0 ? "+" : ""}
						{diff})
					</span>
				) : null}
			</td>
		</tr>
	);
};

const RATING_KEYS: (keyof CoachRatings)[] = ["dev", "off", "def", "mot"];

export const CompareModal = ({
	candidate,
	colors,
	current,
	currentHead,
	level,
	onHide,
	onHire,
	role,
	roleName,
}: {
	candidate: Candidate | undefined;
	colors: [string, string, string] | undefined;
	current: StaffCoach | undefined;
	// The current head coach's systems and fit (coaching systems on, head coach job)
	currentHead: Head | undefined;
	level: number;
	onHide: () => void;
	onHire: (candidate: Candidate) => void;
	role: CoachRole;
	roleName: string;
}) => {
	if (!candidate) {
		return null;
	}
	const b = candidate;
	const a = current;
	const bo = b.outlook;
	const ao = role === "head" ? currentHead : undefined;
	const sameSystems =
		!!ao && !!bo && ao.offense === bo.offense && ao.defense === bo.defense;

	// The verdict: where the candidate is clearly better or worse
	const better: string[] = [];
	const worse: string[] = [];
	const judge = (
		name: string,
		x: number | undefined,
		y: number | undefined,
		margin: number,
	) => {
		if (x === undefined || y === undefined) {
			return;
		}
		if (y - x >= margin) {
			better.push(name);
		} else if (x - y >= margin) {
			worse.push(name);
		}
	};
	if (a) {
		judge("overall", a.ovr, b.ovr, 3);
		judge("scheme fit", ao?.fit, bo?.fit, 5);
		judge("player development", level, b.levelIfHired, 3);
		judge("offense", ao?.strengths.off, bo?.strengths.off, 4);
		judge("defense", ao?.strengths.def, bo?.strengths.def, 4);
		judge("game management", ao?.strengths.mgmt, bo?.strengths.mgmt, 6);
		judge("reputation", a.systems?.reputation, b.systems?.reputation, 6);
		if (b.demand - a.contract.amount > 0.15 * a.contract.amount) {
			worse.push("cost");
		} else if (a.contract.amount - b.demand > 0.15 * a.contract.amount) {
			better.push("cost");
		}
	}

	return (
		<Modal show onHide={onHide} size="lg" scrollable>
			<Modal.Header closeButton>
				<Modal.Title>Compare: {roleName}</Modal.Title>
			</Modal.Header>
			<Modal.Body data-testid="coach-compare">
				<p className="text-body-secondary">
					{COACH_ROLE_INFO[role][bo ? "doesSystems" : "does"]}
				</p>
				<div className="table-responsive">
					<table className="table table-sm align-middle coach-compare-table">
						<thead>
							<tr>
								<th style={{ width: "30%" }} />
								<th style={{ width: "35%" }}>
									<div className="d-flex align-items-center gap-2">
										{a ? (
											<CoachPortrait
												face={a.face}
												colors={colors}
												age={a.age}
												seed={a.cid}
												width={40}
											/>
										) : null}
										<div>
											<div className="small text-body-secondary fw-normal">
												Current
											</div>
											{a ? a.name : <span className="text-danger">Vacant</span>}
										</div>
									</div>
								</th>
								<th style={{ width: "35%" }}>
									<div className="d-flex align-items-center gap-2">
										<CoachPortrait
											face={b.face}
											colors={colors}
											age={b.age}
											seed={b.cid}
											width={40}
										/>
										<div>
											<div className="small text-body-secondary fw-normal">
												Candidate
											</div>
											{b.name}
										</div>
									</div>
								</th>
							</tr>
						</thead>
						<tbody>
							<Row label="Age" aText={a?.age} bText={b.age} />
							<Row
								label={`Overall as ${roleName}`}
								term="ovr"
								a={a?.ovr}
								b={b.ovr}
								aText={a ? `${a.ovr} · ${ratingWord(a.ovr)}` : undefined}
								bText={`${b.ovr} · ${ratingWord(b.ovr)}`}
							/>
							{RATING_KEYS.map((key) => (
								<Row
									key={key}
									label={COACH_RATING_NAMES[key]}
									a={a?.ratings[key]}
									b={b.ratings[key]}
								/>
							))}
							{bo ? (
								<>
									<Row
										label="Offense system"
										term="systems"
										aText={ao?.offenseName}
										bText={bo.offenseName}
									/>
									<Row
										label="Defense system"
										aText={ao?.defenseName}
										bText={bo.defenseName}
									/>
									<Row
										label="Scheme fit with your roster"
										term="fit"
										a={ao?.fit}
										b={bo.fit}
										aText={ao ? `${ao.fit} · ${ao.fitText}` : undefined}
										bText={`${bo.fit} · ${bo.fitText}`}
									/>
									<Row label="Offense fit" a={ao?.offFit} b={bo.offFit} />
									<Row label="Defense fit" a={ao?.defFit} b={bo.defFit} />
									{(
										Object.keys(strengthNames) as (keyof typeof strengthNames)[]
									).map((key, i) => (
										<Row
											key={key}
											label={`${strengthNames[key]} strength`}
											term={i === 0 ? "strengths" : undefined}
											a={ao?.strengths[key]}
											b={bo.strengths[key]}
										/>
									))}
									<Row
										label="Philosophy"
										term="philosophy"
										aText={ao?.describe.philosophy}
										bText={bo.describe.philosophy}
									/>
									<Row
										label="Personality"
										term="personality"
										aText={ao?.describe.personality}
										bText={bo.describe.personality}
									/>
								</>
							) : !b.systems || role !== "head" ? (
								<Row label="Style" aText={a?.styleText} bText={b.styleText} />
							) : null}
							<Row
								label="Development level with him"
								term="devLevel"
								a={a ? level : undefined}
								b={b.levelIfHired}
								aText={a ? level : `${level} (vacant)`}
							/>
							{b.systems ? (
								<Row
									label="Reputation"
									term="reputation"
									a={a?.systems?.reputation}
									b={b.systems.reputation}
									aText={
										a?.systems
											? `${a.systems.reputation} · ${a.systems.reputationText}`
											: undefined
									}
									bText={`${b.systems.reputation} · ${b.systems.reputationText}`}
								/>
							) : null}
							<Row
								label="Salary per season"
								term="contract"
								aText={
									a
										? `${formatSalary(a.contract.amount)} thru ${a.contract.exp}`
										: undefined
								}
								bText={`${formatSalary(b.demand)} asking`}
							/>
							{a ? (
								<Row
									label="Buyout to fire him"
									term="buyout"
									aText={formatSalary(a.buyout)}
									bText="—"
								/>
							) : null}
							<Row
								label="Head coach record"
								aText={a ? recordText(a) : undefined}
								bText={recordText(b)}
							/>
							{b.systems ? (
								<Row
									label="Learned under"
									term="tree"
									aText={a?.systems?.mentor?.name ?? (a ? "—" : undefined)}
									bText={b.systems.mentor?.name ?? "—"}
								/>
							) : null}
						</tbody>
					</table>
				</div>
				{a ? (
					<div data-testid="coach-compare-verdict">
						{better.length > 0 ? (
							<div>
								<span className="text-success fw-bold">Better: </span>
								{better.join(", ")}.
							</div>
						) : null}
						{worse.length > 0 ? (
							<div>
								<span className="text-danger fw-bold">Worse: </span>
								{worse.join(", ")}.
							</div>
						) : null}
						{better.length === 0 && worse.length === 0 ? (
							<div>About even with {a.name}.</div>
						) : null}
					</div>
				) : null}
				{bo ? (
					<div className="small text-body-secondary mt-2">
						{sameSystems
							? "He runs the same systems, but a new head coach still has to install them: "
							: "A change of systems: "}
						they start {bo.installStart}% installed and take about half a season
						to be fully in.
					</div>
				) : null}
			</Modal.Body>
			<Modal.Footer>
				<button className="btn btn-secondary" onClick={onHide}>
					Close
				</button>
				<button
					className="btn btn-success"
					onClick={() => onHire(b)}
					data-testid="coach-compare-hire"
				>
					{a ? `Replace ${a.name}…` : `Hire ${b.name}…`}
				</button>
			</Modal.Footer>
		</Modal>
	);
};
