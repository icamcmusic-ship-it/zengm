import useTitleBar from "../hooks/useTitleBar.tsx";
import type { View } from "../../common/types.ts";
import TopStuff from "./Player/TopStuff.tsx";
import { useLocal } from "../util/local.ts";
import { PLAYER } from "../../common/constants.ts";
import { last } from "../../common/utils.ts";
import HideableSection from "../components/HideableSection.tsx";
import { TraitBadges } from "../components/PlayerTraits/TraitBadges.tsx";
import {
	TraitBar,
	TraitEffectsHelp,
} from "../components/PlayerTraits/TraitBars.tsx";
import {
	TRAIT_DEFINITIONS,
	TRAIT_KEYS,
	TRAIT_SHORT,
} from "../../common/playerTraits/index.ts";
import { playerProfileUrl, usePlayerProfileOptions } from "./Player/common.tsx";

const PlayerTraits = ({
	bestPos,
	customMenu,
	effects,
	history,
	historyKeys,
	jerseyNumberInfos,
	player,
	playerTraits,
	randomDebutsForeverPids,
	retired,
	statSummary,
	teamColors,
	teamJersey,
	teamName,
	teamURL,
	willingToSign,
}: View<"playerTraits">) => {
	const { challengeNoRatings, season: currentSeason } = useLocal([
		"challengeNoRatings",
		"season",
	]);
	const showRatings = !challengeNoRatings || retired;
	const profileOptions = usePlayerProfileOptions();

	useTitleBar({
		title: player.name,
		customMenu,
		dropdown:
			player.tid !== PLAYER.UNDRAFTED
				? {
						fields: [
							{
								key: "profile",
								options: profileOptions,
								value: "traits",
							},
						],
						urlOverride: ({ profile }) => {
							const gameLogSeason =
								player.stats.at(-1)?.season ??
								(player.ratings.length > 0
									? last(player.ratings).season
									: currentSeason);
							return playerProfileUrl(
								profile as string,
								player.pid,
								gameLogSeason,
							);
						},
					}
				: undefined,
	});

	const topStuff = (
		<TopStuff
			bestPos={bestPos}
			currentSeason={currentSeason}
			jerseyNumberInfos={jerseyNumberInfos}
			player={player}
			randomDebutsForeverPids={randomDebutsForeverPids}
			retired={retired}
			showRatings={showRatings}
			statSummary={statSummary}
			teamColors={teamColors}
			teamJersey={teamJersey}
			teamName={teamName}
			teamURL={teamURL}
			willingToSign={willingToSign}
		/>
	);

	if (!playerTraits) {
		return (
			<>
				{topStuff}
				<p>
					Player traits are turned off in this league. They can be turned on in
					the league settings.
				</p>
			</>
		);
	}

	if (!showRatings) {
		return (
			<>
				{topStuff}
				<p>Traits are hidden by the "no visible player ratings" challenge.</p>
			</>
		);
	}

	const byKey = new Map(playerTraits.traits.map((t) => [t.key, t]));
	const uncertain = playerTraits.traits.some((t) => !t.exact);

	return (
		<>
			{topStuff}

			<div className="mb-3" data-testid="player-traits-page">
				<TraitBadges traits={playerTraits.traits} max={6} />
				{uncertain ? (
					<p className="text-body-secondary mt-2 mb-0">
						{playerTraits.isProspect
							? "Scouting estimates, with the range you can be confident in. Hidden traits are the least certain and become clear after he plays in the league. A better scouting budget narrows the ranges."
							: "Hidden traits are still being learned and become exact after a few seasons in the league."}
					</p>
				) : null}
			</div>

			{playerTraits.agingCurve ? (
				<div
					className="alert alert-info"
					data-testid="aging-curve"
					style={{ maxWidth: 700 }}
				>
					<b>Aging curve: {playerTraits.agingCurve.name}</b>{" "}
					<span className="badge bg-secondary ms-1">
						Revealed on retirement
					</span>
					<div>{playerTraits.agingCurve.description}</div>
					<div className="small text-body-secondary">
						Nobody knew this while he played: it is only revealed on retirement.
					</div>
				</div>
			) : null}

			<HideableSection title="All traits" pageName="PlayerTraits">
				<div className="row">
					{TRAIT_KEYS.map((key) => {
						const trait = byKey.get(key);
						if (!trait) {
							return null;
						}
						const effect = effects[key];
						return (
							<div key={key} className="col-12 col-md-6 col-xl-4">
								<TraitBar trait={trait} />
								<div className="small mb-3" style={{ marginTop: -4 }}>
									{effect ? (
										<>
											<span className="text-body-secondary">For him: </span>
											{effect}
										</>
									) : (
										<span className="text-body-secondary">
											{TRAIT_DEFINITIONS[key].effect}
										</span>
									)}
								</div>
							</div>
						);
					})}
				</div>
				<TraitEffectsHelp />
			</HideableSection>

			{history.length > 0 && historyKeys.length > 0 ? (
				<HideableSection
					title="Trait history"
					description="His current personality with the ratings, age and experience of each season. Only traits whose reading is exact are shown."
					pageName="PlayerTraits"
				>
					<div className="table-responsive">
						<table className="table table-striped table-borderless table-sm table-nonfluid">
							<thead>
								<tr>
									<th>Season</th>
									<th>Age</th>
									{historyKeys.map((key) => (
										<th key={key} title={TRAIT_DEFINITIONS[key].name}>
											{TRAIT_SHORT[key]}
										</th>
									))}
								</tr>
							</thead>
							<tbody>
								{history.map((row) => (
									<tr key={row.season}>
										<td>{row.season}</td>
										<td>{row.age}</td>
										{historyKeys.map((key) => (
											<td key={key}>{row.scores[key]}</td>
										))}
									</tr>
								))}
							</tbody>
						</table>
					</div>
				</HideableSection>
			) : null}
		</>
	);
};

export default PlayerTraits;
