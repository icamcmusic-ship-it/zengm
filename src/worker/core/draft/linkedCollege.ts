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
import { potEstimatorBasketballWithoutNoise } from "../player/potEstimator.ts";
import { EXPANDED_RATINGS } from "../../../common/expandedRatings.ts";
import { last } from "../../../common/utils.ts";
import { formatPlayerAwardName } from "../../../common/awards.ts";
import { COLLEGE_AWARD_PREFIX } from "../../../common/preDraft.ts";

const ALREADY_IMPORTED = "Already imported.";

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
 * A college player's awards as pre-draft honors ({ season, type }, common/preDraft.ts): the college league's awards (Player of the Year,
 * All-American, conference awards, ...) are award-settings awards without a type, named here, with the conference's name for a conference
 * award, since that league's award settings and conferences don't exist in the pro league.
 */
export const collegeHonors = (
	awards: any[],
	collegeSeason: number,
	confNames: Map<number, string>,
) => {
	const out: { season: number; type: string }[] = [];
	for (const a of awards) {
		if (!a || typeof a.season !== "number" || a.season > collegeSeason) {
			continue;
		}
		let name: string | undefined;
		if (typeof a.type === "string") {
			name = a.type;
		} else if (typeof a.name === "string") {
			const groupPrefix =
				a.group?.type === "conf" ? confNames.get(a.group.cid) : undefined;
			name = formatPlayerAwardName(a, { groupPrefix });
		}
		if (!name) {
			continue;
		}
		const type = name.startsWith(COLLEGE_AWARD_PREFIX)
			? name
			: `${COLLEGE_AWARD_PREFIX}${name}`;
		if (!out.some((row) => row.season === a.season && row.type === type)) {
			out.push({ season: a.season, type });
		}
	}
	return out;
};

/**
 * The departed players of a college league's season as a draft class file: off-screen pro draft picks in pick order, then everyone else
 * who left (seniors, and early entrants nobody picked) by pro stock. Ratings are copied (toProScale puts them on the pro league's scale
 * after the import). College stats rows and honors become pre-draft rows and honors, the school is the player's college.
 */
export const buildLinkedClassFile = async (
	lid: number,
	collegeSeason: number,
	max: number,
	// College pids already in this league (imported for an earlier draft): never imported twice
	exclude: Set<number> = new Set(),
) => {
	const db = await connectLeague(lid);
	try {
		const confsRaw = (
			await db.transaction("gameAttributes").store.get("confs" as any)
		)?.value;
		const confNames = new Map<number, string>();
		if (Array.isArray(confsRaw)) {
			// Plain, or a history of { start, value } rows (the one in effect that season)
			const isHistory = confsRaw.some(
				(row: any) => row && Array.isArray(row.value),
			);
			const confs = isHistory
				? (confsRaw
						.filter(
							(row: any) =>
								row.start === undefined ||
								row.start === null ||
								row.start <= collegeSeason,
						)
						.at(-1)?.value ??
					confsRaw[0]?.value ??
					[])
				: confsRaw;
			for (const conf of confs) {
				if (conf && typeof conf.cid === "number") {
					confNames.set(conf.cid, conf.name);
				}
			}
		}
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
		const numDeparted = departed.length;
		const available = departed.filter((p: any) => !exclude.has(p.pid));
		const numAlready = numDeparted - available.length;
		const stock = (p: any) => {
			const r = p.ratings.at(-1);
			return 0.5 * r.ovr + 0.5 * r.pot;
		};
		available.sort((a: any, b: any) => {
			const pa = a.collegeExit.pick ?? Infinity;
			const pb = b.collegeExit.pick ?? Infinity;
			return pa - pb || stock(b) - stock(a);
		});

		const players = available.slice(0, max).map((p: any) => {
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
				awards: collegeHonors(p.awards ?? [], collegeSeason, confNames),
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
			numDeparted,
			numAlready,
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
 * for the same draft (not saved): the k-th best imported prospect gets the draft value of the k-th best generated one (the age-adjusted
 * mix of ovr and pot the draft AI uses, with the noiseless pot estimate for both), every rating but height scaled by the same factor.
 * Then ovr, pot and value are computed again. Matching on value, not ovr: the class is about 1.5 years older than a generated one (the
 * college off-screen draft takes mostly seniors), and at the same ovr an older prospect has less potential, so matching ovr left the class
 * about 6 points of pot and 8 of value below a generated one, rank for rank. An older prospect now gets a little more ovr instead.
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
	// Draft value from ovr and age, with the noiseless pot estimate (what monteCarloPot gives on average)
	const draftValue = (ovr: number, age: number) =>
		player.valueCombineOvrPot(
			ovr,
			Math.max(ovr, potEstimatorBasketballWithoutNoise(ovr, age)),
			age,
		);
	const generated = await genPlayersWithoutSaving(draftYear, scoutingLevel, []);
	const reference = generated
		.map((p) => draftValue(last(p.ratings).ovr, draftYear - p.born.year))
		.sort((a, b) => b - a);
	if (reference.length === 0) {
		return;
	}
	// The values the draft AI will see (pot from monteCarloPot), for the calibration below
	const actualValue = (p: {
		born: { year: number };
		ratings: { ovr: number; pot: number }[];
	}) => {
		const r = p.ratings.at(-1)!;
		return player.valueCombineOvrPot(r.ovr, r.pot, draftYear - p.born.year);
	};
	const top = Math.min(60, imported.length, generated.length);
	const meanTop = (values: number[]) =>
		values
			.sort((a, b) => b - a)
			.slice(0, top)
			.reduce((sum, x) => sum + x, 0) / top;
	const referenceActual = meanTop(generated.map(actualValue));
	const originals = imported.map((p) => ({ ...last(p.ratings) }));

	const scaleAll = async (offset: number) => {
		for (const [i, p] of imported.entries()) {
			// Past the end of the reference class, keep the gap to its last prospect
			const j = Math.min(i, reference.length - 1);
			const target = reference[j]! - (i - j) * 0.2 + offset;
			const ratings = last(p.ratings) as any;
			Object.assign(ratings, originals[i]);
			const age = draftYear - p.born.year;
			// The factor that gives the target value (value rises with k)
			let lo = 0.2;
			let hi = 1.5;
			for (let iter = 0; iter < 14; iter++) {
				const mid = (lo + hi) / 2;
				if (
					draftValue(player.ovr(scaled(ratings, mid), ratings.pos), age) <
					target
				) {
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
		}
	};
	await scaleAll(0);
	// monteCarloPot doesn't give an older prospect quite the pot the estimate says: one more pass, with the gap between the top of
	// the two classes (as the draft AI values them) added to the targets
	const gap = referenceActual - meanTop(imported.map(actualValue));
	if (Math.abs(gap) >= 0.5) {
		await scaleAll(gap);
	}
	for (const p of imported) {
		await player.updateValues(p);
		await idb.cache.players.put(p);
	}
};

/**
 * College pids (of league lid) of the players already in this league: drafted, on a team, retired, or prospects of another draft. The
 * class of draftYear is left out, since an import replaces it.
 */
const importedCollegePids = async (lid: number, draftYear: number) => {
	const out = new Set<number>();
	const seen = new Set<number>();
	const add = (p: any, fromDb: boolean) => {
		if (p.linkedCollege?.lid !== lid) {
			return;
		}
		if (p.tid === PLAYER.UNDRAFTED) {
			// Prospects only count from the cache (one removed by an earlier import may still be in the database until it is flushed)
			if (fromDb || p.draft.year === draftYear) {
				return;
			}
		}
		out.add(p.linkedCollege.pid);
	};
	for (const p of await idb.cache.players.getAll()) {
		seen.add(p.pid);
		add(p, false);
	}
	for (const p of await idb.league.getAll("players")) {
		if (!seen.has(p.pid)) {
			add(p, true);
		}
	}
	return out;
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
	if (g.get("phase") === PHASE.DRAFT) {
		return {
			error:
				"The draft is under way. The next class can be imported once it is over.",
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
		return { error: ALREADY_IMPORTED };
	}
	const file = await buildLinkedClassFile(
		linked.lid,
		collegeSeason,
		classSize(),
		await importedCollegePids(linked.lid, draftYear),
	);
	// One college season is one class: once some of it is in this league (imported for an earlier draft), it is not imported again,
	// even the players who were left out of that class
	if (file.numAlready > 0) {
		return {
			error: `The college league's class of ${collegeSeason} is already in this league (imported for an earlier draft). Its next class comes after its season ${collegeSeason + 1} Departures phase.`,
		};
	}
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
		const result = await importLinkedCollegeClass({ onlyNew: true });
		// The college league is behind or gone: say so, or the generated class staying would look like the link did nothing
		if (result.error && result.error !== ALREADY_IMPORTED) {
			await logEvent({
				type: "info",
				text: `The ${nextDraftYear()} draft class is not from your linked college league: ${result.error} The generated class stays. <a href="${helpers.leagueUrl(["draft_scouting"])}">Draft Scouting</a>`,
				showNotification: !local.autoPlayUntil,
				saveToDb: false,
			});
		}
	} catch (error) {
		console.error(error);
	}
};
