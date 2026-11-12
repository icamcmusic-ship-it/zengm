// College mode: conference realignment (setting collegeRealignment, docs/college-mode.md). Every few years, when a season is over, programs
// that have outgrown their conference move to a stronger one nearby, and the conference they left backfills from a weaker conference. A
// move changes the team's conference (t.cid / t.did) for the next season on; the season just played keeps its conferences (teamSeasons).
import { gauss } from "../../../common/random.ts";
import { CONFERENCES } from "../../../common/collegeStats/colleges.ts";
import {
	distanceKm,
	schoolCoords,
	type LatLong,
} from "../../../common/college/geography.ts";
import type { CollegeRealignmentMove } from "../../../common/college/types.ts";
import type { Team } from "../../../common/types.ts";
import { idb } from "../../db/index.ts";
import { g, helpers, logEvent } from "../../util/index.ts";
import { featureOn, featureOption } from "../../util/nativeFeatures.ts";
import { getCollegeArchive, updateCollegeArchive } from "./archive.ts";
import { getTeamPrestige } from "./players.ts";

export const realignmentOn = () => featureOn("collegeRealignment");

const realignmentYears = () =>
	Math.max(1, featureOption<number>("collegeRealignmentYears") ?? 4);

// A conference keeps at least this many schools, and takes at most this many
const MIN_SIZE = 6;
const MAX_SIZE = 18;
// A school moves up when it is above its conference's average prestige by this much, and a conference whose average is at least STEP_UP
// higher takes it if it is within FIT of that average (it would be an ordinary member there)
const OUTGROWN = 1.5;
const STEP_UP = 2;
const FIT = 3;

type Conf = {
	cid: number;
	did: number;
	name: string;
	tids: number[];
	avg: number;
	center: LatLong | undefined;
};

const centerOf = (coords: LatLong[]): LatLong | undefined => {
	if (coords.length === 0) {
		return undefined;
	}
	let lat = 0;
	let long = 0;
	for (const c of coords) {
		lat += c[0];
		long += c[1];
	}
	return [lat / coords.length, long / coords.length];
};

const confLink = (name: string) => `the ${name}`;

const teamLink = (t: Team) =>
	`<a href="${helpers.leagueUrl(["roster", `${t.abbrev}_${t.tid}`, g.get("season")])}">${t.region}</a>`;

/**
 * The realignment itself (also used by the test with force: true). Returns the moves made.
 */
export const realignConferences = async (
	force = false,
): Promise<CollegeRealignmentMove[]> => {
	const season = g.get("season");
	if (!force) {
		if (!realignmentOn() || season <= g.get("startingSeason")) {
			return [];
		}
		// Never two seasons in a row
		if ((await getCollegeArchive(season - 1))?.realignment?.length) {
			return [];
		}
		if (Math.random() >= 1 / realignmentYears()) {
			return [];
		}
	}

	const teams = (await idb.cache.teams.getAll()).filter((t) => !t.disabled);
	const byTid = new Map(teams.map((t) => [t.tid, t]));
	const prestige = new Map(teams.map((t) => [t.tid, getTeamPrestige(t)]));
	const coords = new Map(teams.map((t) => [t.tid, schoolCoords(t.region)]));
	const divs = g.get("divs");
	const confs = new Map<number, Conf>();
	for (const conf of g.get("confs")) {
		const div = divs.find((d) => d.cid === conf.cid);
		if (!div) {
			continue;
		}
		confs.set(conf.cid, {
			cid: conf.cid,
			did: div.did,
			name: conf.name,
			tids: [],
			avg: 0,
			center: undefined,
		});
	}
	for (const t of teams) {
		confs.get(t.cid)?.tids.push(t.tid);
	}
	const refresh = (conf: Conf) => {
		conf.avg =
			conf.tids.reduce((sum, tid) => sum + prestige.get(tid)!, 0) /
			Math.max(1, conf.tids.length);
		conf.center = centerOf(
			conf.tids.map((tid) => coords.get(tid)).filter((c) => c !== undefined),
		);
	};
	for (const conf of confs.values()) {
		refresh(conf);
	}
	// Conference averages before any move, so one move doesn't open the door to the next
	const avgBefore = new Map([...confs.values()].map((c) => [c.cid, c.avg]));
	const distTo = (tid: number, conf: Conf) => {
		const c = coords.get(tid);
		return c && conf.center ? distanceKm(c, conf.center) : 1500;
	};

	const moves: CollegeRealignmentMove[] = [];
	const moved = new Set<number>();

	const move = (
		tid: number,
		from: Conf,
		to: Conf,
		reason: CollegeRealignmentMove["reason"],
	) => {
		from.tids = from.tids.filter((x) => x !== tid);
		to.tids.push(tid);
		refresh(from);
		refresh(to);
		moved.add(tid);
		moves.push({ tid, from: from.cid, to: to.cid, reason });
	};

	// Backfill a conference that lost a school: the best school of a weaker conference, nearby ones first. One more level of backfill at
	// most, after that a conference just has one school fewer
	const backfill = (conf: Conf, depth: number) => {
		const options = teams
			.filter((t) => {
				const from = confs.get(t.cid);
				return (
					from &&
					!moved.has(t.tid) &&
					from.cid !== conf.cid &&
					from.tids.includes(t.tid) &&
					from.tids.length > MIN_SIZE &&
					avgBefore.get(from.cid)! < avgBefore.get(conf.cid)! &&
					prestige.get(t.tid)! >= conf.avg - 8
				);
			})
			.map((t) => ({
				t,
				score: prestige.get(t.tid)! - distTo(t.tid, conf) / 150 + gauss(0, 1.5),
			}))
			.sort((a, b) => b.score - a.score);
		const pick = options[0];
		if (!pick) {
			return;
		}
		const from = confs.get(pick.t.cid)!;
		move(pick.t.tid, from, conf, "backfill");
		if (depth < 1) {
			backfill(from, depth + 1);
		}
	};

	const movers = teams
		.map((t) => {
			const own = confs.get(t.cid);
			return {
				t,
				own,
				excess: own ? prestige.get(t.tid)! - own.avg + gauss(0, 1) : 0,
			};
		})
		.filter((row) => row.own && row.excess >= OUTGROWN)
		.sort((a, b) => b.excess - a.excess);
	let numMoves = 1 + Number(Math.random() < 0.5) + Number(Math.random() < 0.25);

	for (const { t, own } of movers) {
		if (numMoves <= 0) {
			break;
		}
		if (moved.has(t.tid) || !own || own.tids.length <= MIN_SIZE) {
			continue;
		}
		const p = prestige.get(t.tid)!;
		const target = [...confs.values()]
			.filter(
				(conf) =>
					conf.cid !== own.cid &&
					conf.tids.length > 0 &&
					conf.tids.length < MAX_SIZE &&
					avgBefore.get(conf.cid)! >= avgBefore.get(own.cid)! + STEP_UP &&
					p >= conf.avg - FIT,
			)
			.map((conf) => ({
				conf,
				score: conf.avg - distTo(t.tid, conf) / 200,
			}))
			.sort((a, b) => b.score - a.score)[0]?.conf;
		if (!target) {
			continue;
		}
		move(t.tid, own, target, "upgrade");
		numMoves -= 1;
		backfill(own, 0);
	}

	if (moves.length === 0) {
		return [];
	}

	// Save: the team's conference from next season, and some long-run prestige from the new conference's standing
	for (const m of moves) {
		const t = byTid.get(m.tid)!;
		const from = confs.get(m.from)!;
		const to = confs.get(m.to)!;
		t.cid = to.cid;
		t.did = to.did;
		const strengthFrom = CONFERENCES[from.name]?.strength;
		const strengthTo = CONFERENCES[to.name]?.strength;
		if (strengthFrom !== undefined && strengthTo !== undefined) {
			const base = (t as any).collegePrestigeBase ?? prestige.get(t.tid)!;
			(t as any).collegePrestigeBase =
				Math.round(
					helpers.bound(base + 0.5 * (strengthTo - strengthFrom), 35, 100) * 10,
				) / 10;
		}
		await idb.cache.teams.put(t);
	}
	await updateCollegeArchive({ realignment: moves });

	const userTid = g.get("userTid");
	const userCid = byTid.get(userTid)?.cid;
	for (const m of moves) {
		const t = byTid.get(m.tid)!;
		const from = confs.get(m.from)!;
		const to = confs.get(m.to)!;
		const user = m.tid === userTid || m.to === userCid || m.from === userCid;
		await logEvent({
			type: "info",
			text:
				m.reason === "upgrade"
					? `Conference realignment: ${teamLink(t)} leaves ${confLink(from.name)} for ${confLink(to.name)}.`
					: `Conference realignment: ${teamLink(t)} moves from ${confLink(from.name)} to ${confLink(to.name)} to fill its opening.`,
			showNotification: user,
			tids: [m.tid],
			score: m.reason === "upgrade" ? 20 : 10,
		});
	}
	return moves;
};
