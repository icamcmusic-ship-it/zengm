import type { ReactNode } from "react";
import { OverlayTrigger, Tooltip } from "react-bootstrap";
import type { DevParts } from "../../../common/types.basketball.ts";

// Development breakdown (basketball, worker/core/player/devParts.ts): the parts of a season's ovr change, on hover over his ovr in the
// ratings table. Rows from before it (no devParts) show nothing
const LABELS: [keyof DevParts, string][] = [
	["base", "Age and development"],
	["coach", "Coaching"],
	["mentor", "Mentor (veteran savvy)"],
	["traits", "Work ethic and aging curve"],
	["minutes", "Playing time"],
	["aging", "Career aging"],
	["injury", "Injuries"],
];

const fmt = (x: number) => (x > 0 ? `+${x.toFixed(1)}` : x.toFixed(1));

export const devPartsTotal = (devParts: DevParts) =>
	LABELS.reduce((sum, [key]) => sum + (devParts[key] ?? 0), 0);

export const DevPartsOvr = ({
	children,
	devParts,
}: {
	children: ReactNode;
	devParts: DevParts | undefined;
}) => {
	if (!devParts) {
		return children;
	}
	return (
		<OverlayTrigger
			overlay={
				<Tooltip>
					<div className="fw-bold">
						Ovr change {fmt(devPartsTotal(devParts))}
					</div>
					<table className="text-start">
						<tbody>
							{LABELS.map(([key, label]) => {
								const x = devParts[key];
								if (x === undefined || (key !== "base" && x === 0)) {
									return null;
								}
								return (
									<tr key={key}>
										<td className="pe-2">{label}</td>
										<td className="text-end">{fmt(x)}</td>
									</tr>
								);
							})}
						</tbody>
					</table>
				</Tooltip>
			}
			placement="bottom"
		>
			<span style={{ borderBottom: "1px dotted" }}>{children}</span>
		</OverlayTrigger>
	);
};
