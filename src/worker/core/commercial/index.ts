// Commercial Deals & Ownership (League Extra "commercial", basketball, needs budget): sponsorship and local TV deals, revenue sharing
// and ownership sales. Formulas: common/commercial.ts. With the setting off nothing here runs and no random numbers are drawn. Every
// draw uses a seeded stream (season, tid, purpose), never Math.random, so the main random stream is unchanged.

import { PHASE } from "../../../common/constants.ts";
import { MAX_LEVEL } from "../../../common/budgetLevels.ts";
import {
	DEAL_KINDS,
	DEAL_KIND_NAMES,
	DEAL_STYLES,
	OWNER_SALE_PROB,
	OWNER_TYPES,
	dealExpired,
	dealFairValue,
	dealGamePayment,
	makeOffers,
	pickNewOwnerType,
	revenueSharingPayouts,
	successScore,
	type CommercialDeal,
	type CommercialTeam,
	type DealKind,
	type DealStyle,
	type OwnerType,
} from "../../../common/commercial.ts";
import { marketFactor, type OwnerGoals } from "../../../common/ownerOffice.ts";
import { makeSeededRandom } from "../../../common/random.ts";
import { honeymoonOwnerMood } from "../../../common/ownerMood.ts";
import type { Team, TeamSeasonWithoutKey } from "../../../common/types.ts";
import { idb } from "../../db/index.ts";
import { g, helpers, local, logEvent, toUI } from "../../util/index.ts";
import { featureOn, featureOption } from "../../util/nativeFeatures.ts";
import getLevelLastThree from "../finances/getLevelLastThree.ts";
import { getFacilitiesBonus } from "../ownerOffice/index.ts";
import { resetOwnerProfile } from "../ownerOffice/owner.ts";
import { gmDealStyle } from "../gm/finance.ts";

export const commercialEnabled = () =>
	__SPORT === "basketball" && featureOn("commercial") && !!g.get("budget");

const seeded = (season: number, tid: number, salt: number) =>
	makeSeededRandom(season * 15485863 + tid * 32452843 + salt);

const SALT_OFFERS = 101;
const SALT_AI_CHOICE = 202;
const SALT_SALE = 303;

const ensure = (t: Team): CommercialTeam => {
	t.commercial ??= { deals: {} };
	return t.commercial;
};

export const getOwnerType = (t: Pick<Team, "commercial">): OwnerType =>
	commercialEnabled()
		? (t.commercial?.ownerType ?? "traditional")
		: "traditional";

const isUserTeam = (tid: number) =>
	g.get("userTids").includes(tid) &&
	!local.autoPlayUntil &&
	!g.get("spectator");

const rosterLink = (tid: number) =>
	`<a href="${helpers.leagueUrl([
		"roster",
		`${g.get("teamInfoCache")[tid]?.abbrev}_${tid}`,
		g.get("season"),
	])}">${g.get("teamInfoCache")[tid]?.name}</a>`;

const money = (thousands: number) =>
	helpers.formatCurrency(thousands / 1000, "M", 1);

// Fair value of each deal kind for a team this season
const fairValues = async (tid: number) => {
	const season = g.get("season");
	const current = (
		await idb.cache.teamSeasons.indexGetAll("teamSeasonsBySeasonTid", [
			[season],
			[season, "Z"],
		])
	).filter((ts) => !g.get("teamInfoCache")[ts.tid]?.disabled);
	const own = current.find((ts) => ts.tid === tid);
	const pops = current.map((ts) => ts.pop).sort((a, b) => b - a);
	const popRank = own ? pops.indexOf(own.pop) + 1 : Math.ceil(pops.length / 2);
	const market = marketFactor(popRank, pops.length);

	const prev = await idb.cache.teamSeasons.indexGetAll(
		"teamSeasonsByTidSeason",
		[
			[tid, season - 3],
			[tid, season - 1],
		],
	);
	const success = successScore(
		prev.map((ts) => {
			const gp = helpers.getTeamSeasonGp(ts);
			return {
				winp: gp > 0 ? (ts.won + 0.5 * ts.tied) / gp : 0.5,
				playoffRoundsWon: ts.playoffRoundsWon,
				numRounds: g.get("numGamesPlayoffSeries", ts.season).length,
			};
		}),
	);
	const star = own ? 0.7 * own.hype + 0.3 * market : 0.5;
	const t = await idb.cache.teams.get(tid);
	const facilitiesLevel =
		(await getLevelLastThree("facilities", { tid })) +
		(t ? getFacilitiesBonus(t) : 0);
	const facilities = (facilitiesLevel - 1) / (MAX_LEVEL - 1);
	const out = {} as Record<DealKind, number>;
	for (const kind of DEAL_KINDS) {
		out[kind] = dealFairValue({
			kind,
			salaryCap: g.get("salaryCap"),
			market,
			success,
			star,
			facilities,
		});
	}
	return out;
};

const aiStyle = (t: Team, rng: () => number): DealStyle => {
	const ownerType = getOwnerType(t);
	const preferred = OWNER_TYPES[ownerType].dealStyle;
	// AI GM finance styles: the GM's preferred style (undefined when off or he has none). A traditional owner leaves the choice to him;
	// another owner type's preference comes first and the GM picks within the rest
	const gmStyle = gmDealStyle(t);
	const first = gmStyle && ownerType === "traditional" ? gmStyle : preferred;
	if (rng() < 0.6) {
		return first;
	}
	if (gmStyle && first !== gmStyle && rng() < 0.6) {
		return gmStyle;
	}
	const styles: DealStyle[] = ["long", "standard", "short"];
	return styles[Math.floor(rng() * styles.length)]!;
};

const sign = (t: Team, deal: CommercialDeal) => {
	const office = ensure(t);
	office.deals[deal.kind] = deal;
	if (office.offers) {
		delete office.offers[deal.kind];
	}
	if (isUserTeam(t.tid)) {
		logEvent({
			type: "commercialDeal",
			text: `The ${rosterLink(t.tid)} signed a ${deal.years}-season ${DEAL_KIND_NAMES[deal.kind].toLowerCase()} deal with ${deal.partner} worth ${money(deal.annual)} a season${deal.bonus > 0 ? ` plus up to ${money(deal.bonus)} in winning bonuses` : ""}.`,
			tids: [t.tid],
			showNotification: false,
			score: 0,
		});
	}
};

// Expired deals: offers for the user (a message), a seeded pick for AI teams. Returns the kinds the user has offers for
const renewDeals = async (t: Team) => {
	const season = g.get("season");
	const office = ensure(t);
	const expired = DEAL_KINDS.filter(
		(kind) => dealExpired(office.deals[kind], season) && !office.offers?.[kind],
	);
	if (expired.length === 0) {
		return [];
	}
	const fair = await fairValues(t.tid);
	const user = isUserTeam(t.tid);
	const userKinds: DealKind[] = [];
	for (const kind of expired) {
		const rng = seeded(season, t.tid, SALT_OFFERS + DEAL_KINDS.indexOf(kind));
		const offers = makeOffers({
			kind,
			fair: fair[kind],
			startSeason: season,
			rng,
		});
		if (user) {
			office.offers ??= {};
			office.offers[kind] = offers;
			userKinds.push(kind);
		} else {
			const style = aiStyle(
				t,
				seeded(season, t.tid, SALT_AI_CHOICE + DEAL_KINDS.indexOf(kind)),
			);
			sign(
				t,
				offers.find((offer) => offer.style === style)!,
			);
		}
	}
	return userKinds;
};

// One regular season game's deal payments (thousands, before the difficulty fudge factor), into the new revenue lines. A missing deal
// (feature just turned on, new league) is set up here; pending user offers are signed at their standard terms
export const payGame = async (
	t: Team,
	teamSeason: TeamSeasonWithoutKey,
	fudgeFactor: number,
) => {
	if (g.get("phase") === PHASE.PLAYOFFS) {
		return 0;
	}
	const office = ensure(t);
	if (
		DEAL_KINDS.some((kind) => dealExpired(office.deals[kind], g.get("season")))
	) {
		await renewDeals(t);
		for (const kind of DEAL_KINDS) {
			const offers = office.offers?.[kind];
			if (offers && dealExpired(office.deals[kind], g.get("season"))) {
				sign(
					t,
					offers.find((offer) => offer.style === "standard")!,
				);
			}
		}
	}
	const gp = helpers.getTeamSeasonGp(teamSeason);
	const winp = gp > 0 ? (teamSeason.won + 0.5 * teamSeason.tied) / gp : 0.5;
	let total = 0;
	for (const kind of DEAL_KINDS) {
		const deal = office.deals[kind];
		if (!deal) {
			continue;
		}
		const amount = fudgeFactor * dealGamePayment(deal, g.get("numGames"), winp);
		const key = kind === "sponsor" ? "sponsorDeal" : "localTvDeal";
		teamSeason.revenues[key] = (teamSeason.revenues[key] ?? 0) + amount;
		total += amount;
	}
	return total;
};

// Revenue sharing, at the end of the regular season (with the luxury tax). Contributions are an expense line, payouts a revenue line
export const shareRevenue = (teamSeasons: TeamSeasonWithoutKey[]) => {
	if (!commercialEnabled()) {
		return;
	}
	const sharePct = featureOption<number>("featureRevenueSharePct");
	if (!(sharePct > 0)) {
		return;
	}
	const mode =
		featureOption<string>("featureRevenueShareMode") === "smallMarkets"
			? "smallMarkets"
			: "equal";
	const active = teamSeasons.filter(
		(ts) => !g.get("teamInfoCache")[ts.tid]?.disabled,
	);
	const pops = active.map((ts) => ts.pop).sort((a, b) => b - a);
	const rows = active.map((ts) => ({
		localRevenue:
			ts.revenues.ticket +
			ts.revenues.merch +
			ts.revenues.sponsor +
			ts.revenues.localTv +
			(ts.revenues.sponsorDeal ?? 0) +
			(ts.revenues.localTvDeal ?? 0),
		market: marketFactor(pops.indexOf(ts.pop) + 1, pops.length),
	}));
	const payouts = revenueSharingPayouts(rows, sharePct, mode);
	for (const [i, ts] of active.entries()) {
		const { contribution, payout } = payouts[i]!;
		ts.expenses.revenueSharing = contribution;
		ts.revenues.revenueSharing = payout;
		ts.cash += payout - contribution;
		if (isUserTeam(ts.tid)) {
			logEvent({
				type: "revenueSharing",
				text: `The ${rosterLink(ts.tid)} paid ${money(contribution)} into the league's revenue sharing pool and received ${money(payout)} (net ${payout >= contribution ? "+" : "-"}${money(Math.abs(payout - contribution))}).`,
				tids: [ts.tid],
				showNotification: false,
				score: 0,
			});
		}
	}
};

// Messages from the owner go to every user team (multi-team mode included), so a user team never gets a sale or deal renewals silently
const userMessage = async (tid: number, subject: string, text: string) => {
	const multiTeam = g.get("userTids").length > 1;
	await idb.cache.messages.add({
		read: false,
		from: "The Owner",
		year: g.get("season"),
		text,
		subject: multiTeam
			? `${subject} (${g.get("teamInfoCache")[tid]?.region ?? ""} ${g.get("teamInfoCache")[tid]?.name ?? ""})`.trim()
			: subject,
		tid,
	});
};

const applySale = async (t: Team, ownerType: OwnerType) => {
	const office = ensure(t);
	office.ownerType = ownerType;
	office.ownerSince = g.get("season");
	office.pendingSale = undefined;
	const def = OWNER_TYPES[ownerType];
	// Owner's Office: the new owner has his own name and personality traits
	resetOwnerProfile(t, g.get("season"));

	// Honeymoon: the new owner doesn't inherit his predecessor's grudges (common/ownerMood.ts)
	const teamSeason = await idb.cache.teamSeasons.indexGet(
		"teamSeasonsByTidSeason",
		[t.tid, g.get("season")],
	);
	if (teamSeason?.ownerMood) {
		teamSeason.ownerMood = honeymoonOwnerMood(teamSeason.ownerMood);
		await idb.cache.teamSeasons.put(teamSeason);
	}

	logEvent({
		type: "ownerSale",
		text: `The ${rosterLink(t.tid)} have been sold. The new owner is a ${def.name.toLowerCase()} type: ${def.description.toLowerCase()}`,
		tids: [t.tid],
		showNotification: isUserTeam(t.tid),
		score: 20,
	});
};

// Preseason, before AI teams set their budgets (after the new team season rows exist): ownership sales, so a sold AI team's budget
// already follows its new owner. The user's team gets a season's notice
export const onPreseasonSales = async () => {
	if (!commercialEnabled()) {
		return;
	}
	const season = g.get("season");
	const teams = (await idb.cache.teams.getAll()).filter((t) => !t.disabled);
	for (const t of teams) {
		const office = ensure(t);

		if (office.pendingSale && office.pendingSale.season <= season) {
			await applySale(t, office.pendingSale.ownerType);
		} else if (!office.pendingSale) {
			const rng = seeded(season, t.tid, SALT_SALE);
			if (rng() < OWNER_SALE_PROB) {
				const ownerType = pickNewOwnerType(getOwnerType(t), rng);
				if (isUserTeam(t.tid)) {
					office.pendingSale = { season: season + 1, ownerType };
					await userMessage(
						t.tid,
						"The team is being sold",
						`<p>I wanted you to hear it from me first: I have agreed to sell the team. The new ownership group takes over before next season.</p><p>From what I hear they are the <b>${OWNER_TYPES[ownerType].name.toLowerCase()}</b> type. ${OWNER_TYPES[ownerType].description} Plan accordingly.</p>`,
					);
				} else {
					await applySale(t, ownerType);
				}
			}
		}
		await idb.cache.teams.put(t);
	}
};

// Preseason (after the AI budgets are set): deal renewals
export const onPreseason = async () => {
	if (!commercialEnabled()) {
		return;
	}
	const teams = (await idb.cache.teams.getAll()).filter((t) => !t.disabled);
	for (const t of teams) {
		const userKinds = await renewDeals(t);
		if (isUserTeam(t.tid) && userKinds.length > 0) {
			await userMessage(
				t.tid,
				"Commercial deals up for renewal",
				`<p>Our ${userKinds.map((kind) => DEAL_KIND_NAMES[kind].toLowerCase()).join(" and ")} deal${userKinds.length > 1 ? "s are" : " is"} up. Pick one of the offers on <a href="${helpers.leagueUrl(["team_finances"])}">Team Finances</a> before the regular season starts, or I'll sign the standard one.</p>`,
			);
		}
		await idb.cache.teams.put(t);
	}
};

// Owner's Office budget meeting goals, adjusted for the owner's type
export const adjustOwnerGoals = (
	goals: OwnerGoals,
	t: Pick<Team, "commercial">,
	salaryCapScale: number,
) => {
	const def = OWNER_TYPES[getOwnerType(t)];
	goals.maxPayroll = Math.round(goals.maxPayroll * def.payrollFactor);
	goals.taxWilling = goals.maxPayroll > g.get("luxuryPayroll");
	goals.profitTarget =
		Math.round(
			10 * (goals.profitTarget + def.profitTargetDelta * salaryCapScale),
		) / 10;
	return goals;
};

// The user picks an offer. Returns an error message, or undefined on success
export const chooseOffer = async (kind: DealKind, style: DealStyle) => {
	if (!commercialEnabled()) {
		return "Commercial Deals & Ownership is turned off for this league.";
	}
	if (!DEAL_KINDS.includes(kind) || !DEAL_STYLES[style]) {
		return "Unknown offer.";
	}
	const t = await idb.cache.teams.get(g.get("userTid"));
	const offer = t?.commercial?.offers?.[kind]?.find((o) => o.style === style);
	if (!t || !offer) {
		return "That offer is no longer available.";
	}
	sign(t, offer);
	await idb.cache.teams.put(t);
	await toUI("realtimeUpdate", [["teamFinances"]]);
};

// Everything Team Finances shows. Undefined when off
export const getFinancesInfo = async (tid: number) => {
	if (!commercialEnabled()) {
		return;
	}
	const t = await idb.cache.teams.get(tid);
	if (!t) {
		return;
	}
	const ownerType = getOwnerType(t);
	return {
		deals: DEAL_KINDS.map((kind) => ({
			kind,
			name: DEAL_KIND_NAMES[kind],
			deal: t.commercial?.deals[kind],
			offers: t.commercial?.offers?.[kind] ?? [],
		})),
		styles: DEAL_STYLES,
		owner: {
			type: ownerType,
			...OWNER_TYPES[ownerType],
			since: t.commercial?.ownerSince,
			pendingSale: t.commercial?.pendingSale
				? {
						season: t.commercial.pendingSale.season,
						name: OWNER_TYPES[t.commercial.pendingSale.ownerType].name,
					}
				: undefined,
		},
		sharePct: featureOption<number>("featureRevenueSharePct"),
		shareMode: featureOption<string>("featureRevenueShareMode"),
	};
};
