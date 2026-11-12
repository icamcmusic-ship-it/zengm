// @ts-nocheck (diagnostic script)
/* eslint-disable no-undef */
// Calibration of the End-of-Game Intelligence setting (smartEndgame, endgame.ts): league per-team-game averages and close-game outcomes
// with the setting off and on (all the other new-league defaults on, coaching systems included), what the new decisions do, and how much
// a good game manager is worth. Run with
// EG_CAL=1 npx vitest --run --project basketball <this file>
// (EG_LEAGUES, EG_GAMES to change the size, EG_STOCK=1 for the other settings at their existing-league defaults, EG_MGMT=1 for the
// game manager experiment only, EG_MGMT=0 to skip it)
import { test } from "vitest";
import GameSim from "./index.ts";
import { genLeague, simLeague, boxAverages } from "./coachSystemsMetrics.ts";
import { nativeFeatureNewLeagueDefaults } from "../../../common/nativeFeatures.ts";
import { NEUTRAL_COACH_SIM } from "../../../common/coachSystems.ts";
import { range } from "../../../common/utils.ts";

// EG_SET='{"earlyTimeouts":0}': change constants of the feature (to see what each part does)
import { ENDGAME } from "./endgame.ts";
if (process.env.EG_SET) {
	Object.assign(ENDGAME, JSON.parse(process.env.EG_SET));
}

const f = (x, d = 3) => (Number.isFinite(x) ? x.toFixed(d) : String(x));

let diag;
const resetDiag = () => {
	diag = {
		games: 0,
		runTimeouts: 0,
		up3Fouls: 0,
		odSubs: 0,
		lateTimeouts: 0,
		intentional: 0,
		targetFt: 0,
		lineupFt: 0,
		// games with a leader with a minute left in regulation, and those he won
		lead60: 0,
		lead60Won: 0,
		lead60By3: 0,
		lead60By3Won: 0,
		// up 3 on defense with 7 seconds or less at the start of a possession: games, and those won
		up3: 0,
		up3Won: 0,
		ot: 0,
		// points per team in the last 2 minutes of the final period and overtime
		ptsLast2: 0,
		// points in the last possession window of the first three quarters
		lastShotTimes: [],
	};
};
resetDiag();

// (the counters are only installed for a calibration run: the other test files share these classes)
if (process.env.EG_CAL) {
	const proto = GameSim.prototype;
	const origPoss = proto.simPossession;
	proto.simPossession = function () {
		const period = this.team[0].stat.ptsQtrs.length;
		if (period === this.numPeriods && !this.elamActive) {
			const lead = this.team[0].stat.pts - this.team[1].stat.pts;
			if (this.t <= 60 && this._lead60 === undefined) {
				this._lead60 = lead;
			}
			if (this.t <= 120 && this._pts120 === undefined) {
				this._pts120 = this.team[0].stat.pts + this.team[1].stat.pts;
			}
		}
		origPoss.call(this);
		// (after the possession: o is the team that had the ball unless it keeps it)
	};
	const origFactor = proto.getClockFactor;
	proto.getClockFactor = function () {
		const period = this.team[0].stat.ptsQtrs.length;
		if (
			period >= this.numPeriods &&
			this.t <= 7 &&
			this.t > 1.5 &&
			this.team[this.d].stat.pts - this.team[this.o].stat.pts === 3 &&
			this._up3 === undefined
		) {
			this._up3 = this.d;
		}
		return origFactor.call(this);
	};
	const origFoul = proto.doNonShootingFoulPossession;
	proto.doNonShootingFoulPossession = function (shooter, clockFactor, dt) {
		if (clockFactor === "intentionalFoul") {
			diag.intentional += 1;
			diag.targetFt += this.freeThrowProb(this.o, shooter);
			let sum = 0;
			for (const p of this.playersOnCourt[this.o]) {
				sum += this.freeThrowProb(this.o, p);
			}
			diag.lineupFt += sum / this.playersOnCourt[this.o].length;
		}
		return origFoul.call(this, shooter, clockFactor, dt);
	};
	const origTimeout = proto.maybeTimeoutToAdvanceBall;
	proto.maybeTimeoutToAdvanceBall = function (a, b) {
		const out = origTimeout.call(this, a, b);
		if (out) {
			diag.lateTimeouts += 1;
		}
		return out;
	};
	const origRun = proto.run;
	proto.run = function () {
		const out = origRun.call(this);
		diag.games += 1;
		diag.runTimeouts += this.endgameCounts.runTimeouts;
		diag.up3Fouls += this.endgameCounts.up3Fouls;
		diag.odSubs += this.endgameCounts.odSubs;
		const won0 = out.team[0].stat.pts > out.team[1].stat.pts;
		if (this._lead60 !== undefined && this._lead60 !== 0) {
			const leaderWon = this._lead60 > 0 === won0;
			diag.lead60 += 1;
			diag.lead60Won += leaderWon ? 1 : 0;
			if (Math.abs(this._lead60) <= 3) {
				diag.lead60By3 += 1;
				diag.lead60By3Won += leaderWon ? 1 : 0;
			}
		}
		if (this._up3 !== undefined) {
			diag.up3 += 1;
			diag.up3Won += (this._up3 === 0) === won0 ? 1 : 0;
		}
		diag.ot += out.overtimes > 0 ? 1 : 0;
		diag.ptsLast2 +=
			(out.team[0].stat.pts + out.team[1].stat.pts - (this._pts120 ?? 0)) / 2;
		return out;
	};
}

const SIM = [
	"realisticPossessions",
	"simFixes",
	"positionalComposites",
	"realisticRotations",
	"expandedRatings",
	"playerTraits",
	"perimeterDefense",
	"technicalFouls",
	"spacingCreation",
	"matchupDefense",
	"coachSystems",
];

const outcomes = (rows) => {
	let home = 0;
	let by3 = 0;
	let by5 = 0;
	let margin = 0;
	let min = 0;
	for (const row of rows) {
		const d = row.team[0].stat.pts - row.team[1].stat.pts;
		home += d > 0 ? 1 : 0;
		margin += d;
		by3 += Math.abs(d) <= 3 ? 1 : 0;
		by5 += Math.abs(d) <= 5 ? 1 : 0;
		for (const t of row.team) {
			for (const p of t.player) {
				min += p.stat.min;
			}
		}
	}
	const n = rows.length;
	const q = [0, 0, 0, 0];
	for (const row of rows) {
		for (const t of row.team) {
			for (const i of range(4)) {
				q[i] += t.stat.ptsQtrs[i] / (2 * n);
			}
		}
	}
	return {
		q,
		homeWin: home / n,
		homeMargin: margin / n,
		by3: by3 / n,
		by5: by5 / n,
		min: min / (2 * n),
	};
};

const baseSettings = () =>
	process.env.EG_STOCK
		? {}
		: Object.fromEntries(
				Object.entries(nativeFeatureNewLeagueDefaults()).filter(([k]) =>
					SIM.includes(k),
				),
			);

test.skipIf(!process.env.EG_CAL || process.env.EG_MGMT === "1")(
	"end-of-game calibration",
	async () => {
		const numLeagues = Number(process.env.EG_LEAGUES ?? 2);
		const gamesPerPair = Number(process.env.EG_GAMES ?? 20);
		const out = {};
		for (const on of [false, true]) {
			const settings = { ...baseSettings(), smartEndgame: on };
			resetDiag();
			const rows = [];
			for (const L of range(numLeagues)) {
				const league = await genLeague({
					numPairs: 15,
					seed: 100 + L,
					settings,
				});
				rows.push(
					...(await simLeague({
						league,
						seed: 200 + L,
						gamesPerPair,
						coaches: !process.env.EG_STOCK,
						settings,
					})),
				);
			}
			out[on ? "on" : "off"] = {
				box: boxAverages(rows),
				o: outcomes(rows),
				diag,
				n: rows.length,
			};
		}
		const names = Object.keys(out);
		console.log(`games per config: ${out.off.n}`);
		console.log(`stat | ${names.join(" | ")}`);
		for (const key of [
			"pts",
			"fgp",
			"tpaRate",
			"tpp",
			"ast",
			"tov",
			"orb",
			"fta",
			"stl",
			"blk",
			"pf",
			"poss",
		]) {
			console.log(
				`${key} | ${names.map((x) => f(out[x].box[key], key === "fgp" || key === "tpaRate" || key === "tpp" ? 4 : 2)).join(" | ")}`,
			);
		}
		for (const key of ["min", "homeWin", "homeMargin", "by3", "by5"]) {
			console.log(`${key} | ${names.map((x) => f(out[x].o[key])).join(" | ")}`);
		}
		console.log(
			`pts by quarter | ${names.map((x) => out[x].o.q.map((v) => f(v, 2)).join(" ")).join(" | ")}`,
		);
		const d = (x, k) => out[x].diag[k];
		const perGame = (k) =>
			names.map((x) => f(d(x, k) / d(x, "games"))).join(" | ");
		console.log(`overtime games | ${perGame("ot")}`);
		console.log(`pts per team, last 2:00 and OT | ${perGame("ptsLast2")}`);
		console.log(`run timeouts per game | ${perGame("runTimeouts")}`);
		console.log(`late timeouts per game | ${perGame("lateTimeouts")}`);
		console.log(`O/D substitutions per game | ${perGame("odSubs")}`);
		console.log(`intentional fouls per game | ${perGame("intentional")}`);
		console.log(
			`FT% of the player fouled on purpose | ${names.map((x) => f(d(x, "targetFt") / d(x, "intentional"))).join(" | ")}`,
		);
		console.log(
			`FT% of his lineup | ${names.map((x) => f(d(x, "lineupFt") / d(x, "intentional"))).join(" | ")}`,
		);
		console.log(
			`leader with 1:00 left wins | ${names.map((x) => `${f(d(x, "lead60Won") / d(x, "lead60"))} (${d(x, "lead60")})`).join(" | ")}`,
		);
		console.log(
			`leader by 1-3 with 1:00 left wins | ${names.map((x) => `${f(d(x, "lead60By3Won") / d(x, "lead60By3"))} (${d(x, "lead60By3")})`).join(" | ")}`,
		);
		console.log(
			`up 3 on defense, 7 s or less: wins | ${names.map((x) => `${f(d(x, "up3Won") / d(x, "up3"))} (${d(x, "up3")})`).join(" | ")}`,
		);
	},
	7_200_000,
);

// The value of game management: in each pair of rosters one coach is a good game manager (+1) and the other a poor one (-1), swapped
// for the other half of the games so the rosters cancel; everything else about the coaches is neutral
test.skipIf(!process.env.EG_CAL || process.env.EG_MGMT === "0")(
	"game manager experiment",
	async () => {
		const numLeagues = Number(process.env.EG_LEAGUES ?? 2);
		const gamesPerPair = Number(process.env.EG_GAMES ?? 20);
		const lines = [];
		for (const on of [false, true]) {
			const settings = { ...baseSettings(), smartEndgame: on };
			let games = 0;
			let won = 0;
			let close = 0;
			let closeWon = 0;
			for (const L of range(numLeagues)) {
				const league = await genLeague({
					numPairs: 15,
					seed: 100 + L,
					settings,
				});
				for (const flip of [0, 1]) {
					const withMgmt = league.map((t, i) => {
						const good = i % 2 === flip;
						return {
							...t,
							sim: {
								...NEUTRAL_COACH_SIM,
								off: "motion",
								def: "switch",
								foulWindow: good ? 33 : 21,
								mgmtGood: good,
							},
						};
					});
					const rows = await simLeague({
						league: withMgmt,
						seed: 300 + L * 2 + flip,
						gamesPerPair: gamesPerPair / 2,
						coaches: true,
						settings,
					});
					for (const row of rows) {
						const goodSide = row.sims[0].mgmtGood ? 0 : 1;
						const dPts =
							row.team[goodSide].stat.pts - row.team[1 - goodSide].stat.pts;
						games += 1;
						won += dPts > 0 ? 1 : 0;
						const ot = row.team[0].stat.ptsQtrs.length > 4;
						if (Math.abs(dPts) <= 5 || ot) {
							close += 1;
							closeWon += dPts > 0 ? 1 : 0;
						}
					}
				}
			}
			lines.push(
				`${on ? "on" : "off"} | ${f(won / games, 4)} (${games}) | ${f(closeWon / close, 4)} (${close})`,
			);
		}
		console.log(
			"smartEndgame | good manager wins, all games | close games (within 5 or overtime)",
		);
		for (const line of lines) {
			console.log(line);
		}
	},
	7_200_000,
);
