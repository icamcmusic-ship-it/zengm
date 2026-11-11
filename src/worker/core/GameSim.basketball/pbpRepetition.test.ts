import { assert, test, vi } from "vitest";

// (whole simulated games: slow when the machine is busy)
vi.setConfig({ testTimeout: 120_000 });
import {
	FlavorSession,
	playersFromInitEvent,
	type FlavorHost,
	type FlavorStat,
} from "../../../common/pbpFlavor/index.ts";
import { simulateGame } from "./simLiveGameForTests.ts";

/*
 * How much the most common lines of the play-by-play repeat, over 30 simulated games: for each kind of line (made and missed jumpers,
 * shots inside, rebounds, fouls, free throws, substitutions, timeouts, period starts and ends...), the share of lines that have the same
 * shape (names and numbers taken out) as one of the previous 8 lines of that kind, and how many different shapes there are. Printed for
 * tuning; the assertions only keep it from getting much worse.
 */

const GROUPS: Record<string, string> = {
	fgMidRange: "made jumper",
	fgMidRangeAndOne: "made jumper",
	tp: "made jumper",
	tpAndOne: "made jumper",
	missMidRange: "missed jumper",
	missTp: "missed jumper",
	fgAtRim: "made inside",
	fgAtRimAndOne: "made inside",
	fgLowPost: "made inside",
	fgLowPostAndOne: "made inside",
	fgPutBack: "made inside",
	fgPutBackAndOne: "made inside",
	fgTipIn: "made inside",
	fgTipInAndOne: "made inside",
	missAtRim: "missed inside",
	missLowPost: "missed inside",
	missPutBack: "missed inside",
	missTipIn: "missed inside",
	orb: "rebound",
	drb: "rebound",
	pfNonShooting: "foul",
	pfBonus: "foul",
	pfFG: "foul",
	pfTP: "foul",
	ft: "free throw",
	missFt: "free throw",
	sub: "substitution",
	timeout: "timeout",
	period: "period start",
	overtime: "period start",
	endOfPeriod: "period end",
	tov: "turnover",
	stl: "steal",
};

const escape = (s: string) =>
	s.replaceAll(/[$()*+.?[\\\]^{|}]/g, String.raw`\$&`);

const SEEDS = Array.from({ length: 30 }, (_, i) => i + 101);

const measureRepetition = async () => {
	const stats = new Map<
		string,
		{ n: number; repeats: number; shapes: Set<string> }
	>();
	for (const seed of SEEDS) {
		const { events } = await simulateGame(seed);
		const players = playersFromInitEvent(events[0]);
		const session = new FlavorSession({
			gid: seed,
			numPeriods: 4,
			quarterLength: 12,
			female: false,
			noArticle: false,
			teams: [
				{ name: "Celtics", abbrev: "BOS" },
				{ name: "Mavericks", abbrev: "DAL" },
			],
			players,
		});
		const names = new Set<string>(["Celtics", "Mavericks"]);
		for (const p of players) {
			names.add(p.name);
			const parts = p.name
				.split(" ")
				.filter((w) => !/^(Jr\.?|Sr\.?|II|III|IV)$/.test(w));
			names.add(parts.at(-1)!);
		}
		const nameRe = new RegExp(
			[...names]
				.sort((a, b) => b.length - a.length)
				.map(escape)
				.join("|"),
			"g",
		);
		const shapeOf = (s: string) =>
			s
				.replaceAll(/ \((?:\d+ [A-Z]+|P\d[^)]*)\)/g, "")
				.replace(nameRe, "N")
				.replaceAll(/N's\b/g, "N'")
				.replaceAll(/\d+/g, "#");
		const score: [number, number] = [0, 0];
		const box = new Map<number, FlavorStat>();
		const onCourt: [Set<number>, Set<number>] = [new Set(), new Set()];
		const host: FlavorHost = {
			stat: (pid) => box.get(pid),
			score: () => [score[0], score[1]],
			onCourt: (t) => [...onCourt[t]],
		};
		const recent = new Map<string, string[]>();
		const recentNotes: string[] = [];
		for (let i = 0; i < events.length; i++) {
			const e = events[i];
			if (e.type === "init") {
				continue;
			}
			if (e.type === "stat") {
				if (e.s === "pts") {
					score[e.t as 0 | 1] += e.amt;
				}
				if (e.pid !== undefined && e.pid !== null) {
					let s = box.get(e.pid);
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
						box.set(e.pid, s);
					}
					const k = e.s === "orb" || e.s === "drb" ? "trb" : e.s;
					if (k in s) {
						(s as any)[k] += e.amt;
					}
					if (e.s === "gs") {
						onCourt[e.t as 0 | 1].add(e.pid);
					}
				}
				continue;
			}
			const r = session.describe(e, host, events.slice(i + 1));
			if (e.type === "sub") {
				for (const pid of e.pidsOff) {
					onCourt[e.t as 0 | 1].delete(pid);
				}
				for (const pid of e.pids) {
					onCourt[e.t as 0 | 1].add(pid);
				}
			}
			// The second lines (milestones, runs, colour, context), whatever the play: a group of their own
			if (r && r !== "silent" && r.note) {
				for (const sentence of r.note.split(/(?<=[!.?])\s+/)) {
					const shape = shapeOf(sentence);
					if (!shape) {
						continue;
					}
					let st = stats.get("notes");
					if (!st) {
						st = { n: 0, repeats: 0, shapes: new Set() };
						stats.set("notes", st);
					}
					const prev = recentNotes;
					st.n += 1;
					if (prev.includes(shape)) {
						st.repeats += 1;
					}
					st.shapes.add(shape);
					prev.push(shape);
					if (prev.length > 8) {
						prev.shift();
					}
				}
			}
			const group = GROUPS[e.type];
			if (!r || r === "silent" || !group) {
				continue;
			}
			const shape = shapeOf(r.text || r.note || "");
			if (!shape) {
				continue;
			}
			let st = stats.get(group);
			if (!st) {
				st = { n: 0, repeats: 0, shapes: new Set() };
				stats.set(group, st);
			}
			const prev = recent.get(group) ?? [];
			st.n += 1;
			if (prev.includes(shape)) {
				st.repeats += 1;
			}
			st.shapes.add(shape);
			prev.push(shape);
			if (prev.length > 8) {
				prev.shift();
			}
			recent.set(group, prev);
		}
	}
	return stats;
};

test("the common lines rarely repeat one of the last 8 of their kind", async () => {
	const stats = await measureRepetition();
	let n = 0;
	let repeats = 0;
	const rows: string[] = [];
	for (const [group, st] of [...stats].sort((a, b) => b[1].n - a[1].n)) {
		// (the notes are reported on their own, not in the total)
		if (group !== "notes") {
			n += st.n;
			repeats += st.repeats;
		}
		rows.push(
			`${group.padEnd(14)} lines ${String(st.n).padStart(5)}  repeat-in-8 ${((100 * st.repeats) / st.n).toFixed(1).padStart(5)}%  shapes ${st.shapes.size}`,
		);
	}
	console.log(
		`play-by-play repetition over ${SEEDS.length} games\n${rows.join("\n")}\nall            lines ${n}  repeat-in-8 ${((100 * repeats) / n).toFixed(1)}%`,
	);
	// (5.5% before the extra phrases of this round, 1.3% after)
	assert.isBelow(repeats / n, 0.03);
});
