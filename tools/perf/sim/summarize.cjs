// Summarize run.sh output: node summarize.cjs results.txt [baseline-results.txt]
// CPU time (WALL=1 for wall time). Groups phases into season (regular season), playoffs, offseason; per-feature rows are (off + feature) - off.
const fs = require("node:fs");
const read = (file) =>
	fs
		.readFileSync(file, "utf8")
		.split("\n")
		.filter((l) => l.startsWith("SIM_BENCH_RESULT "))
		.map((l) => JSON.parse(l.slice(17)));
const groups = {
	day1: ["day1"],
	season: ["toRegularSeason", "day1", "week1", "restOfRegularSeason"],
	playoffs: ["playoffs"],
	offseason: [
		"toDraft",
		"draft",
		"toResignPlayers",
		"toFreeAgency",
		"freeAgencyDays",
		"toPreseason",
		"toRegularSeason2",
	],
	faDays: ["freeAgencyDays"],
};
const sum = (r) => {
	const out = {};
	const t = process.env.WALL ? r.times : (r.cpu ?? r.times);
	for (const [g, keys] of Object.entries(groups))
		out[g] = keys.reduce((a, k) => a + (t[k] ?? 0), 0);
	out.total = out.season + out.playoffs + out.offseason;
	return out;
};
const label = (r) => (r.feature ? `+${r.feature}` : r.mode);
const load = (file) => {
	const m = new Map();
	for (const r of read(file)) m.set(label(r), { ...sum(r), hash: r.hash });
	return m;
};
const a = load(process.argv[2]);
const b = process.argv[3] ? load(process.argv[3]) : undefined;
const cols = Object.keys(groups).concat("total");
const fmt = (x) => (x / 1000).toFixed(1).padStart(6);
const off = a.get("off");
console.log(
	`${"".padEnd(26)}${cols.map((c) => c.padStart(b ? 16 : 8)).join("")}`,
);
const rows = [...a.keys()].sort((x, y) => {
	const order = (k) =>
		k === "on" ? 0 : k === "stock" ? 1 : k === "off" ? 2 : 3;
	return (
		order(x) - order(y) ||
		a.get(y).total - (off?.total ?? 0) - (a.get(x).total - (off?.total ?? 0))
	);
});
for (const k of rows) {
	const r = a.get(k);
	const isFeature = k.startsWith("+");
	const cells = cols.map((c) => {
		const v = isFeature && off ? r[c] - off[c] : r[c];
		if (!b) return fmt(v).padStart(8);
		const rb = b.get(k);
		const offB = b.get("off");
		const vb = rb ? (isFeature && offB ? rb[c] - offB[c] : rb[c]) : NaN;
		return `${fmt(vb)}→${fmt(v)}`.padStart(16);
	});
	console.log(`${k.padEnd(26)}${cells.join("")}`);
}
