// AI GM personalities: a GM's leanings as centered bars, his track record, and the GM card on the team page
import { useState } from "react";
import {
	GM_TRAIT_INFO,
	GM_TRAIT_KEYS,
	gmBandLabel,
	type GmTraitBands,
} from "../../common/gmPersonality.ts";
import type { GmTraits } from "../../common/types.ts";
import type { FaceConfig } from "facesjs";
import { helpers } from "../util/helpers.ts";
import { StaffFace } from "./StaffFace.tsx";

// bands: each leaning's band (always sent); traits: the exact numbers, only sent in God Mode
export const GmTraitBars = ({
	bands,
	traits,
}: {
	bands: GmTraitBands;
	traits?: GmTraits;
}) => {
	return (
		<table className="table table-sm table-borderless mb-0 small gm-traits">
			<tbody>
				{GM_TRAIT_KEYS.map((key) => {
					const band = bands[key];
					const x = traits ? traits[key] : band / 2;
					const info = GM_TRAIT_INFO[key];
					const width = Math.abs(x) * 50;
					const label = gmBandLabel(key, band);
					return (
						<tr key={key} title={info.description}>
							<td className="text-body-secondary pe-2 py-0">{info.name}</td>
							<td className="py-0" style={{ width: 90, minWidth: 40 }}>
								<div
									className="position-relative bg-body-secondary rounded"
									style={{ height: 8, marginTop: 6 }}
									aria-label={`${info.low} to ${info.high}: ${label}`}
								>
									<div
										className="position-absolute bg-secondary"
										style={{ left: "50%", top: -2, width: 1, height: 12 }}
									/>
									<div
										className={`position-absolute rounded ${x < 0 ? "bg-warning" : "bg-primary"}`}
										style={{
											top: 0,
											height: 8,
											left: x < 0 ? `${50 - width}%` : "50%",
											width: `${width}%`,
										}}
									/>
								</div>
							</td>
							<td className="ps-2 py-0">
								{label}
								{traits ? (
									<span className="text-body-secondary">
										{" "}
										({x > 0 ? "+" : ""}
										{x.toFixed(2)})
									</span>
								) : null}
							</td>
						</tr>
					);
				})}
			</tbody>
		</table>
	);
};

export type GmBehaviorInfo = {
	seasons: number;
	trades: number;
	tradesPerSeason: number;
	payroll?: number;
	taxSeasons: number;
	taxSeasonsOf: number;
	picksOut: number;
	picksIn: number;
	avgAge?: number;
};

// What he actually does, next to his labels: trades a season, payroll, luxury tax seasons, picks moved, roster age
export const gmBehaviorParts = (b: GmBehaviorInfo) => {
	const parts: { label: string; value: string; title: string }[] = [];
	if (b.seasons === 0 && b.trades === 0) {
		return parts;
	}
	parts.push({
		label: "Trades",
		value: `${b.tradesPerSeason.toFixed(1)}/season`,
		title: `${b.trades} trades in ${b.seasons} season${b.seasons === 1 ? "" : "s"} running a team`,
	});
	if (b.payroll !== undefined) {
		parts.push({
			label: "Payroll",
			value: `${Math.round(b.payroll * 100)}% of cap`,
			title: "Average payroll as a share of the salary cap",
		});
	}
	if (b.taxSeasonsOf > 0) {
		parts.push({
			label: "Tax",
			value: `${b.taxSeasons} of ${b.taxSeasonsOf}`,
			title: "Seasons his team paid the luxury tax",
		});
	}
	parts.push({
		label: "Picks",
		value: `${b.picksOut} out, ${b.picksIn} in`,
		title: "Draft picks traded away and acquired",
	});
	if (b.avgAge !== undefined) {
		parts.push({
			label: "Roster age",
			value: b.avgAge.toFixed(1),
			title: "Average age of his rosters (weighted by minutes)",
		});
	}
	return parts;
};

export const GmBehaviorLine = ({ behavior }: { behavior: GmBehaviorInfo }) => {
	const parts = gmBehaviorParts(behavior);
	if (parts.length === 0) {
		return null;
	}
	return (
		<div className="text-body-secondary" data-testid="gm-behavior">
			Track record:{" "}
			{parts.map((part, i) => (
				<span key={part.label} title={part.title}>
					{i > 0 ? " · " : ""}
					{part.label} {part.value}
				</span>
			))}
		</div>
	);
};

export type GmCardInfo = {
	gmid: number;
	name: string;
	age: number;
	face?: FaceConfig;
	// Exact leanings, God Mode only
	traits?: GmTraits;
	traitBands: GmTraitBands;
	behavior: GmBehaviorInfo;
	styleLabels: string[];
	finance?: { name: string; description: string };
	since?: number;
	tenureSeasons: number;
	won: number;
	lost: number;
	// Both undefined under No Visible Ratings (expectations come from roster ratings)
	aboveExp?: number;
	playoffs: number;
	titles: number;
	expWon?: number;
	seasonWon?: number;
	seasonLost?: number;
	hotSeatLabel: string;
	previousTeams: string[];
};

export const hotSeatClass = (label: string) =>
	label === "Hot seat"
		? "text-danger"
		: label === "Warm"
			? "text-warning"
			: label === "Secure"
				? "text-success"
				: undefined;

export const GmCard = ({
	colors,
	gm,
}: {
	colors?: [string, string, string];
	gm: GmCardInfo;
}) => {
	const [showTraits, setShowTraits] = useState(false);
	return (
		<div data-testid="gm-card">
			<div className="d-flex gap-2 align-items-start">
				{gm.face ? (
					<div style={{ width: 50, height: 75, flexShrink: 0 }}>
						<StaffFace
							face={gm.face}
							colors={colors}
							age={gm.age}
							seed={gm.gmid}
						/>
					</div>
				) : null}
				<div>
					<div>
						General manager:{" "}
						<a href={helpers.leagueUrl(["gm", gm.gmid])}>{gm.name}</a>{" "}
						<span className="text-body-secondary">(age {gm.age})</span>
					</div>
					<div>
						{gm.styleLabels.length > 0
							? gm.styleLabels.join(" · ")
							: "Balanced"}
					</div>
					{gm.finance ? (
						<div title={gm.finance.description}>
							Finances: {gm.finance.name}
						</div>
					) : null}
					<div>
						{gm.since !== undefined ? `Since ${gm.since}` : null}
						{gm.tenureSeasons > 0 ? (
							<>
								, {gm.won}-{gm.lost}
								{gm.titles > 0
									? `, ${gm.titles} title${gm.titles > 1 ? "s" : ""}`
									: ""}
							</>
						) : null}
						{" · "}
						<span className={hotSeatClass(gm.hotSeatLabel)}>
							{gm.hotSeatLabel}
						</span>
					</div>
					<GmBehaviorLine behavior={gm.behavior} />
					{gm.expWon !== undefined ? (
						<div className="text-body-secondary">
							Preseason expectation: {Math.round(gm.expWon)} wins
						</div>
					) : null}
					<button
						type="button"
						className="btn btn-link p-0 border-0 align-baseline"
						onClick={() => setShowTraits(!showTraits)}
					>
						{showTraits ? "Hide leanings" : "Show leanings"}
					</button>
				</div>
			</div>
			{showTraits ? (
				<GmTraitBars bands={gm.traitBands} traits={gm.traits} />
			) : null}
		</div>
	);
};
