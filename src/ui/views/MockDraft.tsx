import { useCallback, useEffect, useRef, useState } from "react";
import { ScoutingHoverIcon } from "../components/ScoutingReport/index.tsx";
import { DraftClassShape } from "../components/DraftClassShape.tsx";
import useTitleBar from "../hooks/useTitleBar.tsx";
import type { View } from "../../common/types.ts";
import { helpers } from "../util/helpers.ts";
import { useLocal } from "../util/local.ts";
import { toWorker } from "../util/toWorker.ts";
import {
	ProjectionCells,
	verdictClass,
	type ProProjectionData,
} from "../components/ProProjection.tsx";
import { PHASE } from "../../common/constants.ts";

type MockResult = Awaited<ReturnType<typeof runMock>>;
const runMock = () => toWorker("main", "runMockDraft", undefined);

const BATCH = 6;

const SOURCES = {
	draftOrder: "the league's draft order",
	lotteryProjection:
		"a simulated draft lottery (rerun for another lottery draw)",
	records: "worst record first",
} as const;

const MockDraft = ({ season, phase, shape, userTids }: View<"mockDraft">) => {
	useTitleBar({ title: `${season} Mock Draft` });

	const [result, setResult] = useState<MockResult | undefined>();
	const [running, setRunning] = useState(false);
	const [projections, setProjections] = useState<
		Record<number, ProProjectionData>
	>({});
	const [progress, setProgress] = useState<[number, number] | undefined>();
	const runId = useRef(0);
	const { challengeNoRatings } = useLocal(["challengeNoRatings"]);

	const run = useCallback(async () => {
		const id = ++runId.current;
		setRunning(true);
		const mock = await runMock();
		if (id !== runId.current) {
			return;
		}
		setResult(mock);
		setRunning(false);

		if (!("picks" in mock)) {
			return;
		}
		// Projections in small batches, so the table fills in with progress (cached in the worker after the first run)
		const pids = (mock.picks ?? []).map((pick) => pick.pid);
		const done: Record<number, ProProjectionData> = {};
		setProgress([0, pids.length]);
		for (let i = 0; i < pids.length; i += BATCH) {
			const batch = await toWorker(
				"main",
				"getProProjections",
				pids.slice(i, i + BATCH),
			);
			if (id !== runId.current) {
				return;
			}
			Object.assign(done, batch);
			setProjections({ ...done });
			setProgress([Math.min(i + BATCH, pids.length), pids.length]);
		}
		setProgress(undefined);
	}, []);

	useEffect(() => {
		run();
	}, [run, season, phase]);

	if (result && "message" in result) {
		return <p>{result.message}</p>;
	}

	const picks = result?.picks ?? [];

	return (
		<>
			{shape ? <DraftClassShape shape={shape} /> : null}
			<p>
				Every team picks the way the AI drafts: by value plus its own needs and
				strategy
				{result && !result.useNeeds
					? " (need-based drafting is off in League Extras, so value only)"
					: ""}
				, with a little randomness. Pick order:{" "}
				{result ? SOURCES[result.source] : "…"}. Pick protections and swaps are
				applied. Pro projections are simulated careers from the ratings your
				scouts see.
			</p>
			<div className="d-flex align-items-center gap-3 mb-3 flex-wrap">
				<button className="btn btn-primary" disabled={running} onClick={run}>
					{running ? "Drafting…" : "Rerun mock draft"}
				</button>
				{progress ? (
					<div style={{ width: 200 }}>
						<div className="small text-body-secondary">
							Simulating careers {progress[0]}/{progress[1]}
						</div>
						<div className="progress" style={{ height: 6 }}>
							<div
								className="progress-bar"
								style={{ width: `${(100 * progress[0]) / progress[1]}%` }}
							/>
						</div>
					</div>
				) : null}
				{phase === PHASE.DRAFT ? (
					<span className="text-body-secondary">
						Remaining picks of the draft in progress.
					</span>
				) : null}
			</div>
			{result && picks.length === 0 ? (
				<p>No picks or no prospects to mock.</p>
			) : null}
			{picks.length > 0 ? (
				<div className="table-responsive">
					<table className="table table-sm table-hover table-nonfluid mock-draft">
						<thead>
							<tr>
								<th>Pick</th>
								<th>Team</th>
								<th>Player</th>
								<th>Pos</th>
								<th>Age</th>
								{challengeNoRatings ? null : (
									<>
										<th>Ovr</th>
										<th>Pot</th>
									</>
								)}
								<th title="Rank on your scouting list">Board</th>
								<th>Why</th>
								{challengeNoRatings ? null : (
									<th title="Projected peak ovr (10th-90th percentile)">
										Peak
									</th>
								)}
								<th>Star</th>
								<th>Starter</th>
								<th>Bust</th>
								<th>Outlook</th>
							</tr>
						</thead>
						<tbody>
							{picks.map((pick, i) => {
								const mine = userTids.includes(pick.tid);
								const projection = projections[pick.pid];
								return (
									<tr
										key={pick.pid}
										className={mine ? "table-info" : undefined}
										style={
											i > 0 && picks[i - 1]!.round !== pick.round
												? { borderTop: "3px solid var(--bs-border-color)" }
												: undefined
										}
									>
										<td className="text-nowrap">
											{pick.round}-{pick.pick}
											{mine ? (
												<span className="badge bg-primary ms-1">You</span>
											) : null}
										</td>
										<td className="text-nowrap">
											<a
												href={helpers.leagueUrl([
													"roster",
													`${pick.abbrev}_${pick.tid}`,
												])}
												title={
													pick.teamNeeds.length > 0
														? `Needs: ${pick.teamNeeds.join(", ")}`
														: undefined
												}
											>
												{pick.abbrev}
											</a>
											{pick.originalTid !== pick.tid ? (
												<span className="text-body-secondary small">
													{" "}
													via {pick.originalAbbrev}
												</span>
											) : null}
											{pick.note ? (
												<div className="small text-warning-emphasis">
													{pick.note}
												</div>
											) : null}
											{pick.teamStrategy ? (
												<div className="text-body-secondary small">
													{pick.teamStrategy}
												</div>
											) : null}
										</td>
										<td className="text-nowrap">
											<a href={helpers.leagueUrl(["player", pick.pid])}>
												{pick.name}
											</a>
											<ScoutingHoverIcon pid={pick.pid} />
										</td>
										<td>{pick.pos}</td>
										<td>{pick.age}</td>
										{challengeNoRatings ? null : (
											<>
												<td>{pick.ovr}</td>
												<td>{pick.pot}</td>
											</>
										)}
										<td>{pick.scoutRank}</td>
										<td className="small" style={{ minWidth: 180 }}>
											{pick.reasons.join(" · ")}
										</td>
										<ProjectionCells
											projection={projection}
											hidePeak={challengeNoRatings}
										/>
										<td
											className={
												projection
													? verdictClass(projection.verdict)
													: undefined
											}
										>
											{projection?.verdict}
										</td>
									</tr>
								);
							})}
						</tbody>
					</table>
				</div>
			) : null}
		</>
	);
};

export default MockDraft;
