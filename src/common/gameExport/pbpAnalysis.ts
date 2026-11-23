// Per-game download (Game Log, "Download game data"): what can be worked out from a basketball game's stored play-by-play events
// (common/pbpFlavor/store.ts decodePlayByPlay): who was on the floor when (lineups, stints, on/off, minutes by quarter), every shot,
// a win probability after each scoring play, runs, leads and ties, the clutch minutes, and how each team's points came (paint, second
// chance, off turnovers, fast break, transition). Pure: no database, no random numbers. See worker/util/gameExport for the file.

export type PbpEvent = Record<string, any> & { type: string };

export type AnalysisInput = {
	events: readonly PbpEvent[];
	// teams[0] is the home team (as in the game)
	numPeriods: number;
	// Minutes per period
	quarterLength: number;
	// Expected home margin before the game (points, home court included), for the win probability
	spread: number;
	foulsToFoulOut: number;
	// pid -> team index, from the box score (a player the events name but the box score doesn't is skipped)
	teamOf: Map<number, 0 | 1>;
};

// Seconds of a possession that still count as transition (and, from a steal or a defensive rebound, a fast break)
export const TRANSITION_SECONDS = 8;
// Clutch: the last 5 minutes of the final period or overtime, margin within 5
export const CLUTCH_SECONDS = 300;
export const CLUTCH_MARGIN = 5;
// Final margin SD (points) of the win probability model: the same scale as Season Odds' winProb (logistic 6.5, about a normal with SD 11.8)
export const WP_SIGMA = 11.8;
// Runs listed: at least this many unanswered points
export const RUN_MIN = 8;

const MADE_TYPES = new Set([
	"fgAtRim",
	"fgAtRimAndOne",
	"fgMidRange",
	"fgMidRangeAndOne",
	"fgLowPost",
	"fgLowPostAndOne",
	"tp",
	"tpAndOne",
	"fgTipIn",
	"fgTipInAndOne",
	"fgPutBack",
	"fgPutBackAndOne",
]);
const MISS_TYPES = new Set([
	"missAtRim",
	"missMidRange",
	"missLowPost",
	"missTp",
	"missTipIn",
	"missPutBack",
]);
const BLOCK_TYPES = new Set([
	"blkAtRim",
	"blkMidRange",
	"blkLowPost",
	"blkTp",
	"blkTipIn",
	"blkPutBack",
]);
const FGA_TYPES = new Set([
	"fgaAtRim",
	"fgaMidRange",
	"fgaLowPost",
	"fgaTp",
	"fgaTpFake",
	"fgaTipIn",
	"fgaPutBack",
]);

export type ShotZone = "rim" | "post" | "mid" | "three" | "tip" | "putback";
export const SHOT_ZONE_NAMES: Record<ShotZone, string> = {
	rim: "At the rim",
	post: "Post-up",
	mid: "Mid-range",
	three: "Three",
	tip: "Tip-in",
	putback: "Putback",
};
const PAINT_ZONES = new Set<ShotZone>(["rim", "post", "tip", "putback"]);

export const zoneOf = (type: string): ShotZone | undefined => {
	if (type.includes("AtRim")) {
		return "rim";
	}
	if (type.includes("LowPost")) {
		return "post";
	}
	if (type.includes("MidRange")) {
		return "mid";
	}
	if (type.includes("TipIn")) {
		return "tip";
	}
	if (type.includes("PutBack")) {
		return "putback";
	}
	if (type === "tp" || type === "tpAndOne" || type.includes("Tp")) {
		return "three";
	}
	return undefined;
};

// Normal CDF (Abramowitz and Stegun 7.1.26)
const phi = (x: number) => {
	const t = 1 / (1 + (0.3275911 * Math.abs(x)) / Math.SQRT2);
	const y =
		1 -
		((((1.061405429 * t - 1.453152027) * t + 1.421413741) * t - 0.284496736) *
			t +
			0.254829592) *
			t *
			Math.exp((-x * x) / 2);
	return x >= 0 ? (1 + y) / 2 : (1 - y) / 2;
};

// The home team's win probability with this home margin and this much of the game left (share of regulation, 0-1, can be an overtime's
// share), from the pregame spread: the spread still to come is in proportion to the time left, and so is the variance
export const winProbability = (
	margin: number,
	leftShare: number,
	spread: number,
) => {
	if (leftShare <= 0) {
		return margin > 0 ? 1 : margin < 0 ? 0 : 0.5;
	}
	const mu = margin + spread * leftShare;
	const sd = WP_SIGMA * Math.sqrt(leftShare);
	return phi(mu / sd);
};

const r1 = (x: number) => Math.round(x * 10) / 10;
const r3 = (x: number) => Math.round(x * 1000) / 1000;

export const clockText = (sec: number) => {
	const s = Math.max(0, sec);
	const m = Math.floor(s / 60);
	const rest = s - 60 * m;
	const whole = Math.floor(rest);
	return `${m}:${String(whole).padStart(2, "0")}${rest - whole >= 0.05 && m === 0 ? `.${Math.floor((rest - whole) * 10)}` : ""}`;
};

type BoxLine = {
	pts: number;
	fga: number;
	fg: number;
	tpa: number;
	tp: number;
	fta: number;
	ft: number;
	orb: number;
	drb: number;
	ast: number;
	tov: number;
	stl: number;
	blk: number;
	pf: number;
};
const emptyLine = (): BoxLine => ({
	pts: 0,
	fga: 0,
	fg: 0,
	tpa: 0,
	tp: 0,
	fta: 0,
	ft: 0,
	orb: 0,
	drb: 0,
	ast: 0,
	tov: 0,
	stl: 0,
	blk: 0,
	pf: 0,
});
const LINE_KEYS = Object.keys(emptyLine()) as (keyof BoxLine)[];

// Possessions from a team's and its opponent's counts (the usual estimate, averaged over both teams)
export const possEstimate = (
	a: Pick<BoxLine, "fga" | "orb" | "tov" | "fta">,
	b: Pick<BoxLine, "fga" | "orb" | "tov" | "fta">,
) =>
	(a.fga -
		a.orb +
		a.tov +
		0.44 * a.fta +
		(b.fga - b.orb + b.tov + 0.44 * b.fta)) /
	2;

type OnCourtAcc = {
	sec: number;
	ptsFor: number;
	ptsAgainst: number;
	us: BoxLine;
	them: BoxLine;
};
const emptyAcc = (): OnCourtAcc => ({
	sec: 0,
	ptsFor: 0,
	ptsAgainst: 0,
	us: emptyLine(),
	them: emptyLine(),
});

type Stint = { start: number; end: number };

type PossCtx = {
	start: number;
	kind: "live" | "dead" | "make" | "period";
	second: boolean;
	offTo: boolean;
};

export type Shot = {
	n: number;
	period: number;
	clock: string;
	// Seconds into the game
	time: number;
	t: 0 | 1;
	pid: number;
	zone: ShotZone;
	pts: 2 | 3;
	made: boolean;
	blocked: boolean;
	pidBlk?: number;
	assisted: boolean;
	pidAst?: number;
	andOne: boolean;
	// Seconds into the possession (the sim's own possession length when the shot logged one)
	possSec?: number;
	transition: boolean;
	putback: boolean;
	desperation: boolean;
	// Score after the shot, home first
	score: [number, number];
};

export const analyzePlayByPlay = (input: AnalysisInput) => {
	const { events, numPeriods, quarterLength, spread, teamOf } = input;
	const regSec = numPeriods * quarterLength * 60;
	const otLenDefault = Math.min(5, quarterLength) * 60;

	let period = 1;
	let periodLen = quarterLength * 60;
	let clock = periodLen;
	// Seconds into the game at the start of this period
	let periodStart = 0;
	const now = () => periodStart + (periodLen - clock);
	const score: [number, number] = [0, 0];

	const onCourt: [Set<number>, Set<number>] = [new Set(), new Set()];
	const players = new Map<
		number,
		{
			pid: number;
			t: 0 | 1;
			on: OnCourtAcc;
			stints: Stint[];
			stintStart?: number;
			secByPeriod: number[];
			pf: number;
			foulTrouble: { from: number; fouls: number; to?: number; sec: number }[];
			events: {
				kind: string;
				time: number;
				period: number;
				clock: string;
				back?: boolean;
			}[];
			clutch: BoxLine & { sec: number; pm: number };
			wpa: number;
		}
	>();
	const getP = (pid: number) => {
		let p = players.get(pid);
		if (!p) {
			const t = teamOf.get(pid);
			if (t === undefined) {
				return undefined;
			}
			p = {
				pid,
				t,
				on: emptyAcc(),
				stints: [],
				secByPeriod: [],
				pf: 0,
				foulTrouble: [],
				events: [],
				clutch: { ...emptyLine(), sec: 0, pm: 0 },
				wpa: 0,
			};
			players.set(pid, p);
		}
		return p;
	};

	const lineups = new Map<
		string,
		{ t: 0 | 1; pids: number[]; acc: OnCourtAcc }
	>();
	const lineupKey = (t: 0 | 1) =>
		[...onCourt[t]].sort((a, b) => a - b).join("-");
	const getLineup = (t: 0 | 1) => {
		const key = `${t}:${lineupKey(t)}`;
		let l = lineups.get(key);
		if (!l) {
			l = {
				t,
				pids: [...onCourt[t]].sort((a, b) => a - b),
				acc: emptyAcc(),
			};
			lineups.set(key, l);
		}
		return l;
	};

	const teamClutch: [BoxLine & { sec: number }, BoxLine & { sec: number }] = [
		{ ...emptyLine(), sec: 0 },
		{ ...emptyLine(), sec: 0 },
	];
	const isClutch = () =>
		period >= numPeriods &&
		clock <= CLUTCH_SECONDS &&
		Math.abs(score[0] - score[1]) <= CLUTCH_MARGIN;
	let clutchSecTotal = 0;

	const leftShare = () => {
		if (period <= numPeriods) {
			return Math.max(0, (regSec - now()) / regSec);
		}
		return Math.max(0, clock / regSec);
	};

	// Time passing
	const advance = (newClock: number) => {
		const dt = clock - newClock;
		if (!(dt > 0)) {
			return;
		}
		const clutch = isClutch();
		if (clutch) {
			clutchSecTotal += dt;
		}
		for (const t of [0, 1] as const) {
			if (onCourt[t].size > 0) {
				getLineup(t).acc.sec += dt;
			}
			if (clutch) {
				teamClutch[t].sec += dt;
			}
			for (const pid of onCourt[t]) {
				const p = getP(pid);
				if (p) {
					p.on.sec += dt;
					p.secByPeriod[period - 1] = (p.secByPeriod[period - 1] ?? 0) + dt;
					if (clutch) {
						p.clutch.sec += dt;
					}
				}
			}
		}
		// Foul trouble on the court
		for (const p of players.values()) {
			const ft = p.foulTrouble.at(-1);
			if (ft && ft.to === undefined && onCourt[p.t].has(p.pid)) {
				ft.sec += dt;
			}
		}
		clock = newClock;
	};
	// Foul trouble: 2 fouls in the 1st period, 3 in the 2nd, 4 in the 3rd, one short of fouling out in the last and overtime
	const foulTroubleLimit = () =>
		Math.min(
			input.foulsToFoulOut - 1,
			period >= numPeriods ? input.foulsToFoulOut - 1 : period + 1,
		);
	const updateFoulTrouble = () => {
		const limit = foulTroubleLimit();
		for (const p of players.values()) {
			const open = p.foulTrouble.at(-1);
			const inTrouble = p.pf >= limit && p.pf < input.foulsToFoulOut;
			if (open && open.to === undefined && !inTrouble) {
				open.to = now();
			} else if ((!open || open.to !== undefined) && inTrouble) {
				p.foulTrouble.push({ from: now(), fouls: p.pf, sec: 0 });
			}
		}
	};

	const putOn = (t: 0 | 1, pid: number) => {
		const p = getP(pid);
		if (!p || onCourt[t].has(pid)) {
			return;
		}
		onCourt[t].add(pid);
		p.stintStart = now();
	};
	const takeOff = (t: 0 | 1, pid: number) => {
		const p = getP(pid);
		if (!p || !onCourt[t].has(pid)) {
			return;
		}
		onCourt[t].delete(pid);
		if (p.stintStart !== undefined) {
			p.stints.push({ start: p.stintStart, end: now() });
			p.stintStart = undefined;
		}
	};

	// Win probability timeline, after each scoring play
	const wp0 = winProbability(0, 1, spread);
	const timeline: {
		n: number;
		period: number;
		clock: string;
		time: number;
		score: [number, number];
		wp: number;
		pid?: number;
		t?: 0 | 1;
		play?: string;
		delta: number;
	}[] = [];
	let lastWp = wp0;

	// Leads, ties, runs
	let leadChanges = 0;
	let ties = 0;
	let leader: 0 | 1 | -1 = -1;
	const largestLead: [
		(
			| {
					lead: number;
					time: number;
					period: number;
					clock: string;
					score: [number, number];
			  }
			| undefined
		),
		(
			| {
					lead: number;
					time: number;
					period: number;
					clock: string;
					score: [number, number];
			  }
			| undefined
		),
	] = [undefined, undefined];
	const runs: {
		t: 0 | 1;
		pts: number;
		from: { period: number; clock: string; score: [number, number] };
		to: { period: number; clock: string; score: [number, number] };
	}[] = [];
	let run:
		| {
				t: 0 | 1;
				pts: number;
				from: { period: number; clock: string; score: [number, number] };
				to: { period: number; clock: string; score: [number, number] };
		  }
		| undefined;
	const closeRun = () => {
		if (run && run.pts >= RUN_MIN) {
			runs.push(run);
		}
		run = undefined;
	};

	// Margin (home) after each event, for garbage time
	const marginTrack: {
		time: number;
		period: number;
		clock: number;
		margin: number;
	}[] = [];

	// Point sources
	const splits = [0, 1].map(() => ({
		paint: 0,
		secondChance: 0,
		offTurnovers: 0,
		fastBreak: 0,
		transition: 0,
		halfcourt: 0,
		freeThrows: 0,
	}));
	const ctx: [PossCtx, PossCtx] = [
		{ start: 0, kind: "period", second: false, offTo: false },
		{ start: 0, kind: "period", second: false, offTo: false },
	];
	const newCtx = (t: 0 | 1, kind: PossCtx["kind"], offTo = false) => {
		ctx[t] = { start: now(), kind, second: false, offTo };
	};
	const creditPoints = (t: 0 | 1, pts: number, paint: boolean, ft: boolean) => {
		const c = ctx[t];
		const s = splits[t]!;
		if (paint) {
			s.paint += pts;
		}
		if (ft) {
			s.freeThrows += pts;
		}
		if (c.second) {
			s.secondChance += pts;
		}
		if (c.offTo) {
			s.offTurnovers += pts;
		}
		const quick = c.kind !== "period" && now() - c.start <= TRANSITION_SECONDS;
		if (quick) {
			s.transition += pts;
			if (c.kind === "live") {
				s.fastBreak += pts;
			}
		} else {
			s.halfcourt += pts;
		}
	};

	const shots: Shot[] = [];
	let lastFga: {
		pid?: number;
		t?: 0 | 1;
		poss?: number;
		desperation?: boolean;
	} = {};
	let lastFgaStatPid: number | undefined;
	let started = false;
	const knocks: {
		pid: number;
		kind: string;
		period: number;
		clock: string;
		back?: boolean;
	}[] = [];

	const stamp = () => ({
		period,
		clock: clockText(clock),
		score: [score[0], score[1]] as [number, number],
	});

	for (const e of events) {
		if (typeof e.clock === "number" && Number.isFinite(e.clock)) {
			if (e.type === "period" || e.type === "overtime") {
				// handled below
			} else {
				advance(e.clock);
			}
		}

		if (e.type === "period" || e.type === "overtime") {
			// Close the period: stints carry on, the clock resets
			advance(0);
			periodStart += periodLen;
			period = typeof e.period === "number" ? e.period : period + 1;
			periodLen =
				typeof e.clock === "number" && Number.isFinite(e.clock)
					? e.clock
					: e.type === "overtime"
						? otLenDefault
						: quarterLength * 60;
			clock = periodLen;
			newCtx(0, "period");
			newCtx(1, "period");
			closeRun();
			updateFoulTrouble();
			continue;
		}

		if (e.type === "stat") {
			const t = e.t as 0 | 1;
			const amt = typeof e.amt === "number" ? e.amt : 1;
			const pid = e.pid as number | undefined;
			if (e.s === "gs" && pid !== undefined && !started) {
				putOn(t, pid);
				continue;
			}
			if (t !== 0 && t !== 1) {
				continue;
			}
			started = true;
			const clutch = isClutch();
			const key = e.s as keyof BoxLine;
			if (LINE_KEYS.includes(key) || e.s === "fga") {
				if (e.s === "fga") {
					lastFgaStatPid = pid;
				}
				const opp = (1 - t) as 0 | 1;
				// On-court counts for the lineups and on/off (team totals for and against)
				if (key !== "pts") {
					if (onCourt[t].size > 0) {
						getLineup(t).acc.us[key] += amt;
					}
					if (onCourt[opp].size > 0) {
						getLineup(opp).acc.them[key] += amt;
					}
					for (const q of onCourt[t]) {
						const pq = getP(q);
						if (pq) {
							pq.on.us[key] += amt;
						}
					}
					for (const q of onCourt[opp]) {
						const pq = getP(q);
						if (pq) {
							pq.on.them[key] += amt;
						}
					}
				}
				if (clutch) {
					teamClutch[t][key] += amt;
					if (pid !== undefined) {
						const p = getP(pid);
						if (p) {
							p.clutch[key] += amt;
						}
					}
				}
				if (key === "pf" && pid !== undefined) {
					const p = getP(pid);
					if (p) {
						p.pf += amt;
						updateFoulTrouble();
					}
				}
			}
			if (e.s === "pts") {
				const opp = (1 - t) as 0 | 1;
				const before = [score[0], score[1]];
				const wpBefore = winProbability(
					score[0] - score[1],
					leftShare(),
					spread,
				);
				score[t] += amt;
				if (onCourt[t].size > 0) {
					getLineup(t).acc.ptsFor += amt;
				}
				if (onCourt[opp].size > 0) {
					getLineup(opp).acc.ptsAgainst += amt;
				}
				for (const q of onCourt[t]) {
					const pq = getP(q);
					if (pq) {
						pq.on.ptsFor += amt;
						if (clutch) {
							pq.clutch.pm += amt;
						}
					}
				}
				for (const q of onCourt[opp]) {
					const pq = getP(q);
					if (pq) {
						pq.on.ptsAgainst += amt;
						if (clutch) {
							pq.clutch.pm -= amt;
						}
					}
				}
				if (clutch) {
					teamClutch[t].pts += amt;
					if (pid !== undefined) {
						const p = getP(pid);
						if (p) {
							p.clutch.pts += amt;
						}
					}
				}
				// Leads, ties, runs
				const margin = score[0] - score[1];
				const newLeader = margin > 0 ? 0 : margin < 0 ? 1 : -1;
				if (newLeader === -1 && score[0] > 0) {
					ties += 1;
				}
				if (newLeader !== -1 && leader !== -1 && newLeader !== leader) {
					leadChanges += 1;
				}
				if (newLeader !== -1) {
					leader = newLeader;
				}
				const lead = Math.abs(margin);
				if (newLeader !== -1) {
					const cur = largestLead[newLeader];
					if (!cur || lead > cur.lead) {
						largestLead[newLeader] = { lead, time: r1(now()), ...stamp() };
					}
				}
				if (run && run.t === t) {
					run.pts += amt;
					run.to = stamp();
				} else {
					closeRun();
					run = {
						t,
						pts: amt,
						from: {
							period,
							clock: clockText(clock),
							score: before as [number, number],
						},
						to: stamp(),
					};
				}
				// Win probability (at the last point of a play, so an and-one or free throws read as one play)
				const wp = winProbability(margin, leftShare(), spread);
				const credit = (t === 0 ? 1 : -1) * (wp - wpBefore);
				if (pid !== undefined) {
					const p = getP(pid);
					if (p) {
						p.wpa += credit;
					}
				}
				const prev = timeline.at(-1);
				const sameMoment =
					prev && prev.time === r1(now()) && prev.t === t && prev.pid === pid;
				if (sameMoment) {
					prev.score = [score[0], score[1]];
					prev.wp = r3(wp);
					prev.delta = r3(wp - (timeline.at(-2)?.wp ?? wp0));
				} else {
					timeline.push({
						n: timeline.length + 1,
						period,
						clock: clockText(clock),
						time: r1(now()),
						score: [score[0], score[1]],
						wp: r3(wp),
						t,
						pid,
						delta: r3(wp - lastWp),
					});
				}
				lastWp = wp;
				marginTrack.push({ time: now(), period, clock, margin });
			}
			continue;
		}

		const t = e.t as 0 | 1 | undefined;

		if (e.type === "sub" && (t === 0 || t === 1)) {
			for (const pid of e.pidsOff ?? []) {
				takeOff(t, pid);
			}
			for (const pid of e.pids ?? []) {
				putOn(t, pid);
			}
			continue;
		}

		if (e.type === "jumpBall") {
			newCtx(0, "period");
			newCtx(1, "period");
			continue;
		}

		if (FGA_TYPES.has(e.type)) {
			lastFga = {
				pid: e.pid,
				t,
				poss: typeof e.poss === "number" ? e.poss : undefined,
				desperation: e.desperation === true,
			};
			continue;
		}

		if (
			MADE_TYPES.has(e.type) ||
			MISS_TYPES.has(e.type) ||
			BLOCK_TYPES.has(e.type)
		) {
			const blocked = BLOCK_TYPES.has(e.type);
			const made = MADE_TYPES.has(e.type);
			// (a block event is the blocking team's; the shooter is the last field goal attempt's)
			const shooter = blocked ? lastFgaStatPid : (e.pid as number | undefined);
			const st = shooter !== undefined ? teamOf.get(shooter) : undefined;
			const zone = zoneOf(e.type);
			if (shooter !== undefined && st !== undefined && zone) {
				const fromFga = lastFga.pid === shooter ? lastFga : {};
				const pts = zone === "three" ? 3 : 2;
				const c = ctx[st];
				const possSec =
					fromFga.poss !== undefined
						? fromFga.poss
						: c.kind === "period"
							? undefined
							: Math.max(0, now() - c.start);
				if (made) {
					creditPoints(st, pts, PAINT_ZONES.has(zone), false);
				}
				shots.push({
					n: shots.length + 1,
					period,
					clock: clockText(clock),
					time: r1(now()),
					t: st,
					pid: shooter,
					zone,
					pts,
					made,
					blocked,
					...(blocked && e.pid !== undefined ? { pidBlk: e.pid } : {}),
					assisted: made && e.pidAst !== undefined,
					...(made && e.pidAst !== undefined ? { pidAst: e.pidAst } : {}),
					andOne: e.type.endsWith("AndOne"),
					...(possSec !== undefined ? { possSec: r1(possSec) } : {}),
					transition:
						c.kind !== "period" && now() - c.start <= TRANSITION_SECONDS,
					putback: zone === "putback" || zone === "tip",
					desperation: fromFga.desperation === true,
					score: [score[0], score[1]],
				});
				if (made && !e.type.endsWith("AndOne")) {
					newCtx((1 - st) as 0 | 1, "make");
				}
			}
			lastFga = {};
			continue;
		}

		if (e.type === "ft" && (t === 0 || t === 1)) {
			creditPoints(t, 1, false, true);
			continue;
		}
		if (e.type === "drb" && (t === 0 || t === 1)) {
			newCtx(t, "live");
			continue;
		}
		if (e.type === "orb" && (t === 0 || t === 1)) {
			ctx[t].second = true;
			continue;
		}
		if (e.type === "stl" && (t === 0 || t === 1)) {
			newCtx(t, "live", true);
			continue;
		}
		if ((e.type === "tov" || e.type === "offFoul") && (t === 0 || t === 1)) {
			newCtx((1 - t) as 0 | 1, "dead", true);
			continue;
		}
		if (
			e.type === "knock" ||
			e.type === "knockReturn" ||
			e.type === "injury" ||
			e.type === "foulOut" ||
			e.type === "ejection"
		) {
			const pid = e.pid as number | undefined;
			const p = pid !== undefined ? getP(pid) : undefined;
			if (p && pid !== undefined) {
				const entry = {
					kind: e.type,
					time: r1(now()),
					period,
					clock: clockText(clock),
					...(e.type === "knockReturn" ? { back: e.back === true } : {}),
				};
				p.events.push(entry);
				knocks.push({
					pid,
					kind: e.type,
					period,
					clock: clockText(clock),
					...(e.type === "knockReturn" ? { back: e.back === true } : {}),
				});
			}
			continue;
		}
		if (e.type === "gameOver") {
			advance(0);
		}
	}

	// End of the game: close stints and foul trouble
	const end = now();
	for (const t of [0, 1] as const) {
		for (const pid of onCourt[t]) {
			const p = getP(pid);
			if (p && p.stintStart !== undefined) {
				p.stints.push({ start: p.stintStart, end });
				p.stintStart = undefined;
			}
		}
	}
	for (const p of players.values()) {
		const ft = p.foulTrouble.at(-1);
		if (ft && ft.to === undefined) {
			ft.to = end;
		}
	}
	closeRun();

	// Garbage time: the first moment in the final period of regulation from which the margin stays big enough for the time left
	// (25+ with 9-12 minutes left, 20+ with 6-9, 10+ under 6; the quarter's own length scaled), never in overtime
	const finalStart = (numPeriods - 1) * quarterLength * 60;
	const scale = quarterLength / 12;
	const threshold = (clockLeft: number) =>
		clockLeft > 9 * 60 * scale ? 25 : clockLeft > 6 * 60 * scale ? 20 : 10;
	let garbage:
		| { period: number; clock: string; time: number; margin: number }
		| undefined;
	if (period <= numPeriods) {
		for (let j = 0; j < marginTrack.length; j++) {
			const m = marginTrack[j]!;
			if (m.time < finalStart || m.period !== numPeriods) {
				continue;
			}
			let ok = true;
			for (let k = j; k < marginTrack.length; k++) {
				const n = marginTrack[k]!;
				if (
					Math.abs(n.margin) < threshold(n.clock) ||
					Math.sign(n.margin) !== Math.sign(m.margin)
				) {
					ok = false;
					break;
				}
			}
			if (ok) {
				garbage = {
					period: m.period,
					clock: clockText(m.clock),
					time: r1(m.time),
					margin: m.margin,
				};
				break;
			}
		}
	}

	const lineupRows = [...lineups.values()]
		.filter((l) => l.pids.length > 0 && l.acc.sec > 0)
		.map((l) => {
			const poss = possEstimate(l.acc.us, l.acc.them);
			return {
				t: l.t,
				pids: l.pids,
				sec: r1(l.acc.sec),
				ptsFor: l.acc.ptsFor,
				ptsAgainst: l.acc.ptsAgainst,
				pm: l.acc.ptsFor - l.acc.ptsAgainst,
				poss: r1(poss),
				netRtg:
					poss >= 5
						? r1((100 * (l.acc.ptsFor - l.acc.ptsAgainst)) / poss)
						: null,
			};
		})
		.sort((a, b) => b.sec - a.sec);

	const closing: [number[], number[]] = [
		[...onCourt[0]].sort((a, b) => a - b),
		[...onCourt[1]].sort((a, b) => a - b),
	];

	// Team totals while on the floor (for off-court numbers)
	const teamTotals = [0, 1].map(() => ({ sec: end, ...emptyLine() }));
	const teamAgainst = [0, 1].map(() => emptyLine());
	for (const l of lineups.values()) {
		for (const k of LINE_KEYS) {
			teamTotals[l.t]![k] += l.acc.us[k];
			teamAgainst[l.t]![k] += l.acc.them[k];
		}
	}

	const playerRows = [...players.entries()].map(([pid, p]) => {
		const tPts = score[p.t];
		const oPts = score[1 - p.t]!;
		const onPoss = possEstimate(p.on.us, p.on.them);
		const offUs = emptyLine();
		const offThem = emptyLine();
		for (const k of LINE_KEYS) {
			offUs[k] = teamTotals[p.t]![k] - p.on.us[k];
			offThem[k] = teamAgainst[p.t]![k] - p.on.them[k];
		}
		const offPoss = possEstimate(offUs, offThem);
		const offFor = tPts - p.on.ptsFor;
		const offAgainst = oPts - p.on.ptsAgainst;
		const onNet =
			onPoss >= 5 ? (100 * (p.on.ptsFor - p.on.ptsAgainst)) / onPoss : null;
		const offNet =
			offPoss >= 5 ? (100 * (offFor - offAgainst)) / offPoss : null;
		return {
			pid,
			t: p.t,
			onOff: {
				on: {
					sec: r1(p.on.sec),
					ptsFor: p.on.ptsFor,
					ptsAgainst: p.on.ptsAgainst,
					pm: p.on.ptsFor - p.on.ptsAgainst,
					poss: r1(onPoss),
					netRtg: onNet === null ? null : r1(onNet),
				},
				off: {
					sec: r1(Math.max(0, end - p.on.sec)),
					ptsFor: offFor,
					ptsAgainst: offAgainst,
					pm: offFor - offAgainst,
					poss: r1(offPoss),
					netRtg: offNet === null ? null : r1(offNet),
				},
				netDiff: onNet !== null && offNet !== null ? r1(onNet - offNet) : null,
			},
			stints: p.stints.map((s) => ({
				in: r1(s.start),
				out: r1(s.end),
				sec: r1(s.end - s.start),
			})),
			minByPeriod: p.secByPeriod.map((s) => r1((s ?? 0) / 60)),
			longestStintMin: r1(
				Math.max(0, ...p.stints.map((s) => s.end - s.start)) / 60,
			),
			foulTrouble: p.foulTrouble.map((f) => ({
				from: r1(f.from),
				to: r1(f.to ?? end),
				fouls: f.fouls,
				minOnCourt: r1(f.sec / 60),
			})),
			events: p.events,
			clutch: p.clutch.sec > 0 ? { ...p.clutch, sec: r1(p.clutch.sec) } : null,
			wpa: r3(p.wpa),
		};
	});

	// Biggest swings
	const swings = timeline
		.toSorted((a, b) => Math.abs(b.delta) - Math.abs(a.delta))
		.slice(0, 10);

	return {
		end: r1(end),
		periods: period,
		finalScore: [score[0], score[1]] as [number, number],
		wpStart: r3(wp0),
		timeline,
		swings,
		leadChanges,
		ties,
		largestLead: largestLead.map((x) => x ?? null),
		runs,
		garbage: garbage ?? null,
		clutch: {
			sec: r1(clutchSecTotal),
			teams: teamClutch.map((c) => ({ ...c, sec: r1(c.sec) })),
		},
		splits,
		shots,
		lineups: lineupRows,
		closing,
		players: playerRows,
		knocks,
	};
};

export type PbpAnalysis = ReturnType<typeof analyzePlayByPlay>;
