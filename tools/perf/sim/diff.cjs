// Self time per function, profile B minus profile A (biggest differences): node diff.cjs a.cpuprofile b.cpuprofile [N]
const fs = require("node:fs");
const selfBy = (file) => {
	const prof = JSON.parse(fs.readFileSync(file, "utf8"));
	const nodes = new Map(prof.nodes.map((n) => [n.id, n]));
	const out = new Map();
	for (let i = 0; i < prof.samples.length; i++) {
		const n = nodes.get(prof.samples[i]);
		const k = `${n.callFrame.functionName || "(anon)"} ${n.callFrame.url.replace(/.*\/src\//, "").replace(/.*node_modules\//, "nm/")}`;
		out.set(k, (out.get(k) ?? 0) + (prof.timeDeltas[i] ?? 0));
	}
	return out;
};
const a = selfBy(process.argv[2]);
const b = selfBy(process.argv[3]);
const keys = new Set([...a.keys(), ...b.keys()]);
const total = (m) => [...m.values()].reduce((x, y) => x + y, 0) / 1e6;
console.log(`total ${total(a).toFixed(1)}s -> ${total(b).toFixed(1)}s`);
[...keys]
	.map((k) => [k, ((b.get(k) ?? 0) - (a.get(k) ?? 0)) / 1e6])
	.sort((x, y) => Math.abs(y[1]) - Math.abs(x[1]))
	.slice(0, Number(process.argv[4] ?? 40))
	.forEach(([k, d]) =>
		console.log(`${d >= 0 ? "+" : ""}${d.toFixed(2)}s ${k}`),
	);
