import { useState } from "react";
import HideableSection from "../../components/HideableSection.tsx";
import { helpers } from "../../util/helpers.ts";
import {
	advStat,
	ADV_STAT_META,
	playTypeProfile,
	type AdvStatKey,
} from "../../../common/advStats.ts";

// Advanced Tracking Stats: a player's play-type profile (frequency bars, points per possession, FG%, TOV%) and his shooting, defense,
// on/off and clutch numbers for one regular season or his career. Stats, not ratings, so shown with hidden ratings too.

type AdvSeason = { season: number | "career"; adv: number[] };

const LABELS: Partial<Record<AdvStatKey, string>> = {
	cs3a: "Catch-and-shoot 3PA",
	cs3p: "Catch-and-shoot 3P%",
	pu3a: "Pull-up 3PA",
	pu3p: "Pull-up 3P%",
	astpRim: "Assisted, at rim",
	astpLong: "Assisted, mid-range",
	astp3: "Assisted, threes",
	dfga: "Shots defended",
	dfgp: "Defended FG%",
	dfgp3: "Defended 3P%",
	con2: "2PT contests",
	con3: "3PT contests",
	rimDfgp: "Rim DFG%",
	rimDeter: "Rim attempts on-off /100",
	onOrtg: "ORtg on",
	onDrtg: "DRtg on",
	onNet: "Net on",
	offNet: "Net off",
	onOffNet: "On-off",
	clGp: "Games",
	clMin: "Minutes",
	clPts: "Points",
	clFgp: "FG%",
	clPm: "+/-",
	clUsgp: "Usage",
};

const Stat = ({ adv, stat }: { adv: number[]; stat: AdvStatKey }) => {
	const value = advStat(adv, stat);
	return (
		<tr>
			<td title={ADV_STAT_META[stat].desc}>
				{LABELS[stat] ?? ADV_STAT_META[stat].title}
			</td>
			<td className="text-end text-nowrap">
				{value === undefined ? "" : helpers.roundStat(value, stat)}
			</td>
		</tr>
	);
};

const Group = ({
	adv,
	stats,
	title,
}: {
	adv: number[];
	stats: AdvStatKey[];
	title: string;
}) => (
	<div className="col-12 col-md-6 col-xl-3 mb-3">
		<h3 className="h6 mb-1">{title}</h3>
		<table className="table table-sm table-borderless mb-0 small">
			<tbody>
				{stats.map((stat) => (
					<Stat key={stat} adv={adv} stat={stat} />
				))}
			</tbody>
		</table>
	</div>
);

export const TrackingProfile = ({
	advSeasons,
}: {
	advSeasons: AdvSeason[] | undefined;
}) => {
	const seasons = advSeasons ?? [];
	const defaultIndex = Math.max(0, seasons.length - 2);
	const [index, setIndex] = useState<number | undefined>();
	if (seasons.length === 0) {
		return null;
	}
	const selected = seasons[index ?? defaultIndex] ?? seasons[0]!;
	const adv = selected.adv;
	const profile = playTypeProfile(adv);
	const maxFreq = Math.max(
		1,
		...(profile?.types.map((t) => t.freq ?? 0) ?? []),
	);

	return (
		<HideableSection
			title="Tracking Profile"
			description="Play types, shooting, defense, on/off and clutch from the game sim's tracking (regular season)."
		>
			<div className="mb-2">
				<select
					aria-label="Season"
					className="form-select form-select-sm d-inline-block w-auto"
					value={index ?? defaultIndex}
					onChange={(event) => {
						setIndex(Number(event.target.value));
					}}
				>
					{seasons.map((row, i) => (
						<option key={String(row.season)} value={i}>
							{row.season === "career" ? "Career" : row.season}
						</option>
					))}
				</select>
			</div>
			{profile ? (
				<div className="table-responsive mb-3" style={{ maxWidth: 720 }}>
					<table className="table table-sm table-striped mb-0">
						<thead>
							<tr>
								<th>Play type</th>
								<th className="text-end" title="Possessions">
									Poss
								</th>
								<th style={{ minWidth: 140 }} title="Share of his possessions">
									Freq
								</th>
								<th className="text-end" title="Points per possession">
									PPP
								</th>
								<th className="text-end">FG%</th>
								<th className="text-end" title="Turnovers per possession">
									TOV%
								</th>
							</tr>
						</thead>
						<tbody>
							{profile.types
								.filter((row) => row.poss > 0)
								.map((row) => (
									<tr key={row.key}>
										<td className="text-nowrap">{row.name}</td>
										<td className="text-end">{row.poss}</td>
										<td>
											<div className="d-flex align-items-center">
												<div
													className="bg-primary rounded-1 me-2"
													style={{
														height: 10,
														width: `${(70 * (row.freq ?? 0)) / maxFreq}%`,
														minWidth: 2,
													}}
												/>
												<span className="small text-nowrap">
													{helpers.roundStat(row.freq ?? 0, "ptPrbFreq")}%
												</span>
											</div>
										</td>
										<td className="text-end">
											{row.ppp === undefined
												? ""
												: helpers.roundStat(row.ppp, "ptPrbPpp")}
										</td>
										<td className="text-end">
											{row.fgp === undefined
												? ""
												: helpers.roundStat(row.fgp, "ptPrbFgp")}
										</td>
										<td className="text-end">
											{row.tovp === undefined
												? ""
												: helpers.roundStat(row.tovp, "ptPrbTovp")}
										</td>
									</tr>
								))}
						</tbody>
					</table>
				</div>
			) : null}
			<div className="row">
				<Group
					adv={adv}
					title="Shooting"
					stats={[
						"cs3a",
						"cs3p",
						"pu3a",
						"pu3p",
						"astpRim",
						"astpLong",
						"astp3",
					]}
				/>
				<Group
					adv={adv}
					title="Defense"
					stats={[
						"dfga",
						"dfgp",
						"dfgp3",
						"con2",
						"con3",
						"rimDfgp",
						"rimDeter",
					]}
				/>
				<Group
					adv={adv}
					title="On/Off"
					stats={["onOrtg", "onDrtg", "onNet", "offNet", "onOffNet"]}
				/>
				<Group
					adv={adv}
					title="Clutch"
					stats={["clGp", "clMin", "clPts", "clFgp", "clPm", "clUsgp"]}
				/>
			</div>
		</HideableSection>
	);
};
