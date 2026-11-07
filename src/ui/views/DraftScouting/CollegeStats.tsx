import { useState } from "react";
import { toWorker } from "../../util/toWorker.ts";
import { confirm } from "../../util/confirm.tsx";

const randomSeed = () => Math.random().toString(36).slice(2, 8);

// Generate (or regenerate, or remove) college stats and honors for the prospects of a draft class
export const CollegeStats = ({
	numPlayers,
	numWithCollegeStats,
	season,
}: {
	numPlayers: number;
	numWithCollegeStats: number;
	season: number;
}) => {
	const [seed, setSeed] = useState(randomSeed);
	const [status, setStatus] = useState<"working" | undefined>();
	const [message, setMessage] = useState<string | undefined>();

	const hasAny = numWithCollegeStats > 0;

	const generate = async (seedToUse: string) => {
		if (hasAny) {
			const proceed = await confirm(
				`This replaces the college stats and honors already on the ${season} prospects, including any that came from an imported file. Continue?`,
				{
					okText: "Replace",
				},
			);
			if (!proceed) {
				return;
			}
		}

		setStatus("working");
		const output = await toWorker("main", "generateCollegeStats", {
			draftYear: season,
			seed: seedToUse,
		});
		setMessage(
			`Generated ${output.numSeasons} college seasons and ${output.numHonors} honors for ${output.numPlayers} prospects (seed ${seedToUse}).`,
		);
		setStatus(undefined);
	};

	return (
		<div className="mb-3">
			<p className="mb-2 small text-body-secondary">
				College stats and honors appear on prospects' player pages, labeled as
				college. They are not pro stats: they don't count toward experience,
				career totals, or player value. Same seed, same result.{" "}
				{numWithCollegeStats > 0
					? `${numWithCollegeStats} of ${numPlayers} prospects have them now.`
					: null}
			</p>
			<div className="d-flex flex-wrap gap-2 align-items-center">
				<div className="input-group input-group-sm w-auto">
					<span className="input-group-text">Seed</span>
					<input
						type="text"
						className="form-control"
						style={{ width: 110 }}
						value={seed}
						onChange={(event) => {
							setSeed(event.target.value);
						}}
					/>
				</div>
				<button
					className="btn btn-sm btn-secondary"
					disabled={status === "working" || seed.trim() === ""}
					onClick={async () => {
						await generate(seed.trim());
					}}
				>
					{hasAny ? "Regenerate" : "Generate college stats & honors"}
				</button>
				{hasAny ? (
					<>
						<button
							className="btn btn-sm btn-light-bordered"
							disabled={status === "working"}
							onClick={async () => {
								const newSeed = randomSeed();
								setSeed(newSeed);
								await generate(newSeed);
							}}
						>
							New seed
						</button>
						<button
							className="btn btn-sm btn-light-bordered"
							disabled={status === "working"}
							onClick={async () => {
								const proceed = await confirm(
									`Remove college stats and honors from the ${season} prospects?`,
									{ okText: "Remove" },
								);
								if (!proceed) {
									return;
								}
								setStatus("working");
								const output = await toWorker(
									"main",
									"removeCollegeStats",
									season,
								);
								setMessage(`Removed from ${output.numPlayers} prospects.`);
								setStatus(undefined);
							}}
						>
							Remove
						</button>
					</>
				) : null}
			</div>
			{message ? <div className="mt-2 small">{message}</div> : null}
		</div>
	);
};
