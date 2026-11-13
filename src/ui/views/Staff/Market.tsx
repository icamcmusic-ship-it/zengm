// Hiring: the available coaches for one job, with recommendations, filters and a sortable table
import { useState } from "react";
import { DataTable } from "../../components/DataTable/index.tsx";
import type { DataTableRow } from "../../components/DataTable/index.tsx";
import {
	CoachLink,
	CoachPortrait,
	Term,
	formatSalary,
} from "../../components/CoachUi.tsx";
import {
	COACH_ROLE_INFO,
	COACH_TERMS,
	ratingWord,
	roleNoun,
} from "../../../common/staffText.ts";
import { DEFENSE_NAMES, OFFENSE_NAMES } from "../../../common/coachSystems.ts";
import type { Col } from "../../components/DataTable/index.tsx";
import type { CoachRole, View } from "../../../common/types.ts";
import type { Candidate, Head, StaffCoach } from "./CompareModal.tsx";

const TAG_COLORS: Record<string, string> = {
	"Best overall": "primary",
	"Best fit": "success",
	"Best developer": "info",
	"Best tactician": "warning",
	"Top reputation": "secondary",
};

export const TagBadges = ({ tags }: { tags: string[] }) => (
	<>
		{tags.map((tag) => (
			<span
				key={tag}
				className={`badge text-bg-${TAG_COLORS[tag] ?? "secondary"} ms-1`}
			>
				{tag}
			</span>
		))}
	</>
);

const numberCol = (title: string, desc: string): Col => ({
	title,
	desc,
	sortSequence: ["desc", "asc"],
	sortType: "number",
});

export const Market = ({
	candidates,
	coachSystems,
	colors,
	head,
	level,
	onCompare,
	onHire,
	role,
	setRole,
	slots,
}: {
	candidates: View<"staff">["candidates"];
	coachSystems: boolean;
	colors: [string, string, string] | undefined;
	head: Head | undefined;
	level: number;
	onCompare: (candidate: Candidate) => void;
	onHire: (candidate: Candidate) => void;
	role: CoachRole;
	setRole: (role: CoachRole) => void;
	slots: View<"staff">["slots"];
}) => {
	const [offense, setOffense] = useState("");
	const [defense, setDefense] = useState("");
	const [onlyBetter, setOnlyBetter] = useState(false);
	const [onlyTagged, setOnlyTagged] = useState(false);

	const slot = slots.find((s) => s.role === role)!;
	const current: StaffCoach | undefined = slot.coach;
	const showSystems = coachSystems && role === "head";
	const list = candidates[role];

	const filtered = list.filter(
		(c) =>
			(!showSystems ||
				((offense === "" || c.systems?.offenseKey === offense) &&
					(defense === "" || c.systems?.defenseKey === defense))) &&
			(!onlyBetter || !current || c.ovr > current.ovr) &&
			(!onlyTagged || c.tags.length > 0),
	);

	const tagged = list.filter((c) => c.tags.length > 0);

	const cols: Col[] = [
		{ title: "Coach", sortType: "name" },
		{ title: "Age", sortType: "number" },
		numberCol("Ovr", `Overall as ${slot.roleName}. ${COACH_TERMS.ovr.text}`),
		numberCol("Dev", "Player development rating"),
		numberCol("Off", "Offense rating"),
		numberCol("Def", "Defense rating"),
		numberCol("Mot", "Motivation rating"),
		...(showSystems
			? [
					{ title: "Offense", desc: COACH_TERMS.systems.text } as Col,
					{ title: "Defense", desc: COACH_TERMS.systems.text } as Col,
					numberCol(
						"Fit",
						`Scheme fit with your roster. ${COACH_TERMS.fit.text}`,
					),
					numberCol("Rep", `Reputation. ${COACH_TERMS.reputation.text}`),
				]
			: [{ title: "Style" } as Col]),
		numberCol(
			"Dev Lvl",
			`Your development level with him in this job (now ${level}). ${COACH_TERMS.devLevel.text}`,
		),
		numberCol("Asking", "Salary per season he asks for"),
		...(role === "head"
			? [
					{
						title: "HC Record",
						desc: "Career record as a head coach",
						sortType: "record",
					} as Col,
				]
			: []),
		{ title: "", noSearch: true, sortSequence: [] },
	];

	const rows: DataTableRow[] = filtered.map((c) => ({
		key: c.cid,
		data: [
			{
				value: (
					<span className="text-nowrap">
						<CoachLink cid={c.cid} name={c.name} />
						<TagBadges tags={c.tags} />
					</span>
				),
				sortValue: c.name,
				searchValue: `${c.name} ${c.tags.join(" ")}`,
			},
			c.age,
			{
				value: (
					<span title={ratingWord(c.ovr)}>
						<b>{c.ovr}</b>
						{current ? (
							<span
								className={`small ms-1 ${c.ovr > current.ovr ? "text-success" : c.ovr < current.ovr ? "text-danger" : "text-body-secondary"}`}
							>
								({c.ovr > current.ovr ? "+" : ""}
								{c.ovr - current.ovr})
							</span>
						) : null}
					</span>
				),
				sortValue: c.ovr,
				searchValue: c.ovr,
			},
			c.ratings.dev,
			c.ratings.off,
			c.ratings.def,
			c.ratings.mot,
			...(showSystems
				? [
						c.systems?.offense ?? "",
						c.systems?.defense ?? "",
						{
							value: c.outlook ? (
								<span title={c.outlook.fitText}>
									{c.outlook.fit}
									{head ? (
										<span
											className={`small ms-1 ${c.outlook.fit > head.fit ? "text-success" : c.outlook.fit < head.fit ? "text-danger" : "text-body-secondary"}`}
										>
											({c.outlook.fit > head.fit ? "+" : ""}
											{c.outlook.fit - head.fit})
										</span>
									) : null}
								</span>
							) : null,
							sortValue: c.outlook?.fit ?? null,
							searchValue: c.outlook?.fit ?? "",
						},
						c.systems?.reputation ?? null,
					]
				: [c.styleText]),
			{
				value: (
					<span
						className={
							c.levelIfHired > level
								? "text-success"
								: c.levelIfHired < level
									? "text-danger"
									: undefined
						}
					>
						{c.levelIfHired}
					</span>
				),
				sortValue: c.levelIfHired,
				searchValue: c.levelIfHired,
			},
			{
				value: formatSalary(c.demand),
				sortValue: c.demand,
				searchValue: formatSalary(c.demand),
			},
			...(role === "head"
				? [c.headSeasons > 0 ? `${c.headWon}-${c.headLost}` : ""]
				: []),
			{
				value: (
					<div className="btn-group text-nowrap">
						<button
							className="btn btn-sm btn-light-bordered"
							onClick={() => onCompare(c)}
							data-testid="candidate-compare"
						>
							Compare
						</button>
						<button
							className="btn btn-sm btn-success"
							onClick={() => onHire(c)}
							data-testid="candidate-hire"
						>
							{current ? "Replace" : "Hire"}
						</button>
					</div>
				),
				sortValue: null,
				searchValue: "",
			},
		],
	}));

	return (
		<div data-testid="coach-market">
			<div className="d-flex flex-wrap gap-2 mb-2 align-items-center">
				<div className="btn-group flex-wrap" role="group" aria-label="Job">
					{slots.map(({ role: r }) => {
						const s = slots.find((x) => x.role === r)!;
						return (
							<button
								key={r}
								className={`btn btn-sm ${role === r ? "btn-primary" : "btn-light-bordered"}`}
								onClick={() => setRole(r)}
							>
								{s.roleName}
								{!s.coach ? " (vacant)" : ""}
							</button>
						);
					})}
				</div>
			</div>
			<p className="mb-2">
				{COACH_ROLE_INFO[role][coachSystems ? "doesSystems" : "does"]}{" "}
				{current ? (
					<>
						Your {roleNoun(role)} is <b>{current.name}</b> (overall{" "}
						{current.ovr}, {ratingWord(current.ovr).toLowerCase()}). The numbers
						in brackets compare each candidate with him.
					</>
				) : (
					<span className="text-danger">
						This job is vacant. If it is still open in the preseason, a coach is
						hired for you.
					</span>
				)}
			</p>

			{tagged.length > 0 ? (
				<div className="mb-3" data-testid="coach-recommendations">
					<div className="mb-1">
						<Term term="recommendation">
							<b>Recommended</b>
						</Term>
					</div>
					<div className="d-flex flex-wrap gap-2">
						{tagged.map((c) => (
							<button
								key={c.cid}
								className="btn btn-light-bordered text-start d-flex align-items-center gap-2 p-1 pe-2"
								onClick={() => onCompare(c)}
							>
								<CoachPortrait
									face={c.face}
									colors={colors}
									age={c.age}
									seed={c.cid}
									width={36}
								/>
								<span>
									<span className="d-block">
										{c.name}{" "}
										<span className="text-body-secondary">({c.ovr} ovr)</span>
									</span>
									<span className="d-block" style={{ marginLeft: -4 }}>
										<TagBadges tags={c.tags} />
									</span>
								</span>
							</button>
						))}
					</div>
				</div>
			) : null}

			<div className="d-flex flex-wrap gap-3 mb-2 align-items-center">
				{showSystems ? (
					<>
						<select
							className="form-select form-select-sm w-auto"
							value={offense}
							onChange={(event) => setOffense(event.target.value)}
							aria-label="Offense system"
						>
							<option value="">Any offense</option>
							{Object.entries(OFFENSE_NAMES).map(([key, name]) => (
								<option key={key} value={key}>
									{name}
								</option>
							))}
						</select>
						<select
							className="form-select form-select-sm w-auto"
							value={defense}
							onChange={(event) => setDefense(event.target.value)}
							aria-label="Defense system"
						>
							<option value="">Any defense</option>
							{Object.entries(DEFENSE_NAMES).map(([key, name]) => (
								<option key={key} value={key}>
									{name}
								</option>
							))}
						</select>
					</>
				) : null}
				{current ? (
					<div className="form-check mb-0">
						<input
							className="form-check-input"
							type="checkbox"
							id="staff-only-better"
							checked={onlyBetter}
							onChange={() => setOnlyBetter(!onlyBetter)}
						/>
						<label className="form-check-label" htmlFor="staff-only-better">
							Better than {current.name}
						</label>
					</div>
				) : null}
				<div className="form-check mb-0">
					<input
						className="form-check-input"
						type="checkbox"
						id="staff-only-tagged"
						checked={onlyTagged}
						onChange={() => setOnlyTagged(!onlyTagged)}
					/>
					<label className="form-check-label" htmlFor="staff-only-tagged">
						Recommended only
					</label>
				</div>
				<span className="text-body-secondary">
					{filtered.length} of {list.length} candidates
				</span>
			</div>

			<DataTable
				cols={cols}
				defaultSort={[2, "desc"]}
				defaultStickyCols={window.mobile ? 0 : 1}
				name={`Staff:Candidates:${role}:${showSystems ? "s" : "n"}`}
				pagination
				rows={rows}
			/>
		</div>
	);
};
