import { useState, type SubmitEvent, type ChangeEvent } from "react";
import useTitleBar from "../hooks/useTitleBar.tsx";
import { helpers } from "../util/helpers.ts";
import { showNotification } from "../util/showNotification.ts";
import { toWorker } from "../util/toWorker.ts";
import { ActionButton } from "../components/ActionButton.tsx";

const mb = (bytes: number) => `${(bytes / 1e6).toFixed(2)} MB`;

const DeleteOldData = () => {
	const [state, setState] = useState({
		boxScores: true,
		events: true,
		teamStats: true,
		teamHistory: true,
		retiredPlayersUnnotable: true,
		retiredPlayers: true,
		playerStatsUnnotable: true,
		playerStats: true,
		rivalryLog: true,
		pageCache: false,
		wrappedCache: false,
	});
	const [deleting, setDeleting] = useState(false);
	const [sizes, setSizes] = useState<
		| {
				league: { total: number; stores: Record<string, number> };
				pageCache: number;
				wrappedCache: number;
		  }
		| undefined
	>();
	const [measuring, setMeasuring] = useState(false);

	const measure = async () => {
		setMeasuring(true);
		try {
			setSizes(await toWorker("main", "storageSizes", undefined));
		} finally {
			setMeasuring(false);
		}
	};

	const handleChange =
		(name: keyof typeof state) => (event: ChangeEvent<HTMLInputElement>) => {
			setState({
				...state,
				[name]: event.target.checked,
			});
		};

	const handleSubmit = async (event: SubmitEvent) => {
		event.preventDefault();
		setDeleting(true);

		await toWorker("main", "deleteOldData", state);

		showNotification({
			type: "success",
			text: "Data successfully deleted.",
		});
		setDeleting(false);
		if (sizes) {
			await measure();
		}
	};

	useTitleBar({ title: "Delete Old Data" });

	return (
		<div style={{ maxWidth: 600 }}>
			<p>
				As you play multiple seasons in a league, the database can grow quite
				large. This used to slow down performance, but doesn't much anymore.
				However it does still use up hard drive space, which you can reclaim
				here by deleting old data from this league.
			</p>

			<div className="mb-3">
				<ActionButton
					onClick={measure}
					processing={measuring}
					processingText="Measuring"
					variant="secondary"
				>
					Show storage sizes
				</ActionButton>
				{sizes ? (
					<table className="table table-sm table-striped mt-2 mb-0">
						<tbody>
							<tr>
								<th>This league</th>
								<th className="text-end">{mb(sizes.league.total)}</th>
							</tr>
							{Object.entries(sizes.league.stores)
								.filter(([, bytes]) => bytes >= 10_000)
								.sort((a, b) => b[1] - a[1])
								.map(([store, bytes]) => (
									<tr key={store}>
										<td className="ps-3">{store}</td>
										<td className="text-end">{mb(bytes)}</td>
									</tr>
								))}
							<tr>
								<th>Page cache (all leagues)</th>
								<th className="text-end">{mb(sizes.pageCache)}</th>
							</tr>
							<tr>
								<th>Wrapped cache (all leagues)</th>
								<th className="text-end">{mb(sizes.wrappedCache)}</th>
							</tr>
						</tbody>
					</table>
				) : null}
				<div className="text-body-secondary small mt-1">
					Sizes are the data before compression, so the files on disk are
					usually smaller. Stores under 0.01 MB are not listed.
				</div>
			</div>

			<div className="d-flex gap-2 mb-3">
				<button
					className="btn btn-secondary"
					onClick={() => {
						const newState = {
							...state,
						};
						for (const key of helpers.keys(newState)) {
							newState[key] = true;
						}
						setState(newState);
					}}
				>
					Select all
				</button>
				<button
					className="btn btn-secondary"
					onClick={() => {
						const newState = {
							...state,
						};
						for (const key of helpers.keys(newState)) {
							newState[key] = false;
						}
						setState(newState);
					}}
				>
					Clear
				</button>
			</div>

			<form onSubmit={handleSubmit}>
				<div className="form-check">
					<label className="form-check-label">
						<input
							className="form-check-input"
							onChange={handleChange("boxScores")}
							type="checkbox"
							checked={state.boxScores}
						/>
						Delete Old Box Scores{" "}
						<a href={helpers.leagueUrl(["settings"])}>
							(done automatically by default)
						</a>
					</label>
				</div>
				<div className="form-check">
					<label className="form-check-label">
						<input
							className="form-check-input"
							onChange={handleChange("teamStats")}
							type="checkbox"
							checked={state.teamStats}
						/>
						Delete Old Team Stats
					</label>
				</div>
				<div className="form-check">
					<label className="form-check-label">
						<input
							className="form-check-input"
							onChange={handleChange("teamHistory")}
							type="checkbox"
							checked={state.teamHistory}
						/>
						Delete Old Team History (stuff like W/L, finances, etc)
					</label>
				</div>
				<div className="form-check">
					<label className="form-check-label">
						<input
							className="form-check-input"
							onChange={handleChange("retiredPlayersUnnotable")}
							type="checkbox"
							checked={state.retiredPlayersUnnotable}
						/>
						Delete Unnotable Retired Players
						<br />
						<i>Won't delete your past players or players who have won awards</i>
					</label>
				</div>
				<div className="form-check">
					<label className="form-check-label">
						<input
							className="form-check-input"
							onChange={handleChange("retiredPlayers")}
							type="checkbox"
							checked={state.retiredPlayers}
						/>
						Delete All Retired Players
					</label>
				</div>
				<div className="form-check">
					<label className="form-check-label">
						<input
							className="form-check-input"
							onChange={handleChange("playerStatsUnnotable")}
							type="checkbox"
							checked={state.playerStatsUnnotable}
						/>
						Delete Unnotable Player Info (stats, ratings, salaries, injuries)
						<br />
						<i>Won't delete your past players or players who have won awards</i>
					</label>
				</div>
				<div className="form-check">
					<label className="form-check-label">
						<input
							className="form-check-input"
							onChange={handleChange("playerStats")}
							type="checkbox"
							checked={state.playerStats}
						/>
						Delete Old Player Info (stats, ratings, salaries, injuries)
					</label>
				</div>
				<div className="form-check">
					<label className="form-check-label">
						<input
							className="form-check-input"
							onChange={handleChange("events")}
							type="checkbox"
							checked={state.events}
						/>
						Delete All News Feed Entries
					</label>
				</div>
				<div className="form-check">
					<label className="form-check-label">
						<input
							className="form-check-input"
							onChange={handleChange("rivalryLog")}
							type="checkbox"
							checked={state.rivalryLog}
						/>
						Delete Old Rivalry Log (Rivalry Stories games before this season)
						<br />
						<i>
							Rivalry scores and records are kept. Seasons older than 10 are
							already trimmed to each game's top scorers automatically.
						</i>
					</label>
				</div>
				<div className="form-check">
					<label className="form-check-label">
						<input
							className="form-check-input"
							onChange={handleChange("pageCache")}
							type="checkbox"
							checked={state.pageCache}
						/>
						Clear Page Cache (all leagues)
						<br />
						<i>
							Saved results of pages that read whole seasons of box scores. They
							are rebuilt when the pages are visited.
						</i>
					</label>
				</div>
				<div className="form-check">
					<label className="form-check-label">
						<input
							className="form-check-input"
							onChange={handleChange("wrappedCache")}
							type="checkbox"
							checked={state.wrappedCache}
						/>
						Clear Wrapped Cache (all leagues)
						<br />
						<i>
							Saved data for Wrapped and Storylines, rebuilt when they are
							opened.
						</i>
					</label>
				</div>

				<p className="alert alert-danger mt-3">
					<b>Warning!</b> Once you delete old data, it's completely gone!
					There's no going back! This can impact your players making the Hall of
					Fame and the completion of in-progress achievements!
				</p>

				<ActionButton
					processing={deleting}
					processingText="Deleting"
					type="submit"
					variant="danger"
				>
					Delete Old Data
				</ActionButton>
			</form>
		</div>
	);
};

export default DeleteOldData;
