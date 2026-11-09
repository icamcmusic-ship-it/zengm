// Who calls a function (by name substring), with time: node callers.cjs file.cpuprofile name [depth]
const fs = require("node:fs");
const prof = JSON.parse(fs.readFileSync(process.argv[2], "utf8"));
const name = process.argv[3];
const depth = Number(process.argv[4] ?? 4);
const nodes = new Map(prof.nodes.map((n) => [n.id, n]));
const parent = new Map();
for (const n of prof.nodes)
	for (const c of n.children ?? []) parent.set(c, n.id);
const self = new Map();
for (let i = 0; i < prof.samples.length; i++)
	self.set(
		prof.samples[i],
		(self.get(prof.samples[i]) ?? 0) + (prof.timeDeltas[i] ?? 0),
	);
const key = (n) =>
	`${n.callFrame.functionName || "(anon)"} ${n.callFrame.url.replace(/.*\/src\//, "").replace(/.*node_modules\//, "nm/")}:${n.callFrame.lineNumber + 1}`;
const out = new Map();
for (const [id, t] of self) {
	let cur = id;
	while (cur !== undefined && !key(nodes.get(cur)).includes(name))
		cur = parent.get(cur);
	if (cur === undefined) continue;
	const chain = [];
	for (
		let c = parent.get(cur), i = 0;
		c !== undefined && i < depth;
		c = parent.get(c), i++
	)
		chain.push(key(nodes.get(c)));
	const k = chain.join(" < ");
	out.set(k, (out.get(k) ?? 0) + t);
}
[...out]
	.sort((a, b) => b[1] - a[1])
	.slice(0, 25)
	.forEach(([k, t]) => console.log(`${(t / 1e6).toFixed(2)}s ${k}`));
