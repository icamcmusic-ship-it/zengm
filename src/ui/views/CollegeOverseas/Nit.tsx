import clsx from "clsx";
import { useState } from "react";
import { Bracket, ProspectLinks } from "./Bracket.tsx";
import { HonorList, makeTeamInfo, type WithSeason } from "./common.tsx";

/**
 * The NIT: 32 of the best teams left out of the NCAA tournament, in four parts of eight.
 */
export const Nit = (props: WithSeason) => {
	const [view, setView] = useState<number>(-1);
	const teamInfo = makeTeamInfo(props);
	const { nit, teams } = props;
	const champ = teams[nit.champion]!;
	return (
		<>
			<div className="alert alert-light border mb-3" data-testid="nit-champion">
				<b>NIT Champion:</b> {champ.school} ({champ.w}-{champ.l}, {champ.conf},{" "}
				{champ.nitSeed} seed)
				<ProspectLinks
					prospects={props.prospectsBySchool[champ.school] ?? []}
					prefix=" — "
				/>
				<HonorList honors={props.honorWinners} filter={/^NIT /} title="" />
			</div>
			<p className="text-body-secondary">
				The 32 best teams that missed the NCAA tournament. The better seed is at
				home until the semifinals.
				{nit.autoBids.length > 0
					? ` Automatic bids (regular season conference champions that lost their conference tournament): ${nit.autoBids.map((t) => teams[t]!.school).join(", ")}.`
					: ""}
				{nit.counted
					? ""
					: " This class's college stats were made before the NIT was added, so these games are not part of the teams' records or the prospects' stats."}
			</p>
			<div
				className="btn-group mb-3 flex-wrap"
				role="group"
				aria-label="Bracket part"
			>
				{[
					{ key: -1, name: "Semifinals and Final" },
					...nit.regions.map((_, i) => ({ key: i, name: `Bracket ${i + 1}` })),
				].map(({ key, name }) => (
					<button
						key={key}
						type="button"
						className={clsx(
							"btn btn-sm",
							view === key ? "btn-primary" : "btn-light-bordered",
						)}
						onClick={() => setView(key)}
					>
						{name}
					</button>
				))}
			</div>
			{view === -1 ? (
				<Bracket
					rounds={[nit.semis, [nit.final]]}
					roundNames={["Semifinals", "Championship"]}
					teamInfo={teamInfo}
					showSeeds
					wide
				/>
			) : (
				<Bracket
					rounds={nit.regions[view]!}
					roundNames={["First Round", "Second Round", "Quarterfinals"]}
					teamInfo={teamInfo}
					showSeeds
				/>
			)}
		</>
	);
};
