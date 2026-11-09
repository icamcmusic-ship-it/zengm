// Summarize a .cpuprofile: self time and inclusive time per function (top N). Usage: node top.cjs file.cpuprofile [N] [filter]
const fs = require("node:fs");
const prof = JSON.parse(fs.readFileSync(process.argv[2], "utf8"));
const N = Number(process.argv[3] ?? 40);
const filter = process.argv[4];
const nodes = new Map(prof.nodes.map((n) => [n.id, n]));
const parent = new Map();
for (const n of prof.nodes)
	for (const c of n.children ?? []) parent.set(c, n.id);
const self = new Map();
const dt = prof.timeDeltas;
for (let i = 0; i < prof.samples.length; i++)
	self.set(prof.samples[i], (self.get(prof.samples[i]) ?? 0) + (dt[i] ?? 0));
const key = (n) =>
	`${n.callFrame.functionName || "(anon)"} ${n.callFrame.url.replace(/.*\/src\//, "").replace(/.*node_modules\//, "nm/")}:${n.callFrame.lineNumber + 1}`;
const selfBy = new Map(),
	inclBy = new Map();
let total = 0;
for (const [id, t] of self) {
	total += t;
	const n = nodes.get(id);
	selfBy.set(key(n), (selfBy.get(key(n)) ?? 0) + t);
	const seen = new Set();
	for (let cur = id; cur !== undefined; cur = parent.get(cur)) {
		const k = key(nodes.get(cur));
		if (!seen.has(k)) {
			seen.add(k);
			inclBy.set(k, (inclBy.get(k) ?? 0) + t);
		}
	}
}
const show = (m, title) => {
	console.log(`== ${title} (total ${(total / 1e6).toFixed(1)}s)`);
	[...m]
		.filter(([k]) => !filter || k.includes(filter))
		.sort((a, b) => b[1] - a[1])
		.slice(0, N)
		.forEach(([k, t]) =>
			console.log(`${(t / 1e6).toFixed(2).padStart(7)}s ${k}`),
		);
};
show(selfBy, "self");
show(inclBy, "inclusive");
