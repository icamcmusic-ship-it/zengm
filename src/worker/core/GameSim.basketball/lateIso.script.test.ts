// @ts-nocheck (diagnostic script)
/* eslint-disable no-undef */
// Late close possessions (End-of-Game Intelligence, endgame.ts LATE_ISO): the final 24 seconds of the final period or overtime with the
// score within 3, against the rest of the game. For each group: unassisted and self-created share of the field goal attempts, assist rate
// of the makes, the star's share (highest usage on the floor), the shot mix, FG%, and how the play-by-play flavor text words the made
// shots (isolation, pick-and-roll, drive-and-kick...). Also the game-winners and game-tying shots of the clutch-play record. New-league
// defaults plus the 2026 preset, generated rosters. Run with
//   LATE_ISO=1 [LATE_ISO_SEEDS=150] [LATE_ISO_GAMES=10] [LATE_ISO_OFF=1 (smartEndgame off)] [LATE_ISO_SET='{"isoSeconds":-1}' (endgame.ts
//   constants: this one turns the late-game isolations off)] [LATE_ISO_SHOW=1 (print the go-ahead lines)] npx vitest --run --project
//   basketball <this file>
import { test } from "vitest";
import GameSim from "./index.ts";
import loadTeams from "../game/loadTeams.ts";
import { g } from "../../util/index.ts";
import { genTeams, withSeededRandom } from "./simLiveGameForTests.ts";
import { nativeFeatureNewLeagueDefaults } from "../../../common/nativeFeatures.ts";
import gameSimPresets from "../../../ui/views/Settings/gameSimPresets.ts";
import {
	FlavorSession,
	contextFromInitEvent,
	playersFromInitEvent,
} from "../../../common/pbpFlavor/index.ts";
import { clutchFlavorText } from "../../../common/pbpFlavor/clutch.ts";
import { ENDGAME } from "./endgame.ts";

const env = process.env;
if (env.LATE_ISO_SET) {
	Object.assign(ENDGAME, JSON.parse(env.LATE_ISO_SET));
}

const newGroup = () => ({
	fga: 0,
	fg: 0,
	unast: 0,
	self: 0,
	ast: 0,
	star: 0,
	creator: 0,
	three: 0,
	mid: 0,
	rim: 0,
	post: 0,
	other: 0,
	xfg: 0,
});
type Group = ReturnType<typeof newGroup>;

const groups = {
	all: newGroup(),
	rest: newGroup(),
	late: newGroup(),
	goAhead: newGroup(),
};

const isLate = (sim) =>
	sim.team[0].stat.ptsQtrs.length >= sim.numPeriods &&
	!sim.elamActive &&
	sim.t <= 24;

if (env.LATE_ISO) {
	const proto = GameSim.prototype;
	const origInfo = proto.getShotInfo;
	proto.getShotInfo = function (args) {
		const info = origInfo.call(this, args);
		const p = args.p;
		const five = this.playersOnCourt[this.o];
		let star = five[0];
		let creator = five[0];
		for (const q of five) {
			if (q.compositeRating.usage > star.compositeRating.usage) {
				star = q;
			}
			if (
				(q.compositeRating.creation ?? 0) >
				(creator.compositeRating.creation ?? 0)
			) {
				creator = q;
			}
		}
		const margin = this.team[this.o].stat.pts - this.team[this.d].stat.pts;
		this._shot = {
			p,
			fga0: p.stat.fga,
			fg0: p.stat.fg,
			type: info.type,
			passer: info.passer,
			self:
				!args.putBack &&
				!args.tipInFromOutOfBounds &&
				(this.creator === undefined || this.creator === p),
			probMake: info.probMake,
			star: star === p,
			creator: creator === p,
			late: isLate(this) && Math.abs(margin) <= 3,
			goAhead: isLate(this) && margin <= 0 && margin >= -3,
		};
		return info;
	};
	const origShot = proto.doShot;
	proto.doShot = function (...args) {
		this._shot = undefined;
		const out = origShot.apply(this, args);
		const s = this._shot;
		if (s && s.p.stat.fga > s.fga0) {
			const made = s.p.stat.fg > s.fg0;
			const add = (gr: Group) => {
				gr.fga += 1;
				gr.fg += made ? 1 : 0;
				gr.unast += s.passer === undefined ? 1 : 0;
				gr.self += s.self && s.passer === undefined ? 1 : 0;
				gr.ast += made && s.passer !== undefined ? 1 : 0;
				gr.star += s.star ? 1 : 0;
				gr.creator += s.creator ? 1 : 0;
				gr.xfg += s.probMake;
				if (s.type === "threePointer") {
					gr.three += 1;
				} else if (s.type === "midRange") {
					gr.mid += 1;
				} else if (s.type === "atRim") {
					gr.rim += 1;
				} else if (s.type === "lowPost") {
					gr.post += 1;
				} else {
					gr.other += 1;
				}
			};
			add(groups.all);
			add(s.late ? groups.late : groups.rest);
			if (s.goAhead) {
				add(groups.goAhead);
			}
		}
		this._shot = undefined;
		return out;
	};
}

const MADE = new Set([
	"fgAtRim",
	"fgAtRimAndOne",
	"fgLowPost",
	"fgLowPostAndOne",
	"fgMidRange",
	"fgMidRangeAndOne",
	"tp",
	"tpAndOne",
]);
const ISO_WORDS =
	/isolat|clear(s|ed)? out|clears to|one-on-one|sizes up|on an island|step-?back|spread the floor|spaces to the corners|waves off the screen|jab|goes to work|calls for the ball and/i;
const PNR_WORDS = /pick-and-roll|screen|\bpick\b/i;
const DNK_WORDS = /kick|draws (two|the help)|collapses|finds the open man/i;

const newText = () => ({
	n: 0,
	unast: 0,
	isoAction: 0,
	pnrAction: 0,
	dnkAction: 0,
	isoWords: 0,
	pnrWords: 0,
	dnkWords: 0,
	astIso: 0,
});
const texts = { rest: newText(), late: newText(), goAhead: newText() };

const flavorGame = (gid, events, teamOf) => {
	const init = events.find((e) => e.type === "init");
	const session = new FlavorSession({
		gid,
		numPeriods: 4,
		quarterLength: 12,
		female: false,
		noArticle: false,
		teams: [
			{ name: "Celtics", abbrev: "BOS" },
			{ name: "Mavericks", abbrev: "DAL" },
		],
		players: playersFromInitEvent(init),
		context: contextFromInitEvent(init),
	});
	const score = [0, 0];
	const stats = new Map();
	const onCourt = [new Set(), new Set()];
	const host = {
		stat: (pid) => stats.get(pid),
		score: () => [score[0], score[1]],
		onCourt: (t) => [...onCourt[t]],
	};
	let period = 1;
	for (let i = 0; i < events.length; i++) {
		const e = events[i];
		if (e.type === "init") {
			continue;
		}
		if (e.type === "stat") {
			if (e.s === "pts") {
				score[e.t] += e.amt;
			}
			if (e.pid !== undefined && e.pid !== null) {
				let s = stats.get(e.pid);
				if (!s) {
					s = {
						pts: 0,
						ast: 0,
						trb: 0,
						stl: 0,
						blk: 0,
						tov: 0,
						pf: 0,
						fg: 0,
						fga: 0,
						tp: 0,
						tpa: 0,
						ft: 0,
						fta: 0,
					};
					stats.set(e.pid, s);
				}
				const k = e.s === "orb" || e.s === "drb" ? "trb" : e.s;
				if (k in s) {
					s[k] += e.amt;
				}
				if (e.s === "gs") {
					onCourt[e.t].add(e.pid);
				}
			}
			continue;
		}
		if (e.type === "period" || e.type === "overtime") {
			period = e.period ?? period + 1;
		}
		// (the score before this event: points are logged as stat events before the shot's own event)
		let margin;
		if (MADE.has(e.type)) {
			const pts = e.type.startsWith("tp") ? 3 : 2;
			const o = e.t === 0 ? 1 : 0;
			margin = score[e.t] - pts - score[o];
		}
		const r = session.describe(e, host, events.slice(i + 1));
		if (e.type === "sub") {
			for (const pid of e.pidsOff) {
				onCourt[e.t].delete(pid);
			}
			for (const pid of e.pids) {
				onCourt[e.t].add(pid);
			}
		}
		if (!MADE.has(e.type) || !r || r === "silent") {
			continue;
		}
		const late = period >= 4 && e.clock <= 24 && Math.abs(margin) <= 3;
		const goAhead = late && margin <= 0;
		const text = r.text ?? "";
		const add = (x) => {
			x.n += 1;
			x.unast += e.pidAst === undefined ? 1 : 0;
			x.isoAction += r.action === "isolation" ? 1 : 0;
			x.pnrAction += r.action === "pick-and-roll" ? 1 : 0;
			x.dnkAction += r.action === "drive-and-kick" ? 1 : 0;
			const iso = ISO_WORDS.test(text);
			x.isoWords += iso ? 1 : 0;
			x.pnrWords += PNR_WORDS.test(text) ? 1 : 0;
			x.dnkWords += DNK_WORDS.test(text) ? 1 : 0;
			if (iso && e.pidAst !== undefined) {
				x.astIso += 1;
				if (env.LATE_ISO_SHOW) {
					console.log("ASSISTED ISO?", text);
				}
			}
		};
		add(late ? texts.late : texts.rest);
		if (goAhead) {
			add(texts.goAhead);
			if (env.LATE_ISO_SHOW) {
				console.log(`[${margin}] ${text}`);
			}
		}
	}
	void teamOf;
};

const winners = {
	n: 0,
	ast: 0,
	three: 0,
	mid: 0,
	rim: 0,
	post: 0,
	ft: 0,
	other: 0,
	isoText: 0,
};

test.skipIf(!env.LATE_ISO)(
	"late close possessions",
	{ timeout: 24 * 60 * 60 * 1000 },
	async () => {
		const numSeeds = Number(env.LATE_ISO_SEEDS ?? 150);
		const games = Number(env.LATE_ISO_GAMES ?? 10);
		const settings = {
			...nativeFeatureNewLeagueDefaults(),
			...gameSimPresets[2026],
			...(env.LATE_ISO_OFF ? { smartEndgame: false } : {}),
		};
		let numGames = 0;
		let homeWins = 0;
		const margins = [0, 0, 0, 0];
		let pts = 0;
		let ast = 0;
		let fg = 0;
		let fga = 0;
		for (let seed = 1; seed <= numSeeds; seed++) {
			await withSeededRandom(seed * 7919, async () => {
				await genTeams();
				for (const [key, value] of Object.entries(settings)) {
					g.setWithoutSavingToDB(key, value);
				}
				for (let i = 0; i < games; i++) {
					const teams = await loadTeams([0, 1], {});
					const gid = seed * 1000 + i;
					const sim = new GameSim({
						gid,
						teams: [teams[0], teams[1]],
						baseInjuryRate: 0,
						doPlayByPlay: true,
						homeCourtFactor: 1,
						allStarGame: false,
						neutralSite: false,
					});
					const result = sim.run();
					numGames += 1;
					const d = result.team[0].stat.pts - result.team[1].stat.pts;
					homeWins += d > 0 ? 1 : 0;
					const ad = Math.abs(d);
					margins[ad <= 3 ? 0 : ad <= 10 ? 1 : ad <= 20 ? 2 : 3] += 1;
					for (const t of result.team) {
						pts += t.stat.pts;
						ast += t.stat.ast;
						fg += t.stat.fg;
						fga += t.stat.fga;
					}
					for (const [k, c] of result.clutchPlays.entries()) {
						const m = c.meta;
						if (
							!m ||
							(m.kind !== "winner" &&
								m.kind !== "tying" &&
								m.kind !== "forceOT")
						) {
							continue;
						}
						winners.n += 1;
						winners.ast += m.ast ? 1 : 0;
						if (m.finish || m.shot === "ft") {
							winners.ft += 1;
						} else if (m.shot === "threePointer") {
							winners.three += 1;
						} else if (m.shot === "midRange") {
							winners.mid += 1;
						} else if (m.shot === "atRim") {
							winners.rim += 1;
						} else if (m.shot === "lowPost") {
							winners.post += 1;
						} else {
							winners.other += 1;
						}
						const text = clutchFlavorText(m, gid, k, (p) => p.name);
						if (ISO_WORDS.test(text)) {
							winners.isoText += 1;
						}
						if (env.LATE_ISO_SHOW) {
							console.log("CLUTCH", text);
						}
					}
					flavorGame(gid, result.playByPlay, undefined);
				}
			});
		}

		const f = (x, d = 3) => (Number.isFinite(x) ? x.toFixed(d) : "-");
		const lines = [
			`games ${numGames}, smartEndgame ${settings.smartEndgame}, ${env.LATE_ISO_SET ?? ""}`,
			`per team game: pts ${f(pts / numGames / 2, 2)} FG% ${f(fg / fga)} AST ${f(ast / numGames / 2, 2)}, home win% ${f(homeWins / numGames)}, margin <=3 ${f(margins[0] / numGames)} 4-10 ${f(margins[1] / numGames)} 11-20 ${f(margins[2] / numGames)} 21+ ${f(margins[3] / numGames)}`,
			"group | FGA | FG% | xFG% | unassisted/FGA | self-created unassisted/FGA | AST/FGM | star share | top creator share | 3PT | mid | rim | post | other",
		];
		for (const [name, gr] of Object.entries(groups)) {
			lines.push(
				`${name} | ${gr.fga} | ${f(gr.fg / gr.fga)} | ${f(gr.xfg / gr.fga)} | ${f(gr.unast / gr.fga)} | ${f(gr.self / gr.fga)} | ${f(gr.ast / gr.fg)} | ${f(gr.star / gr.fga)} | ${f(gr.creator / gr.fga)} | ${f(gr.three / gr.fga)} | ${f(gr.mid / gr.fga)} | ${f(gr.rim / gr.fga)} | ${f(gr.post / gr.fga)} | ${f(gr.other / gr.fga)}`,
			);
		}
		lines.push(
			"text (made FG) | n | unassisted | action iso | action PnR | action D&K | iso words | PnR words | D&K words | iso words on assisted",
		);
		for (const [name, x] of Object.entries(texts)) {
			lines.push(
				`${name} | ${x.n} | ${f(x.unast / x.n)} | ${f(x.isoAction / x.n)} | ${f(x.pnrAction / x.n)} | ${f(x.dnkAction / x.n)} | ${f(x.isoWords / x.n)} | ${f(x.pnrWords / x.n)} | ${f(x.dnkWords / x.n)} | ${x.astIso}`,
			);
		}
		const w = winners;
		lines.push(
			`clutch plays (winner/tying/forceOT) ${w.n}: assisted ${f(w.ast / w.n)}, 3PT ${f(w.three / w.n)} mid ${f(w.mid / w.n)} rim ${f(w.rim / w.n)} post ${f(w.post / w.n)} FT/and-one ${f(w.ft / w.n)} other ${f(w.other / w.n)}, iso words in the clutch line ${f(w.isoText / w.n)}`,
		);
		console.log(lines.join("\n"));
	},
);
