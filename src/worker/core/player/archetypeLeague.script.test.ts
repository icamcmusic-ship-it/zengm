/* eslint-disable no-undef, curly */
// @ts-nocheck
// archramp: the reading on one of the user's own leagues (a players export, "Export players" JSON, one file or several),
// read as the game reads it: the league's own norms, stat and play-type references, sub-ratings, traits, prospects as
// scouted. Compares parameter sets of the v2 engine (default: the cliffs, rampLo 0, against the shipped ramps):
// - the labels each gives, the players whose label differs, and the largest shares
// - stability: the same label after every rating moves by 3 (a uniform shift), and after every rating moves on its own
//   by up to 2 (independent noise, three draws)
// - churn: each player's last seasons replayed from his ratings history, last season's label carried
// Not part of the normal run:
//   RUN_ARCHETYPE_LEAGUE=1 ARCH_LEAGUE_FILES=/dir/or/a.json,b.json ARCH_LEAGUE_OUT=report.txt \
//     npx vitest --run src/worker/core/player/archetypeLeague.script.test.ts
// ARCH_LEAGUE_VARIANTS='{"name":{"rampLo":2},...}' replaces the parameter sets; ARCH_LEAGUE_DUMP=file writes every
// player's label per set (name, position, age, overall).
import { readdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { test } from "vitest";
import { PLAYER } from "../../../common/constants.ts";
import { archetypeById } from "../../../common/archetypes/index.ts";
import { isPos } from "../../../common/archetypes/position.ts";
import { classifyV2 } from "../../../common/archetypes/v2/engine.ts";
import { Rng } from "../../../common/ratingsBuilds/rng.ts";
import { mockIDBLeague, resetCache, resetG } from "../../../test/helpers.ts";
import { idb } from "../../db/index.ts";
import { g } from "../../util/index.ts";
import {
	archetypeTraits,
	getLeagueNorms,
	ratingsForArchetype,
	readOptionsFor,
	resetArchetypeNorms,
} from "./archetype.ts";

const FILES = process.env.ARCH_LEAGUE_FILES ?? "";
const OUT = process.env.ARCH_LEAGUE_OUT ?? "/tmp/claude-0/archleague.txt";
const VARIANTS: Record<string, object> = process.env.ARCH_LEAGUE_VARIANTS
	? JSON.parse(process.env.ARCH_LEAGUE_VARIANTS)
	: { cliffs: { rampLo: 0 }, ramps: {} };
const CHURN_SEASONS = 5;

const loadPlayers = () => {
	const paths = [];
	for (const f of FILES.split(",").filter(Boolean)) {
		if (statSync(f).isDirectory()) {
			for (const x of readdirSync(f).sort())
				if (x.endsWith(".json")) paths.push(join(f, x));
		} else paths.push(f);
	}
	const byPid = new Map();
	for (const f of paths) {
		const d = JSON.parse(readFileSync(f, "utf8").replace(/^\uFEFF/, ""));
		for (const p of d.players ?? []) byPid.set(p.pid, p);
	}
	return [...byPid.values()];
};

const pct = (a, b) => `${((100 * a) / Math.max(1, b)).toFixed(1)}%`;
const SKIP = new Set(["hgt", "fuzz", "ovr", "pot", "season", "wng"]);
// A copy of his latest ratings row with every rating (not height or wingspan) moved by `d(key)`
const moved = (p, d) => {
	const row = { ...p.ratings.at(-1) };
	for (const [k, v] of Object.entries(row)) {
		if (typeof v === "number" && !SKIP.has(k))
			row[k] = Math.max(0, Math.min(100, v + d(k)));
	}
	if (Array.isArray(row.sub))
		row.sub = row.sub.map((x, i) =>
			Math.max(0, Math.min(100, x + d(`sub${i}`))),
		);
	return { ...p, ratings: [...p.ratings.slice(0, -1), row] };
};

test.skipIf(!process.env.RUN_ARCHETYPE_LEAGUE)(
	"the reading on the user's league",
	async () => {
		const players = loadPlayers();
		if (players.length === 0) throw new Error("ARCH_LEAGUE_FILES: no players");
		const season = Math.max(...players.map((p) => p.ratings.at(-1).season));
		const row0 = players.find((p) => p.tid >= 0).ratings.at(-1);
		resetG();
		g.setWithoutSavingToDB("season", season);
		g.setWithoutSavingToDB("phase", 1);
		// (the settings the file shows the league has)
		g.setWithoutSavingToDB("subRatings", Array.isArray(row0.sub));
		g.setWithoutSavingToDB("expandedRatings", row0.pdef !== undefined);
		g.setWithoutSavingToDB(
			"playerTraits",
			players.some((p) => p.traits),
		);
		g.setWithoutSavingToDB(
			"advStats",
			players.some((p) => p.stats?.some((s) => s.adv)),
		);
		// (no team finances in a players file: the default scouting level)
		g.setWithoutSavingToDB("budget", false);
		resetArchetypeNorms();
		idb.league = mockIDBLeague();
		await resetCache({ players });
		const norms = await getLeagueNorms(true);

		const read = (p, params, previousId) => {
			const ratings = ratingsForArchetype(p);
			if (!ratings) return undefined;
			const row = p.ratings.at(-1);
			const pos = isPos(row.pos) ? row.pos : "F";
			return classifyV2(ratings, {
				norms,
				ovr: row.ovr,
				previousId,
				pos,
				traits: archetypeTraits(p, row.season),
				...readOptionsFor(p, pos, row.season),
				...(process.env.ARCH_LEAGUE_NOSTATS
					? { stats: undefined, pt: undefined }
					: {}),
				params,
			});
		};
		const nameOf = (p) => `${p.firstName} ${p.lastName}`;
		const who = (p) => {
			const r = p.ratings.at(-1);
			return `${nameOf(p)} (${r.pos}, ${season - p.born.year}, ovr ${r.ovr}${p.tid === PLAYER.UNDRAFTED ? ", prospect" : ""})`;
		};

		const out = [
			`${players.length} players, season ${season}: ${players.filter((p) => p.tid >= 0).length} on teams, ${players.filter((p) => p.tid === PLAYER.FREE_AGENT).length} free agents, ${players.filter((p) => p.tid === PLAYER.UNDRAFTED).length} draft prospects; sub-ratings ${g.get("subRatings")}, expanded ratings ${g.get("expandedRatings")}, traits ${g.get("playerTraits")}, tracking stats ${g.get("advStats")}`,
		];
		const labels = {};
		for (const [vn, params] of Object.entries(VARIANTS)) {
			const t0 = performance.now();
			const res = new Map();
			const counts = {};
			let composed = 0;
			for (const p of players) {
				const c = read(p, params);
				if (!c) continue;
				res.set(p.pid, c);
				counts[c.name] = (counts[c.name] ?? 0) + 1;
				if (c.id.startsWith("v2:")) composed++;
			}
			labels[vn] = res;
			const ms = (performance.now() - t0) / res.size;
			const sh = Object.entries(counts).sort((a, b) => b[1] - a[1]);
			out.push(
				`== ${vn} ${JSON.stringify(params)}`,
				`labels: ${sh.length} distinct, composed ${pct(composed, res.size)}, ${ms.toFixed(1)} ms per player; top: ${sh
					.slice(0, 6)
					.map(([n, k]) => `${n} ${pct(k, res.size)}`)
					.join(", ")}`,
			);
			// Stability: a uniform shift, and independent noise
			for (const dd of [3, 6]) {
				let same = 0,
					n = 0;
				for (const p of players) {
					const base = res.get(p.pid);
					if (!base) continue;
					for (const sgn of [-dd, dd]) {
						n++;
						if (
							read(
								moved(p, () => sgn),
								params,
							)?.id === base.id
						)
							same++;
					}
				}
				out.push(`stability, every rating ${dd} up or down: ${pct(same, n)}`);
			}
			for (const amp of [1, 2]) {
				let same = 0,
					n = 0;
				const flips = {};
				// (what moved with the label: the classic voter's label, the voted family, a voter's family, the kind of winner)
				const why = {};
				const gaps = [];
				for (const p of players) {
					const base = res.get(p.pid);
					if (!base) continue;
					for (let draw = 0; draw < 3; draw++) {
						const rng = new Rng(`jit-${p.pid}-${amp}-${draw}`);
						const c = read(
							moved(p, () => rng.int(-amp, amp)),
							params,
						);
						n++;
						if (c?.id === base.id) same++;
						else if (amp === 2) {
							const k = `${base.name} -> ${c?.name}`;
							flips[k] = (flips[k] ?? 0) + 1;
							const a = base.v2,
								b = c.v2;
							const kind = (x) => x.candidates[0].kind ?? "?";
							const bump = (k) => (why[k] = (why[k] ?? 0) + 1);
							bump("flips");
							if (a.classicTop[0] !== b.classicTop[0])
								bump("classic label moved");
							if (a.family !== b.family) bump("voted family moved");
							for (const v of ["classic", "knn", "rule", "probs"])
								if (a.voters[v] !== b.voters[v]) bump(`voter ${v} moved`);
							if (
								!["classic", "knn", "rule", "probs"].some(
									(v) => a.voters[v] !== b.voters[v],
								)
							)
								bump("no voter moved");
							bump(`winner ${kind(a)} -> ${kind(b)}`);
							if (!a.candidates.some((x) => x.id === c.id))
								bump("new label was not a candidate before");
							if (!b.candidates.some((x) => x.id === base.id))
								bump("old label is no candidate after");
							gaps.push(
								a.candidates[0].score -
									(a.candidates.find((x) => x.id === c.id)?.score ?? -9),
							);
						}
					}
				}
				out.push(
					`stability, each rating on its own by up to ${amp}: ${pct(same, n)}`,
				);
				if (amp === 2 && process.env.ARCH_LEAGUE_WHY) {
					gaps.sort((x, y) => x - y);
					out.push(
						`    why: ${Object.entries(why)
							.sort((x, y) => y[1] - x[1])
							.map(([k, v]) => `${k} ${v}`)
							.join("; ")}`,
						`    score gap to the new label before the move (quartiles): ${[0.25, 0.5, 0.75].map((q) => gaps[Math.floor(q * gaps.length)]?.toFixed(2)).join(" / ")}`,
					);
				}
				if (amp === 2)
					out.push(
						...Object.entries(flips)
							.sort((a, b) => b[1] - a[1])
							.slice(0, 8)
							.map(([k, v]) => `    ${v} ${k}`),
					);
			}
			// Churn: his last seasons replayed from his ratings history (the league's current norms throughout)
			{
				let changes = 0,
					steps = 0;
				const cwhy = {};
				const gone = [];
				const cgaps = [];
				for (const p of players) {
					if (p.tid === PLAYER.UNDRAFTED) continue;
					let prev;
					for (let s = season - CHURN_SEASONS; s <= season; s++) {
						if (s <= (p.draft?.year ?? -Infinity)) continue;
						const rows = p.ratings.filter((r) => r.season <= s);
						if (rows.length === 0 || rows.at(-1).season !== s) {
							prev = undefined;
							continue;
						}
						const c = read({ ...p, ratings: rows }, params, prev?.id);
						if (!c) continue;
						if (prev) {
							steps++;
							// (the label as shown: a composed name's id also holds his size group)
							if (prev.name !== c.name) {
								changes++;
								const bump = (k) => (cwhy[k] = (cwhy[k] ?? 0) + 1);
								const old = c.v2.candidates.find((x) => x.id === prev.id);
								if (prev.v2.classicTop[0] !== c.v2.classicTop[0])
									bump("classic label moved");
								if (prev.v2.family !== c.v2.family) bump("voted family moved");
								if (rows.at(-1).pos !== rows.at(-2)?.pos)
									bump("position moved");
								if (!old) {
									bump("old label no longer a candidate");
									bump(
										prev.id.startsWith("v2:")
											? `  gone: composed, role ${c.v2.candidates.some((x) => x.role === prev.v2.candidates[0].role && x.id.startsWith("v2:")) ? "still passes" : "no longer passes"}`
											: "  gone: a build",
									);
									if (gone.length < 25)
										gone.push(
											`${prev.name} -> ${c.name} (${rows.at(-2)?.pos} -> ${rows.at(-1).pos}, age ${s - p.born.year})`,
										);
								} else {
									bump("old label still a candidate");
									cgaps.push(c.v2.candidates[0].score - old.score);
								}
								if (/^(Raw|Reserve) |Prospect|Depth Piece/.test(prev.name))
									bump("was Prospect / Depth Piece");
								if (/^(Raw|Reserve) |Prospect|Depth Piece/.test(c.name))
									bump("became Prospect / Depth Piece");
							}
						}
						prev = c;
					}
				}
				out.push(
					`churn, last ${CHURN_SEASONS} seasons replayed: ${pct(changes, steps)} of seasons change label (${steps} player-seasons)`,
				);
				if (process.env.ARCH_LEAGUE_WHY) {
					cgaps.sort((x, y) => x - y);
					out.push(
						`    why: ${Object.entries(cwhy)
							.sort((x, y) => y[1] - x[1])
							.map(([k, v]) => `${k} ${v}`)
							.join("; ")}`,
						...gone.map((x) => `      ${x}`),
						`    how far the old label trails when it is still a candidate (quartiles): ${[0.25, 0.5, 0.75].map((q) => cgaps[Math.floor(q * cgaps.length)]?.toFixed(2)).join(" / ")}`,
					);
				}
			}
			writeFileSync(OUT, out.join("\n") + "\n");
		}
		// What differs between the first set and each other one
		const [first, ...others] = Object.keys(VARIANTS);
		for (const vn of others) {
			const diff = players.filter(
				(p) =>
					labels[first].get(p.pid) &&
					labels[first].get(p.pid).id !== labels[vn].get(p.pid)?.id,
			);
			out.push(
				`== ${first} -> ${vn}: ${diff.length} of ${labels[first].size} labels differ (${pct(diff.length, labels[first].size)})`,
				...diff
					.sort((a, b) => b.ratings.at(-1).ovr - a.ratings.at(-1).ovr)
					.map(
						(p) =>
							`  ${who(p)}: ${labels[first].get(p.pid).name} -> ${labels[vn].get(p.pid)?.name}`,
					),
			);
		}
		writeFileSync(OUT, out.join("\n") + "\n");
		if (process.env.ARCH_LEAGUE_DUMP) {
			writeFileSync(
				process.env.ARCH_LEAGUE_DUMP,
				players
					.map(
						(p) =>
							`${who(p)}\t${Object.keys(VARIANTS)
								.map((vn) => {
									const c = labels[vn].get(p.pid);
									return c
										? `${c.name} [${archetypeById(c.id)?.family ?? ""} ${Math.round(c.confidence * 100)}%]`
										: "-";
								})
								.join("\t")}`,
					)
					.join("\n") + "\n",
			);
		}
	},
	3600000,
);
