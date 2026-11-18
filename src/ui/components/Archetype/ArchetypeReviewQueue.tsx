// archramp: "Check labels" (League -> Archetypes): a handful of players at a time, the ones the reading is least sure of
// first, each with his label, its description and why; the user answers Fits or Doesn't fit. A yes/no answer is quick
// and far more consistent than picking one build out of hundreds, and the share of "Fits" is the fit rate shown here.
// "Doesn't fit" offers the picker ("Doesn't fit?") for the build that fits better. Names and words only: no numbers
// about a player (the no-visible-ratings challenge).
import { useEffect, useState } from "react";
import type { ReviewQueue } from "../../../worker/api/archetypes.ts";
import { helpers } from "../../util/helpers.ts";
import { realtimeUpdate } from "../../util/realtimeUpdate.ts";
import { toWorker } from "../../util/toWorker.ts";
import { ArchetypeFeedbackModal } from "./ArchetypeFeedback.tsx";

type Verdict = "fits" | "no" | "skip";

const rate = (fits: number, judged: number) =>
	`${Math.round((100 * fits) / Math.max(1, judged))}%`;

export const ArchetypeReviewQueue = () => {
	const [queue, setQueue] = useState<ReviewQueue | undefined>();
	const [done, setDone] = useState<Record<number, Verdict>>({});
	const [skipped, setSkipped] = useState<number[]>([]);
	const [busy, setBusy] = useState(false);
	const [pickFor, setPickFor] = useState<number | undefined>();

	const load = async (skip: number[]) => {
		setBusy(true);
		const q = await toWorker("archetypes", "reviewQueue", { skip });
		setQueue(q);
		setDone({});
		setBusy(false);
	};
	useEffect(() => {
		load([]);
	}, []);

	if (!queue || !queue.enabled) {
		return null;
	}

	const answer = async (pid: number, fits: boolean) => {
		setBusy(true);
		const res = await toWorker("archetypes", "reviewSubmit", { pid, fits });
		setBusy(false);
		if (res.ok) {
			setDone((d) => ({ ...d, [pid]: fits ? "fits" : "no" }));
			if (res.stats) {
				setQueue((q) => (q ? { ...q, stats: res.stats! } : q));
			}
			await realtimeUpdate(["playerMovement"]);
		}
	};
	const skip = (pid: number) => {
		setDone((d) => ({ ...d, [pid]: "skip" }));
		setSkipped((s) => [...s, pid]);
	};

	const { stats, items } = queue;
	const left = items.filter((i) => done[i.pid] === undefined).length;

	return (
		<div className="card mb-4" style={{ maxWidth: 640 }}>
			<div className="card-body">
				<h2 className="h5 card-title">Check labels</h2>
				<p className="mb-2">
					Does the label fit the player? Players on teams come first, the ones
					the reading is least sure of at the top. Your answers teach it how you
					see players like them.
				</p>
				<p className="mb-3">
					{stats.judged === 0 ? (
						<span className="text-body-secondary">No answers yet.</span>
					) : (
						<>
							<b>{rate(stats.fits, stats.judged)}</b> of the labels you checked
							fit ({stats.fits} of {stats.judged}).
							{stats.families.length > 0 &&
							stats.families[0]!.fits < stats.families[0]!.judged ? (
								<>
									{" "}
									Weakest: {stats.families[0]!.family} (
									{stats.families[0]!.fits} of {stats.families[0]!.judged}).
								</>
							) : null}
						</>
					)}
				</p>
				{items.length === 0 ? (
					<p className="mb-0 text-body-secondary">
						Nobody left to check this season.
					</p>
				) : (
					<ul className="list-group list-group-flush mb-3">
						{items.map((it) => {
							const v = done[it.pid];
							return (
								<li
									key={it.pid}
									className="list-group-item px-0"
									style={v ? { opacity: 0.6 } : undefined}
								>
									<div>
										<a href={helpers.leagueUrl(["player", it.pid])}>
											{it.name}
										</a>{" "}
										<span className="text-body-secondary">
											{it.pos}, {it.age} y.o., {it.team}
										</span>
									</div>
									<div className="fw-bold">{it.label}</div>
									<div className="small">{it.desc}</div>
									{it.why.length > 0 ? (
										<div className="small text-body-secondary">
											{it.why.join(" · ")}
										</div>
									) : null}
									<div className="d-flex flex-wrap align-items-center gap-2 mt-2">
										{v === undefined ? (
											<>
												<button
													type="button"
													className="btn btn-sm btn-outline-success"
													disabled={busy}
													onClick={() => answer(it.pid, true)}
												>
													Fits
												</button>
												<button
													type="button"
													className="btn btn-sm btn-outline-danger"
													disabled={busy}
													onClick={() => answer(it.pid, false)}
												>
													Doesn't fit
												</button>
												<button
													type="button"
													className="btn btn-sm btn-link text-body-secondary"
													disabled={busy}
													onClick={() => skip(it.pid)}
												>
													Not sure
												</button>
											</>
										) : v === "fits" ? (
											<span className="text-success">Fits</span>
										) : v === "no" ? (
											<>
												<span className="text-danger">Doesn't fit</span>
												<button
													type="button"
													className="btn btn-sm btn-link p-0"
													onClick={() => setPickFor(it.pid)}
												>
													Pick the one that does
												</button>
											</>
										) : (
											<span className="text-body-secondary">Skipped</span>
										)}
										{v === "fits" || v === "no" ? (
											<button
												type="button"
												className="btn btn-sm btn-link text-body-secondary p-0"
												disabled={busy}
												onClick={() => answer(it.pid, v !== "fits")}
											>
												Change
											</button>
										) : null}
									</div>
								</li>
							);
						})}
					</ul>
				)}
				{items.length > 0 ? (
					<div className="d-flex flex-wrap align-items-center gap-2">
						<button
							type="button"
							className="btn btn-sm btn-secondary"
							disabled={busy}
							onClick={() => load(skipped)}
						>
							{left === 0 ? "Next players" : "Show other players"}
						</button>
						<span className="small text-body-secondary">
							{queue.remaining} left to check this season
						</span>
					</div>
				) : null}
			</div>
			{pickFor !== undefined ? (
				<ArchetypeFeedbackModal
					pid={pickFor}
					show
					onHide={() => setPickFor(undefined)}
				/>
			) : null}
		</div>
	);
};
