import {
	DELEGATION_AREAS,
	DELEGATION_HELP,
	DELEGATION_NAMES,
	LINEUP_PRESET_NAMES,
	LINEUP_PRESETS,
	type CoachDelegation,
	type LineupPreset,
} from "../../../common/coachDecisions.ts";
import type { View } from "../../../common/types.ts";
import { toWorker } from "../../util/toWorker.ts";

const handleAutoSort = async () => {
	await toWorker("main", "autoSortRoster", undefined);
};

const handleResetPT = async () => {
	await toWorker("main", "resetPlayingTime", undefined);
};

// Coach Decisions: what the head coach decides (each area on its own), and the lineup for the next game
const CoachDecisionControls = ({
	coachDecisions,
	tid,
}: {
	coachDecisions: NonNullable<View<"roster">["coachDecisions"]>;
	tid: number;
}) => {
	const { delegation, preset, overrides, games, coachName, style } =
		coachDecisions;
	const setArea = async (area: keyof CoachDelegation, value: boolean) => {
		await toWorker("main", "updateCoachDelegation", {
			tid,
			delegation: { ...delegation, [area]: value },
		});
	};
	return (
		<div className="mt-2" data-testid="coach-decisions">
			<div className="d-flex flex-wrap align-items-center gap-3">
				<span className="text-body-secondary">
					{coachName ? `${coachName} decides:` : "Coach decides:"}
				</span>
				{DELEGATION_AREAS.map((area) => (
					<div
						className="form-check mb-0"
						key={area}
						title={DELEGATION_HELP[area]}
					>
						<input
							className="form-check-input"
							type="checkbox"
							checked={delegation[area]}
							id={`coach-decides-${area}`}
							onChange={() => setArea(area, !delegation[area])}
						/>
						<label
							className="form-check-label"
							htmlFor={`coach-decides-${area}`}
						>
							{DELEGATION_NAMES[area]}
						</label>
					</div>
				))}
			</div>
			<div className="d-flex flex-wrap align-items-center gap-2 mt-2">
				<label className="text-body-secondary mb-0" htmlFor="lineup-preset">
					Next game's lineup:
				</label>
				<select
					id="lineup-preset"
					className="form-select form-select-sm"
					style={{ width: "auto" }}
					value={preset}
					onChange={async (event) => {
						await toWorker("main", "updateLineupPreset", {
							tid,
							preset: event.target.value as LineupPreset | "coach",
						});
					}}
				>
					<option value="coach">Coach's choice</option>
					{LINEUP_PRESETS.map((key) => (
						<option key={key} value={key}>
							{LINEUP_PRESET_NAMES[key]}
						</option>
					))}
				</select>
				{style ? (
					<span className="small text-body-secondary">{style}.</span>
				) : null}
			</div>
			{games >= 10 && overrides / games >= 0.35 ? (
				<div className="small text-warning-emphasis mt-1">
					You have overruled your coach's lineup in {overrides} of {games} games
					this season. He'd like more say.
				</div>
			) : null}
		</div>
	);
};

const InstructionsAndSortButtons = ({
	coachDecisions,
	keepRosterSorted,
	editable,
	tid,
}: Pick<View<"roster">, "coachDecisions" | "editable" | "tid"> & {
	keepRosterSorted: boolean;
}) => {
	return (
		<>
			{editable ? (
				<div className="mb-3">
					<div className="d-flex flex-wrap gap-2">
						{editable ? (
							<>
								<button
									className="btn btn-secondary"
									onClick={handleAutoSort}
									title="Your head coach sets the starters and the rotation order"
								>
									Let coach decide
								</button>
								<button className="btn btn-secondary" onClick={handleResetPT}>
									Reset playing time
								</button>
							</>
						) : null}
					</div>
					{editable ? (
						<div className="form-check mt-2">
							<input
								className="form-check-input"
								type="checkbox"
								checked={keepRosterSorted}
								id="ai-sort-user-roster"
								onChange={async () => {
									if (!keepRosterSorted) {
										await handleAutoSort();
									}
									await toWorker("main", "updateKeepRosterSorted", {
										tid,
										keepRosterSorted: !keepRosterSorted,
									});
								}}
							/>
							<label className="form-check-label" htmlFor="ai-sort-user-roster">
								Always let coach decide
							</label>
						</div>
					) : null}
					{editable && coachDecisions ? (
						<CoachDecisionControls coachDecisions={coachDecisions} tid={tid} />
					) : null}
				</div>
			) : null}
		</>
	);
};

export default InstructionsAndSortButtons;
