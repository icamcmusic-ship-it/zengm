import { useState } from "react";
import { wrappedFreeAgentMarket } from "../components/FreeAgentMarket.tsx";
import { dropdownOptions } from "../hooks/useDropdownOptions.tsx";
import { PHASE, PHASE_TEXT } from "../../common/constants.ts";
import { DataTable } from "../components/DataTable/index.tsx";
import { MoreLinks } from "../components/MoreLinks.tsx";
import useTitleBar from "../hooks/useTitleBar.tsx";
import { helpers } from "../util/helpers.ts";
import { getCols } from "../../common/getCols.ts";
import { useLocal } from "../util/local.ts";
import type { Phase, View } from "../../common/types.ts";
import { wrappedMood } from "../components/Mood.tsx";
import {
	wrappedContractAmount,
	wrappedContractExp,
} from "../components/contract.tsx";
import { wrappedPlayerNameLabels } from "../components/PlayerNameLabels.tsx";
import { range } from "../../common/utils.ts";
import { getAffordFilter } from "../../common/freeAgentsAffordFilter.ts";
import type { DropdownOption } from "../hooks/useDropdownOptions.tsx";
import type { FreeAgentTransaction } from "../../worker/views/freeAgents.ts";
import {
	type DataTableHandle,
	type DataTableRow,
} from "../components/DataTable/index.tsx";
import { NegotiateButtons } from "../components/NegotiateButtons.tsx";
import { RosterComposition } from "../components/RosterComposition.tsx";
import { RosterSalarySummary } from "../components/RosterSalarySummary.tsx";
import {
	NegotiationModal,
	useNegotiaionModal,
} from "../components/NegotiationModal.tsx";

const useSeasonsFreeAgents = () => {
	const { phase, season, startingSeason } = useLocal([
		"phase",
		"season",
		"startingSeason",
	]);

	// Decrease season by 1, since "free agent season" starts in the previous calendar year
	const minFreeAgencySeason = startingSeason - 1;

	// These are 1 lower than you'd expect, because there's also a "current" entry added below
	const maxFreeAgencySeason = phase >= PHASE.PLAYOFFS ? season - 1 : season - 2;

	const options: DropdownOption[] = range(
		minFreeAgencySeason,
		maxFreeAgencySeason + 1,
	).map((freeAgencySeason) => {
		let label;
		if (freeAgencySeason >= -10 && freeAgencySeason < 10) {
			label = `${freeAgencySeason}-${freeAgencySeason + 1}`;
		} else {
			label = `${freeAgencySeason}-${String((freeAgencySeason + 1) % 100).padStart(2)}`;
		}

		return {
			key: freeAgencySeason,
			label,
		};
	});

	options.push({
		key: "current",
		label: "Current",
	});

	options.reverse();

	return options;
};

const signedFreeAgentWrapped = (
	freeAgentTransaction: FreeAgentTransaction & {
		abbrev: string;
	},
	freeAgencySeason: number,
	season: number | "current",
	phase: Phase,
) => {
	let rosterSeason;

	if (season === "current" && phase >= PHASE.PLAYOFFS) {
		// Link to current season roster, because there is no next season roster
		rosterSeason = freeAgencySeason;
	} else {
		// Link to next season roster, because freeAgencySeason starts after the regular season ends
		rosterSeason = freeAgencySeason + 1;
	}

	return {
		value: (
			<>
				<a
					href={helpers.leagueUrl([
						"roster",
						`${freeAgentTransaction.abbrev}_${freeAgentTransaction.tid}`,
						rosterSeason,
					])}
				>
					{freeAgentTransaction.abbrev}
				</a>
				, {PHASE_TEXT[freeAgentTransaction.phase]}
			</>
		),
		searchValue: `${freeAgentTransaction.abbrev}, ${PHASE_TEXT[freeAgentTransaction.phase]}`,
	};
};

const FreeAgents = ({
	capExceptions,
	analytics,
	capSpace,
	market,
	signingAdvice,
	challengeNoFreeAgents,
	freeAgencySeason,
	numRosterSpots,
	payroll,
	players,
	season,
	stats,
	type,
	userPlayers,
}: View<"freeAgents">) => {
	const seasonsFreeAgents = useSeasonsFreeAgents();

	useTitleBar({
		title: "Free Agents",
		dropdown: {
			fields: [
				{ key: "type", options: dropdownOptions.typeFreeAgents, value: type },
				{
					key: "season",
					options: seasonsFreeAgents,
					value: season,
					buttons: "reverse",
				},
			],
			view: "freeAgents",
		},
	});

	const {
		challengeNoRatings,
		gameSimInProgress,
		minContract,
		phase,
		salaryCapType,
		spectator,
	} = useLocal([
		"challengeNoRatings",
		"gameSimInProgress",
		"minContract",
		"phase",
		"salaryCapType",
		"spectator",
	]);

	const [dataTableHandle, setDataTableHandle] =
		useState<DataTableHandle | null>(null);

	const negotiationModal = useNegotiaionModal();

	if (
		((phase > PHASE.AFTER_TRADE_DEADLINE && phase <= PHASE.RESIGN_PLAYERS) ||
			phase === PHASE.FANTASY_DRAFT ||
			phase === PHASE.EXPANSION_DRAFT) &&
		season === "current"
	) {
		return (
			<div>
				<MoreLinks type="freeAgents" page="free_agents" />
				<p>You're not allowed to sign free agents now.</p>
				<p>
					Free agents can only be signed before the playoffs or after players
					are re-signed.
				</p>
			</div>
		);
	}

	const askingForText = "Asking For";
	const colKeys = [
		"Name",
		"Pos",
		"Age",
		"Ovr",
		"Pot",
		...(analytics
			? [
					{
						title: "Proj",
						desc: "Analytics projection: your analytics department's 80% range for his ovr next season (narrower with a bigger Analytics budget, Team Finances)",
						sortSequence: ["desc", "asc"] as const,
						sortType: "number" as const,
					},
				]
			: []),
		...stats.map((stat) => `stat:${stat}`),
		"Mood",
		{
			title: "Market",
			desc: "AI teams interested in signing him, and the chance he signs with one of them on the next day (click for details)",
			sortSequence: ["desc", "asc"] as const,
			sortType: "number" as const,
		},
		askingForText,
		"Exp",
		"Actions",
	];
	const cols = getCols(colKeys, {
		Actions: {
			width: "1px",
		},
	});

	const showShowPlayersAffordButton = salaryCapType !== "none";

	// These are used in showAffordablePlayersFilterApplied calculation every render, and then also in toggleShowAfforablePlayers when that is called
	let askingForIndex = -1;
	let askingForFilter = "";

	let showAffordablePlayersFilterApplied = false;
	if (showShowPlayersAffordButton && dataTableHandle) {
		askingForIndex = colKeys.lastIndexOf(askingForText);
		askingForFilter = getAffordFilter({
			// A salary cap exception (setting) counts like that much cap space
			capSpace: Math.max(capSpace, capExceptions?.maxAmount ?? 0),
			challengeNoFreeAgents,
			minContract,
		});

		const enableFilters = dataTableHandle.getEnableFilters();
		if (enableFilters) {
			const filters = dataTableHandle.getFilters();
			showAffordablePlayersFilterApplied =
				filters[askingForIndex] === askingForFilter;
		}
	}

	const toggleShowAfforablePlayers = () => {
		if (dataTableHandle) {
			const enableFilters = dataTableHandle.getEnableFilters();

			// Start from either the current filters (if they are shown/enabled) or no filters at all
			const filters: string[] = enableFilters
				? [...dataTableHandle.getFilters()]
				: new Array(cols.length).fill("");

			// If we currently have this exact filter set, delete it. Otherwise, add it
			let newEnableFilters = true;
			if (filters[askingForIndex] === askingForFilter) {
				filters[askingForIndex] = "";

				// If no other filters are applied, hide filter bar
				if (filters.every((filter) => filter === "")) {
					newEnableFilters = false;
				}
			} else {
				filters[askingForIndex] = askingForFilter;
			}

			dataTableHandle.setFilters(filters, newEnableFilters);
		}
	};

	const playerInfoSeason =
		freeAgencySeason +
		(season === "current" && phase < PHASE.FREE_AGENCY ? 1 : 0);

	const rows: DataTableRow<"player">[] = players.map((p) => {
		const nameLabels = wrappedPlayerNameLabels({
			pid: p.pid,
			injury: p.injury,
			jerseyNumber: p.jerseyNumber,
			skills: p.ratings.skills,
			badges: p.ratings.badges,
			defaultWatch: p.watch,
			firstName: p.firstName,
			firstNameShort: p.firstNameShort,
			lastName: p.lastName,
			season: playerInfoSeason,
		});
		// Scouting info is only shown on player pages
		const blurb: string | undefined = undefined;
		const advice = signingAdvice[p.pid];
		return {
			key: p.pid,
			metadata: {
				type: "player",
				pid: p.pid,
				season: playerInfoSeason,
				playoffs: "regularSeason",
			},
			data: [
				blurb
					? {
							...nameLabels,
							value: (
								<>
									{nameLabels.value}
									<div
										className="small text-body-secondary text-wrap"
										style={{ maxWidth: 280 }}
										data-testid="fa-scouting-blurb"
									>
										{blurb}
									</div>
								</>
							),
						}
					: nameLabels,
				p.ratings.pos,
				p.age,
				!challengeNoRatings ? p.ratings.ovr : null,
				!challengeNoRatings ? p.ratings.pot : null,
				...(analytics
					? [
							analytics[p.pid]
								? {
										value: `${analytics[p.pid]!.lo}–${analytics[p.pid]!.hi}`,
										sortValue:
											(analytics[p.pid]!.lo + analytics[p.pid]!.hi) / 2,
									}
								: null,
						]
					: []),
				...stats.map((stat) => helpers.roundStat(p.stats[stat], stat)),
				p.freeAgentType === "available"
					? wrappedMood({
							defaultType: "user",
							maxWidth: true,
							p,
						})
					: undefined,
				p.freeAgentType === "available"
					? wrappedFreeAgentMarket(market[p.pid], p.mood.user.contractAmount)
					: undefined,
				wrappedContractAmount(p, p.contract.amount),
				wrappedContractExp(p),
				p.freeAgentType === "available"
					? spectator
						? null
						: {
								value: (
									<>
										<NegotiateButtons
											canGoOverCap={salaryCapType === "none"}
											capSpace={capSpace}
											exceptionAmount={capExceptions?.maxAmount}
											disabled={gameSimInProgress}
											minContract={minContract}
											onNegotiate={async () => {
												await negotiationModal.negotiate(p.pid);
											}}
											spectator={spectator}
											p={p}
											willingToNegotiate={p.mood.user.willing}
											signingAdvice={advice}
										/>
										{p.mood.user.willing && advice?.type === "tooLong" ? (
											<span
												className="small text-body-secondary text-nowrap"
												title={advice.reason}
											>
												Too long for exception
											</span>
										) : null}
									</>
								),
								classNames: "d-flex align-items-center gap-2",
								searchValue: p.mood.user.willing
									? "Negotiate Sign"
									: "Refuses!",
							}
					: signedFreeAgentWrapped(
							p.freeAgentTransaction,
							freeAgencySeason,
							season,
							phase,
						),
			],
		};
	});

	return (
		<>
			{season === "current" ? (
				<RosterComposition className="float-end mb-3" players={userPlayers} />
			) : null}
			<MoreLinks type="freeAgents" page="free_agents" />
			{season === "current" ? (
				<>
					<RosterSalarySummary
						capExceptions={capExceptions}
						capSpace={capSpace}
						numRosterSpots={numRosterSpots}
						payroll={payroll}
					/>

					{showShowPlayersAffordButton ? (
						<button
							className="btn btn-secondary mb-3"
							onClick={toggleShowAfforablePlayers}
						>
							{showAffordablePlayersFilterApplied
								? "Show players with any asking price"
								: "Show players you can afford now"}
						</button>
					) : null}
				</>
			) : null}

			{gameSimInProgress && !spectator ? (
				<p className="text-danger">Stop game simulation to sign free agents.</p>
			) : null}

			{spectator ? (
				<div>
					<div className="alert alert-danger d-inline-block">
						The AI will handle signing free agents in spectator mode.
					</div>
				</div>
			) : challengeNoFreeAgents ? (
				<div>
					<div className="alert alert-danger d-inline-block">
						<b>Challenge Mode:</b> You are not allowed to sign free agents,
						except to minimum contracts.
					</div>
				</div>
			) : null}

			<DataTable
				cols={cols}
				defaultSort={[cols.length - 3, "desc"]}
				defaultStickyCols={window.mobile ? 0 : 1}
				name="FreeAgents"
				pagination
				ref={setDataTableHandle}
				rows={rows}
			/>

			<NegotiationModal {...negotiationModal.props} />
		</>
	);
};

export default FreeAgents;
