import { useId, useState, type ChangeEvent, type ReactNode } from "react";
import {
	AWARD_AUTOMATIC_TEXT,
	MAX_AWARD_STAT_COLS,
	awardStatColOptions,
	type AwardKeyStats,
} from "../../components/AwardKeyStats.tsx";
import { StatColsEditor } from "../../components/StatColsEditor.tsx";
import { bySport } from "../../../common/sportFunctions.ts";
import { HelpPopover } from "../../components/HelpPopover.tsx";
import {
	NOT_REAL_POSITIONS_AWARDS,
	POSITIONS,
	TEAM_AWARD_INFO,
} from "../../../common/constants.ts";
import { helpers } from "../../util/helpers.ts";
import type { InputAward } from "../AwardRaces.tsx";
import {
	awardSettingsSchema,
	type AwardInfoCommon,
	type AwardSettingIndividual,
	type AwardSettingTeam,
	type TeamSelection,
} from "../../../common/types.ts";
import { orderBy } from "../../../common/utils.ts";
import type { ZodError } from "zod";
import { Dropdown, DropdownButton } from "react-bootstrap";
import { POS_NUMBERS } from "../../../common/constants.baseball.ts";

const SUPPORT_OPOY_STUFF = __SPORT === "football";
const OPOY_FORMULA_NAME = "OPOY (including QB)";

// Team awards in BBGM can be filled by position (football, hockey and baseball team awards are always by position)
const SUPPORT_TEAM_SELECTION = __SPORT === "basketball";
const teamSelections: { key: TeamSelection | "default"; text: string }[] = [
	{ key: "default", text: "Default" },
	{ key: "none", text: "Positionless" },
	{ key: "oneGuard", text: "One guard" },
	{ key: "gfc", text: "Guards, forwards, center" },
];

type AwardSetting = AwardSettingIndividual | AwardSettingTeam;

export const awardSettingToEditingState = (award: AwardSetting) => {
	const group = award.group ?? "league";

	const common = {
		shortName: award.shortName,
		name: award.name,
		formula: award.formula,
		formulaByPos: award.formulaByPos ? { ...award.formulaByPos } : {},
		showByPos: !!award.formulaByPos,
		statRange: award.statRange ?? "regularSeason",
		showStats: award.showStats,
		group,
		bench: !!award.bench,
		mip: !!award.mip,
		rookie: !!award.rookie,
		advStats: !!award.advStats,
		// Stats shown, undefined for automatic
		statCols: (award.statCols ? [...award.statCols] : undefined) as
			| string[]
			| undefined,
	} as const;

	type ActAs = "mvp" | "roy" | "opoy" | "none";

	if (award.numTeams === undefined) {
		return {
			...common,
			type: "individual" as const,
			actAs:
				award.actAs ??
				((award.opoyFormula !== undefined ? "opoy" : "none") as ActAs),
			opoyFormula: award.opoyFormula ?? "",
			numTeams: "1",
			teamSelection: "default" as TeamSelection | "default",
		};
	}

	return {
		...common,
		type: "team" as const,
		actAs: "none" as ActAs,
		opoyFormula: "",
		numTeams: String(award.numTeams),
		teamSelection: (award.teamSelection ?? "default") as
			| TeamSelection
			| "default",
	};
};

// InputAward is an award setting plus the candidates for the award
export const awardToEditingState = (award: InputAward) => {
	const group =
		!award.group || award.group.type === "playoffSeries"
			? undefined
			: award.group.type;

	return awardSettingToEditingState({
		...award,
		group,
	});
};

export const awardsToEditingState = (groups: InputAward[][]) => {
	return groups
		.filter((awards) => awards.length > 0)
		.map((awards) => {
			return {
				awards,
				editing: awardToEditingState(awards[0]!),
			};
		});
};

export type EditingState = ReturnType<typeof awardSettingToEditingState>;

const editingStateToAward = (state: EditingState, index: number) => {
	const common: Omit<AwardInfoCommon, "group"> = {
		shortName: state.shortName,
		name: state.name,
		formula: state.formula,
		showStats: state.showStats,
	};

	const flags = ["bench", "mip", "rookie", "advStats"] as const;
	for (const flag of flags) {
		if (state[flag]) {
			common[flag] = true;
		}
	}

	if (state.statRange !== "regularSeason") {
		common.statRange = state.statRange;
	}

	if (state.statCols && state.statCols.length > 0) {
		common.statCols = [...state.statCols];
	}

	const errorMessages: { index: number; message: string }[] = [];

	let award: AwardSettingIndividual | AwardSettingTeam;
	if (state.type === "individual") {
		award = {
			...common,
		};

		if (state.actAs !== "none" && state.actAs !== "opoy") {
			award.actAs = state.actAs;
		}

		if (state.actAs === "opoy" && state.opoyFormula !== "") {
			award.opoyFormula = state.opoyFormula;
		}
	} else {
		let numTeams = Number.parseInt(state.numTeams);
		if (Number.isNaN(numTeams) || numTeams < 1) {
			// Annoying to encode this in awardSettingTeamSchema due to the union of team and individual awards. Could be done in awardSettingsSchema superRefine, but then we need to change the other schemas to explicitly allow NaN which is a bit weird. So maybe this is better?
			errorMessages.push({
				index,
				message: "numTeams must be an integer >= 1",
			});
			numTeams = 1;
		}

		award = {
			...common,
			numTeams,
		};
		if (SUPPORT_TEAM_SELECTION && state.teamSelection !== "default") {
			award.teamSelection = state.teamSelection;
		}
	}

	if (state.group === "conf" || state.group === "div") {
		// conf/div grouping does not make sense for playoff series awards
		if (typeof state.statRange !== "number") {
			award.group = state.group;
		}
	}

	if (state.showByPos) {
		const entries = Object.entries(state.formulaByPos).filter(
			(entry) => entry[1].trim() !== "",
		);
		if (entries.length > 0) {
			award.formulaByPos = {};
			for (const [pos, formula] of entries) {
				award.formulaByPos[pos] = formula;
			}
		}
	}

	return {
		award,
		errorMessages: errorMessages.length > 0 ? errorMessages : undefined,
	};
};

export const zodErrorsToErrorMessages = (error: ZodError<unknown>) => {
	return error.issues.map((error) => {
		const index = error.path[0] as any;
		return {
			index,
			message: error.message,
		};
	});
};

export const getUniqueErrorMessages = (
	errorMessages: { index: number; message: string }[],
	awards: { shortName: string }[],
) => {
	return Array.from(
		new Set(
			orderBy(errorMessages, "index", "asc").map(({ index, message }) => {
				const shortName = awards?.[index]?.shortName;
				let output = shortName !== undefined ? `${shortName}: ` : "";
				output += message;
				return output;
			}),
		),
	);
};

// Returns either the award settings, or error messages if they are not valid
export const editingStatesToAwards = (editingStates: EditingState[]) => {
	// Combine error messages from editingStateToAward and awardSettingsSchema
	const errorMessages: {
		index: number;
		message: string;
	}[] = [];
	const awards: AwardSetting[] = [];
	for (const [index, editing] of editingStates.entries()) {
		const { award, errorMessages: errorMessagesTemp } = editingStateToAward(
			editing,
			index,
		);
		awards.push(award);
		if (errorMessagesTemp) {
			errorMessages.push(...errorMessagesTemp);
		}
	}

	const result = awardSettingsSchema.safeParse(awards);
	if (result.success) {
		if (errorMessages.length === 0) {
			return {
				awards: result.data,
			};
		}
	} else {
		errorMessages.push(...zodErrorsToErrorMessages(result.error));
	}

	return {
		// Some error messages can be repeated, like if there are multiple duplicate abbrevs
		// Also sort in order of index (how they are displayed in UI)
		errorMessages: getUniqueErrorMessages(errorMessages, awards),
	};
};

export const EditSettings = ({
	canMoveDown,
	canMoveUp,
	disabled,
	keyStats,
	move,
	numGamesPlayoffSeries,
	playoffsByConf,
	remove,
	setState,
	state,
}: {
	canMoveDown: boolean;
	canMoveUp: boolean;
	disabled: boolean;

	// The saved award's key stats (the stats it can show and the automatic choice), for Stats shown
	keyStats?: AwardKeyStats;
	move: (direction: -1 | 1) => void;
	numGamesPlayoffSeries: number[];
	playoffsByConf: number | false;
	remove: () => void;
	setState: (state: EditingState) => void;
	state: EditingState;
}) => {
	const groups: {
		key: EditingState["group"];
		text: string;
	}[] = [
		{
			key: "league",
			text: "Leaguewide",
		},
		{
			key: "conf",
			text: "Conference",
		},
		{
			key: "div",
			text: "Division",
		},
	];

	const numPlayoffRounds = numGamesPlayoffSeries.length;

	const statRanges: {
		key: EditingState["statRange"];
		text: string;
	}[] = [
		{
			key: "regularSeason",
			text: "Regular season",
		},
		{
			key: "playoffs",
			text: "Playoffs",
		},
		{
			key: "combined",
			text: "Combined",
		},
		...numGamesPlayoffSeries.map((numGames, i) => {
			return {
				key: -(i + 1),
				text: helpers.upperCaseFirstLetter(
					helpers.playoffRoundName(
						numPlayoffRounds - i - 1,
						numPlayoffRounds,
						playoffsByConf,
					),
				),
			};
		}),
	];

	// Handle invalid statRange value, like if playoff size changed and a round is no longer valid
	if (!statRanges.some((row) => row.key === state.statRange)) {
		statRanges.push({
			key: state.statRange,
			text: "Invalid round",
		});
	}

	const showStatss: {
		key: EditingState["showStats"];
		text: string;
	}[] = bySport({
		baseball: [
			{ key: "overall", text: "Overall" },
			{ key: "sp", text: "Starting Pitching" },
			{ key: "rp", text: "Relief Pitching" },
			{ key: "offense", text: "Offense" },
			{ key: "defense", text: "Defense" },
		],
		basketball: [
			{ key: "offense", text: "Overall" },
			{ key: "defense", text: "Defense" },
		],
		football: [
			{ key: "overall", text: "Overall" },
			{ key: "defense", text: "Defense" },
			{ key: "blocking", text: "Blocking" },
		],
		hockey: [
			{ key: "overall", text: "Overall" },
			{ key: "defense", text: "Defense" },
			{ key: "goalkeeping", text: "Goalkeeping" },
		],
	});

	const actAss: {
		key: EditingState["actAs"];
		text: string;
	}[] = [
		{
			key: "mvp",
			text: "MVP",
		},
		{
			key: "roy",
			text: "ROY",
		},
		...(SUPPORT_OPOY_STUFF ? [{ key: "opoy", text: "OPOY" } as const] : []),
		{
			key: "none",
			text: "None",
		},
	];

	const flags: {
		key: "bench" | "mip" | "rookie" | "advStats";
		text: string;
		help: ReactNode;
		id: string;
	}[] = [
		{
			key: "rookie",
			text: "Rookie only",
			help: bySport({
				baseball:
					"Rookies are defined similar to MLB (130 AB or 50 IP, scaled for season length) except in the first season of a league with no historical data (such as a new league) where rookies are defined based on draft year.",
				default:
					"Rookies are defined based on the season they first played, except in the first season of a league with no historical data (such as a new league) where rookies are defined based on draft year.",
			}),
			id: useId(),
		},
		{
			key: "bench",
			text: "Bench only",
			help: 'Only players who came off the bench more than they started are eligible, similar to a "Sixth Man of the Year" award in basketball.',
			id: useId(),
		},
		{
			key: "mip",
			text: "Most Improved Player",
			help: (
				<>
					<p>
						If we call this award's formula <code>f(season)</code> and the score
						is normally calculated as <code>f(this season)</code>, then enabling
						this option makes the score{" "}
						<code>
							2*f(this season) - f(last season) - f(best previous season)
						</code>
						.
					</p>
					<p>
						This option also requires 1st round picks to be in their 3rd+ season
						after being drafted, since it's expected that top prospects will
						improve after their first year.
					</p>
				</>
			),
			id: useId(),
		},
	];
	const advStatsFlagId = useId();
	if (__SPORT === "basketball") {
		flags.push({
			key: "advStats",
			text: "Advanced Tracking Stats only",
			help: "Only given when Advanced Tracking Stats is on (League Extras), like the default Clutch Player of the Year. With the setting off the award is skipped.",
			id: advStatsFlagId,
		});
	}

	const [showStatCols, setShowStatCols] = useState(false);
	const actAsId = useId();
	const teamSelectionId = useId();
	const groupId = useId();
	const opoyId = useId();

	const changeHandler =
		<Key extends keyof EditingState>(
			key: Key,
			processValue?: (value: string) => EditingState[Key],
		) =>
		(event: ChangeEvent<HTMLInputElement | HTMLSelectElement>) => {
			const value =
				event.target instanceof HTMLInputElement &&
				event.target.type === "checkbox"
					? event.target.checked
					: processValue
						? processValue(event.target.value)
						: event.target.value;

			setState({
				...state,
				[key]: value,
			});
		};

	const positions = bySport({
		baseball: Object.keys(POS_NUMBERS),
		basketball: POSITIONS,
		football: POSITIONS,
		hockey: POSITIONS,
	});

	const isPlayoffSeriesAward = typeof state.statRange === "number";

	return (
		<div>
			<div className="d-flex gap-3">
				<label className="flex-grow-1">
					<div className="mb-1">Name</div>
					<input
						className="form-control"
						disabled={disabled}
						type="text"
						value={state.name}
						onChange={changeHandler("name")}
					/>
				</label>
				<label style={{ width: 100 }}>
					<div className="mb-1">Abbrev</div>
					<input
						className="form-control"
						disabled={disabled}
						type="text"
						value={state.shortName}
						onChange={changeHandler("shortName")}
					/>
				</label>
			</div>
			<label className="mt-2 d-flex align-items-center gap-3">
				<span>Formula</span>
				<div className="input-group">
					<input
						className="form-control"
						disabled={disabled}
						type="text"
						value={state.formula}
						onChange={changeHandler("formula")}
					/>
					{TEAM_AWARD_INFO.byPos ? (
						<button
							type="button"
							className="btn btn-secondary text-nowrap"
							disabled={disabled}
							title="By position"
							onClick={() => {
								setState({
									...state,
									showByPos: !state.showByPos,
								});
							}}
						>
							By pos
						</button>
					) : null}
				</div>
			</label>
			{state.showByPos ? (
				<>
					<div className="mt-2 d-flex align-items-center gap-2">
						<DropdownButton
							disabled={disabled}
							variant="secondary"
							title="Add position-specific formula"
						>
							{positions.map((pos) => {
								if (
									NOT_REAL_POSITIONS_AWARDS.has(pos) ||
									state.formulaByPos[pos] !== undefined
								) {
									return null;
								}

								return (
									<Dropdown.Item
										key={pos}
										onClick={() => {
											setState({
												...state,
												formulaByPos: {
													...state.formulaByPos,
													[pos]: "",
												},
											});
										}}
									>
										{pos}
									</Dropdown.Item>
								);
							})}
						</DropdownButton>
						<HelpPopover title="Position-specific formulas">
							<p>
								By default, the same formula is used for players at every
								position.
							</p>
							<p>
								If you want to override that formula for some positions, specify
								them here.
							</p>
							<p>
								For any other positions, or for any blank position-specific
								formulas, the main formula will be used.
							</p>
						</HelpPopover>
					</div>
					{positions.map((pos) => {
						const formula = state.formulaByPos[pos];
						if (formula === undefined) {
							return null;
						}

						return (
							<label key={pos} className="mt-2 d-flex align-items-center gap-3">
								<span className="text-end" style={{ minWidth: 47 }}>
									{pos}
								</span>
								<input
									className="form-control"
									disabled={disabled}
									type="text"
									value={formula}
									onChange={(event) => {
										setState({
											...state,
											formulaByPos: {
												...state.formulaByPos,
												[pos]: event.target.value,
											},
										});
									}}
								/>
								<button
									className="btn-close"
									disabled={disabled}
									onClick={() => {
										const formulaByPos = {
											...state.formulaByPos,
										};
										delete formulaByPos[pos];
										setState({
											...state,
											formulaByPos,
										});
									}}
									title={`Delete ${pos} formula`}
									type="button"
								></button>
							</label>
						);
					})}
				</>
			) : null}
			<div className="mt-2 d-flex flex-wrap gap-3">
				<div>
					<label className="mb-1" htmlFor={groupId}>
						Grouping
					</label>
					{isPlayoffSeriesAward ? (
						<HelpPopover title="Grouping" className="ms-1">
							<p>
								For playoff round awards, one award will be awarded for each
								series in that round. So 2 awards for the semifinals, 4 for the
								quarterfinals, etc.
							</p>
						</HelpPopover>
					) : null}
					<select
						id={groupId}
						className="form-select"
						disabled={disabled || isPlayoffSeriesAward}
						onChange={changeHandler("group")}
						value={state.group}
					>
						{isPlayoffSeriesAward ? (
							<option value={state.group}>Playoff series</option>
						) : (
							groups.map(({ key, text }) => (
								<option key={key} value={key}>
									{text}
								</option>
							))
						)}
					</select>
				</div>
				<label>
					<div className="mb-1">Range</div>
					<select
						className="form-select"
						disabled={disabled}
						onChange={changeHandler("statRange", (value) => {
							const newStatRange = (
								value.startsWith("-") ? Number.parseInt(value) : value
							) as EditingState["statRange"];
							return newStatRange;
						})}
						value={state.statRange}
					>
						{statRanges.map(({ key, text }) => (
							<option key={key} value={key}>
								{text}
							</option>
						))}
					</select>
				</label>
				<label>
					<div className="mb-1 text-nowrap">UI stats</div>
					<select
						className="form-select"
						disabled={disabled}
						onChange={changeHandler("showStats")}
						value={state.showStats}
					>
						{showStatss.map(({ key, text }) => (
							<option key={key} value={key}>
								{text}
							</option>
						))}
					</select>
				</label>
				<div className="text-nowrap">
					{flags.map(({ help, id, key, text }) => {
						return (
							<div key={key} className="form-check">
								<input
									className="form-check-input"
									disabled={disabled}
									id={id}
									type="checkbox"
									checked={state[key]}
									onChange={changeHandler(key)}
								/>
								<label className="form-check-label" htmlFor={id}>
									{text}
								</label>
								<HelpPopover className="ms-2" title={text}>
									{help}
								</HelpPopover>
							</div>
						);
					})}
				</div>
			</div>
			<div className="mt-1 d-flex gap-3 align-items-center">
				<div>
					<select
						className="form-select"
						disabled={disabled}
						onChange={changeHandler("type")}
						value={state.type}
					>
						<option value="individual">Individual award</option>
						<option value="team">Team award</option>
					</select>
				</div>
				{state.type === "individual" ? (
					<div>
						<label className="mb-1" htmlFor={actAsId}>
							Act as
						</label>
						<HelpPopover title="Act as" className="ms-1">
							<p>
								A few places in the UI rely on one award to be known as the
								"MVP" or "ROY" award. That can be any award, you just need to
								label it that way here.
							</p>
							<p>Specifically these places are:</p>
							<p>
								MVP: shows up on Draft History, draft class frivolities, and the
								Hall of Fame page.
								{SUPPORT_OPOY_STUFF
									? " In FBGM it also is used if you enable the OPOY formula for an award (see below)."
									: null}
							</p>
							<p>ROY: shows up on the Draft History page.</p>
							{SUPPORT_OPOY_STUFF ? (
								<>
									<p>
										OPOY: This enables "OPOY mode", see the help icon by "
										{OPOY_FORMULA_NAME}" for more info.
									</p>
								</>
							) : null}
						</HelpPopover>
						<select
							id={actAsId}
							className="form-select"
							disabled={disabled}
							onChange={changeHandler("actAs")}
							value={state.actAs}
						>
							{actAss.map(({ key, text }) => (
								<option key={key} value={key}>
									{text}
								</option>
							))}
						</select>
					</div>
				) : (
					<div>
						<label>
							<div className="mb-1"># teams</div>
							<input
								className="form-control"
								disabled={disabled}
								onChange={changeHandler("numTeams")}
								type="number"
								value={state.numTeams}
							/>
						</label>
					</div>
				)}
				{state.type === "team" && SUPPORT_TEAM_SELECTION ? (
					<div>
						<label className="mb-1" htmlFor={teamSelectionId}>
							Team selection
						</label>
						<HelpPopover title="Team selection" className="ms-1">
							<p>How the players on each team are picked.</p>
							<p>
								<b>Positionless:</b> the best scores, like the NBA since 2024.
							</p>
							<p>
								<b>One guard:</b> at least one guard (PG, SG or G) on every
								team.
							</p>
							<p>
								<b>Guards, forwards, center:</b> 2 guards, 2 forwards and a
								center on every team, like the NBA before 2024 (a GF can be a
								guard or a forward, an FC a forward or a center).
							</p>
							<p>
								<b>Default:</b> an All-Defensive award follows the league's
								Perimeter Defense setting "All-Defensive Teams by Position", any
								other team award is positionless.
							</p>
						</HelpPopover>
						<select
							id={teamSelectionId}
							className="form-select"
							disabled={disabled}
							onChange={changeHandler("teamSelection")}
							value={state.teamSelection}
						>
							{teamSelections.map(({ key, text }) => (
								<option key={key} value={key}>
									{text}
								</option>
							))}
						</select>
					</div>
				) : null}
				<button
					type="button"
					className="ms-auto btn btn-secondary"
					aria-label="Move up"
					title="Move up"
					disabled={disabled || !canMoveUp}
					onClick={() => {
						move(-1);
					}}
				>
					<span
						style={{ paddingRight: 2 }}
						className="glyphicon glyphicon-arrow-up"
					/>
				</button>
				<button
					type="button"
					className="btn btn-secondary"
					aria-label="Move down"
					title="Move down"
					disabled={disabled || !canMoveDown}
					onClick={() => {
						move(1);
					}}
				>
					<span
						style={{ paddingRight: 2 }}
						className="glyphicon glyphicon-arrow-down"
					/>
				</button>
				<button
					type="button"
					className="btn btn-danger"
					disabled={disabled}
					onClick={remove}
				>
					Delete
				</button>
			</div>
			{SUPPORT_OPOY_STUFF &&
			state.type === "individual" &&
			state.actAs === "opoy" ? (
				<div className="mt-2 d-flex align-items-center">
					<label className="flex-shrink-0" htmlFor={opoyId}>
						{OPOY_FORMULA_NAME}
					</label>
					<HelpPopover title="OPOY" className="ms-2">
						<p>
							The intended use case of "OPOY mode" is for you to write a normal
							formula that doesn't include QB stats (such as just rushing and
							receiving stats), and then in this special "{OPOY_FORMULA_NAME}"
							field, enter an alternative formula that also includes passing
							stats. Then, if a QB wins MVP, the "{OPOY_FORMULA_NAME}" formula
							will be applied to the MVP and and the OPOY leader, and if the
							MVP's score is 20% higher, the MVP will win OPOY too.
						</p>
						<p>
							I apologize that the OPOY stuff is complicated. OPOY is a weird
							award since usually the MVP is an offensive player, so OPOY should
							arguably always be the same player in those cases, but then it's
							kind of a redundant award. The method described above lets you use
							OPOY to mean "best non-QB offensive player, unless the QB had an
							exceptional season", which I think at least makes some sense.
							Great QBs will win MVPs, and rarely may even win OPOY too. Great
							RB/WR/TE will win OPOYs, and rarely may even win MVP too.
						</p>
					</HelpPopover>
					<input
						className="form-control ms-3"
						disabled={disabled}
						id={opoyId}
						type="text"
						value={state.opoyFormula}
						onChange={changeHandler("opoyFormula")}
					/>
				</div>
			) : null}
			{keyStats ? (
				<div className="mt-2">
					<button
						type="button"
						className="btn btn-link p-0"
						aria-expanded={showStatCols}
						onClick={() => {
							setShowStatCols(!showStatCols);
						}}
					>
						Stats shown:{" "}
						{state.statCols && state.statCols.length > 0
							? `Custom (${state.statCols.length})`
							: "Automatic"}
					</button>
					<HelpPopover title="Stats shown" className="ms-2">
						<p>
							The stat columns of this award on Award Races, Award History and
							the season summary.
						</p>
						<p>
							<b>Automatic:</b> the stats that move the formula's score the most
							among the players shown, padded with the award's usual stats.
						</p>
						<p>
							<b>Custom:</b> pick up to {MAX_AWARD_STAT_COLS} stats, in order.
							Stats the award can't show (like after changing its range to a
							playoff round) are skipped.
						</p>
						<p>
							The Columns menu on Award Races and Award History changes this
							setting too.
						</p>
					</HelpPopover>
					{showStatCols ? (
						<div className="border rounded p-2 mt-1">
							<StatColsEditor
								automaticText={AWARD_AUTOMATIC_TEXT}
								disabled={disabled}
								max={MAX_AWARD_STAT_COLS}
								onChange={(statCols) => {
									setState({
										...state,
										statCols,
									});
								}}
								options={awardStatColOptions(keyStats)}
								suggested={keyStats.suggested}
								value={state.statCols}
							/>
							<div className="small text-body-secondary mt-1">
								The stats offered and the automatic ones are from the saved
								formula and range, and update when you save.
							</div>
						</div>
					) : null}
				</div>
			) : null}
		</div>
	);
};
