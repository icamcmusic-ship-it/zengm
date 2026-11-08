import { DataTable } from "./DataTable/index.tsx";
import { getCol } from "../../common/getCol.ts";
import { helpers } from "../util/helpers.ts";
import { useLocal } from "../util/local.ts";
import type { SeasonOddsResult } from "../../worker/core/seasonOdds/index.ts";

export const formatOdds = (prob: number) => {
	if (prob <= 0) {
		return "0%";
	}
	if (prob >= 1) {
		return "100%";
	}
	if (prob < 0.005) {
		return "<1%";
	}
	if (prob > 0.995) {
		return ">99%";
	}
	return `${Math.round(100 * prob)}%`;
};

const pctCol = (title: string, desc: string) => ({
	...getCol("Win%", { desc }),
	title,
});

// One cell per seed, shaded by probability
const SeedBar = ({ seeds }: { seeds: number[] }) => {
	return (
		<div className="d-flex" style={{ gap: 1 }}>
			{seeds.map((prob, i) => (
				<div
					key={i}
					title={`#${i + 1} seed: ${formatOdds(prob)}`}
					style={{
						width: 14,
						height: 16,
						fontSize: 9,
						lineHeight: "16px",
						textAlign: "center",
						backgroundColor: `rgba(13, 110, 253, ${Math.min(1, prob * 1.6)})`,
						color: prob > 0.35 ? "#fff" : "var(--bs-secondary-color)",
					}}
				>
					{i + 1}
				</div>
			))}
		</div>
	);
};

// Monte Carlo season projections, see worker/core/seasonOdds
export const SeasonOddsTable = ({
	odds,
	season,
}: {
	odds: SeasonOddsResult;
	season: number;
}) => {
	const { teamInfoCache, userTid } = useLocal(["teamInfoCache", "userTid"]);

	const numSeeds = Math.max(0, ...odds.teams.map((t) => t.seeds.length));
	const roundNames =
		odds.numRounds >= 2
			? [
					...(odds.numRounds >= 3
						? [pctCol("Semis", "Chance to reach the semifinals")]
						: []),
					pctCol("Finals", "Chance to reach the finals"),
				]
			: [];

	const cols = [
		getCol("Team"),
		{ ...getCol("W"), title: "Proj W", desc: "Projected wins" },
		{ ...getCol("L"), title: "Proj L", desc: "Projected losses" },
		pctCol("Playoffs", "Chance to make the playoffs (after any play-in)"),
		pctCol("Play-In", "Chance to be in the play-in tournament"),
		{
			...getCol("Team"),
			title: "Seed",
			desc: "Seed distribution, darker is more likely",
			sortSequence: [],
		},
		...roundNames,
		pctCol("Title", "Chance to win the title"),
	];

	const rows = odds.teams
		.toSorted((a, b) => b.title - a.title || b.playoffs - a.playoffs)
		.map((t) => {
			const info = teamInfoCache[t.tid];
			const seeds = [...t.seeds];
			while (seeds.length < numSeeds) {
				seeds.push(0);
			}
			const roundCells = [];
			if (odds.numRounds >= 3) {
				const p = t.roundsWon[odds.numRounds - 3] ?? 0;
				roundCells.push({ value: formatOdds(p), sortValue: p });
			}
			if (odds.numRounds >= 2) {
				const p = t.roundsWon[odds.numRounds - 2] ?? 0;
				roundCells.push({ value: formatOdds(p), sortValue: p });
			}
			return {
				key: t.tid,
				data: [
					{
						value: info ? (
							<a
								href={helpers.leagueUrl([
									"roster",
									`${info.abbrev}_${t.tid}`,
									season,
								])}
							>
								{info.region} {info.name}
							</a>
						) : (
							t.tid
						),
						sortValue: info ? `${info.region} ${info.name}` : t.tid,
					},
					t.projWon.toFixed(1),
					t.projLost.toFixed(1),
					{ value: formatOdds(t.playoffs), sortValue: t.playoffs },
					{ value: formatOdds(t.playIn), sortValue: t.playIn },
					{ value: <SeedBar seeds={seeds} />, sortValue: 0 },
					...roundCells,
					{ value: formatOdds(t.title), sortValue: t.title },
				],
				classNames: {
					"table-info": t.tid === userTid,
				},
			};
		});

	return (
		<div data-testid="season-odds">
			<DataTable
				cols={cols}
				defaultSort={[cols.length - 1, "desc"]}
				hideAllControls
				name="SeasonOdds"
				nonfluid
				rows={rows}
			/>
			<p className="text-body-secondary small">
				From {odds.numSims.toLocaleString()} simulations of the rest of the
				season, using team ratings (blended with point margin as the season goes
				on). Tiebreakers are approximated and reseeding is ignored. Updated
				after each day of games.
			</p>
		</div>
	);
};
