// Hall of Fame (basketball): the ballot (League Extras "Hall of Fame Ballot"), the veterans committee and the coaches and
// executives wing, run once a season after the offseason's retirements (phase.newPhaseBeforeDraft). The vote model is in
// common/hofBallot.ts. See docs/native-features.md, Hall of Fame ballot.
import { PLAYER } from "../../../common/constants.ts";
import {
	HOF_DEFAULT_WAIT,
	HOF_MAX_YEARS,
	HOF_SCREEN_RATIO,
	HOF_VOTERS,
	VETERANS_GAP,
	ballotResult,
	veteransMeet,
	veteransPicks,
	voterLean,
	votePct,
	yearNoise,
} from "../../../common/hofBallot.ts";
import { COACH_RETIRED } from "../../../common/staff.ts";
import { legacyTidOf as legacyTidOfStats } from "../../../common/legacyTid.ts";
import { COACH_OF_THE_YEAR } from "../../../common/coachExecAwards.ts";
import type {
	Awards,
	Coach,
	Conditions,
	Gm,
	Player,
} from "../../../common/types.ts";
import { idb } from "../../db/index.ts";
import { g, helpers, logEvent } from "../../util/index.ts";
import { featureOn, featureOption } from "../../util/nativeFeatures.ts";
import { storeHofStoryAtInduction } from "../../util/hofStory.ts";
import addAward from "../player/addAward.ts";
import { hofScoreBasketball } from "../player/madeHof.basketball.ts";
import { isCollege } from "../college/isCollege.ts";
import { runCollegeHallOfFame } from "./college.ts";

type HofRecord = NonNullable<Awards["hof"]>;
type BallotRow = NonNullable<HofRecord["ballot"]>[number];
type VeteransRow = NonNullable<HofRecord["veterans"]>[number];
type WingRow = NonNullable<HofRecord["wing"]>[number];

export const HOF_AWARD = "Inducted into the Hall of Fame";

// Players are voted in (on), or inducted when they retire (off)
export const hofBallotOn = () =>
	__SPORT === "basketball" && featureOn("hofBallot");

export const hofBallotWait = () => {
	const wait = featureOption<number>("hofBallotWait");
	return typeof wait === "number" && Number.isFinite(wait)
		? helpers.bound(Math.round(wait), 1, 10)
		: HOF_DEFAULT_WAIT;
};

// A player coming out of retirement (every un-retire path): his ballot record is forgotten unless he was inducted (by the vote
// or the veterans committee), so when he retires again he is screened afresh and gets a new 10-year window. Kept, a ballot whose
// window had run out while he played was skipped every season with no status, so he was never inducted nor sent to the
// veterans committee. A Hall of Famer stays one (p.hof) and keeps his record, and is never inducted twice
export const clearHofBallotOnUnretire = (p: Pick<Player, "hofBallot">) => {
	const status = p.hofBallot?.status;
	if (p.hofBallot && status !== "inducted" && status !== "veterans") {
		delete p.hofBallot;
	}
};

const playerName = (p: { firstName: string; lastName: string }) =>
	`${p.firstName} ${p.lastName}`;

const playerLink = (p: Player) =>
	`<a href="${helpers.leagueUrl(["player", p.pid])}">${playerName(p)}</a>`;

// His legacy team, the same one the Hall of Fame page shows (common/legacyTid.ts)
export const legacyTidOf = (p: Pick<Player, "stats">) =>
	legacyTidOfStats(p.stats);

const round1 = (x: number) => Math.round(x * 10) / 10;

// "first ballot, 93.5%" / "4th year, 77.0%" / "veterans committee"
export const ballotLine = (
	hofBallot: Player["hofBallot"],
	// The season of his latest vote (his induction): his year is counted as the ballot counts it (season - first + 1, which
	// is more than his number of votes when the ballot was off for a while). Without it, his number of votes
	lastVoteSeason?: number,
): string | undefined => {
	if (!hofBallot) {
		return;
	}
	if (hofBallot.status === "veterans") {
		return "veterans committee";
	}
	const pct = hofBallot.votes.at(-1);
	if (pct === undefined) {
		return;
	}
	const year =
		lastVoteSeason !== undefined
			? lastVoteSeason - hofBallot.first + 1
			: hofBallot.votes.length;
	const yearText =
		year === 1 ? "first ballot" : `${helpers.ordinal(year)} year`;
	return `${yearText}, ${pct.toFixed(1)}%`;
};

const induct = async (
	p: Player,
	season: number,
	conditions: Conditions,
	text: string,
) => {
	p.hof = 1;
	addAward(p, { season, type: HOF_AWARD });
	logEvent(
		{
			type: "hallOfFame",
			text,
			showNotification: p.statsTids.includes(g.get("userTid")),
			pids: [p.pid],
			tids: p.statsTids,
			score: 20,
		},
		conditions,
	);
	await storeHofStoryAtInduction(p);
};

const hofLink = () =>
	`<a href="${helpers.leagueUrl(["hall_of_fame"])}">Hall of Fame</a>`;

// This season's ballot: new candidates screened in, everyone on it voted on
const runBallot = async (season: number, conditions: Conditions) => {
	const wait = hofBallotWait();
	const startingSeason = g.get("startingSeason");
	const rows: BallotRow[] = [];
	const inducted: Player[] = [];

	// New candidates retired `wait` seasons ago (or within the window, for a league that just turned the ballot on). Candidates
	// already on the ballot can have retired earlier than that window (screened late), so look back twice as far for them
	const newMin = season - wait - (HOF_MAX_YEARS - 1);
	for (
		let retiredYear = season - wait - 2 * HOF_MAX_YEARS;
		retiredYear <= season - wait;
		retiredYear++
	) {
		// Players retired before the league started are history, not candidates
		if (retiredYear < startingSeason) {
			continue;
		}
		const players = await idb.merged.players.getAll({ retiredYear });
		for (const p0 of players) {
			if (p0.tid !== PLAYER.RETIRED || p0.hof || p0.hofBallot?.status) {
				continue;
			}
			let ballot = p0.hofBallot;
			if (ballot) {
				const nextSeason = ballot.first + ballot.votes.length;
				// Already voted this season, or somehow skipped seasons (feature off for a while): his window still ends 10
				// seasons after his first ballot
				if (nextSeason > season || ballot.first + HOF_MAX_YEARS <= season) {
					continue;
				}
			} else {
				if (retiredYear < newMin) {
					continue;
				}
				const { score, threshold } = hofScoreBasketball(p0);
				if (!(threshold > 0) || score / threshold < HOF_SCREEN_RATIO) {
					continue;
				}
				ballot = {
					first: season,
					votes: [],
					score: round1(score),
					threshold: round1(threshold),
				};
			}

			// From here on p is a copy for the cache (rows from the cache are not copied by merged getAll)
			const p = (await idb.cache.players.get(p0.pid)) ?? p0;
			const year = season - ballot.first + 1;
			const pct = votePct({
				ratio: ballot.score / ballot.threshold,
				year,
				lean: voterLean(p.pid),
				noise: yearNoise(p.pid, season),
			});
			const result = ballotResult(pct, year);
			p.hofBallot = {
				...ballot,
				votes: [...ballot.votes, pct],
				...(result ? { status: result } : {}),
			};
			rows.push({
				pid: p.pid,
				name: playerName(p),
				tid: legacyTidOf(p),
				retiredYear: p.retiredYear,
				year,
				pct,
				score: ballot.score,
				threshold: ballot.threshold,
				...(result ? { result } : {}),
			});
			if (result === "inducted") {
				await induct(
					p,
					season,
					conditions,
					`${playerLink(p)} was elected to the ${hofLink()}${
						year === 1
							? " on his first ballot"
							: ` in his ${helpers.ordinal(year)} year on the ballot`
					}, with ${pct.toFixed(1)}% of the vote.`,
				);
				inducted.push(p);
			}
			await idb.cache.players.put(p);
		}
	}

	rows.sort((a, b) => b.pct - a.pct || a.pid - b.pid);
	return { rows, inducted };
};

// The veterans committee, in the seasons it meets: the best of the players who fell off the ballot long enough ago
const runVeterans = async (
	season: number,
	conditions: Conditions,
	allAwards: Awards[],
) => {
	if (featureOption<boolean>("hofVeteransCommittee") === false) {
		return [];
	}
	if (!veteransMeet(season)) {
		return [];
	}

	const done = new Set<number>();
	const fellOff = new Map<number, BallotRow & { ratio: number }>();
	for (const awards of allAwards) {
		for (const row of awards.hof?.veterans ?? []) {
			done.add(row.pid);
		}
		for (const row of awards.hof?.ballot ?? []) {
			if (
				(row.result === "dropped" || row.result === "expired") &&
				awards.season <= season - VETERANS_GAP
			) {
				fellOff.set(row.pid, {
					...row,
					ratio: row.threshold > 0 ? row.score / row.threshold : 0,
				});
			}
		}
	}

	// The committee picks from the best few that are still not in (a God Mode edit could have inducted one)
	const candidates = [...fellOff.values()]
		.filter((row) => !done.has(row.pid))
		.sort((a, b) => b.ratio - a.ratio || a.pid - b.pid);
	const eligible: (typeof candidates)[number][] = [];
	for (const row of candidates.slice(0, 5)) {
		const p = await idb.merged.players.get(row.pid);
		if (p && !p.hof && p.tid === PLAYER.RETIRED) {
			eligible.push(row);
		}
	}

	const out: VeteransRow[] = [];
	for (const pick of veteransPicks(eligible)) {
		const p0 = await idb.merged.players.get(pick.pid);
		if (!p0) {
			continue;
		}
		const p = (await idb.cache.players.get(p0.pid)) ?? p0;
		if (p.hofBallot) {
			p.hofBallot = { ...p.hofBallot, status: "veterans" };
		}
		await induct(
			p,
			season,
			conditions,
			`${playerLink(p)} was elected to the ${hofLink()} by the veterans committee.`,
		);
		await idb.cache.players.put(p);
		out.push({
			pid: p.pid,
			name: playerName(p),
			tid: legacyTidOf(p),
			retiredYear: p.retiredYear,
			score: pick.score,
			threshold: pick.threshold,
		});
	}
	return out;
};

// Coaches wing ----------------------------------------------------------------------------------------------------------------

const scaleGames = (season: number) => {
	const numGames = g.get("numGames", season);
	return numGames > 0 ? 82 / numGames : 1;
};

const numRounds = (season: number) =>
	g.get("numGamesPlayoffSeries", season).length;

export const COACH_HOF_THRESHOLD = 25;
export const GM_HOF_THRESHOLD = 25;

// A head coach's Hall of Fame case: wins (per 82 games), titles, Coach of the Year awards and playoff trips
export const coachHofCase = (c: Coach) => {
	let won = 0;
	let lost = 0;
	let wins82 = 0;
	let titles = 0;
	let playoffs = 0;
	for (const row of c.stats) {
		if (row.role !== "head") {
			continue;
		}
		won += row.won;
		lost += row.lost;
		wins82 += row.won * scaleGames(row.season);
		if (row.playoffRoundsWon >= 0) {
			playoffs += 1;
			if (row.playoffRoundsWon >= numRounds(row.season)) {
				titles += 1;
			}
		}
	}
	const coy = c.awards.filter((a) => a.type === COACH_OF_THE_YEAR).length;
	const score = wins82 / 50 + 4 * titles + 2 * coy + 0.5 * playoffs;
	const parts = [`${won}-${lost}`];
	if (titles > 0) {
		parts.push(`${titles} ${helpers.plural("title", titles)}`);
	}
	if (coy > 0) {
		parts.push(`${coy} Coach of the Year`);
	}
	return { score, won, lost, titles, coy, playoffs, line: parts.join(", ") };
};

// A GM's: titles, Executive of the Year awards, winning above .500 over his career, playoff trips
export const gmHofCase = (gm: Gm) => {
	let won = gm.career?.won ?? 0;
	let lost = gm.career?.lost ?? 0;
	let titles = gm.career?.titles ?? 0;
	let playoffs = gm.career?.playoffs ?? 0;
	let seasons = gm.career?.seasons ?? 0;
	for (const row of gm.seasons) {
		seasons += 1;
		won += row.won;
		lost += row.lost;
		if (row.playoffRoundsWon >= 0) {
			playoffs += 1;
			if (row.playoffRoundsWon >= numRounds(row.season)) {
				titles += 1;
			}
		}
	}
	const eoy = gm.awards?.length ?? 0;
	const winp = won + lost > 0 ? won / (won + lost) : 0.5;
	const score =
		5 * titles +
		3 * eoy +
		40 * (winp - 0.5) * Math.sqrt(seasons) +
		0.5 * playoffs;
	const parts = [`${won}-${lost}`];
	if (titles > 0) {
		parts.push(`${titles} ${helpers.plural("title", titles)}`);
	}
	if (eoy > 0) {
		parts.push(`${eoy} Executive of the Year`);
	}
	return {
		score,
		won,
		lost,
		titles,
		eoy,
		playoffs,
		seasons,
		line: parts.join(", "),
	};
};

// The team he spent the most seasons with
export const mostTidOf = (tids: number[]) => {
	const counts = new Map<number, number>();
	for (const tid of tids) {
		counts.set(tid, (counts.get(tid) ?? 0) + 1);
	}
	let best = -1;
	let bestN = 0;
	for (const [tid, n] of counts) {
		if (n > bestN) {
			best = tid;
			bestN = n;
		}
	}
	return best;
};

// Coaches and GMs retired at least `wait` seasons (0 with instant induction) whose case clears the bar
const runWing = async (season: number, conditions: Conditions) => {
	if (__SPORT !== "basketball") {
		return [];
	}
	const wait = hofBallotOn() ? hofBallotWait() : 0;
	const out: WingRow[] = [];

	const coaches = await idb.cache.coaches.getAll();
	for (const c of coaches) {
		if (
			c.tid !== COACH_RETIRED ||
			c.hof !== undefined ||
			c.retiredYear === undefined ||
			c.retiredYear + wait > season
		) {
			continue;
		}
		const hofCase = coachHofCase(c);
		if (hofCase.score < COACH_HOF_THRESHOLD) {
			continue;
		}
		c.hof = season;
		await idb.cache.coaches.put(c);
		const tid = mostTidOf(
			c.stats.filter((row) => row.role === "head").map((row) => row.tid),
		);
		out.push({
			kind: "coach",
			id: c.cid,
			name: `${c.firstName} ${c.lastName}`,
			tid,
			line: hofCase.line,
		});
		logEvent(
			{
				type: "hallOfFame",
				text: `Coach <a href="${helpers.leagueUrl(["coach", c.cid])}">${c.firstName} ${c.lastName}</a> (${hofCase.line}) was inducted into the ${hofLink()}.`,
				showNotification: false,
				pids: [],
				tids: tid >= 0 ? [tid] : [],
				score: 10,
			},
			conditions,
		);
	}

	const teams = await idb.cache.teams.getAll();
	for (const t of teams) {
		let changed = false;
		for (const gm of t.formerGms ?? []) {
			if (
				gm.hof !== undefined ||
				gm.retiredYear === undefined ||
				gm.retiredYear + wait > season
			) {
				continue;
			}
			const hofCase = gmHofCase(gm);
			if (hofCase.score < GM_HOF_THRESHOLD) {
				continue;
			}
			gm.hof = season;
			changed = true;
			const tid = mostTidOf(
				gm.tenures.flatMap((tenure) =>
					Array.from(
						{
							length: Math.max(1, (tenure.end ?? season) - tenure.start + 1),
						},
						() => tenure.tid,
					),
				),
			);
			out.push({
				kind: "gm",
				id: gm.gmid,
				name: `${gm.firstName} ${gm.lastName}`,
				tid,
				line: hofCase.line,
			});
			logEvent(
				{
					type: "hallOfFame",
					text: `Executive <a href="${helpers.leagueUrl(["gm", gm.gmid])}">${gm.firstName} ${gm.lastName}</a> (${hofCase.line}) was inducted into the ${hofLink()}.`,
					showNotification: false,
					pids: [],
					tids: tid >= 0 ? [tid] : [],
					score: 10,
				},
				conditions,
			);
		}
		if (changed) {
			await idb.cache.teams.put(t);
		}
	}

	return out;
};

// "Class of 2031" news item: the players voted in (with their share), the veterans committee's and the wing's picks
const classEvent = (
	season: number,
	conditions: Conditions,
	ballot: BallotRow[],
	veterans: VeteransRow[],
	wing: WingRow[],
	players: Player[],
) => {
	const parts: string[] = [];
	for (const row of ballot) {
		if (row.result === "inducted") {
			parts.push(
				`<a href="${helpers.leagueUrl(["player", row.pid])}">${row.name}</a> (${row.year === 1 ? "first ballot, " : ""}${row.pct.toFixed(1)}%)`,
			);
		}
	}
	for (const row of veterans) {
		parts.push(
			`<a href="${helpers.leagueUrl(["player", row.pid])}">${row.name}</a> (veterans committee)`,
		);
	}
	for (const row of wing) {
		parts.push(`${row.kind === "coach" ? "coach" : "executive"} ${row.name}`);
	}
	if (parts.length === 0) {
		return;
	}
	const list =
		parts.length === 1
			? parts[0]
			: `${parts.slice(0, -1).join(", ")} and ${parts.at(-1)}`;
	const tids = new Set<number>();
	for (const p of players) {
		for (const tid of p.statsTids) {
			tids.add(tid);
		}
	}
	for (const row of wing) {
		if (row.tid >= 0) {
			tids.add(row.tid);
		}
	}
	logEvent(
		{
			type: "hallOfFame",
			text: `The ${hofLink()} Class of ${season}: ${list}. <a href="${helpers.leagueUrl(["hall_of_fame_ballot", season])}">Ballot results and induction ceremony</a>`,
			showNotification: [...tids].includes(g.get("userTid")),
			pids: players.map((p) => p.pid),
			tids: [...tids],
			score: 30,
		},
		conditions,
	);
};

/**
 * The season's Hall of Fame business after the offseason's retirements: the ballot and the veterans committee (ballot on), and the
 * coaches and executives wing. Stores what happened on the season's awards row (awards.hof).
 */
export const runHallOfFame = async (conditions: Conditions) => {
	if (__SPORT !== "basketball") {
		return;
	}
	// College leagues have their own Hall of Fame (players who left school, college coaches) in place of all of this
	if (isCollege()) {
		await runCollegeHallOfFame(conditions);
		return;
	}
	const season = g.get("season");
	const ballotOn = hofBallotOn();

	let ballot: BallotRow[] = [];
	let veterans: VeteransRow[] = [];
	let players: Player[] = [];
	if (ballotOn) {
		const result = await runBallot(season, conditions);
		ballot = result.rows;
		players = result.inducted;
		const allAwards = await idb.merged.awards.getAll();
		veterans = await runVeterans(season, conditions, allAwards);
		for (const row of veterans) {
			const p = await idb.cache.players.get(row.pid);
			if (p) {
				players.push(p);
			}
		}
	}
	const wing = await runWing(season, conditions);

	if (ballotOn) {
		classEvent(season, conditions, ballot, veterans, wing, players);
	}

	if (ballot.length > 0 || veterans.length > 0 || wing.length > 0) {
		const awards = await idb.merged.awards.get(season);
		if (awards) {
			await idb.cache.awards.put({
				...awards,
				hof: {
					...(ballotOn ? { voters: HOF_VOTERS, ballot } : {}),
					...(veterans.length > 0 ? { veterans } : {}),
					...(wing.length > 0 ? { wing } : {}),
				},
			});
		}
	}
};
