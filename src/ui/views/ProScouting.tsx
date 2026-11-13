import useTitleBar from "../hooks/useTitleBar.tsx";
import type { View } from "../../common/types.ts";
import { MoreLinks } from "../components/MoreLinks.tsx";
import { helpers } from "../util/helpers.ts";
import { useLocal } from "../util/local.ts";

const money = (x: number) => `$${(x / 1000).toFixed(1)}M`;

type Target = View<"proScouting">["targets"][number];

const TargetLine = ({ t }: { t: Target }) => (
	<li className="mb-1">
		<a href={helpers.leagueUrl(["player", t.pid])}>{t.name}</a> ({t.abbrev},{" "}
		{t.pos}, {t.age}): {t.valueText.toLowerCase()} at {money(t.contract.amount)}
		{t.fit ? `, ${t.fit.toLowerCase()}` : ""}
		{t.shapeText ? (
			<div className="small text-body-secondary">{t.shapeText}</div>
		) : null}
	</li>
);

// Pro Scouting (Scouting Director & Regions): league-wide targets for your needs
const ProScouting = ({
	noRatings,
	listsOn,
	weakest,
	needs,
	filedBy,
	targets,
	trade,
	fa,
	systems,
}: View<"proScouting">) => {
	useTitleBar({ title: "Pro Scouting" });
	const { draftType } = useLocal(["draftType"]);
	return (
		<>
			<MoreLinks type="draft" page="pro_scouting" draftType={draftType} />
			<p>
				Your pro scouts' targets around the league, for your weakest area (
				<b>{weakest.name}</b>), your positional needs (
				{needs.length > 0 ? needs.join(", ") : "none"})
				{systems ? ", your head coach's systems" : ""} and value for the
				contract.{filedBy ? ` Filed by ${filedBy}.` : ""}
				{noRatings ? " No visible ratings: production only." : ""}{" "}
				<a href={helpers.leagueUrl(["staff_report"])}>Staff Report</a>
			</p>
			<div className="row g-3 mb-3">
				<div className="col-12 col-md-6" data-testid="pro-trade">
					<h3 className="h5">Trade targets</h3>
					<ol className="ps-3">
						{trade.map((t) => (
							<TargetLine key={t.pid} t={t} />
						))}
					</ol>
				</div>
				<div className="col-12 col-md-6" data-testid="pro-fa">
					<h3 className="h5">Free agents</h3>
					{fa.length === 0 ? (
						<p className="text-body-secondary">No free agent stands out.</p>
					) : (
						<ol className="ps-3">
							{fa.map((t) => (
								<TargetLine key={t.pid} t={t} />
							))}
						</ol>
					)}
				</div>
			</div>
			<div className="table-responsive">
				<table
					className="table table-striped table-sm table-hover"
					data-testid="pro-targets"
				>
					<thead>
						<tr>
							<th>#</th>
							<th>Name</th>
							<th>Team</th>
							<th>Pos</th>
							<th>Age</th>
							{noRatings ? null : <th>Ovr</th>}
							<th>Contract</th>
							<th>Value</th>
							{systems ? <th>System fit</th> : null}
							<th>Notes</th>
						</tr>
					</thead>
					<tbody>
						{targets.map((t, i) => (
							<tr key={t.pid}>
								<td>{i + 1}</td>
								<td>
									<a href={helpers.leagueUrl(["player", t.pid])}>{t.name}</a>
								</td>
								<td>{t.abbrev}</td>
								<td>{t.pos}</td>
								<td>{t.age}</td>
								{noRatings ? null : <td>{t.ovr}</td>}
								<td className="text-nowrap">
									{money(t.contract.amount)} thru {t.contract.exp}
								</td>
								<td>{t.valueText}</td>
								{systems ? <td>{t.fit}</td> : null}
								<td className="small">
									{t.shapeText}
									{listsOn && t.blurb ? (
										<div className="text-body-secondary">{t.blurb}</div>
									) : null}
								</td>
							</tr>
						))}
					</tbody>
				</table>
			</div>
		</>
	);
};

export default ProScouting;
