// AI GM personalities: a GM's leanings as centered bars, and the GM card on the team page
import { useState } from "react";
import {
	GM_TRAIT_INFO,
	GM_TRAIT_KEYS,
	gmTraitLabel,
} from "../../common/gmPersonality.ts";
import type { GmTraits } from "../../common/types.ts";
import type { FaceConfig } from "facesjs";
import { helpers } from "../util/helpers.ts";
import { MyFace } from "./MyFace.tsx";

export const GmTraitBars = ({ traits }: { traits: GmTraits }) => {
	return (
		<table className="table table-sm table-borderless mb-0 small gm-traits">
			<tbody>
				{GM_TRAIT_KEYS.map((key) => {
					const x = traits[key];
					const info = GM_TRAIT_INFO[key];
					const width = Math.abs(x) * 50;
					return (
						<tr key={key} title={info.description}>
							<td className="text-body-secondary pe-2 py-0">{info.name}</td>
							<td className="py-0" style={{ width: 90, minWidth: 40 }}>
								<div
									className="position-relative bg-body-secondary rounded"
									style={{ height: 8, marginTop: 6 }}
									aria-label={`${info.low} to ${info.high}: ${gmTraitLabel(key, x)}`}
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
							<td className="ps-2 py-0">{gmTraitLabel(key, x)}</td>
						</tr>
					);
				})}
			</tbody>
		</table>
	);
};

export type GmCardInfo = {
	gmid: number;
	name: string;
	age: number;
	face?: FaceConfig;
	traits: GmTraits;
	styleLabels: string[];
	since?: number;
	tenureSeasons: number;
	won: number;
	lost: number;
	aboveExp: number;
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
	jersey,
}: {
	colors?: [string, string, string];
	gm: GmCardInfo;
	jersey?: string;
}) => {
	const [showTraits, setShowTraits] = useState(false);
	return (
		<div data-testid="gm-card">
			<div className="d-flex gap-2 align-items-start">
				{gm.face ? (
					<div style={{ width: 50, height: 75, flexShrink: 0 }}>
						<MyFace face={gm.face} colors={colors} jersey={jersey} />
					</div>
				) : null}
				<div>
					<div>
						General manager:{" "}
						<a href={helpers.leagueUrl(["front_offices"])}>{gm.name}</a>{" "}
						<span className="text-body-secondary">(age {gm.age})</span>
					</div>
					<div>
						{gm.styleLabels.length > 0
							? gm.styleLabels.join(" · ")
							: "Balanced"}
					</div>
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
			{showTraits ? <GmTraitBars traits={gm.traits} /> : null}
		</div>
	);
};
