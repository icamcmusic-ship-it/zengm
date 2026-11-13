import { useEffect, useState } from "react";
import { toWorker } from "../util/toWorker.ts";
import { useFeatureOn } from "../util/nativeFeatures.ts";
import { useLocal } from "../util/local.ts";

export type ProProjectionData = Awaited<
	ReturnType<typeof getProjections>
>[number];

const getProjections = (pids: number[]) =>
	toWorker("main", "getProProjections", pids);

const pct = (x: number) => `${Math.round(100 * x)}%`;

export const verdictClass = (verdict: string) =>
	verdict === "Star"
		? "text-success fw-bold"
		: verdict === "Starter"
			? "text-success"
			: verdict === "Bust risk"
				? "text-danger"
				: undefined;

// Odds and peak in a compact form, for tables
export const ProjectionCells = ({
	projection,
	hidePeak,
}: {
	projection: ProProjectionData | undefined;
	// No visible ratings challenge: the peak is an ovr
	hidePeak?: boolean;
}) => {
	if (!projection) {
		return (
			<>
				{hidePeak ? null : <td className="text-body-secondary">…</td>}
				<td className={hidePeak ? "text-body-secondary" : undefined}>
					{hidePeak ? "…" : null}
				</td>
				<td />
				<td />
			</>
		);
	}
	return (
		<>
			{hidePeak ? null : (
				<td
					title={`10th-90th percentile: ${projection.peakLow}-${projection.peakHigh}`}
				>
					{projection.peak}{" "}
					<span className="text-body-secondary small">
						({projection.peakLow}-{projection.peakHigh})
					</span>
				</td>
			)}
			<td>{pct(projection.starPct)}</td>
			<td>{pct(projection.starterPct)}</td>
			<td>{pct(projection.bustPct)}</td>
		</>
	);
};

// Pro projection section of a draft prospect's player page
export const ProProjectionSection = ({ pid }: { pid: number }) => {
	const on = useFeatureOn("mockDraft");
	const { challengeNoRatings } = useLocal(["challengeNoRatings"]);
	const [projection, setProjection] = useState<
		ProProjectionData | undefined | null
	>(null);

	useEffect(() => {
		if (!on) {
			return;
		}
		let cancelled = false;
		setProjection(null);
		(async () => {
			const result = await getProjections([pid]);
			if (!cancelled) {
				setProjection(result[pid]);
			}
		})();
		return () => {
			cancelled = true;
		};
	}, [on, pid]);

	if (!on || projection === undefined) {
		return null;
	}

	return (
		<div className="mb-3" style={{ maxWidth: 520 }}>
			<h2>Pro projection</h2>
			{projection === null ? (
				<p className="text-body-secondary">Simulating careers…</p>
			) : (
				<>
					<p className="mb-2">
						Projects as a{" "}
						<span className={verdictClass(projection.verdict)}>
							{projection.verdict.toLowerCase()}
						</span>
						:{" "}
						{challengeNoRatings
							? "peak"
							: `peak ovr ${projection.peak} (range ${projection.peakLow}-${projection.peakHigh})`}{" "}
						around age {projection.peakAge}, about {projection.years} seasons in
						the league.
					</p>
					<div className="d-flex gap-3 flex-wrap mb-1">
						<div>
							<div className="text-body-secondary small">Star (65+)</div>
							<div className="fs-5">{pct(projection.starPct)}</div>
						</div>
						<div>
							<div className="text-body-secondary small">Starter (58+)</div>
							<div className="fs-5">{pct(projection.starterPct)}</div>
						</div>
						<div>
							<div className="text-body-secondary small">Bust</div>
							<div className="fs-5">{pct(projection.bustPct)}</div>
						</div>
					</div>
					<p className="text-body-secondary small mb-0">
						Simulated careers with the game's own player development, from his
						ratings as your scouts see them. Bust: under 50 ovr at his peak or
						out of the league within 4 seasons.
					</p>
				</>
			)}
		</div>
	);
};
