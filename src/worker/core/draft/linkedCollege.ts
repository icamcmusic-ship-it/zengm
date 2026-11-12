// Linked college league (docs/college-mode.md, "A pro league with a linked college league"): a pro league can point to a college league
// in the same browser. Its draft class can then be the players who left that college league after its latest season (early entrants and
// seniors), read straight from the college league's database, keeping names, school, college stats, honors and ratings.
import {
	LEAGUE_DATABASE_VERSION,
	PHASE,
	PLAYER,
} from "../../../common/constants.ts";
import type { PlayerCollegeExit } from "../../../common/college/types.ts";
import type { LinkedCollege } from "../../../common/types.ts";
import connectLeague from "../../db/connectLeague.ts";
import { idb } from "../../db/index.ts";
import { g, helpers, local, logEvent, toUI } from "../../util/index.ts";
import { finances, league, player } from "../index.ts";
import handleUploadedDraftClass from "./handleUploadedDraftClass.ts";
import genPlayersWithoutSaving from "./genPlayersWithoutSaving.ts";
import { RATINGS } from "../../../common/constants.ts";
import { syncExpandedToCompat } from "../player/expandedRatings.ts";
import { EXPANDED_RATINGS } from "../../../common/expandedRatings.ts";
import { last } from "../../../common/utils.ts";

const leagueExists = async (lid: number) =>
	!!(await idb.meta.get("leagues", lid));

/**
 * Read the basics of another league without loading it: its type, season and phase. Undefined if it is gone or unreadable.
 */
const readLeagueInfo = async (lid: number) => {
	if (!(await leagueExists(lid)) || lid === g.get("lid")) {
		return;
	}
	const db = await connectLeague(lid);
	try {
		const store = db.transaction("gameAttributes").store;
		const get = async (key: string) => (await store.get(key as any))?.value;
		const unwrap = (value: any) =>
			Array.isArray(value) ? value.at(-1)?.value : value;
		return {
			leagueType: (await get("leagueType")) as string | undefined,
			season: (await get("season")) as number | undefined,
			phase: (await get("phase")) as number | undefined,
			collegeLevel: unwrap(await get("collegeLevel")) as string | undefined,
		};
	} finally {
		db.close();
	}
};

/**
 * College leagues in this browser that a pro league can link to.
 */
export const getLinkableCollegeLeagues = async () => {
	const leagues = await idb.meta.getAll("leagues");
	const out: {
		lid: number;
		name: string;
		season: number;
		phase: number;
		level: string | undefined;
	}[] = [];
	for (const l of leagues) {
		if (l.lid === g.get("lid")) {
			continue;
		}
		try {
			const info = await readLeagueInfo(l.lid);
			if (
				info?.leagueType === "college" &&
				typeof info.season === "number" &&
				typeof info.phase === "number"
			) {
				out.push({
					lid: l.lid,
					name: l.name,
					season: info.season,
					phase: info.phase,
					level: info.collegeLevel,
				});
			}
		} catch (error) {
			console.error(error);
		}
	}
	return out.reverse();
};

// The latest college season whose departures happened (the Departures phase is the college league's PHASE.DRAFT)
const latestDepartureSeason = (season: number, phase: number) =>
	phase >= PHASE.DRAFT ? season : season - 1;

// The pro league's next draft that hasn't happened
export const nextDraftYear = () =>
	g.get("season") + (g.get("phase") > PHASE.DRAFT ? 1 : 0);

// How many prospects a class has here (like a generated class)
const classSize = () =>
	Math.max(
		1,
		Math.round((g.get("numDraftRounds") * g.get("numActiveTeams") * 7) / 6),
	);

/**
 * The departed players of a college league's season as a draft class file: off-screen pro draft picks in pick order, then everyone else
 * who left (seniors, and early entrants nobody picked) by pro stock. Ratings are copied (toProScale puts them on the pro league's scale
 * after the import). College stats rows and honors become pre-draft rows and honors, the school is the player's college.
 */
export const buildLinkedClassFile = async (
	lid: number,
	collegeSeason: number,
	max: number,
) => {
	const db = await connectLeague(lid);
	try {
		const teams = await db.transaction("teams").store.getAll();
		const regionByTid = new Map(teams.map((t) => [t.tid, t.region]));
		const teamSeasons = await db
			.transaction("teamSeasons")
			.store.index("season, tid")
			.getAll(IDBKeyRange.bound([collegeSeason - 5], [collegeSeason, ""]));
		const seasonRegion = new Map(
			teamSeasons.map((ts) => [`${ts.season}|${ts.tid}`, ts.region]),
		);
		const school = (tid: number, season: number) =>
			seasonRegion.get(`${season}|${tid}`) ?? regionByTid.get(tid) ?? "";

		const retired = await db
			.transaction("players")
			.store.index("tid")
			.getAll(PLAYER.RETIRED);
		const departed = retired.filter((p: any) => {
			const exit = p.collegeExit as PlayerCollegeExit | undefined;
			return (
				exit &&
				exit.season === collegeSeason &&
				(exit.type === "pro" || exit.type === "graduated")
			);
		});
		const stock = (p: any) => {
			const r = p.ratings.at(-1);
			return 0.5 * r.ovr + 0.5 * r.pot;
		};
		departed.sort((a: any, b: any) => {
			const pa = a.collegeExit.pick ?? Infinity;
			const pb = b.collegeExit.pick ?? Infinity;
			return pa - pb || stock(b) - stock(a);
		});

		const players = departed.slice(0, max).map((p: any) => {
			const exit = p.collegeExit as PlayerCollegeExit;
			const ratings = { ...p.ratings.at(-1), season: collegeSeason };
			// Computed again in the pro league (age, scouting fuzz)
			for (const key of [
				"ovr",
				"pot",
				"ovrs",
				"pots",
				"skills",
				"fuzz",
				"pos",
				"injuryIndex",
			]) {
				delete ratings[key];
			}
			const stats = (p.stats ?? [])
				.filter((row: any) => !row.playoffs && row.gp > 0)
				.map((row: any) => ({
					...row,
					teamName: school(row.tid, row.season),
				}));
			const lastSchool = school(exit.tid, collegeSeason);
			return {
				pid: p.pid,
				firstName: p.firstName,
				lastName: p.lastName,
				born: p.born,
				hgt: p.hgt,
				weight: p.weight,
				face: p.face,
				imgURL: p.imgURL,
				college: lastSchool,
				ratings: [ratings],
				stats,
				awards: (p.awards ?? []).filter(
					(a: any) => typeof a.type === "string" && a.season <= collegeSeason,
				),
				injury: { type: "Healthy", gamesRemaining: 0 },
				injuries: [],
				tid: PLAYER.UNDRAFTED,
				draft: {
					round: 0,
					pick: 0,
					tid: -1,
					originalTid: -1,
					year: collegeSeason,
					pot: 0,
					ovr: 0,
					skills: [],
				},
				linkedCollege: {
					lid,
					pid: p.pid,
					season: collegeSeason,
					school: lastSchool,
					exit: exit.type,
					pick: exit.pick,
					classYear: p.classYear,
				},
			};
		});
		return {
			version: LEAGUE_DATABASE_VERSION,
			startingSeason: collegeSeason,
			gameAttributes: { season: collegeSeason },
			players,
			numDeparted: departed.length,
		};
	} finally {
		db.close();
	}
};

// Height and wingspan are measurements, not skills
const SCALE_KEYS: string[] = [
	...RATINGS.filter((key) => key !== "hgt"),
	...EXPANDED_RATINGS.filter((key) => key !== "wng"),
];

// Every rating but height times k, so the profile (shooter, big, ...) keeps its shape and nothing is clipped at 0
const scaled = (ratings: any, k: number) => {
	const out = { ...ratings };
	for (const key of SCALE_KEYS) {
		if (typeof out[key] === "number") {
			out[key] = player.limitRating(ratings[key] * k);
		}
	}
	return out;
};

/**
 * Put an imported class on this league's scale. A college league's ratings are ordinary ratings, but its talent is calibrated for college
 * games (its seniors are much better than the prospects of a pro draft class), so the class is mapped by rank onto a pro class generated
 * for the same draft (not saved): the k-th best imported prospect gets the ovr of the k-th best generated one, every rating but height
 * scaled by the same factor. Then ovr, pot and value are computed again.
 */
const toProScale = async (draftYear: number, lid: number, season: number) => {
	const imported = (
		await idb.cache.players.indexGetAll("playersByTid", PLAYER.UNDRAFTED)
	)
		.filter(
			(p) =>
				p.draft.year === draftYear &&
				p.linkedCollege?.lid === lid &&
				p.linkedCollege.season === season,
		)
		.sort((a, b) => last(b.ratings).ovr - last(a.ratings).ovr);
	if (imported.length === 0) {
		return;
	}
	const scoutingLevel = await finances.getLevelLastThree("scouting", {
		tid: g.get("userTid"),
	});
	const reference = (
		await genPlayersWithoutSaving(draftYear, scoutingLevel, [])
	)
		.map((p) => last(p.ratings).ovr)
		.sort((a, b) => b - a);
	if (reference.length === 0) {
		return;
	}
	for (const [i, p] of imported.entries()) {
		// Past the end of the reference class, keep the gap to its last prospect
		const j = Math.min(i, reference.length - 1);
		const target = reference[j]! - (i - j) * 0.2;
		const ratings = last(p.ratings) as any;
		// The factor that gives the target ovr (ovr rises with k)
		let lo = 0.2;
		let hi = 1.5;
		for (let iter = 0; iter < 14; iter++) {
			const mid = (lo + hi) / 2;
			if (player.ovr(scaled(ratings, mid), ratings.pos) < target) {
				lo = mid;
			} else {
				hi = mid;
			}
		}
		const next = scaled(ratings, (lo + hi) / 2);
		for (const key of SCALE_KEYS) {
			ratings[key] = next[key];
		}
		syncExpandedToCompat(ratings);
		await player.develop(p, 0);
		await player.updateValues(p);
		await idb.cache.players.put(p);
	}
};

const saveLinked = async (linked: LinkedCollege | undefined) => {
	await league.setGameAttributes({ linkedCollege: linked });
	await toUI("realtimeUpdate", [["gameAttributes"]]);
};

export const setLinkedCollege = async ({
	lid,
	auto,
}: {
	lid: number | undefined;
	auto?: boolean;
}) => {
	if (g.get("leagueType") === "college") {
		throw new Error("A college league can't link to a college league.");
	}
	if (lid === undefined) {
		await saveLinked(undefined);
		return;
	}
	const info = await readLeagueInfo(lid);
	if (info?.leagueType !== "college") {
		throw new Error("That league is not a college league.");
	}
	const prev = g.get("linkedCollege");
	await saveLinked({
		lid,
		auto: auto ?? prev?.auto ?? true,
		imports: prev?.lid === lid ? prev.imports : [],
	});
};

/**
 * Import the latest departed class of the linked college league as the next draft class (replacing that class). Returns what happened,
 * for the UI. With onlyNew, a college season already imported is not imported again (the automatic import before each draft).
 */
export const importLinkedCollegeClass = async ({
	onlyNew,
}: {
	onlyNew?: boolean;
} = {}): Promise<{ error?: string; num?: number; collegeSeason?: number }> => {
	const linked = g.get("linkedCollege");
	if (!linked || g.get("leagueType") === "college") {
		return { error: "No linked college league." };
	}
	const info = await readLeagueInfo(linked.lid);
	if (
		info?.leagueType !== "college" ||
		info.season === undefined ||
		info.phase === undefined
	) {
		return {
			error:
				"The linked college league can't be found. It may have been deleted.",
		};
	}
	const collegeSeason = latestDepartureSeason(info.season, info.phase);
	const draftYear = nextDraftYear();
	if (
		onlyNew &&
		linked.imports.some(
			(row) =>
				row.collegeSeason === collegeSeason || row.draftYear === draftYear,
		)
	) {
		return { error: "Already imported." };
	}
	const file = await buildLinkedClassFile(
		linked.lid,
		collegeSeason,
		classSize(),
	);
	if (file.players.length === 0) {
		return {
			error: `The college league has no departed players from ${collegeSeason} yet (its season ${info.season} departures happen in its Departures phase).`,
		};
	}
	await handleUploadedDraftClass({ uploadedFile: file, draftYear });
	await toProScale(draftYear, linked.lid, collegeSeason);
	await saveLinked({
		...linked,
		imports: [
			...linked.imports.filter((row) => row.draftYear !== draftYear),
			{ collegeSeason, draftYear, num: file.players.length },
		],
	});
	await logEvent({
		type: "info",
		text: `The ${draftYear} draft class is the class of ${collegeSeason} from your linked college league: ${file.players.length} prospects. <a href="${helpers.leagueUrl(["draft_scouting"])}">Draft Scouting</a>`,
		showNotification: !local.autoPlayUntil,
		saveToDb: false,
	});
	return { num: file.players.length, collegeSeason };
};

/**
 * Before each draft (season over), the automatic import, when the link is set to automatic.
 */
export const autoImportLinkedCollegeClass = async () => {
	const linked = g.get("linkedCollege");
	if (!linked?.auto || g.get("leagueType") === "college") {
		return;
	}
	try {
		await importLinkedCollegeClass({ onlyNew: true });
	} catch (error) {
		console.error(error);
	}
};
