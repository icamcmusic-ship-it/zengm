import { MoreLinks } from "../components/MoreLinks.tsx";
import { dropdownOptions } from "../hooks/useDropdownOptions.tsx";
import useTitleBar from "../hooks/useTitleBar.tsx";
import { helpers } from "../util/helpers.ts";
import type { View } from "../../common/types.ts";
import { SafeHtml } from "../components/SafeHtml.tsx";
import { TradeGradeBadge } from "../components/TradeGradeBadge.tsx";
import { wsPref } from "./TradeSummary/index.tsx";
import { useLocal } from "../util/local.ts";

const Transactions = ({
	eventType,
	events,
	season,
	team,
}: View<"transactions">) => {
	const { teamInfoCache } = useLocal(["teamInfoCache"]);
	const ws = wsPref();

	useTitleBar({
		title: "Transactions",
		dropdown: {
			fields: [
				{
					key: "team",
					options: { type: "teams", all: true, watch: true },
					value: team,
				},
				{
					key: "season",
					options: { type: "seasons", all: true },
					value: season,
				},
				{
					key: "eventType",
					options: dropdownOptions.eventType,
					value: eventType,
				},
			],
			view: "transactions",
		},
	});

	const moreLinks =
		typeof team === "number" ? (
			<MoreLinks
				type="team"
				page="transactions"
				tid={team}
				season={season !== "all" ? season : undefined}
			/>
		) : (
			<p>
				More: <a href={helpers.leagueUrl(["news", team, season])}>News Feed</a>
			</p>
		);

	return (
		<>
			{moreLinks}

			<ul className="list-group">
				{events.map((e) => {
					const grades = ws === "rs" ? (e.gradesRs ?? e.grades) : e.grades;
					return (
						<li key={e.eid} className="list-group-item">
							<SafeHtml dirty={e.text} />
							{grades ? (
								<div className="mt-1 small">
									<a
										href={helpers.leagueUrl(["trade_summary", e.eid])}
										className="text-reset text-decoration-none"
										title={`Trade grader: ${ws === "rs" ? "regular season" : "regular season + playoffs"} win shares each side got out of it`}
									>
										{grades.map((x) => (
											<span key={x.tid} className="me-2">
												<span className="text-body-secondary">
													{teamInfoCache[x.tid]?.abbrev ?? "???"}
												</span>{" "}
												<TradeGradeBadge grade={x.g} />
											</span>
										))}
									</a>
								</div>
							) : null}
						</li>
					);
				})}
			</ul>
		</>
	);
};

export default Transactions;
