import useTitleBar from "../hooks/useTitleBar.tsx";
import { helpers } from "../util/helpers.ts";
import { useLocal } from "../util/local.ts";
import { DataTable } from "../components/DataTable/index.tsx";
import { frivolitiesMenu } from "./Frivolities.tsx";
import type { View } from "../../common/types.ts";

type Props = View<"skillBadges">;
type Tiered = NonNullable<Props["tiered"]>;

const TierPill = ({
	short,
	name,
	tier,
}: {
	short: string;
	name: string;
	tier: number;
}) => (
	<span className={`skill ms-0 badge2k badge2k-${tier}`} title={name}>
		{short}
	</span>
);

// 2K Badges (League Extra): the badges by category with their holders by tier, and one badge's full list
const TieredBadges = ({
	tiered,
	label,
	userTid,
	hideRatings,
}: {
	tiered: Tiered;
	label: string | undefined;
	userTid: number;
	hideRatings: boolean;
}) => {
	const selected = tiered.badges.find((b) => b.key === label);
	const categories = [...new Set(tiered.badges.map((b) => b.category))];
	const tierCols = tiered.tierNames.map((name) => ({
		title: name,
		sortType: "number" as const,
	}));
	return (
		<>
			<p>
				NBA 2K-style badges in five categories, each in five tiers:{" "}
				{tiered.tierNames.map((name, i) => (
					<span key={name} className="me-1">
						<span className={`skill ms-0 badge2k badge2k-${i + 1}`}>
							{name}
						</span>
					</span>
				))}
				. Tiers are league-relative: a badge's score (a weighted average of the
				ratings and sub-ratings that drive it) is compared with the league's
				rotation players
				{tiered.numRotation !== undefined
					? ` (${tiered.numRotation} this season)`
					: ""}
				, Bronze from the 85th percentile, Silver 93rd, Gold 97.5th, Hall of
				Fame 99.3rd and Legend 99.9th (at most one Legend per badge). Badge
				points (Bronze 1 to Legend 5) are capped by ovr, so role players carry
				fewer. Badges are set each preseason and drop at most one tier a season.
				In games they add small effects on top of the skills, calibrated so
				league averages stay the same.
			</p>
			{selected ? (
				<div className="mb-4">
					<h2>
						<TierPill short={selected.short} name={selected.name} tier={3} />{" "}
						{selected.name}
					</h2>
					<p>
						{selected.meaning} Driven by {selected.drivers}.
						{selected.gates ? ` Needs ${selected.gates}.` : ""}{" "}
						<a href={helpers.leagueUrl(["frivolities", "skill_badges"])}>
							Back to all badges
						</a>
					</p>
					<DataTable
						cols={[
							{ title: "Tier" },
							{ title: "Name" },
							{ title: "Pos" },
							{ title: "Team" },
							{ title: "Age", sortType: "number" },
							...(hideRatings
								? []
								: [{ title: "Ovr", sortType: "number" as const }]),
						]}
						defaultSort="disableSort"
						name="SkillBadges:tieredList"
						pagination
						rows={selected.list.map((p) => ({
							key: p.pid,
							data: [
								{
									value: (
										<TierPill
											short={tiered.tierNames[p.tier - 1]!}
											name={tiered.tierNames[p.tier - 1]!}
											tier={p.tier}
										/>
									),
									sortValue: p.tier,
									searchValue: tiered.tierNames[p.tier - 1],
								},
								<PlayerCell key="n" p={p} />,
								p.pos,
								p.abbrev,
								p.age,
								...(hideRatings ? [] : [p.ovr]),
							],
							classNames: { "table-info": p.tid === userTid },
						}))}
					/>
				</div>
			) : null}
			{categories.map((category) => (
				<div key={category} className="mb-4">
					<h3>{category}</h3>
					<DataTable
						cols={[
							{ title: "Badge" },
							{ title: "Name" },
							{ title: "Meaning", sortType: "string" },
							{ title: "Driven by" },
							...tierCols,
							...(hideRatings
								? []
								: [
										{
											title: "Cutoffs",
											desc: "Score where Bronze, Silver, Gold, Hall of Fame and Legend start this season",
										},
									]),
							{ title: "Best (Gold+)", noSearch: true },
						]}
						defaultSort={[1, "asc"]}
						name={`SkillBadges:tiered:${category}`}
						rows={tiered.badges
							.filter((b) => b.category === category)
							.map((b) => ({
								key: b.key,
								data: [
									{
										value: (
											<a
												href={helpers.leagueUrl([
													"frivolities",
													"skill_badges",
													b.key,
												])}
											>
												<TierPill short={b.short} name={b.name} tier={3} />
											</a>
										),
										sortValue: b.short,
										searchValue: b.short,
									},
									b.name,
									b.meaning,
									b.gates ? `${b.drivers} (needs ${b.gates})` : b.drivers,
									...b.counts,
									...(hideRatings ? [] : [b.cutoffs?.join(" / ") ?? ""]),
									{
										value: (
											<span className="small">
												{b.top.map((p, i) => (
													<span key={p.pid}>
														{i > 0 ? ", " : ""}
														<PlayerCell p={p} /> ({tiered.tierNames[p.tier - 1]}
														)
													</span>
												))}
											</span>
										),
										searchValue: b.top.map((p) => p.name).join(" "),
										sortValue: b.top[0]?.name ?? "",
									},
								],
							}))}
					/>
				</div>
			))}
		</>
	);
};
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

const SkillBadges = ({
	badges,
	combos,
	label,
	numPlayers,
	tiered,
	userTid,
}: Props) => {
	useTitleBar({
		title: tiered ? "Badges" : "Skill Badges",
		customMenu: frivolitiesMenu,
	});
	const { challengeNoRatings } = useLocal(["challengeNoRatings"]);
	if (tiered) {
		return (
			<TieredBadges
				tiered={tiered}
				label={label}
				userTid={userTid}
				hideRatings={!!challengeNoRatings}
			/>
		);
	}
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
							{
								title: challengeNoRatings
									? "Players (by team)"
									: "Top 5 (margin)",
								noSearch: true,
							},
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
							{
								title: challengeNoRatings
									? "Players (by team)"
									: "Top 5 (score)",
								noSearch: true,
							},
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
