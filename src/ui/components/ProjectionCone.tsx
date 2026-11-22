import type { Cone } from "../../common/scoutingReports/cone.ts";

const capFirst = (s: string) => s.replace(/^./, (c) => c.toUpperCase());

// Scale of the bar, visible ovr
const LO = 30;
const HI = 80;
const pos = (x: number) =>
	`${(100 * (Math.max(LO, Math.min(HI, x)) - LO)) / (HI - LO)}%`;

/**
 * A prospect's projection cone: projected peak floor / median / ceiling. With ratings visible, a bar on the ovr scale; under the no
 * visible ratings challenge, the three roles only.
 */
export const ProjectionCone = ({ cone }: { cone: Cone }) => {
	const n = cone.numbers;
	return (
		<div className="mb-2" data-testid="projection-cone">
			<div className="small">
				<b>Projected peak</b>{" "}
				<span className="badge text-bg-secondary">{cone.width} cone</span>
				{cone.trend ? (
					<span
						className={`ms-1 fw-bold ${cone.trend === "up" ? "text-success" : "text-danger"}`}
						title={
							cone.trend === "up"
								? "Trending up: the cone leans higher"
								: "Trending down: the cone leans lower"
						}
					>
						{cone.trend === "up" ? "▲ trending up" : "▼ trending down"}
					</span>
				) : null}
			</div>
			{n ? (
				<div
					className="position-relative my-1"
					style={{ height: 14, maxWidth: 360 }}
					title={`Floor ${n.floor}, median ${n.median}, ceiling ${n.ceiling} (projected peak ovr)`}
				>
					<div
						className="position-absolute bg-body-secondary rounded"
						style={{ left: 0, right: 0, top: 5, height: 4 }}
					/>
					<div
						className="position-absolute bg-primary rounded opacity-50"
						style={{
							left: pos(n.floor),
							width: `calc(${pos(n.ceiling)} - ${pos(n.floor)})`,
							top: 2,
							height: 10,
						}}
					/>
					<div
						className="position-absolute bg-primary"
						style={{ left: pos(n.median), width: 3, top: 0, height: 14 }}
					/>
				</div>
			) : null}
			<div className="small">
				Floor: {capFirst(cone.floorRole)}
				{n ? ` (${n.floor})` : ""} · Median: {capFirst(cone.medianRole)}
				{n ? ` (${n.median})` : ""} · Ceiling: {capFirst(cone.ceilingRole)}
				{n ? ` (${n.ceiling})` : ""}
			</div>
			{cone.notes.length > 0 ? (
				<div className="small text-body-secondary">
					{cone.notes.join(" · ")}
				</div>
			) : null}
		</div>
	);
};
