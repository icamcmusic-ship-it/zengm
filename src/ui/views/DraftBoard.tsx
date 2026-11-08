import { useEffect, useState } from "react";
import useTitleBar from "../hooks/useTitleBar.tsx";
import type { View } from "../../common/types.ts";
import { MoreLinks } from "../components/MoreLinks.tsx";
import { useLocal } from "../util/local.ts";
import { helpers } from "../util/helpers.ts";
import { toWorker } from "../util/toWorker.ts";
import { PlayerNameLabels } from "../components/PlayerNameLabels.tsx";
import { ScoutCell } from "./DraftScouting/DraftClass.tsx";

type Prospect = View<"draftBoard">["prospects"][number];

const sortProspects = (prospects: Prospect[]) =>
	[...prospects].sort((a, b) => {
		const ra = a.board.rank ?? Infinity;
		const rb = b.board.rank ?? Infinity;
		if (ra !== rb) {
			return ra - rb;
		}
		return a.valueRank - b.valueRank;
	});

// Send the whole board after a change, renumbered 1..n so there are never gaps or ties
const saveRanks = async (ranked: Prospect[], others: Prospect[] = []) => {
	await toWorker("main", "updateDraftBoard", [
		...ranked.map((p, i) => ({
			pid: p.pid,
			rank: i + 1,
			tier: p.board.tier,
			note: p.board.note,
		})),
		...others.map((p) => ({
			pid: p.pid,
			rank: undefined,
			tier: p.board.tier,
			note: p.board.note,
		})),
	]);
};

const NoteInput = ({ p }: { p: Prospect }) => {
	const [value, setValue] = useState(p.board.note ?? "");
	useEffect(() => {
		setValue(p.board.note ?? "");
	}, [p.board.note]);
	return (
		<input
			className="form-control form-control-sm"
			style={{ minWidth: 140 }}
			placeholder="Notes"
			value={value}
			onChange={(event) => setValue(event.target.value)}
			onBlur={async () => {
				if (value !== (p.board.note ?? "")) {
					await toWorker("main", "updateDraftBoard", [
						{ pid: p.pid, rank: p.board.rank, tier: p.board.tier, note: value },
					]);
				}
			}}
		/>
	);
};

const DraftBoard = ({
	draftBoardAutoDraft,
	prospects,
	scoutingSystem,
	season,
	seasons,
}: View<"draftBoard">) => {
	const { challengeNoRatings, draftType } = useLocal([
		"challengeNoRatings",
		"draftType",
	]);
	useTitleBar({ title: `${season} Draft Board` });

	const sorted = sortProspects(prospects);
	const ranked = sorted.filter((p) => p.board.rank !== undefined);

	const move = async (p: Prospect, delta: number) => {
		const i = ranked.indexOf(p);
		const j = i + delta;
		if (i < 0 || j < 0 || j >= ranked.length) {
			return;
		}
		const next = [...ranked];
		next[i] = ranked[j]!;
		next[j] = p;
		await saveRanks(next);
	};

	const showRatings = !challengeNoRatings;

	return (
		<>
			<MoreLinks type="draft" page="draft_board" draftType={draftType} />

			<p>
				Rank the prospects you want, group them into tiers and keep notes.
				Ranked prospects come first, then everyone else in your scouts' order.
				Your board is saved with the league.
			</p>

			{seasons.length > 1 ? (
				<div className="btn-group mb-3">
					{seasons.map((s) => (
						<a
							key={s}
							className={`btn btn-sm ${s === season ? "btn-primary" : "btn-light-bordered"}`}
							href={helpers.leagueUrl(["draft_board", s])}
						>
							{s}
						</a>
					))}
				</div>
			) : null}

			<div className="d-flex flex-wrap gap-2 align-items-center mb-3">
				<div className="form-check">
					<input
						className="form-check-input"
						type="checkbox"
						id="draft-board-auto"
						checked={draftBoardAutoDraft}
						onChange={async (event) => {
							await toWorker(
								"main",
								"setDraftBoardAutoDraft",
								event.target.checked,
							);
						}}
					/>
					<label className="form-check-label" htmlFor="draft-board-auto">
						Auto draft from my board (when your pick is made automatically, take
						the highest ranked prospect still available)
					</label>
				</div>
				<button
					className="btn btn-light-bordered btn-sm"
					disabled={ranked.length > 0}
					onClick={() => saveRanks(sorted.slice(0, 30))}
				>
					Start from scouts' top 30
				</button>
				<button
					className="btn btn-light-bordered btn-sm"
					disabled={ranked.length === 0}
					onClick={() => saveRanks([], ranked)}
				>
					Clear ranks
				</button>
				{scoutingSystem ? (
					<a href={helpers.leagueUrl(["draft_scouting"])}>Scout prospects</a>
				) : null}
			</div>

			<div className="table-responsive">
				<table className="table table-striped table-sm table-hover">
					<thead>
						<tr>
							<th title="Your rank">Board</th>
							<th>Tier</th>
							<th>Name</th>
							<th>Pos</th>
							<th>Age</th>
							{showRatings ? (
								<>
									<th>Ovr</th>
									<th>Pot</th>
								</>
							) : null}
							<th title="Scouts' order">Scouts</th>
							<th>Build</th>
							<th>College / overseas</th>
							{scoutingSystem && showRatings ? <th>Scout report</th> : null}
							<th>Notes</th>
						</tr>
					</thead>
					<tbody>
						{sorted.map((p) => {
							const i = ranked.indexOf(p);
							const prevTier = i > 0 ? ranked[i - 1]!.board.tier : undefined;
							return (
								<tr
									key={p.pid}
									className={
										p.board.tier !== undefined &&
										p.board.tier !== prevTier &&
										i > 0
											? "border-top border-2"
											: undefined
									}
								>
									<td className="text-nowrap">
										{p.board.rank !== undefined ? (
											<>
												<b>{i + 1}</b>{" "}
												<button
													className="btn btn-link btn-sm p-0"
													title="Move up"
													onClick={() => move(p, -1)}
												>
													▲
												</button>
												<button
													className="btn btn-link btn-sm p-0"
													title="Move down"
													onClick={() => move(p, 1)}
												>
													▼
												</button>
												<button
													className="btn btn-link btn-sm p-0 ms-1 text-danger"
													title="Remove from board"
													onClick={() =>
														saveRanks(
															ranked.filter((p2) => p2 !== p),
															[p],
														)
													}
												>
													✕
												</button>
											</>
										) : (
											<button
												className="btn btn-light-bordered btn-xs"
												onClick={() => saveRanks([...ranked, p])}
											>
												Add
											</button>
										)}
									</td>
									<td>
										<select
											className="form-select form-select-sm"
											style={{ width: 70 }}
											value={p.board.tier ?? ""}
											onChange={async (event) => {
												const tier =
													event.target.value === ""
														? undefined
														: Number.parseInt(event.target.value);
												await toWorker("main", "updateDraftBoard", [
													{
														pid: p.pid,
														rank: p.board.rank,
														tier,
														note: p.board.note,
													},
												]);
											}}
										>
											<option value="">-</option>
											{[1, 2, 3, 4, 5, 6].map((tier) => (
												<option key={tier} value={tier}>
													{tier}
												</option>
											))}
										</select>
									</td>
									<td>
										<PlayerNameLabels
											pid={p.pid}
											season={season}
											skills={p.skills}
											defaultWatch={p.watch}
											firstName={p.firstName}
											firstNameShort={p.firstNameShort}
											lastName={p.lastName}
										/>
									</td>
									<td>{p.pos}</td>
									<td>{p.age}</td>
									{showRatings ? (
										<>
											<td>{p.ovr}</td>
											<td>{p.pot}</td>
										</>
									) : null}
									<td>{p.valueRank}</td>
									<td>{p.build ?? ""}</td>
									<td>
										{p.preDraftLabel ? (
											<span className="badge text-bg-secondary fw-normal me-1">
												{p.preDraftLabel}
											</span>
										) : null}
										{p.school}
										{p.preDraftLine ? (
											<div className="text-body-secondary small">
												{p.preDraftLine}
												{p.numHonors > 0
													? `, ${p.numHonors} ${helpers.plural("honor", p.numHonors)}`
													: ""}
											</div>
										) : null}
									</td>
									{scoutingSystem && showRatings && p.scoutReport ? (
										<td>
											<ScoutCell
												pid={p.pid}
												report={p.scoutReport}
												remaining={undefined}
											/>
											<div className="text-body-secondary small">
												{p.scoutReport.notes.slice(0, 2).join(". ")}
											</div>
										</td>
									) : null}
									<td>
										<NoteInput p={p} />
									</td>
								</tr>
							);
						})}
					</tbody>
				</table>
			</div>
		</>
	);
};

export default DraftBoard;
