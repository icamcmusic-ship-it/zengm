const fs = require("fs"), assert = require("assert");
const [a, b] = process.argv.slice(2);
for (const k of ["wrapped.season", "wrapped.team", "wrapped.player", "wrapped.all", "storylines"]) {
	const x = JSON.parse(fs.readFileSync(`${process.env.DUMP || "dump"}/${a}-${k}.json`)), y = JSON.parse(fs.readFileSync(`${process.env.DUMP || "dump"}/${b}-${k}.json`));
	delete x.loading; delete y.loading;
	assert.deepStrictEqual(y, x);
	console.log("identical", k);
}
