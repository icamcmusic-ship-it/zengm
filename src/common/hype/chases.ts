// Record chases: players closing in on a league or franchise record (single season or career), from the records standing going into the season and their totals to date.
import {
	STAT_KEYS,
	type Chase,
	type HListed,
	type HRecordEntry,
	type HRecords,
	type StatKey,
} from "./types.ts";
import {
	careerTotal,
	clamp,
	curGp,
	curTotal,
	fmtN,
	known,
	pick,
} from "./util.ts";

// [word, smallest single-season record worth chasing, smallest career record worth chasing]
export const CHASE: Record<StatKey, [string, number, number]> = {
	pts: ["points", 1500, 10000],
	trb: ["rebounds", 700, 4000],
	ast: ["assists", 500, 3000],
	stl: ["steals", 150, 800],
	blk: ["blocks", 150, 800],
	tp: ["three-pointers", 200, 1000],
};

// Seasons of history needed before a league record means something
const MIN_LEAGUE_SEASONS = 5;
const MIN_FRANCHISE_SEASONS = 15;

export type ChaseCtx = {
	season: number;
	numGames: number;
	records: HRecords | null;
	// Games a team has played this season
	teamGp: (tid: number) => number;
	teamName: (tid: number) => string;
};

export const findChases = (
	C: ChaseCtx,
	players: HListed[],
	loose = false,
): Chase[] => {
	const R = C.records;
	if (!R) {
		return [];
	}
	const out: Chase[] = [];
	const seasonsOn = C.season - R.firstSeason;
	for (const P of players) {
		const gpAll = curGp(P);
		if (!P.cur || !gpAll) {
			continue;
		}
		const tid = P.tid;
		const teamGp = C.teamGp(tid);
		const left = Math.max(0, C.numGames - teamGp);
		const avail = teamGp ? clamp(gpAll / teamGp, 0, 1) : 1;
		const gpF = curGp(P, tid);
		const fr = R.seasonFranchise[tid];
		for (const k of STAT_KEYS) {
			const [word, sMin, cMin] = CHASE[k];
			const one = (
				scope: "league" | "franchise",
				kind: "season" | "career",
				cur: number | null,
				gp: number,
				rec: HRecordEntry | null | undefined,
				seasonCur: number | null,
			) => {
				if (!known(cur) || !rec || rec.pid === P.pid || !gp || !known(seasonCur)) {
					return;
				}
				const rate = seasonCur / gp;
				const proj = cur + rate * avail * left;
				const need = rec.v - cur + 1;
				let status: Chase["status"] | null = null;
				let pts = 0;
				const lg = scope === "league";
				if (need <= 0) {
					status = "broken";
					pts = 2;
				} else if (
					kind === "season" &&
					gp >= 15 &&
					proj >= (loose ? 0.92 : 0.98) * rec.v &&
					left > 0
				) {
					status =
						proj >= rec.v
							? "on pace"
							: proj >= 0.98 * rec.v
								? "just off the pace"
								: "off the pace";
					pts = (lg ? 7 : 4) + (need <= 1.5 * rate ? 2 : 0);
				} else if (
					kind === "career" &&
					gp >= 10 &&
					left > 0 &&
					rate > 0 &&
					need <= rate * avail * left
				) {
					status = "within reach";
					pts = (lg ? 8 : 4) + (need <= 1.5 * rate ? 2 : 0);
				}
				if (!status) {
					return;
				}
				out.push({
					pid: P.pid,
					name: P.name,
					tid,
					k,
					word,
					scope,
					kind,
					record: rec,
					whole: true,
					cur,
					need: Math.max(0, need),
					gp,
					rate,
					left,
					proj: Math.round(proj),
					status,
					pts,
				});
			};

			const seasonAll = curTotal(P, k);
			const seasonF = curTotal(P, k, tid);

			// single season: league (with enough history), then franchise
			const lr = R.seasonLeague[k];
			if (lr && seasonsOn >= MIN_LEAGUE_SEASONS && lr.v >= sMin) {
				one("league", "season", seasonAll, gpAll, lr, seasonAll);
			}
			const fRec = fr?.best[k];
			if (
				fr &&
				fRec &&
				fr.n >= MIN_FRANCHISE_SEASONS &&
				fRec.v >= sMin &&
				!(lr && fRec.pid === lr.pid && fRec.v === lr.v)
			) {
				one("franchise", "season", seasonF, gpF, fRec, seasonF);
			}

			// career: the leader's mark, or the runner-up's for the leader himself (skipped inside `one`)
			const cl = R.careerLeague[k];
			const top = cl?.[0];
			if (top && top.v >= cMin && seasonsOn >= MIN_LEAGUE_SEASONS) {
				one("league", "career", careerTotal(P, k), gpAll, top, seasonAll);
			}
			const cf = R.careerFranchise[tid]?.[k]?.[0];
			if (
				cf &&
				cf.v >= cMin &&
				fr &&
				fr.n >= MIN_FRANCHISE_SEASONS &&
				gpF
			) {
				one("franchise", "career", careerTotal(P, k, tid), gpF, cf, seasonF);
			}
		}
	}
	// a player's league chase makes his franchise chase of the same stat and kind redundant
	const seen = new Set(
		out.filter((x) => x.scope === "league").map((x) => `${x.pid}|${x.k}|${x.kind}`),
	);
	return out
		.filter((x) => x.scope === "league" || !seen.has(`${x.pid}|${x.k}|${x.kind}`))
		.sort((a, b) => b.pts - a.pts || a.need - b.need);
};

export const recLabel = (C: Pick<ChaseCtx, "teamName">, x: Chase) => {
	const team = C.teamName(x.tid);
	const w = x.word;
	if (x.kind === "career") {
		return x.scope === "league"
			? `the league's career ${w} record`
			: `the ${team} career ${w} record`;
	}
	return x.scope === "franchise"
		? `the ${team} single-season ${w} record`
		: `the league single-season ${w} record`;
};

const recHolder = (x: Chase) =>
	fmtN(x.record.v) +
	(x.record.name
		? `${x.kind === "season" ? " by " : ", "}${x.record.name}`
		: "") +
	(x.kind === "season" && x.record.season !== undefined
		? ` in ${x.record.season}`
		: "");

// One line for a chase. `done`: the season is over.
export const chaseText = (
	C: Pick<ChaseCtx, "teamName">,
	x: Chase,
	gid: number,
	done = false,
) => {
	const lab = recLabel(C, x);
	const who = `[[p:${x.pid}|${x.name}]]`;
	const w = x.word;
	const left = `${x.left} game${x.left === 1 ? "" : "s"} left`;
	if (x.status === "broken") {
		return `${who} ${done ? "broke" : "already owns"} ${lab}: ${fmtN(x.cur)}${done ? "" : " and counting"} (old mark ${recHolder(x)})`;
	}
	if (x.kind === "career") {
		const games = Math.max(1, Math.ceil(x.need / x.rate));
		return pick(gid, 11 + x.k.length, [
			`${who} is ${fmtN(x.need)} ${w} from ${lab} (${recHolder(x)}): about ${games} game${games === 1 ? "" : "s"}' worth at his rate, ${left}`,
			`${fmtN(x.need)} to go: ${who} is closing on ${lab} (${recHolder(x)}), ${left}`,
		]);
	}
	return pick(gid, 13 + x.k.length, [
		`${who} has ${fmtN(x.cur)} ${w} in ${x.gp} games, on pace for ${fmtN(x.proj)}: ${fmtN(x.need)} to go for ${lab} (${recHolder(x)}), ${left}`,
		`${fmtN(x.need)} ${w} to go: ${who} (${fmtN(x.cur)} so far, pace ${fmtN(x.proj)}) is chasing ${lab} (${recHolder(x)}), ${left}`,
		`${who} is ${x.status} for ${lab} (${recHolder(x)}): ${fmtN(x.cur)} so far, ${fmtN(x.need)} to go with ${left}`,
	]);
};
