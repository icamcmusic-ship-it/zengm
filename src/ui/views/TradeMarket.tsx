import { MoreLinks } from "../components/MoreLinks.tsx";
import { DataTable } from "../components/DataTable/index.tsx";
import type { DataTableRow } from "../components/DataTable/index.tsx";
import useTitleBar from "../hooks/useTitleBar.tsx";
import { helpers } from "../util/helpers.ts";
import { toWorker } from "../util/toWorker.ts";
import { getCols } from "../../common/getCols.ts";
import type { View } from "../../common/types.ts";
import { wrappedPlayerNameLabels } from "../components/PlayerNameLabels.tsx";
import { wrappedContract } from "../components/contract.tsx";
import { PHASE } from "../../common/constants.ts";
import { useLocal } from "../util/local.ts";

const TIER_SORT = {
	low: 0,
	medium: 1,
	high: 2,
	veryHigh: 3,
};

const TradeMarket = ({
	challengeNoRatings,
	phase,
	players,
}: View<"tradeMarket">) => {
	useTitleBar({ title: "Trade Market" });
	const { season } = useLocal(["season"]);

	const cols = getCols([
		"Name",
		"Pos",
		{
			title: "Team",
			sortSequence: ["asc", "desc"],
			sortType: "string",
		},
		"Age",
		"Ovr",
		"Pot",
		"Contract",
		{
			title: "Available",
			desc: "How willing the team is to trade him, 0-100",
			sortSequence: ["desc", "asc"],
			sortType: "number",
		},
		{
			title: "Why",
			sortSequence: [],
		},
		{
			title: "Asking Price",
			desc: "Rough hint at what it would take, compared to the team's own next first round pick",
			sortSequence: ["desc", "asc"],
			sortType: "number",
		},
		{
			title: "",
			sortSequence: [],
			noSearch: true,
		},
	]);

	const rows: DataTableRow<"player">[] = players.map((p) => {
		return {
			key: p.pid,
			metadata: {
				type: "player",
				pid: p.pid,
				season,
				playoffs: "regularSeason",
			},
			data: [
				wrappedPlayerNameLabels({
					pid: p.pid,
					injury: p.injury,
					jerseyNumber: p.jerseyNumber,
					skills: p.ratings.skills,
					badges: p.ratings.badges,
					firstName: p.firstName,
					firstNameShort: p.firstNameShort,
					lastName: p.lastName,
				}),
				p.ratings.pos,
				{
					value: (
						<>
							<a href={helpers.leagueUrl(["roster", `${p.abbrev}_${p.tid}`])}>
								{p.abbrev}
							</a>{" "}
							<span className="text-body-secondary">({p.strategy})</span>
						</>
					),
					sortValue: p.abbrev,
					searchValue: `${p.abbrev} ${p.strategy}`,
				},
				p.age,
				!challengeNoRatings ? p.ratings.ovr : null,
				!challengeNoRatings ? p.ratings.pot : null,
				wrappedContract(p),
				p.availability,
				{
					value: p.reasons.join(". "),
					searchValue: p.reasons.join(". "),
				},
				{
					value: p.askingPrice.text,
					sortValue: TIER_SORT[p.askingPrice.tier],
					searchValue: p.askingPrice.text,
				},
				{
					value: (
						<button
							className="btn btn-light-bordered btn-xs"
							onClick={async () => {
								await toWorker("actions", "tradeFor", { pid: p.pid });
							}}
						>
							Trade for
						</button>
					),
				},
			],
		};
	});

	return (
		<>
			<MoreLinks type="trade" page="trade_market" />
			<p>
				Players AI teams are willing to move, based on their strategy
				(contending or rebuilding), the player's age, contract and role on the
				team. The asking price is a rough hint at what it would take, compared
				to the value of the team's own next first round pick. Rebuilding teams
				want picks and young players, contenders want players who help now. See
				also{" "}
				<a href={helpers.leagueUrl(["trade_proposals"])}>Trade Proposals</a> and
				the <a href={helpers.leagueUrl(["trade"])}>Trade</a> page.
			</p>
			{phase >= PHASE.AFTER_TRADE_DEADLINE && phase <= PHASE.PLAYOFFS ? (
				<p className="alert alert-warning d-inline-block">
					The trade deadline has passed, so these players can't be traded until
					after the playoffs.
				</p>
			) : null}
			{rows.length > 0 ? (
				<DataTable
					cols={cols}
					defaultSort={[7, "desc"]}
					defaultStickyCols={window.mobile ? 0 : 1}
					name="TradeMarket"
					pagination
					rows={rows}
				/>
			) : (
				<p>No AI team is shopping anyone right now.</p>
			)}
		</>
	);
};

export default TradeMarket;
