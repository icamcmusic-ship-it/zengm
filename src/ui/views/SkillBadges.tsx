import useTitleBar from "../hooks/useTitleBar.tsx";
import { helpers } from "../util/helpers.ts";
import { DataTable } from "../components/DataTable/index.tsx";
import { frivolitiesMenu } from "./Frivolities.tsx";
import { setBadgeMode, useBadgeMode } from "../util/badgeSettings.ts";
import type { BadgeMode } from "../../common/skillBadges/index.ts";
import type { View } from "../../common/types.ts";

type Props = View<"skillBadges">;
type Badge = Props["badges"][number];

const chipClass = (b: { flag: boolean; group: string }) =>
	`skill skill-badge skill-badge-${b.flag ? "flag" : b.group}`;

const PlayerCell = ({ p }: { p: Badge["leaders"][number] }) => (
	<a href={helpers.leagueUrl(["player", p.pid])}>{p.name}</a>
);

const Leaders = ({ b }: { b: Badge }) => (
	<span className="small">
		{b.leaders.map((p, i) => (
			<span key={p.pid}>
				{i > 0 ? ", " : ""}
				<PlayerCell p={p} />{" "}
				<span className="text-body-secondary">{p.score}</span>
			</span>
		))}
	</span>
);

const modes: { value: BadgeMode; label: string }[] = [
	{ value: "off", label: "Off" },
	{ value: "compact", label: "Compact (up to 3, then +N)" },
	{ value: "full", label: "All badges" },
];

const SkillBadges = ({ badges, label, numPlayers, userTid }: Props) => {
	useTitleBar({
		title: "Skill Badges",
		customMenu: frivolitiesMenu,
	});
	const mode = useBadgeMode();
	const selected = badges.find((b) => b.label === label);

	const groups = [...new Set(badges.map((b) => b.groupName))];

	return (
		<>
			<p>
				Extended badges are computed from each player's current ratings and are
				display-only: they never change game results and are not the built-in
				skills (3, A, B, Di, Dp, Po, Ps, R, V). Scores are on a 0-100 scale; a
				badge is awarded when the score passes its threshold. Counts are among{" "}
				{numPlayers} players on teams or in free agency.
			</p>
			<div className="mb-3 d-flex align-items-center gap-2 flex-wrap">
				<label htmlFor="badge-mode" className="mb-0 fw-bold">
					Extended skill badges
				</label>
				<select
					id="badge-mode"
					className="form-select form-select-sm w-auto"
					value={mode}
					onChange={(e) => setBadgeMode(e.target.value as BadgeMode)}
				>
					{modes.map((m) => (
						<option key={m.value} value={m.value}>
							{m.label}
						</option>
					))}
				</select>
				<span className="text-body-secondary small">
					Saved in this browser. Shown in player tables, rosters, the draft,
					trade pages and the player page. Filter by badge in Advanced Player
					Search (Bio: Badges, "contains").
				</span>
			</div>

			{selected ? (
				<div className="mb-4">
					<h2>
						<span className={chipClass(selected)}>{selected.label}</span>{" "}
						{selected.name}
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
												className={chipClass(b)}
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
