// Award Settings: the Coach of the Year and Executive of the Year formulas (built in, League Extra coachExecAwards). They're edited and
// saved on their own, apart from the player awards list
import { useEffect, useState } from "react";
import {
	COACH_EXEC_AWARD_NAMES,
	type CoachExecAwardFormulas,
	type CoachExecAwardKind,
} from "../../../common/coachExecAwards.ts";
import { toWorker } from "../../util/toWorker.ts";
import { showNotification } from "../../util/showNotification.ts";
import {
	COACH_EXEC_AUTOMATIC_TEXT,
	CoachExecRaceTable,
	coachExecStatColOptions,
} from "../../components/CoachExecAwards.tsx";
import { StatColsEditor } from "../../components/StatColsEditor.tsx";
import { ActionButton } from "../../components/ActionButton.tsx";

type Info = Awaited<
	ReturnType<
		typeof import("../../../worker/api/awardSettings.ts").getCoachExecAwardSettings
	>
>;

const KINDS = ["coy", "eoy"] as const;

export const CoachExecAwardSettings = ({ season }: { season: number }) => {
	const [info, setInfo] = useState<Info | undefined>();
	const [formulas, setFormulas] = useState<CoachExecAwardFormulas>({});
	const [status, setStatus] = useState<"loading" | "saving" | "idle">(
		"loading",
	);

	const load = async (edited?: CoachExecAwardFormulas) => {
		setStatus("loading");
		try {
			const newInfo = await toWorker(
				"awardSettings",
				"getCoachExecAwardSettings",
				{ season, formulas: edited },
			);
			setInfo(newInfo);
			if (!edited) {
				setFormulas(newInfo.formulas);
			}
		} finally {
			setStatus("idle");
		}
	};

	useEffect(() => {
		void load();
		// eslint-disable-next-line react-hooks/exhaustive-deps
	}, [season]);

	if (!info) {
		return null;
	}

	const kinds = KINDS.filter((kind) => info.available[kind]);
	if (kinds.length === 0) {
		return null;
	}

	return (
		<form
			className="mt-4"
			onSubmit={async (event) => {
				event.preventDefault();
				setStatus("saving");
				try {
					await toWorker(
						"awardSettings",
						"saveCoachExecAwardFormulas",
						formulas,
					);
					showNotification({
						type: "success",
						text: "Coach of the Year and Executive of the Year formulas saved.",
					});
					await load();
				} catch (error) {
					showNotification({
						type: "error",
						text: error.message,
					});
				} finally {
					setStatus("idle");
				}
			}}
		>
			<h2>Coach &amp; Executive of the Year</h2>
			<p>
				These built-in awards are given after the playoffs with the others. A
				head coach who coached at least half of his team's games can win Coach
				of the Year; every team's front office (its general manager, or you) can
				win Executive of the Year. The highest score wins (ties go to the better
				record). Each formula can use these variables:
			</p>
			<div className="row">
				{kinds.map((kind: CoachExecAwardKind) => {
					const race = info.races.find((row) => row.kind === kind);
					const error = info.errors[kind];
					return (
						<div key={kind} className="col-12 col-xl-6 mb-3">
							<h3>{COACH_EXEC_AWARD_NAMES[kind]}</h3>
							<ul className="small mb-2">
								{info.variables[kind].map((variable) => (
									<li key={variable}>
										<code>{variable}</code>: {info.variableDocs[variable]}
									</li>
								))}
							</ul>
							<label className="form-label" htmlFor={`coach-exec-${kind}`}>
								Formula
							</label>
							<textarea
								id={`coach-exec-${kind}`}
								className={`form-control font-monospace${error ? " is-invalid" : ""}`}
								rows={3}
								value={formulas[kind] ?? ""}
								disabled={status === "saving"}
								onChange={(event) => {
									const value = event.target.value;
									setFormulas((old) => ({ ...old, [kind]: value }));
								}}
							/>
							{error ? <div className="invalid-feedback">{error}</div> : null}
							<div className="d-flex gap-2 mt-2 mb-2">
								<button
									type="button"
									className="btn btn-secondary btn-sm"
									disabled={status !== "idle"}
									onClick={() => {
										void load(formulas);
									}}
								>
									Preview
								</button>
								<button
									type="button"
									className="btn btn-light-bordered btn-sm"
									disabled={status !== "idle"}
									onClick={() => {
										const newFormulas = {
											...formulas,
											[kind]: info.defaults[kind],
										};
										setFormulas(newFormulas);
										void load(newFormulas);
									}}
								>
									Reset to default
								</button>
							</div>
							<div className="mb-2">
								<div className="mb-1">Stats shown</div>
								<StatColsEditor
									automaticText={COACH_EXEC_AUTOMATIC_TEXT}
									disabled={status === "saving"}
									max={info.variables[kind].length}
									onChange={(value) => {
										const newFormulas = {
											...formulas,
											statCols: { ...formulas.statCols, [kind]: value },
										};
										setFormulas(newFormulas);
										void load(newFormulas);
									}}
									options={coachExecStatColOptions(info.variables[kind])}
									suggested={info.variables[kind]}
									value={formulas.statCols?.[kind]}
								/>
							</div>
							{race ? (
								<CoachExecRaceTable
									preview
									race={race}
									season={season}
									title={<h4>Preview, {season}</h4>}
								/>
							) : null}
						</div>
					);
				})}
			</div>
			<ActionButton
				type="submit"
				variant="primary"
				disabled={status === "loading"}
				processing={status === "saving"}
				processingText="Saving"
			>
				Save formulas
			</ActionButton>
		</form>
	);
};
