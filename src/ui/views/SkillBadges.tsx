import useTitleBar from "../hooks/useTitleBar.tsx";
import { helpers } from "../util/helpers.ts";
import { DataTable } from "../components/DataTable/index.tsx";
import { frivolitiesMenu } from "./Frivolities.tsx";
import type { View } from "../../common/types.ts";

type Props = View<"skillBadges">;
type Badge = Props["badges"][number];
type Combo = Props["combos"][number];

const PlayerCell = ({ p }: { p: { pid: number; name: string } }) => (
	<a href={helpers.leagueUrl(["player", p.pid])}>{p.name}</a>
);

const Leaders = ({ b }: { b: Badge | Combo }) => (
	<span className="small">
		{b.leaders.map((p, i) => (
			<span key={p.pid}>
				{i > 0 ? ", " : ""}
				<PlayerCell p={p} />{" "}
				<span className="text-body-secondary">
					{"tier" in p ? `${p.tier}, +${p.score}` : p.score}
				</span>
			</span>
		))}
	</span>
);

const SkillBadges = ({ badges, combos, label, numPlayers, userTid }: Props) => {
	useTitleBar({
		title: "Skill Badges",
		customMenu: frivolitiesMenu,
	});
	const selected = badges.find((b) => b.label === label);
	const selectedCombo = combos.find((b) => b.label === label);

	const groups = [...new Set(badges.map((b) => b.groupName))];

	return (
		<>
			<p>
				Extended badges are computed from each player's current ratings and are
				display-only: they never change game results and are not the built-in
				skills (3, A, B, Di, Dp, Po, Ps, R, V). They are shown right after the
				built-in skills, in the same style; hover one to see its name. Scores
				are on a 0-100 scale; a badge is awarded when the score passes its
				threshold. Warning flags have lower-case labels. Counts are among{" "}
				{numPlayers} players on teams or in free agency.
			</p>
			<p>
				<b>Combos:</b> when a player has every skill or badge of a combo, they
				are replaced by the single combo badge (for example Dp + Di shows as
				Sw). A combo's tier comes from how far past its cutoff the weakest part
				is: Bronze (shown as e.g. <span className="skill ms-0">Sw</span>
				), Silver (<span className="skill ms-0">Sw+</span>, 4+ points past) or
				Gold (<span className="skill ms-0">Sw++</span>, 8+ points). Only the
				display changes: the built-in skills used by the game simulation stay
				the same. Badge counts below are before combining.
			</p>
			{selected ? (
				<div className="mb-4">
					<h2>
						<span className="skill ms-0">{selected.label}</span> {selected.name}
					</h2>
					<p>
						{selected.meaning} Threshold: score{" "}
						{selected.thresholds.join(" and ")}. {selected.count} players have
						it.{" "}
						<a href={helpers.leagueUrl(["frivolities", "skill_badges"])}>
							Back to all badges
						</a>
					</p>
					<DataTable
						cols={[
							{ title: "#", sortSequence: [] },
							{ title: "Name" },
							{ title: "Pos" },
							{ title: "Team" },
							{ title: "Age", sortType: "number" },
							{ title: "Ovr", sortType: "number" },
							{
								title: "Score",
								sortType: "number",
								desc: "Badge score, 0-100",
							},
						]}
						defaultSort={[6, "desc"]}
						name="SkillBadges:list"
						pagination
						rows={selected.list.map((p, i) => ({
							key: p.pid,
							data: [
								i + 1,
								<PlayerCell key="n" p={p} />,
								p.pos,
								p.abbrev,
								p.age,
								p.ovr,
								p.score,
							],
							classNames: { "table-info": p.tid === userTid },
						}))}
					/>
				</div>
			) : null}

			{selectedCombo ? (
				<div className="mb-4">
					<h2>
						<span className="skill ms-0">{selectedCombo.label}</span>{" "}
						{selectedCombo.name}
					</h2>
					<p>
						{selectedCombo.meaning} Needs {selectedCombo.components}.{" "}
						{selectedCombo.count} players show it.{" "}
						<a href={helpers.leagueUrl(["frivolities", "skill_badges"])}>
							Back to all badges
						</a>
					</p>
					<DataTable
						cols={[
							{ title: "#", sortSequence: [] },
							{ title: "Name" },
							{ title: "Pos" },
							{ title: "Team" },
							{ title: "Age", sortType: "number" },
							{ title: "Ovr", sortType: "number" },
							{ title: "Tier" },
							{
								title: "Margin",
								sortType: "number",
								desc: "Points past the cutoff of the weakest part",
							},
						]}
						defaultSort={[7, "desc"]}
						name="SkillBadges:comboList"
						pagination
						rows={selectedCombo.list.map((p, i) => ({
							key: p.pid,
							data: [
								i + 1,
								<PlayerCell key="n" p={p} />,
								p.pos,
								p.abbrev,
								p.age,
								p.ovr,
								p.tier,
								p.score,
							],
							classNames: { "table-info": p.tid === userTid },
						}))}
					/>
				</div>
			) : null}

			{combos.length > 0 ? (
				<div className="mb-4">
					<h3>Combos</h3>
					<DataTable
						cols={[
							{ title: "Badge" },
							{ title: "Name" },
							{ title: "Replaces" },
							{ title: "Meaning", sortType: "string" },
							{ title: "Players", sortType: "number" },
							{
								title: "B/S/G",
								desc: "Players at Bronze / Silver / Gold tier",
							},
							{ title: "Top 5 (tier, margin)", noSearch: true },
						]}
						defaultSort={[4, "desc"]}
						name="SkillBadges:combos"
						rows={combos.map((b) => ({
							key: b.label,
							data: [
								{
									value: (
										<a
											href={helpers.leagueUrl([
												"frivolities",
												"skill_badges",
												b.label,
											])}
											className="skill ms-0"
										>
											{b.label}
										</a>
									),
									searchValue: b.label,
									sortValue: b.label,
								},
								b.name,
								b.components,
								b.meaning,
								b.count,
								b.tierCounts.join(" / "),
								{
									value: <Leaders b={b} />,
									searchValue: b.leaders.map((p) => p.name).join(" "),
									sortValue: b.leaders[0]?.name ?? "",
								},
							],
						}))}
					/>
				</div>
			) : null}

			{groups.map((groupName) => (
				<div key={groupName} className="mb-4">
					<h3>{groupName}</h3>
					<DataTable
						cols={[
							{ title: "Badge" },
							{ title: "Name" },
							{ title: "Meaning", sortType: "string" },
							{
								title: "Threshold",
								desc: "Score needed on the 0-100 badge composite",
							},
							{ title: "Players", sortType: "number" },
							{ title: "Top 5 (score)", noSearch: true },
						]}
						defaultSort={[4, "desc"]}
						name={`SkillBadges:${groupName}`}
						rows={badges
							.filter((b) => b.groupName === groupName)
							.map((b) => ({
								key: b.label,
								data: [
									{
										value: (
											<a
												href={helpers.leagueUrl([
													"frivolities",
													"skill_badges",
													b.label,
												])}
												className="skill ms-0"
											>
												{b.label}
											</a>
										),
										searchValue: b.label,
										sortValue: b.label,
									},
									b.name,
									b.meaning,
									b.thresholds.join(" and "),
									b.count,
									{
										value: <Leaders b={b} />,
										searchValue: b.leaders.map((p) => p.name).join(" "),
										sortValue: b.leaders[0]?.name ?? "",
									},
								],
							}))}
					/>
				</div>
			))}
		</>
	);
};

export default SkillBadges;
