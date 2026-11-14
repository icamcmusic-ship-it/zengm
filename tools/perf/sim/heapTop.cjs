// Summarize a sampled heap profile (SIM_BENCH_HEAP): bytes allocated per function, selfBy and inclusive (top N).
// Usage: node heapTop.cjs file.heapprofile [N]
const fs = require("node:fs");
const prof = JSON.parse(fs.readFileSync(process.argv[2], "utf8"));
const N = Number(process.argv[3] ?? 40);
const selfBy = new Map();
const incl = new Map();
const key = (n) =>
	`${n.callFrame.functionName || "(anon)"} ${n.callFrame.url.replace(/.*\/src\//, "").replace(/.*node_modules\//, "nm/")}:${n.callFrame.lineNumber + 1}`;
let total = 0;
const walk = (n, stack) => {
	const k = key(n);
	const bytes = (n.selfSize ?? 0) + 0;
	let sum = 0;
	for (const s of n.samples ?? []) {sum += s.size * s.count;}
	const own = sum || bytes;
	total += own;
	selfBy.set(k, (selfBy.get(k) ?? 0) + own);
	const seen = new Set(stack);
	if (!seen.has(k)) {stack = [...stack, k];}
	for (const s of stack) {incl.set(s, (incl.get(s) ?? 0) + own);}
	for (const c of n.children ?? []) {walk(c, stack);}
};
walk(prof.head, []);
const fmt = (b) => `${(b / 1e6).toFixed(0).padStart(7)} MB`;
console.log(`== selfBy (total ${fmt(total)})`);
for (const [k, v] of [...selfBy].sort((a, b) => b[1] - a[1]).slice(0, N)) {console.log(fmt(v), k);}
console.log("== inclusive");
for (const [k, v] of [...incl].sort((a, b) => b[1] - a[1]).slice(0, N)) {console.log(fmt(v), k);}
