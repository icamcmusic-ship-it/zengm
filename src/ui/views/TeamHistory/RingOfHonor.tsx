// Ring of Honor: the franchise's retired jerseys and Hall of Famers (players, coaches and executives) together
import type { View } from "../../../common/types.ts";
import HideableSection from "../../components/HideableSection.tsx";
import { helpers } from "../../util/helpers.ts";

export const RingOfHonor = ({
	ringOfHonor,
}: {
	ringOfHonor: View<"teamHistory">["ringOfHonor"];
}) => {
	if (ringOfHonor.length === 0) {
		return null;
	}
	return (
		<HideableSection title="Ring of Honor" className="mb-3">
			<div className="d-flex flex-wrap gap-2" data-testid="ring-of-honor">
				{ringOfHonor.map((row) => {
					const url =
						row.kind === "player"
							? helpers.leagueUrl(["player", row.id])
							: row.kind === "coach"
								? helpers.leagueUrl(["coach", row.id])
								: helpers.leagueUrl(["front_offices"]);
					const seasons =
						row.firstSeason === undefined
							? ""
							: row.firstSeason === row.lastSeason
								? `${row.firstSeason}`
								: `${row.firstSeason}-${row.lastSeason}`;
					return (
						<div
							key={row.key}
							className="border rounded px-2 py-1 bg-body-tertiary"
							style={{ minWidth: 150 }}
						>
							<div>
								{row.jerseys.length > 0 ? (
									<span className="fw-bold me-1">
										#{row.jerseys.join(", #")}
									</span>
								) : null}
								<a href={url}>{row.name}</a>
							</div>
							<div className="small text-body-secondary">
								{row.pos}
								{seasons ? `, ${seasons}` : ""}
								{row.gp !== undefined ? `, ${row.gp} G` : ""}
							</div>
							<div className="small">
								{row.hof ? (
									<span className="badge bg-warning text-dark me-1">
										HoF{row.inducted !== undefined ? ` ${row.inducted}` : ""}
									</span>
								) : null}
								{row.jerseys.length > 0 ? (
									<span className="badge bg-secondary">Jersey retired</span>
								) : null}
							</div>
						</div>
					);
				})}
			</div>
		</HideableSection>
	);
};
