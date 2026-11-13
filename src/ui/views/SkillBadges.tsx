import useTitleBar from "../hooks/useTitleBar.tsx";
import { helpers } from "../util/helpers.ts";
import { useLocal } from "../util/local.ts";
import { DataTable } from "../components/DataTable/index.tsx";
import { frivolitiesMenu } from "./Frivolities.tsx";
import type { View } from "../../common/types.ts";

type Props = View<"skillBadges">;
type Badge = Props["badges"][number];
type Combo = Props["combos"][number];

const PlayerCell = ({ p }: { p: { pid: number; name: string } }) => (
	<a href={helpers.leagueUrl(["player", p.pid])}>{p.name}</a>
);

// No visible ratings challenge: ovr and badge scores (made from ratings) are left out of the tables, the order stays
const NO_RATINGS_COLS = new Set(["Ovr", "Score", "Margin"]);
const withoutRatings = <T,>(
	hide: boolean,
	cols: { title: string }[],
	items: T[],
): T[] =>
	hide ? items.filter((_, i) => !NO_RATINGS_COLS.has(cols[i]!.title)) : items;

const Leaders = ({
	b,
	hideScores,
}: {
	b: Badge | Combo;
	hideScores: boolean;
}) => (
	<span className="small">
		{b.leaders.map((p, i) => (
			<span key={p.pid}>
				{i > 0 ? ", " : ""}
				<PlayerCell p={p} />
				{hideScores ? null : (
					<>
						{" "}
						<span className="text-body-secondary">
							{"parts" in p ? (
								<span title={`Replaces ${p.parts}`}>+{p.score}</span>
							) : (
								p.score
							)}
						</span>
					</>
				)}
			</span>
		))}
	</span>
);

const SkillBadges = ({ badges, combos, label, numPlayers, userTid }: Props) => {
	useTitleBar({
		title: "Skill Badges",
		customMenu: frivolitiesMenu,
	});
	const { challengeNoRatings } = useLocal(["challengeNoRatings"]);
	const selected = badges.find((b) => b.label === label);
	const listCols = [
		{ title: "#", sortSequence: [] as [] },
		{ title: "Name" },
		{ title: "Pos" },
		{ title: "Team" },
		{ title: "Age", sortType: "number" as const },
		{ title: "Ovr", sortType: "number" as const },
		{
			title: "Score",
			sortType: "number" as const,
			desc: "Badge score, 0-100",
		},
	];
	const comboCols = [
		{ title: "#", sortSequence: [] as [] },
		{ title: "Name" },
		{ title: "Pos" },
		{ title: "Team" },
		{ title: "Age", sortType: "number" as const },
		{ title: "Ovr", sortType: "number" as const },
		{ title: "Replaces" },
		{
			title: "Margin",
			sortType: "number" as const,
			desc: "Points past the cutoff of the weakest part",
		},
	];
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
				threshold. Counts are among {numPlayers} players on teams or in free
				agency.
			</p>
			<p>
				<b>Combos:</b> related skills and badges collapse into one named badge,
				so players show fewer badges without losing information. For example Dp
				+ Di shows as <span className="skill ms-0">Sw</span> (Switchable
				defender). Combos are applied in one pass, biggest first, and each skill
				or badge is used at most once. Only the display changes: the built-in
				skills used by the game simulation stay the same. Badge counts below are
				before combining; hover a leader's margin to see what the combo replaced
				for him.
			</p>
			{selected ? (
				<div className="mb-4">
					<h2>
						<span className="skill ms-0">{selected.label}</span> {selected.name}
					</h2>
					<p>
						{selected.meaning} Threshold: {selected.thresholds.join(" and ")}.{" "}
						{selected.count} players have it.{" "}
						<a href={helpers.leagueUrl(["frivolities", "skill_badges"])}>
							Back to all badges
						</a>
					</p>
					<DataTable
						cols={withoutRatings(challengeNoRatings, listCols, listCols)}
						defaultSort={challengeNoRatings ? "disableSort" : [6, "desc"]}
						name="SkillBadges:list"
						pagination
						rows={selected.list.map((p, i) => ({
							key: p.pid,
							data: withoutRatings(challengeNoRatings, listCols, [
								i + 1,
								<PlayerCell key="n" p={p} />,
								p.pos,
								p.abbrev,
								p.age,
								p.ovr,
								p.score,
							]),
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
					{/* text-break: the component lists are long runs like PS/Sp/Sn/... with no spaces, wider than a phone */}
					<p className="text-break">
						{selectedCombo.meaning} Needs {selectedCombo.components}.{" "}
						{selectedCombo.count} players show it.{" "}
						<a href={helpers.leagueUrl(["frivolities", "skill_badges"])}>
							Back to all badges
						</a>
					</p>
					<DataTable
						cols={withoutRatings(challengeNoRatings, comboCols, comboCols)}
						defaultSort={challengeNoRatings ? "disableSort" : [7, "desc"]}
						name="SkillBadges:comboList"
						pagination
						rows={selectedCombo.list.map((p, i) => ({
							key: p.pid,
							data: withoutRatings(challengeNoRatings, comboCols, [
								i + 1,
								<PlayerCell key="n" p={p} />,
								p.pos,
								p.abbrev,
								p.age,
								p.ovr,
								p.parts,
								p.score,
							]),
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
							{ title: "Top 5 (margin)", noSearch: true },
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
								b.level === 2 ? `${b.name} (level 2)` : b.name,
								b.components,
								b.meaning,
								b.count,
								{
									value: <Leaders b={b} hideScores={challengeNoRatings} />,
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
										value: <Leaders b={b} hideScores={challengeNoRatings} />,
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
