import { useState } from "react";
import HideableSection from "../../components/HideableSection.tsx";
import { SHOT_ZONES, shotZones } from "../../../common/advStats.ts";

// Shot Zones (League extras): a player's shot chart by zone (a half court colored by his FG% vs the league's), the sub-zone table
// (frequency and FG% vs the league and his position) and his shot quality (expected FG% from where and how his shots came vs his
// actual FG%). Recorded by Advanced Tracking Stats, so only seasons played with Shot Zones on have it.

type AdvSeason = { season: number | "career"; adv: number[] };
type ZoneRef = {
	season: number;
	pos: string | undefined;
	league: number[];
	posAdv: number[] | undefined;
};
type Table = NonNullable<ReturnType<typeof shotZones>>;

const pct = (x: number | undefined, digits = 1) =>
	x === undefined ? "—" : `${(100 * x).toFixed(digits)}%`;

const GROUPS = [
	{ key: "rim", name: "At the rim" },
	{ key: "paint", name: "Short / paint" },
	{ key: "long", name: "Long two" },
	{ key: "corner3", name: "Corner three" },
	{ key: "ab3", name: "Above the break" },
] as const;
type GroupKey = (typeof GROUPS)[number]["key"];

const groupTotals = (table: Table | undefined) => {
	const out = {} as Record<
		GroupKey,
		{ fga: number; fgm: number; freq: number; fgp: number | undefined }
	>;
	for (const g of GROUPS) {
		let fga = 0;
		let fgm = 0;
		for (const z of table?.zones ?? []) {
			if (z.group === g.key) {
				fga += z.fga;
				fgm += z.fgm;
			}
		}
		out[g.key] = {
			fga,
			fgm,
			freq: table && table.fga > 0 ? fga / table.fga : 0,
			fgp: fga > 0 ? fgm / fga : undefined,
		};
	}
	return out;
};

// Better than the league: blue, worse: red, by up to 10 percentage points (gray with few attempts)
const zoneFill = (
	fga: number,
	fgp: number | undefined,
	ref: number | undefined,
) => {
	if (fga < 10 || fgp === undefined || ref === undefined) {
		return { fill: "#888", opacity: 0.25 };
	}
	const diff = fgp - ref;
	return {
		fill: diff >= 0 ? "#1f77b4" : "#d62728",
		opacity: 0.15 + 0.6 * Math.min(1, Math.abs(diff) / 0.1),
	};
};

const HOOP = { x: 250, y: 52 };

const Court = ({
	groups,
	league,
}: {
	groups: ReturnType<typeof groupTotals>;
	league: ReturnType<typeof groupTotals> | undefined;
}) => {
	const fillOf = (key: GroupKey) =>
		zoneFill(groups[key].fga, groups[key].fgp, league?.[key].fgp);
	const label = (key: GroupKey, x: number, y: number) => (
		<text
			x={x}
			y={y}
			textAnchor="middle"
			fontSize={15}
			fill="currentColor"
			style={{ pointerEvents: "none" }}
		>
			<tspan x={x} fontWeight="bold">
				{pct(groups[key].fgp)}
			</tspan>
			<tspan x={x} dy={17} fontSize={12}>
				{pct(groups[key].freq, 0)} of FGA
			</tspan>
		</text>
	);
	// 10 px per foot: 50 ft wide, 47 ft deep, the three-point arc 23.75 ft (22 ft in the corners), short shots inside 14 ft, the rim
	// area 5 ft
	const arcR = 237.5;
	const cornerY = HOOP.y + Math.sqrt(arcR ** 2 - (250 - 30) ** 2);
	return (
		<svg
			viewBox="0 0 500 470"
			style={{ width: "100%", maxWidth: 420 }}
			role="img"
			aria-label="Shot chart"
		>
			<rect x={0} y={0} width={500} height={470} {...fillOf("ab3")} />
			<rect x={0} y={0} width={30} height={cornerY} {...fillOf("corner3")} />
			<rect x={470} y={0} width={30} height={cornerY} {...fillOf("corner3")} />
			<path
				d={`M30 0 L30 ${cornerY} A${arcR} ${arcR} 0 0 0 470 ${cornerY} L470 0 Z`}
				fill="var(--bs-body-bg, #fff)"
			/>
			<path
				d={`M30 0 L30 ${cornerY} A${arcR} ${arcR} 0 0 0 470 ${cornerY} L470 0 Z`}
				{...fillOf("long")}
			/>
			<circle cx={HOOP.x} cy={HOOP.y} r={140} fill="var(--bs-body-bg, #fff)" />
			<circle cx={HOOP.x} cy={HOOP.y} r={140} {...fillOf("paint")} />
			<circle cx={HOOP.x} cy={HOOP.y} r={50} fill="var(--bs-body-bg, #fff)" />
			<circle cx={HOOP.x} cy={HOOP.y} r={50} {...fillOf("rim")} />
			<g fill="none" stroke="currentColor" strokeOpacity={0.6} strokeWidth={2}>
				<rect x={1} y={1} width={498} height={468} />
				<path
					d={`M30 0 L30 ${cornerY} A${arcR} ${arcR} 0 0 0 470 ${cornerY} L470 0`}
				/>
				<rect x={170} y={0} width={160} height={190} />
				<circle cx={250} cy={190} r={60} />
				<circle cx={HOOP.x} cy={HOOP.y} r={7.5} />
				<line x1={220} y1={40} x2={280} y2={40} />
			</g>
			{label("rim", HOOP.x, HOOP.y + 6)}
			{label("paint", HOOP.x, HOOP.y + 100)}
			{label("long", HOOP.x, HOOP.y + 185)}
			{label("ab3", HOOP.x, 375)}
			<g fontSize={12}>
				<text
					x={15}
					y={cornerY + 18}
					textAnchor="start"
					fill="currentColor"
					style={{ pointerEvents: "none" }}
				>
					Corner {pct(groups.corner3.fgp)} ({pct(groups.corner3.freq, 0)})
				</text>
			</g>
		</svg>
	);
};

export const ShotZones = ({
	advSeasons,
	refs,
}: {
	advSeasons: AdvSeason[] | undefined;
	refs: ZoneRef[] | undefined;
}) => {
	const seasons = (advSeasons ?? []).filter(
		(row) => shotZones(row.adv) !== undefined,
	);
	const defaultIndex = Math.max(0, seasons.length - 2);
	const [index, setIndex] = useState<number | undefined>();
	if (seasons.length === 0) {
		return null;
	}
	const selected = seasons[index ?? defaultIndex] ?? seasons[0]!;
	const table = shotZones(selected.adv)!;
	// The league and his position that season (his career is compared with his latest season's)
	const ref =
		selected.season === "career"
			? refs?.at(-1)
			: refs?.find((r) => r.season === selected.season);
	const league = shotZones(ref?.league);
	const pos = shotZones(ref?.posAdv);
	const groups = groupTotals(table);
	const leagueGroups = league ? groupTotals(league) : undefined;

	return (
		<HideableSection
			title="Shot zones"
			description="Where his shots come from and how he makes them, by zone, against the league and his position (regular season). Chart colors: blue above the league's FG% in that zone, red below."
		>
			<div className="mb-2">
				<select
					aria-label="Season"
					className="form-select form-select-sm d-inline-block w-auto"
					value={index ?? defaultIndex}
					onChange={(event) => {
						setIndex(Number(event.target.value));
					}}
				>
					{seasons.map((row, i) => (
						<option key={String(row.season)} value={i}>
							{row.season === "career" ? "Career" : row.season}
						</option>
					))}
				</select>
			</div>
			<div className="row">
				<div className="col-12 col-lg-5 mb-3">
					<Court groups={groups} league={leagueGroups} />
					<div className="mt-2">
						<b>Shot quality:</b> xFG% {pct(table.xfgp)}, actual FG%{" "}
						{pct(table.fgp)}
						{table.xfgp !== undefined ? (
							<>
								{" "}
								({table.fgp >= table.xfgp ? "+" : ""}
								{(100 * (table.fgp - table.xfgp)).toFixed(1)} shot making)
							</>
						) : null}
						{league?.xfgp !== undefined ? (
							<div className="text-body-secondary small">
								League: xFG% {pct(league.xfgp)}, FG% {pct(league.fgp)}. xFG% is
								the expected FG% of his shots from where they were taken, the
								defense, an assist and spacing, not who took them.
							</div>
						) : null}
					</div>
				</div>
				<div className="col-12 col-lg-7 mb-3">
					<div className="table-responsive">
						<table className="table table-sm table-striped mb-0">
							<thead>
								<tr>
									<th>Zone</th>
									<th className="text-end">FGA</th>
									<th className="text-end">Freq</th>
									<th
										className="text-end"
										title={`${ref?.pos ?? "Position"} average`}
									>
										{ref?.pos ?? "Pos"}
									</th>
									<th className="text-end">Lg</th>
									<th className="text-end">FG%</th>
									<th
										className="text-end"
										title={`${ref?.pos ?? "Position"} average`}
									>
										{ref?.pos ?? "Pos"}
									</th>
									<th className="text-end">Lg</th>
								</tr>
							</thead>
							<tbody>
								{SHOT_ZONES.map((z, i) => {
									const row = table.zones[i]!;
									const l = league?.zones[i];
									const q = pos?.zones[i];
									return (
										<tr key={z.key}>
											<td className="text-nowrap">{z.name}</td>
											<td className="text-end">{row.fga}</td>
											<td className="text-end">{pct(row.freq)}</td>
											<td className="text-end text-body-secondary">
												{pct(q?.freq)}
											</td>
											<td className="text-end text-body-secondary">
												{pct(l?.freq)}
											</td>
											<td className="text-end">{pct(row.fgp)}</td>
											<td className="text-end text-body-secondary">
												{pct(q?.fgp)}
											</td>
											<td className="text-end text-body-secondary">
												{pct(l?.fgp)}
											</td>
										</tr>
									);
								})}
							</tbody>
						</table>
					</div>
				</div>
			</div>
		</HideableSection>
	);
};
