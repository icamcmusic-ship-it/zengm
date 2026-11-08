import { useState } from "react";
import { toWorker } from "../util/toWorker.ts";
import { useLocal } from "../util/local.ts";
import type { DraftType, View } from "../../common/types.ts";
import type { WhatIfDraftType } from "../../worker/core/draft/lotteryWhatIf.ts";

const LABELS: Record<WhatIfDraftType, string> = {
	current: "Current format",
	nba2019: "NBA 2019 (top 4 picks)",
	nba1994: "NBA 1994-2018 (top 3 picks)",
	nba1990: "NBA 1990-1993 (top 3 picks)",
	nhl2021: "NHL 2021 (top 2 picks)",
	nhl2017: "NHL 2017-2020 (top 3 picks)",
	mlb2022: "MLB 2022 (top 6 picks)",
	randomLottery: "Random order",
	randomLotteryFirst3: "Random top 3",
	coinFlip: "Coin flip (top 2 picks)",
};

const DRAFT_TYPES: WhatIfDraftType[] = [
	"current",
	"nba2019",
	"nba1994",
	"nba1990",
	"nhl2021",
	"nhl2017",
	"mlb2022",
	"randomLottery",
	"randomLotteryFirst3",
	"coinFlip",
];

type Result = Awaited<ReturnType<typeof runWhatIf>>;

const runWhatIf = (args: {
	draftType: WhatIfDraftType;
	rows: { tid: number; chances: number }[];
	currentDraftType: DraftType;
	currentNumToPick: number;
	season: number;
}) => toWorker("main", "draftLotteryWhatIf", args);

const pct = (x: number | undefined) =>
	x === undefined ? "" : x === 0 ? "" : `${(100 * x).toFixed(1)}%`;

// What-if simulator on the Draft Lottery page: reorder the lottery teams or switch the lottery format, then see the odds (exact and from
// 20,000 simulated lotteries) and one sample draw
export const DraftLotteryWhatIf = ({
	draftLotteryResult,
	draftType,
	numToPick,
	season,
}: Pick<
	View<"draftLottery">,
	"draftLotteryResult" | "draftType" | "numToPick" | "season"
>) => {
	const { teamInfoCache, userTid } = useLocal(["teamInfoCache", "userTid"]);
	const initialRows = (draftLotteryResult?.result ?? []).map((row) => ({
		tid: row.tid,
		originalTid: row.originalTid,
		chances: row.chances,
	}));
	const [rows, setRows] = useState(initialRows);
	const [whatIfType, setWhatIfType] = useState<WhatIfDraftType>("current");
	const [result, setResult] = useState<Result | undefined>();
	const [running, setRunning] = useState(false);

	if (
		!draftLotteryResult ||
		draftType === undefined ||
		draftType === "dummy" ||
		initialRows.length === 0
	) {
		return null;
	}

	const move = (i: number, delta: number) => {
		const j = i + delta;
		if (j < 0 || j >= rows.length) {
			return;
		}
		const newRows = [...rows];
		// Chances stay with the position (the lottery slot), the team moves
		const a = newRows[i]!;
		const b = newRows[j]!;
		newRows[i] = { ...b, chances: a.chances };
		newRows[j] = { ...a, chances: b.chances };
		setRows(newRows);
		setResult(undefined);
	};

	const run = async () => {
		setRunning(true);
		try {
			setResult(
				await runWhatIf({
					draftType: whatIfType,
					rows: rows.map(({ tid, chances }) => ({ tid, chances })),
					currentDraftType: draftType,
					currentNumToPick: numToPick,
					season,
				}),
			);
		} finally {
			setRunning(false);
		}
	};

	const numPicks = rows.length;
	const samplePickByIndex = new Map<number, number>();
	if (result) {
		for (const [pick, index] of result.sample.entries()) {
			samplePickByIndex.set(index, pick + 1);
		}
	}
	const probs = result?.probs ?? result?.monteCarlo;

	return (
		<div className="mt-4" data-testid="lottery-what-if">
			<h2>What-if simulator</h2>
			<p>
				Move teams up or down the lottery order or try a different lottery
				format, then run it. The odds are exact where possible, checked against
				20,000 simulated lotteries, and one sample draw is shown.
			</p>
			<div
				className="d-flex flex-wrap align-items-center mb-2"
				style={{ gap: 8 }}
			>
				<select
					className="form-select"
					style={{ width: "auto" }}
					value={whatIfType}
					onChange={(event) => {
						setWhatIfType(event.target.value as WhatIfDraftType);
						setResult(undefined);
					}}
				>
					{DRAFT_TYPES.map((type) => (
						<option key={type} value={type}>
							{LABELS[type]}
						</option>
					))}
				</select>
				<button
					className="btn btn-primary"
					type="button"
					disabled={running}
					onClick={run}
				>
					{running ? "Running..." : "Run lottery"}
				</button>
				<button
					className="btn btn-secondary"
					type="button"
					onClick={() => {
						setRows(initialRows);
						setWhatIfType("current");
						setResult(undefined);
					}}
				>
					Reset
				</button>
			</div>
			<div className="table-responsive">
				<table className="table table-sm table-striped table-hover table-nonfluid">
					<thead>
						<tr>
							<th>Slot</th>
							<th>Team</th>
							<th>Chances</th>
							{result ? <th>Sample pick</th> : null}
							{result
								? Array.from({ length: Math.min(numPicks, 14) }, (_, j) => (
										<th key={j}>{j + 1}</th>
									))
								: null}
							{result ? <th title="Average pick">Avg</th> : null}
						</tr>
					</thead>
					<tbody>
						{rows.map((row, i) => {
							const info = teamInfoCache[row.tid];
							const rowProbs = probs?.[i];
							let avg = 0;
							if (rowProbs) {
								for (const [j, p] of rowProbs.entries()) {
									avg += (j + 1) * (p ?? 0);
								}
							}
							return (
								<tr
									key={`${row.tid}-${row.originalTid}`}
									className={row.tid === userTid ? "table-info" : undefined}
								>
									<td className="text-nowrap">
										{i + 1}{" "}
										<button
											className="btn btn-xs btn-light-bordered"
											type="button"
											title="Move up (worse record)"
											disabled={i === 0}
											onClick={() => move(i, -1)}
										>
											▲
										</button>{" "}
										<button
											className="btn btn-xs btn-light-bordered"
											type="button"
											title="Move down (better record)"
											disabled={i === rows.length - 1}
											onClick={() => move(i, 1)}
										>
											▼
										</button>
									</td>
									<td>
										{info ? info.abbrev : row.tid}
										{row.originalTid !== row.tid
											? ` (from ${teamInfoCache[row.originalTid]?.abbrev ?? row.originalTid})`
											: null}
									</td>
									<td>{result ? result.chances[i] : null}</td>
									{result ? (
										<td>
											<b>{samplePickByIndex.get(i)}</b>
										</td>
									) : null}
									{result
										? Array.from({ length: Math.min(numPicks, 14) }, (_, j) => (
												<td
													key={j}
													title={`Simulated: ${pct(result.monteCarlo[i]?.[j])}`}
												>
													{pct(rowProbs?.[j])}
												</td>
											))
										: null}
									{result ? <td>{avg.toFixed(1)}</td> : null}
								</tr>
							);
						})}
					</tbody>
				</table>
			</div>
			{result?.tooSlow ? (
				<p className="text-body-secondary">
					Exact odds would take too long, these are from the simulations.
				</p>
			) : null}
		</div>
	);
};
