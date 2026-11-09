// Not a real test: the vote's distributions over seasons dumped from a real league (see
// worker/core/awards/awardVoteDump.test.ts). Skipped unless AWARD_VOTE_IN (the dump directory) is set:
//
//   AWARD_VOTE_IN=/tmp/awardVote node_modules/.bin/vitest run --project basketball src/common/awardVote/awardVote.calibration.test.ts
// @ts-expect-error node types are not in the web tsconfig, but tests run in node
import { readdirSync, readFileSync } from "node:fs";
import { describe, test } from "vitest";
import { simulateVote, type VoteAwardInput } from "./index.ts";

const IN: string | undefined = (globalThis as any).process.env.AWARD_VOTE_IN;

const pct = (xs: number[], q: number) => {
	const s = [...xs].sort((a, b) => a - b);
	return s[Math.min(s.length - 1, Math.floor(q * s.length))];
};

describe.skipIf(!IN)("award vote calibration", () => {
	test("distributions", () => {
		const files: string[] = readdirSync(IN!).filter((f: string) =>
			f.endsWith(".json"),
		);
		const stats: Record<
			string,
			{
				firsts: number[];
				ruFirsts: number[];
				share: number[];
				getting: number[];
				unanimous: number;
				upsetsFree: number;
			}
		> = {};
		for (const f of files) {
			const season = Number(/(\d{4})/.exec(f)![1]);
			const inputs: VoteAwardInput[] = JSON.parse(
				readFileSync(`${IN}/${f}`, "utf8"),
			);
			for (const input of inputs) {
				if (!["MVP", "DPOY", "ROY", "SMOY", "MIP"].includes(input.shortName)) {
					continue;
				}
				const v = simulateVote(input, { seed: season })!;
				const free = simulateVote(
					{ ...input, respect: undefined },
					{ seed: season },
				)!;
				const st = (stats[input.shortName] ??= {
					firsts: [],
					ruFirsts: [],
					share: [],
					getting: [],
					unanimous: 0,
					upsetsFree: 0,
				});
				st.firsts.push(v.rows[0]!.first);
				st.ruFirsts.push(v.rows[1]?.first ?? 0);
				st.share.push(Math.round(v.rows[0]!.share * 100));
				st.getting.push(v.rows.length);
				if (v.rows[0]!.first === v.voters) {
					st.unanimous += 1;
				}
				if (free.rows[0]!.pid !== (input.respect as number[])[0]) {
					st.upsetsFree += 1;
				}
			}
		}
		for (const [k, st] of Object.entries(stats)) {
			const n = st.firsts.length;
			console.log(
				`${k}: n=${n} winner 1st votes p10/p50/p90 ${pct(st.firsts, 0.1)}/${pct(st.firsts, 0.5)}/${pct(st.firsts, 0.9)}, unanimous ${st.unanimous}, runner-up 1st p50/p90 ${pct(st.ruFirsts, 0.5)}/${pct(st.ruFirsts, 0.9)}, share p50 ${pct(st.share, 0.5)}%, players with votes min/p50/max ${Math.min(...st.getting)}/${pct(st.getting, 0.5)}/${Math.max(...st.getting)}, free vote differs from formula ${st.upsetsFree}`,
			);
			console.log(`  winner 1st votes: ${st.firsts.join(" ")}`);
		}
	});
});
