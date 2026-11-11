import { MoreLinks } from "../components/MoreLinks.tsx";
import useTitleBar from "../hooks/useTitleBar.tsx";
import type { View } from "../../common/types.ts";
import {
	HypeGameRow,
	hypePlainText,
	HypeText,
} from "../components/GameHype.tsx";
import { helpers } from "../util/helpers.ts";

const DAY_LABELS = [
	"Next up",
	"The day after",
	"Two days out",
	"Three days out",
];

const Hype = ({ chases, days, recent }: View<"hype">) => {
	useTitleBar({ title: "Games to Watch" });

	return (
		<>
			<MoreLinks type="schedule" page="hype" />
			<p>
				A must-watch score from 0 to 100 for every upcoming game, built from
				what is known before tip-off: the standings and playoff races, series
				stakes, rivalries, star power, milestones, hot streaks, record chases,
				revenge games and rookie duels. Finished games show whether they lived
				up to it. See also{" "}
				<a href={helpers.leagueUrl(["storylines"])}>Storylines</a>.
			</p>
			<div className="row">
				<div
					className="col-lg-7"
					data-csv-table=""
					data-csv-name="Coming up"
					data-csv-cols={JSON.stringify([
						"Day",
						"Game",
						"Records",
						"Hype",
						"Label",
						"Result",
						"Verdict",
					])}
				>
					<h2>Coming up</h2>
					{days.length === 0 ? (
						<p>No games are scheduled right now.</p>
					) : (
						days.map((d, i) => (
							<div key={d.day} className="mb-3">
								<h3 className="h5 text-body-secondary">
									{DAY_LABELS[i] ?? `Day ${d.day}`}
								</h3>
								{d.games.slice(0, 8).map((h) => (
									<HypeGameRow
										key={h.gid}
										h={h}
										maxReasons={4}
										csvDay={DAY_LABELS[i] ?? `Day ${d.day}`}
									/>
								))}
								{d.games.length > 8 ? (
									<div className="text-body-secondary">
										and {d.games.length - 8} more games with less on the line
									</div>
								) : null}
							</div>
						))
					)}
				</div>
				<div className="col-lg-5">
					<h2>Record chases</h2>
					{chases.length === 0 ? (
						<p>
							No one is close to a league or franchise record yet. Records need
							a few seasons of history to count.
						</p>
					) : (
						<ul
							className="ps-3"
							data-csv-table=""
							data-csv-name="Record chases"
							data-csv-cols={JSON.stringify(["Record chase"])}
						>
							{chases.map((c) => (
								<li
									data-csv-row={JSON.stringify([hypePlainText(c.text)])}
									key={`${c.pid}-${c.k}-${c.scope}-${c.kind}`}
									className="mb-1"
								>
									<HypeText text={c.text} />
								</li>
							))}
						</ul>
					)}
					<h2 className="mt-3">Did it live up to it?</h2>
					{recent.length === 0 ? (
						<p>No games played yet.</p>
					) : (
						<div
							data-csv-table=""
							data-csv-name="Did it live up to it"
							data-csv-cols={JSON.stringify([
								"Day",
								"Game",
								"Records",
								"Hype",
								"Label",
								"Result",
								"Verdict",
							])}
						>
							{recent.map((h) => (
								<HypeGameRow
									key={h.gid}
									h={h}
									maxReasons={2}
									showResult
									csvDay={`Day ${h.day}`}
								/>
							))}
						</div>
					)}
				</div>
			</div>
		</>
	);
};

export default Hype;
