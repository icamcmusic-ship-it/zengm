import { useEffect, useState } from "react";
import { GROUPS, GROUP_INFO } from "../../../common/archetypes/index.ts";
import type { ArchetypeRoster } from "../../../worker/api/archetypes.ts";
import { helpers } from "../../util/helpers.ts";
import { toWorker } from "../../util/toWorker.ts";
import { GroupDot } from "./ArchetypeLabel.tsx";

// A team's roster composition by archetype, with balance warnings. Loads on its own so the roster page stays untouched.
export const ArchetypeRosterPanel = ({
	tid,
	refreshKey,
}: {
	tid: number;
	// Changes whenever the roster does
	refreshKey: string;
}) => {
	const [data, setData] = useState<ArchetypeRoster | undefined>();
	const [open, setOpen] = useState(true);

	useEffect(() => {
		let cancelled = false;
		(async () => {
			const d = await toWorker("archetypes", "roster", { tid });
			if (!cancelled) {
				setData(d);
			}
		})();
		return () => {
			cancelled = true;
		};
	}, [tid, refreshKey]);

	if (!data || !data.enabled || data.players.length === 0) {
		return null;
	}
	const { composition: c, players } = data;

	return (
		<div className="card mt-3" data-testid="archetype-roster-panel">
			<div className="card-header d-flex align-items-center">
				<strong className="me-auto">Roster composition</strong>
				<button
					type="button"
					className="btn btn-light-bordered btn-xs"
					onClick={() => setOpen((v) => !v)}
				>
					{open ? "Hide" : "Show"}
				</button>
			</div>
			{open ? (
				<div className="card-body">
					<div className="d-flex flex-wrap gap-3 mb-2">
						{GROUPS.map((g) => (
							<span key={g}>
								<GroupDot group={g} />
								{GROUP_INFO[g].label}: <strong>{c.byGroup[g]}</strong>
							</span>
						))}
					</div>
					{c.warnings.length > 0 ? (
						<ul className="text-warning mb-2 ps-3">
							{c.warnings.map((w) => (
								<li key={w.kind}>{w.text}</li>
							))}
						</ul>
					) : (
						<p className="text-success mb-2">
							The rotation covers playmaking, spacing, defense and size.
						</p>
					)}
					<div className="table-responsive">
						<table className="table table-sm mb-0 w-auto">
							<tbody>
								{players.map((p) => (
									<tr key={p.pid}>
										<td>
											<a href={helpers.leagueUrl(["player", p.pid])}>
												{p.name}
											</a>
										</td>
										<td>{p.pos}</td>
										<td>{p.ovr}</td>
										<td>
											<GroupDot group={p.group} />
											{p.label}
											{p.live ? (
												<span
													className="text-body-secondary"
													title="Live reading, saved at the next preseason"
												>
													{" "}
													*
												</span>
											) : null}
										</td>
									</tr>
								))}
							</tbody>
						</table>
					</div>
				</div>
			) : null}
		</div>
	);
};
