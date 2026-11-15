import { useEffect, useState } from "react";
import useTitleBar from "../hooks/useTitleBar.tsx";
import type { View } from "../../common/types.ts";
import {
	EMPHASIS_HINTS,
	EMPHASIS_KEYS,
	EMPHASIS_NAMES,
	type Emphasis,
	type EmphasisMode,
	emphasisFit,
	fitLabel,
	nearestPreset,
	PRESET_KEYS,
	PRESET_NAMES,
	PRESETS,
} from "../../common/offEmphasis.ts";
import { OFFENSE_NAMES } from "../../common/coachSystems.ts";
import { helpers } from "../util/helpers.ts";
import { toWorker } from "../util/toWorker.ts";

const MODES: { key: EmphasisMode; name: string; title: string }[] = [
	{ key: "auto", name: "Auto", title: "The head coach sets it" },
	{
		key: "suggest",
		name: "Suggest",
		title: "The head coach proposes, you approve",
	},
	{ key: "manual", name: "Manual", title: "You set it" },
];

const signed = (x: number, digits = 1) => {
	const r = Number(x.toFixed(digits));
	return `${r > 0 ? "+" : r < 0 ? "−" : ""}${Math.abs(r).toFixed(digits)}`;
};

const fitClass = (fit: number) =>
	fit >= 0.35 ? "text-success" : fit <= -0.2 ? "text-danger" : "";

const DialTable = ({
	e,
	other,
	otherName,
}: {
	e: Emphasis;
	other: Emphasis;
	otherName: string;
}) => (
	<table className="table table-sm mb-0 small">
		<thead>
			<tr>
				<th>Dial</th>
				<th className="text-end">Now</th>
				<th className="text-end">{otherName}</th>
			</tr>
		</thead>
		<tbody>
			{EMPHASIS_KEYS.map((key) => (
				<tr key={key}>
					<td>{EMPHASIS_NAMES[key]}</td>
					<td className="text-end">{signed(e[key], 2)}</td>
					<td className="text-end">{signed(other[key], 2)}</td>
				</tr>
			))}
		</tbody>
	</table>
);

const OffEmphasis = ({
	season,
	mode,
	e,
	suggested,
	auto,
	strengths,
	fit,
	autoFit,
	coachSystem,
	mix,
	recommendation,
}: View<"offEmphasis">) => {
	useTitleBar({ title: `${season} Offensive Emphasis` });
	const [draft, setDraft] = useState<Emphasis>(e);
	useEffect(() => {
		setDraft(e);
	}, [e]);
	const draftFit = emphasisFit(draft, strengths);
	const dirty = EMPHASIS_KEYS.some((key) => draft[key] !== e[key]);

	return (
		<>
			<p>
				How your offense leans: more of some play types, less of others. The
				game sim runs your dials (each play type's share moves up to about 30%,
				pace about 3%), and fitting them to what your roster does well helps a
				little, while leaning into its weaknesses hurts a little.{" "}
				<a href={helpers.leagueUrl(["staff_report"])}>Staff Report</a>
			</p>

			<div className="card mb-3" data-testid="offense-mode">
				<div className="card-body">
					<div className="d-flex flex-wrap align-items-center gap-2">
						<span className="fw-bold">Who sets it</span>
						<div className="btn-group btn-group-sm" role="group">
							{MODES.map((m) => (
								<button
									key={m.key}
									title={m.title}
									className={`btn ${mode === m.key ? "btn-primary" : "btn-light-bordered"}`}
									onClick={() =>
										toWorker("main", "offEmphasisAction", { mode: m.key })
									}
								>
									{m.name}
								</button>
							))}
						</div>
					</div>
					<div className="small text-body-secondary mt-2">
						Head coach's system:{" "}
						{coachSystem
							? ((OFFENSE_NAMES as Record<string, string>)[coachSystem] ??
								coachSystem)
							: "none"}
						. His choice for this roster is closest to{" "}
						<b>{PRESET_NAMES[nearestPreset(auto)]}</b> (
						<span className={fitClass(autoFit)}>
							{fitLabel(autoFit).toLowerCase()}
						</span>
						). Your current dials: <b>{PRESET_NAMES[nearestPreset(e)]}</b>-like,{" "}
						<span className={fitClass(fit)}>{fitLabel(fit).toLowerCase()}</span>
						.
					</div>
					{recommendation ? (
						<div
							className="border-start border-3 border-primary ps-2 mt-2 small"
							data-testid="offense-rec"
						>
							{recommendation}
						</div>
					) : null}
				</div>
			</div>

			{mode === "suggest" && suggested ? (
				<div className="card mb-3" data-testid="offense-suggestion">
					<div className="card-header fw-bold">
						The coach proposes: {PRESET_NAMES[nearestPreset(suggested)]} (
						{fitLabel(emphasisFit(suggested, strengths)).toLowerCase()})
					</div>
					<div className="card-body">
						<DialTable e={e} other={suggested} otherName="Proposal" />
						<button
							className="btn btn-sm btn-primary mt-2"
							onClick={() =>
								toWorker("main", "offEmphasisAction", {
									acceptSuggestion: true,
								})
							}
						>
							Accept
						</button>
					</div>
				</div>
			) : null}

			<div className="row g-3">
				<div className="col-12 col-lg-7">
					<div className="card h-100" data-testid="offense-dials">
						<div className="card-header fw-bold d-flex flex-wrap justify-content-between gap-2">
							<span>Dials</span>
							<span className={`small fw-normal ${fitClass(draftFit)}`}>
								Fit: {fitLabel(draftFit)} ({signed(draftFit, 2)})
							</span>
						</div>
						<div className="card-body">
							<div className="d-flex flex-wrap gap-1 mb-3">
								{PRESET_KEYS.map((key) => (
									<button
										key={key}
										className="btn btn-sm btn-light-bordered"
										onClick={() => setDraft(PRESETS[key])}
									>
										{PRESET_NAMES[key]}
									</button>
								))}
								<button
									className="btn btn-sm btn-light-bordered"
									title="The head coach's choice for this roster"
									onClick={() => setDraft(auto)}
								>
									Coach's choice
								</button>
							</div>
							{EMPHASIS_KEYS.map((key) => (
								<div key={key} className="mb-2">
									<div className="d-flex justify-content-between small">
										<label className="fw-bold" htmlFor={`oe-${key}`}>
											{EMPHASIS_NAMES[key]}
										</label>
										<span>
											{signed(draft[key], 2)} · roster{" "}
											<span
												className={
													strengths[key] >= 0.5
														? "text-success"
														: strengths[key] <= -0.5
															? "text-danger"
															: ""
												}
											>
												{signed(strengths[key])} SD
											</span>
										</span>
									</div>
									<input
										id={`oe-${key}`}
										type="range"
										className="form-range"
										min={-100}
										max={100}
										step={5}
										value={Math.round(draft[key] * 100)}
										onChange={(event) =>
											setDraft({
												...draft,
												[key]: Number(event.target.value) / 100,
											})
										}
									/>
									<div className="d-flex justify-content-between small text-body-secondary">
										<span>{EMPHASIS_HINTS[key][0]}</span>
										<span className="text-end">{EMPHASIS_HINTS[key][1]}</span>
									</div>
								</div>
							))}
							<div className="d-flex gap-2 mt-3">
								<button
									className="btn btn-primary"
									disabled={!dirty}
									onClick={() =>
										toWorker("main", "offEmphasisAction", { e: draft })
									}
								>
									Save{mode === "auto" ? " (switches to Manual)" : ""}
								</button>
								<button
									className="btn btn-light-bordered"
									disabled={!dirty}
									onClick={() => setDraft(e)}
								>
									Reset
								</button>
							</div>
						</div>
					</div>
				</div>
				<div className="col-12 col-lg-5">
					<div className="card h-100" data-testid="offense-mix">
						<div className="card-header fw-bold">This season's play types</div>
						<div className="card-body p-0">
							{mix ? (
								<div className="table-responsive">
									<table className="table table-sm mb-0 small">
										<thead>
											<tr>
												<th>Play type</th>
												<th className="text-end">Freq</th>
												<th className="text-end">League</th>
												<th className="text-end">PPP</th>
												<th className="text-end">League</th>
											</tr>
										</thead>
										<tbody>
											{mix.team
												.filter((row) => row.key !== "misc")
												.map((row, i) => {
													const lg = mix.league[i]!;
													return (
														<tr key={row.key}>
															<td>{row.name}</td>
															<td className="text-end">
																{row.freq.toFixed(1)}%
															</td>
															<td className="text-end text-body-secondary">
																{lg.freq.toFixed(1)}%
															</td>
															<td
																className={`text-end ${row.poss >= 60 && row.ppp - lg.ppp >= 0.05 ? "text-success" : row.poss >= 60 && row.ppp - lg.ppp <= -0.05 ? "text-danger" : ""}`}
															>
																{row.ppp.toFixed(2)}
															</td>
															<td className="text-end text-body-secondary">
																{lg.ppp.toFixed(2)}
															</td>
														</tr>
													);
												})}
										</tbody>
									</table>
								</div>
							) : (
								<p className="p-3 mb-0 small text-body-secondary">
									No games yet this season, or Advanced Tracking Stats is off.
								</p>
							)}
						</div>
					</div>
				</div>
			</div>
		</>
	);
};

export default OffEmphasis;
