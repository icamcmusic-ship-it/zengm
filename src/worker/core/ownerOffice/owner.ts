// Owner's Office: the owner as a person (common/ownerProfile.ts). His name and traits, stored on t.ownerOffice.owner (derived from the
// team and his first season when missing, so existing leagues get the same owner every time), and for the user's team his mid-season
// requests, ultimatums and mandates (teamSeason.ownerSeason). Every draw is from a seeded stream (season, tid, checkpoint), never
// Math.random. Requests only exist where the end-of-season evaluation judges them: one user team, not auto play or spectator, not God
// Mode, not college, after the grace period and not in a new owner's first season.

import { PHASE, PLAYER } from "../../../common/constants.ts";
import {
	OWNER_REQUESTS,
	REQUEST_CHECKPOINTS,
	firingLine,
	genOwnerProfile,
	makeRequest,
	maxRequests,
	patienceGraceBonus,
	requestProb,
	resolveRequest,
	starTradePenalty,
	sumAdjustments,
	traitAiBudgetNudge,
	traitAiProjectFactor,
	traitPayrollFactor,
	traitWinPctShift,
	type OwnerAdjustment,
	type OwnerProfile,
	type OwnerRequest,
	type OwnerRequestKind,
	type OwnerSeasonState,
} from "../../../common/ownerProfile.ts";
import type { OwnerGoals } from "../../../common/ownerOffice.ts";
import { makeSeededRandom } from "../../../common/random.ts";
import type {
	OwnerMood,
	Player,
	Team,
	TeamSeasonWithoutKey,
} from "../../../common/types.ts";
import { idb } from "../../db/index.ts";
import { g, helpers, local, logEvent, toUI } from "../../util/index.ts";
import { isCollege } from "../college/isCollege.ts";
import getPayroll from "../team/getPayroll.ts";
import { ownerOfficeEnabled } from "./enabled.ts";

const SALT_REQUESTS = 577;

const defaultSince = (t: Pick<Team, "commercial">) =>
	t.commercial?.ownerSince ?? g.get("startingSeason");

// The owner's profile: stored, or derived (team, first season) when missing
export const getOwnerProfile = (
	t: Pick<Team, "tid" | "ownerOffice" | "commercial">,
): OwnerProfile =>
	t.ownerOffice?.owner ?? genOwnerProfile(t.tid, defaultSince(t));

export const ensureOwnerProfile = (t: Team) => {
	t.ownerOffice ??= { completed: [], facilitiesBonus: 0 };
	t.ownerOffice.owner ??= genOwnerProfile(t.tid, defaultSince(t));
	return t.ownerOffice.owner;
};

// A sale (Commercial Deals & Ownership): the new owner has his own name and traits
export const resetOwnerProfile = (t: Team, season: number) => {
	if (!ownerOfficeEnabled()) {
		return;
	}
	t.ownerOffice ??= { completed: [], facilitiesBonus: 0 };
	t.ownerOffice.owner = genOwnerProfile(t.tid, season);
};

// Traits only matter where the Owner's Office runs, and never in college (the athletic department judges the season there)
const traitsActive = () => ownerOfficeEnabled() && !isCollege();

// Budget meeting goals: the owner's tax appetite moves the payroll ceiling, his patience the win target. Bounded (±4%, ±2%)
export const adjustGoalsForTraits = (
	goals: OwnerGoals,
	t: Pick<Team, "tid" | "ownerOffice" | "commercial">,
) => {
	const { traits } = getOwnerProfile(t);
	const numGames = g.get("numGames");
	goals.maxPayroll = Math.round(goals.maxPayroll * traitPayrollFactor(traits));
	goals.taxWilling = goals.maxPayroll > g.get("luxuryPayroll");
	goals.winTarget = helpers.bound(
		Math.round(goals.winTarget + traitWinPctShift(traits) * numGames),
		0,
		numGames,
	);
	return goals;
};

// AI teams: budget levels added to the spending (0 when off)
export const ownerAiBudgetNudge = (
	t: Pick<Team, "tid" | "ownerOffice" | "commercial">,
) => (traitsActive() ? traitAiBudgetNudge(getOwnerProfile(t).traits) : 0);

// AI teams: multiplier of the chance to start a project
export const ownerAiProjectFactor = (
	t: Pick<Team, "tid" | "ownerOffice" | "commercial">,
) => (traitsActive() ? traitAiProjectFactor(getOwnerProfile(t).traits) : 1);

// The user's firing rule: the overall mood at or below which he is fired and the extra seasons after the grace period. Stock: -1, 0
export const getFiringRule = async () => {
	if (!traitsActive()) {
		return { line: -1, graceBonus: 0 };
	}
	const t = await idb.cache.teams.get(g.get("userTid"));
	if (!t) {
		return { line: -1, graceBonus: 0 };
	}
	const { traits } = getOwnerProfile(t);
	return { line: firingLine(traits), graceBonus: patienceGraceBonus(traits) };
};

const isUserTeam = (tid: number) =>
	g.get("userTids").length === 1 &&
	g.get("userTid") === tid &&
	!local.autoPlayUntil &&
	!g.get("spectator");

// Whether the owner makes requests of this team this season
export const requestsActive = (
	t: Pick<Team, "tid" | "ownerOffice" | "commercial">,
) =>
	traitsActive() &&
	isUserTeam(t.tid) &&
	!g.get("godMode") &&
	g.get("season") >= g.get("gracePeriodEnd") &&
	// Honeymoon: a new owner doesn't make demands in his first season
	!(
		getOwnerProfile(t).since === g.get("season") &&
		g.get("season") > g.get("startingSeason")
	);

const playerName = (p: Pick<Player, "firstName" | "lastName">) =>
	`${p.firstName} ${p.lastName}`;

const ownerLink = () => `<a href="${helpers.leagueUrl(["owner"])}">Owner</a>`;

const seasonMinutes = (p: Player, tid: number) => {
	let min = 0;
	let gp = 0;
	for (const row of p.stats) {
		if (row.season === g.get("season") && row.tid === tid && !row.playoffs) {
			min += (row as any).min ?? 0;
			gp += (row as any).gp ?? 0;
		}
	}
	return { min, gp };
};

const getFranchisePlayer = (players: Player[]) =>
	players.toSorted((a, b) => b.value - a.value)[0];

const newSeasonState = async (tid: number): Promise<OwnerSeasonState> => {
	const players = await idb.cache.players.indexGetAll("playersByTid", tid);
	const franchise = getFranchisePlayer(players);
	return {
		franchisePid: franchise?.pid,
		franchiseName: franchise ? playerName(franchise) : undefined,
		checkpoints: [],
		requests: [],
		adjustments: [],
	};
};

// Preseason: the user's team starts the season with a clean slate (and the franchise player noted)
export const onPreseasonOwner = async (
	t: Team,
	teamSeason: TeamSeasonWithoutKey,
) => {
	ensureOwnerProfile(t);
	teamSeason.ownerSeason = requestsActive(t)
		? await newSeasonState(t.tid)
		: undefined;
};

const money = (thousands: number) =>
	helpers.formatCurrency(thousands / 1000, "M", 1);

const stakeText = (r: OwnerRequest) => {
	const def = OWNER_REQUESTS[r.kind];
	const component =
		def.component === "wins"
			? "regular season"
			: def.component === "playoffs"
				? "playoffs"
				: "finances";
	return def.mandate
		? `Overriding it costs ${r.penalty.toFixed(2)} of owner mood (${component}).`
		: `At stake: ${r.reward > 0 ? `+${r.reward.toFixed(2)} if you do it, ` : ""}${(-r.penalty).toFixed(2)} if you don't (owner mood, ${component}).`;
};

export const describeRequest = (r: OwnerRequest) => {
	switch (r.kind) {
		case "makePlayoffs":
			return "Make the playoffs this season. If we miss them, don't count on keeping your job.";
		case "cutPayroll":
			return `Get the payroll down to ${money(r.target ?? 0)} by ${r.due === "tradeDeadline" ? "the trade deadline" : "the end of the regular season"}.`;
		case "keepStar":
			return `Don't trade ${r.playerName ?? "our franchise player"}. He is this franchise.`;
		case "playYoung":
			return `Play the young guys (${(r.young ?? []).map((y) => y.name).join(", ")}): at least ${r.target ?? 0} minutes a game each, on average, the rest of the regular season.`;
		case "ticketFreeze":
			return `I've frozen ticket prices at ${helpers.formatCurrency(r.target ?? 0)} for the rest of the season (automatic ticket pricing is off). The fans deserve a break.`;
		case "keepFanFavorite":
			return `${r.playerName ?? "He"} stays. The fans love him, so he finishes the season here.`;
	}
};

// Candidates for a checkpoint, in a fixed order (shuffled by the seeded stream afterwards)
const candidates = async (
	t: Team,
	teamSeason: TeamSeasonWithoutKey,
	state: OwnerSeasonState,
	checkpoint: number,
	gp: number,
): Promise<
	(Omit<OwnerRequest, "kind" | "reward" | "penalty" | "status" | "id"> & {
		kind: OwnerRequestKind;
	})[]
> => {
	const out: (Omit<
		OwnerRequest,
		"kind" | "reward" | "penalty" | "status" | "id"
	> & { kind: OwnerRequestKind })[] = [];
	const { traits } = getOwnerProfile(t);
	const players = await idb.cache.players.indexGetAll("playersByTid", t.tid);
	const has = (kind: OwnerRequestKind) =>
		state.requests.some((r) => r.kind === kind);
	const season = g.get("season");

	if (checkpoint === 0) {
		const goals = teamSeason.ownerGoals;
		const payroll = await getPayroll(t.tid);
		if (goals && payroll > goals.maxPayroll && !has("cutPayroll")) {
			out.push({
				kind: "cutPayroll",
				issuedGp: gp,
				due:
					g.get("tradeDeadline") < 1 && g.get("phase") === PHASE.REGULAR_SEASON
						? "tradeDeadline"
						: "seasonEnd",
				target: goals.maxPayroll,
			});
		}

		const star = players.find((p) => p.pid === state.franchisePid);
		if (star && traits.starLoyalty >= 0.35 && !has("keepStar")) {
			out.push({
				kind: "keepStar",
				issuedGp: gp,
				due: "seasonEnd",
				pid: star.pid,
				playerName: playerName(star),
			});
		}

		const young = players
			.filter((p) => season - p.born.year <= 23 && p.pid !== state.franchisePid)
			.toSorted((a, b) => b.value - a.value)
			.slice(0, 2)
			.map((p) => ({ p, ...seasonMinutes(p, t.tid) }))
			.filter(({ min }) => gp > 0 && min / gp < 18);
		if (young.length > 0 && !has("playYoung")) {
			out.push({
				kind: "playYoung",
				issuedGp: gp,
				due: "seasonEnd",
				target: 18,
				young: young.map(({ p, min }) => ({
					pid: p.pid,
					name: playerName(p),
					min,
				})),
			});
		}

		if (!has("ticketFreeze") && t.budget.ticketPrice > 0) {
			out.push({
				kind: "ticketFreeze",
				issuedGp: gp,
				due: "seasonEnd",
				target: t.budget.ticketPrice,
			});
		}

		const fanFavorite = players
			.filter((p) => p.pid !== state.franchisePid && season - p.born.year >= 27)
			.map((p) => ({
				p,
				seasons: new Set(
					p.stats
						.filter((row) => row.tid === t.tid && !row.playoffs)
						.map((row) => row.season),
				).size,
			}))
			.filter(({ seasons }) => seasons >= 4)
			.toSorted((a, b) => b.seasons - a.seasons || b.p.value - a.p.value)[0];
		if (fanFavorite && !has("keepFanFavorite")) {
			out.push({
				kind: "keepFanFavorite",
				issuedGp: gp,
				due: "seasonEnd",
				pid: fanFavorite.p.pid,
				playerName: playerName(fanFavorite.p),
			});
		}
	} else {
		const winp = gp > 0 ? (teamSeason.won + 0.5 * teamSeason.tied) / gp : 0.5;
		if (winp >= 0.35 && winp <= 0.6 && !has("makePlayoffs")) {
			out.push({ kind: "makePlayoffs", issuedGp: gp, due: "seasonEnd" });
		}
	}
	return out;
};

const runCheckpoint = async (
	t: Team,
	teamSeason: TeamSeasonWithoutKey,
	state: OwnerSeasonState,
	checkpoint: number,
	gp: number,
) => {
	state.checkpoints.push(checkpoint);
	const { traits } = getOwnerProfile(t);
	const rng = makeSeededRandom(
		g.get("season") * 15485863 + t.tid * 32452843 + SALT_REQUESTS + checkpoint,
	);
	const list = await candidates(t, teamSeason, state, checkpoint, gp);
	// Seeded shuffle, then each with the meddling probability, up to the season's limit
	for (let i = list.length - 1; i > 0; i--) {
		const j = Math.floor(rng() * (i + 1));
		[list[i], list[j]] = [list[j]!, list[i]!];
	}
	const issued: OwnerRequest[] = [];
	for (const c of list) {
		const roll = rng();
		if (state.requests.length >= maxRequests(traits)) {
			break;
		}
		if (roll >= requestProb(traits)) {
			continue;
		}
		const request = makeRequest(c.kind, traits, {
			...c,
			id: state.requests.length,
		});
		state.requests.push(request);
		issued.push(request);
		if (request.kind === "ticketFreeze") {
			t.autoTicketPrice = false;
		}
	}
	if (issued.length === 0) {
		return;
	}

	const profile = getOwnerProfile(t);
	let text = `<p>I've been watching the season closely. ${issued.length === 1 ? "One thing" : "A few things"} I need from you:</p><ul>`;
	for (const r of issued) {
		text += `<li><b>${OWNER_REQUESTS[r.kind].title}.</b> ${describeRequest(r)} <i>${stakeText(r)}</i>${OWNER_REQUESTS[r.kind].mandate ? ` You can override it on the ${ownerLink()} page.` : ""}</li>`;
	}
	text += `</ul><p>You can follow these on the ${ownerLink()} page.</p><p>${profile.name}</p>`;
	await idb.cache.messages.add({
		read: false,
		from: "The Owner",
		year: g.get("season"),
		text,
		subject:
			checkpoint === 1
				? "An ultimatum from the owner"
				: "A word from the owner",
		tid: t.tid,
	});
	void logEvent({
		type: "ownerRequest",
		text: `The owner has ${issued.length === 1 ? "a request" : `${issued.length} requests`}: ${issued.map((r) => OWNER_REQUESTS[r.kind].title.toLowerCase()).join("; ")}. See the ${ownerLink()} page.`,
		tids: [t.tid],
		showNotification: true,
		score: 0,
	});
};

const resolve = (
	state: OwnerSeasonState,
	request: OwnerRequest,
	status: "met" | "missed" | "overridden",
	note: string,
	tid: number,
) => {
	const adjustment = resolveRequest(request, status, note);
	state.adjustments.push(adjustment);
	if (status !== "met" || adjustment.delta !== 0) {
		void logEvent({
			type: "ownerRequest",
			text: `${OWNER_REQUESTS[request.kind].title}: ${note} (owner mood ${adjustment.delta >= 0 ? "+" : ""}${adjustment.delta.toFixed(2)}).`,
			tids: [tid],
			showNotification: status !== "met",
			score: 0,
		});
	}
};

// A request that no longer applies (the player died): closed with no mood change
const cancel = (request: OwnerRequest, note: string) => {
	request.status = "met";
	request.note = note;
	request.delta = 0;
};

const onTeam = async (pid: number | undefined, tid: number) => {
	if (pid === undefined) {
		return { gone: false, died: false };
	}
	const p = await idb.cache.players.get(pid);
	return {
		gone: !p || p.tid !== tid,
		died: !!p && p.tid === PLAYER.RETIRED,
		p,
	};
};

// Watch for broken promises: the franchise player or fan favorite gone, ticket prices raised
const poll = async (t: Team, state: OwnerSeasonState) => {
	const { traits } = getOwnerProfile(t);

	const star = await onTeam(state.franchisePid, t.tid);
	if (star.gone && !state.franchiseGone) {
		state.franchiseGone = true;
		const request = state.requests.find(
			(r) => r.kind === "keepStar" && r.status === "open",
		);
		if (star.died) {
			if (request) {
				cancel(request, "No longer applies.");
			}
		} else if (request) {
			resolve(state, request, "missed", `${request.playerName} is gone`, t.tid);
		} else {
			const delta = -starTradePenalty(traits);
			state.adjustments.push({
				text: `Franchise player ${state.franchiseName ?? ""} traded or released`.trim(),
				component: "wins",
				delta,
			});
			void logEvent({
				type: "ownerRequest",
				text: `The owner is unhappy that ${state.franchiseName ?? "the franchise player"} is gone (owner mood ${delta.toFixed(2)}).`,
				tids: [t.tid],
				showNotification: true,
				score: 0,
			});
		}
	}

	for (const request of state.requests) {
		if (request.status !== "open") {
			continue;
		}
		if (request.kind === "keepFanFavorite") {
			const info = await onTeam(request.pid, t.tid);
			if (info.died) {
				cancel(request, "No longer applies.");
			} else if (info.gone) {
				resolve(
					state,
					request,
					"overridden",
					`${request.playerName} is gone`,
					t.tid,
				);
			}
		} else if (
			request.kind === "ticketFreeze" &&
			t.budget.ticketPrice > (request.target ?? Infinity) + 0.005
		) {
			resolve(state, request, "overridden", "ticket prices were raised", t.tid);
		}
	}
};

// Every regular season game of the user's team (writeTeamStats, after the result is counted): checks and checkpoints
export const onUserGame = async (t: Team, teamSeason: TeamSeasonWithoutKey) => {
	if (g.get("phase") === PHASE.PLAYOFFS || !requestsActive(t)) {
		return;
	}
	// Turned on (or the league upgraded) mid-season
	teamSeason.ownerSeason ??= await newSeasonState(t.tid);
	const state = teamSeason.ownerSeason;

	await poll(t, state);

	const gp = helpers.getTeamSeasonGp(teamSeason);
	const numGames = g.get("numGames");
	for (const [i, share] of REQUEST_CHECKPOINTS.entries()) {
		if (!state.checkpoints.includes(i) && gp >= Math.round(share * numGames)) {
			await runCheckpoint(t, teamSeason, state, i, gp);
		}
	}
};

const resolvePayroll = async (
	state: OwnerSeasonState,
	request: OwnerRequest,
	tid: number,
) => {
	const payroll = await getPayroll(tid);
	const ok = payroll <= (request.target ?? Infinity) + 0.5;
	resolve(
		state,
		request,
		ok ? "met" : "missed",
		`payroll ${money(payroll)} vs ${money(request.target ?? 0)}`,
		tid,
	);
};

// Trade deadline: the payroll request comes due
export const onTradeDeadline = async () => {
	if (!traitsActive()) {
		return;
	}
	const tid = g.get("userTid");
	const teamSeason = await idb.cache.teamSeasons.indexGet(
		"teamSeasonsByTidSeason",
		[tid, g.get("season")],
	);
	const state = teamSeason?.ownerSeason;
	if (!teamSeason || !state) {
		return;
	}
	for (const request of state.requests) {
		if (
			request.status === "open" &&
			request.kind === "cutPayroll" &&
			request.due === "tradeDeadline"
		) {
			await resolvePayroll(state, request, tid);
		}
	}
	await idb.cache.teamSeasons.put(teamSeason);
};

// End of the season (updateOwnerMood): every open request is judged. Returns the season's adjustments, summed by mood component and
// bounded (common/ownerProfile.ts sumAdjustments)
export const resolveOwnerSeason = async (
	teamSeason: TeamSeasonWithoutKey,
): Promise<{ sums: OwnerMood; adjustments: OwnerAdjustment[] } | undefined> => {
	const state = teamSeason.ownerSeason;
	if (!traitsActive() || !state) {
		return;
	}
	const tid = teamSeason.tid;
	const t = await idb.cache.teams.get(tid);
	if (t) {
		await poll(t, state);
	}
	for (const request of state.requests) {
		if (request.status !== "open") {
			continue;
		}
		switch (request.kind) {
			case "makePlayoffs":
				resolve(
					state,
					request,
					teamSeason.playoffRoundsWon >= 0 ? "met" : "missed",
					teamSeason.playoffRoundsWon >= 0
						? "made the playoffs"
						: "missed the playoffs",
					tid,
				);
				break;
			case "cutPayroll":
				await resolvePayroll(state, request, tid);
				break;
			case "playYoung": {
				const gamesSince = Math.max(
					1,
					helpers.getTeamSeasonGp(teamSeason) - request.issuedGp,
				);
				let total = 0;
				const young = request.young ?? [];
				for (const y of young) {
					const p = await idb.cache.players.get(y.pid);
					const now = p ? seasonMinutes(p, tid).min : y.min;
					total += Math.max(0, now - y.min);
				}
				const avg = young.length > 0 ? total / young.length / gamesSince : 0;
				resolve(
					state,
					request,
					avg >= (request.target ?? 0) ? "met" : "missed",
					`${avg.toFixed(1)} minutes a game each`,
					tid,
				);
				break;
			}
			case "keepStar":
				resolve(state, request, "met", `${request.playerName} stayed`, tid);
				break;
			case "keepFanFavorite":
				resolve(state, request, "met", `${request.playerName} stayed`, tid);
				break;
			case "ticketFreeze":
				resolve(state, request, "met", "prices stayed frozen", tid);
				break;
		}
	}
	return {
		sums: sumAdjustments(state.adjustments),
		adjustments: [...state.adjustments],
	};
};

// The user overrides one of the owner's mandates. Returns an error message, or undefined on success
export const overrideMandate = async (id: number) => {
	if (!traitsActive()) {
		return "Owner's Office is turned off for this league.";
	}
	const tid = g.get("userTid");
	const teamSeason = await idb.cache.teamSeasons.indexGet(
		"teamSeasonsByTidSeason",
		[tid, g.get("season")],
	);
	const state = teamSeason?.ownerSeason;
	const request = state?.requests.find((r) => r.id === id);
	if (!teamSeason || !state || !request) {
		return "That mandate no longer exists.";
	}
	if (!OWNER_REQUESTS[request.kind].mandate) {
		return "Only the owner's mandates can be overridden.";
	}
	if (request.status !== "open") {
		return "That mandate is already settled.";
	}
	resolve(state, request, "overridden", "you overrode it", tid);
	await idb.cache.teamSeasons.put(teamSeason);
	await toUI("realtimeUpdate", [["teamFinances"]]);
};
