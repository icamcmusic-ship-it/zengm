import useTitleBar from "../../hooks/useTitleBar.tsx";
import { helpers } from "../../util/helpers.ts";
import { useLocal } from "../../util/local.ts";
import {
	DataTable,
	type DataTableRow,
} from "../../components/DataTable/index.tsx";
import { getCols } from "../../../common/getCols.ts";
import type { View } from "../../../common/types.ts";
import type { Family } from "../../../common/leagueHistory/families.ts";
import { frivolitiesMenu } from "../Frivolities.tsx";
import { HistoryLoading, PlayerLink } from "./common.tsx";

type Loaded = Extract<View<"familyTrees">, { loading: false }>;

const RECORD_LABELS: Record<Loaded["records"][number]["key"], string> = {
	ws: "Most win shares",
	pts: "Most points",
	gp: "Most games",
	titles: "Most titles",
	allStar: "Most All-Star selections",
	mvp: "Most MVPs",
	hof: "Most Hall of Famers",
	players: "Most players",
	gens: "Most generations",
};

const fmtRecord = (key: string, value: number) =>
	key === "ws" ? value.toFixed(1) : helpers.numberWithCommas(value);

const years = (m: {
	first: number | null;
	last: number | null;
	active: boolean;
}) =>
	m.first === null
		? "never played"
		: m.first === m.last && !m.active
			? `${m.first}`
			: `${m.first}-${m.active ? "" : m.last}`;

const Tree = ({ family, season }: { family: Family; season: number }) => {
	const { gender } = useLocal(["gender"]);
	const played = family.members.filter((m) => m.first !== null);
	const from = Math.min(...played.map((m) => m.first!));
	const to = Math.max(season, ...played.map((m) => m.last!));
	const width = Math.max(1, to - from + 1);
	const genLabel = (i: number, n: number) => {
		if (n === 1) {
			return helpers.getRelativeType(gender, "brother") + "s";
		}
		return `Generation ${i + 1}`;
	};

	return (
		<div className="mb-4">
			<h2>The {family.name} family</h2>
			<p className="text-body-secondary">
				{family.totals.players} players across {family.totals.gens} generation
				{family.totals.gens === 1 ? "" : "s"}: {family.totals.ws.toFixed(1)} WS,{" "}
				{helpers.numberWithCommas(family.totals.pts)} points,{" "}
				{family.totals.allStar} All-Star selection
				{family.totals.allStar === 1 ? "" : "s"}, {family.totals.titles} title
				{family.totals.titles === 1 ? "" : "s"}.
			</p>
			{family.gens.map((gen, i) => (
				<div key={i} className="mb-2">
					<div className="small text-body-secondary mb-1">
						{genLabel(i, family.gens.length)}
					</div>
					<div className="d-flex flex-wrap gap-2">
						{gen.map((m) => (
							<div
								key={m.pid}
								className="border rounded p-2"
								style={{ minWidth: 160, maxWidth: 260 }}
							>
								<div className="fw-bold">
									<PlayerLink pid={m.pid} name={m.name} />
									{m.hof ? (
										<span className="badge bg-danger ms-1">HOF</span>
									) : null}
								</div>
								<div className="small text-body-secondary">{years(m)}</div>
								{m.played ? (
									<div className="small">
										{m.gp} G, {helpers.numberWithCommas(m.pts)} pts,{" "}
										{m.ws.toFixed(1)} WS
										{m.allStar > 0 ? `, ${m.allStar}x All-Star` : ""}
										{m.mvp > 0 ? `, ${m.mvp}x MVP` : ""}
										{m.titles.length > 0
											? `, ${m.titles.length} title${m.titles.length === 1 ? "" : "s"}`
											: ""}
									</div>
								) : null}
							</div>
						))}
					</div>
				</div>
			))}

			{played.length > 0 ? (
				<>
					<h3 className="mt-3">Careers side by side</h3>
					<div className="small" style={{ maxWidth: 760 }}>
						{family.members.map((m) => (
							<div key={m.pid} className="d-flex align-items-center mb-1">
								<div
									className="text-truncate"
									style={{ width: 130, flexShrink: 0 }}
								>
									{m.name}
								</div>
								<div
									className="flex-grow-1 position-relative bg-body-secondary rounded"
									style={{ height: 14 }}
								>
									{m.first !== null ? (
										<div
											className={`position-absolute rounded ${m.active ? "bg-success" : "bg-primary"}`}
											title={years(m)}
											style={{
												left: `${(100 * (m.first - from)) / width}%`,
												width: `${(100 * ((m.active ? season : m.last!) - m.first + 1)) / width}%`,
												top: 0,
												bottom: 0,
											}}
										/>
									) : null}
								</div>
							</div>
						))}
						<div className="d-flex text-body-secondary">
							<div style={{ width: 130, flexShrink: 0 }} />
							<div className="flex-grow-1 d-flex justify-content-between">
								<span>{from}</span>
								<span>{to}</span>
							</div>
						</div>
					</div>
				</>
			) : null}
		</div>
	);
};

const pairCols = (a: string, b: string) =>
	getCols([
		{ title: a, sortType: "name" },
		{ title: b, sortType: "name" },
		{ title: "Overlap", desc: "Seasons both played", sortType: "number" },
		{
			title: "Teammates",
			desc: "Seasons on the same team",
			sortType: "number",
		},
		{
			title: "Opponents",
			desc: "Seasons on different teams",
			sortType: "number",
		},
	]);

const seasonList = (xs: number[]) => {
	if (xs.length === 0) {
		return "–";
	}
	return xs.length > 4 ? `${xs.length} (${xs[0]}-${xs.at(-1)})` : xs.join(", ");
};

const pairRows = (xs: Loaded["fatherSon"]): DataTableRow[] =>
	xs.map((x) => ({
		key: `${x.a}-${x.b}`,
		data: [
			{
				value: <PlayerLink pid={x.a} name={x.aName} />,
				sortValue: x.aName,
				searchValue: x.aName,
			},
			{
				value: <PlayerLink pid={x.b} name={x.bName} />,
				sortValue: x.bName,
				searchValue: x.bName,
			},
			x.overlap.length,
			{ value: seasonList(x.together), sortValue: x.together.length },
			{ value: seasonList(x.against), sortValue: x.against.length },
		],
	}));

const FamilyTreesLoaded = ({
	brothers,
	families,
	fatherSon,
	numFamilies,
	records,
	related,
	requestedPid,
	season,
	selected,
}: Loaded) => {
	const { gender } = useLocal(["gender"]);
	useTitleBar({
		title: selected ? `${selected.name} Family Tree` : "Family Trees",
		customMenu: frivolitiesMenu,
	});

	if (numFamilies === 0) {
		return (
			<p>
				No players in this league are related to each other yet. Relatives show
				up in draft classes over time.
			</p>
		);
	}

	const familyCols = getCols([
		{ title: "Family", sortType: "string" },
		{ title: "Players", sortType: "number" },
		{ title: "Gens", desc: "Generations", sortType: "number" },
		{ title: "Years", sortType: "number" },
		{ title: "WS", desc: "Combined career win shares", sortType: "number" },
		{ title: "Pts", desc: "Combined career points", sortType: "number" },
		{ title: "AS", desc: "All-Star selections", sortType: "number" },
		{ title: "Titles", desc: "Member titles added up", sortType: "number" },
		{ title: "Members", sortType: "string" },
	]);
	const familyRows: DataTableRow[] = families.map((f) => ({
		key: f.id,
		data: [
			{
				value: (
					<a href={helpers.leagueUrl(["frivolities", "family_trees", f.id])}>
						{f.name}
					</a>
				),
				sortValue: f.name,
			},
			f.totals.players,
			f.totals.gens,
			{
				value:
					f.totals.first === null
						? "–"
						: f.totals.first === f.totals.last
							? f.totals.first
							: `${f.totals.first}-${f.totals.last}`,
				sortValue: f.totals.first,
			},
			f.totals.ws.toFixed(1),
			f.totals.pts,
			f.totals.allStar,
			f.totals.titles,
			{
				value: f.members.map((m) => m.name).join(", "),
				searchValue: f.members.map((m) => m.name).join(", "),
			},
		],
		classNames: { "table-info": selected?.id === f.id },
	}));

	const father = helpers.getRelativeType(gender, "father");
	const son = helpers.getRelativeType(gender, "son");
	const brother = helpers.getRelativeType(gender, "brother");

	return (
		<>
			<p>
				{related} players with relatives in the league, in {numFamilies} famil
				{numFamilies === 1 ? "y" : "ies"}. Regular season stats.
			</p>

			{requestedPid !== undefined && selected === undefined ? (
				<p className="alert alert-info">
					That player has no relatives in the league.
				</p>
			) : null}

			{selected ? (
				<Tree key={selected.id} family={selected} season={season} />
			) : null}

			<h2>Family records</h2>
			<div className="row row-cols-2 row-cols-md-3 row-cols-lg-5 g-2 mb-4">
				{records
					.filter((r) => r.id !== undefined && r.value > 0)
					.map((r) => (
						<div key={r.key} className="col">
							<div className="border rounded p-2 h-100">
								<div className="small text-body-secondary">
									{RECORD_LABELS[r.key]}
								</div>
								<div className="fs-5 fw-bold">{fmtRecord(r.key, r.value)}</div>
								<a
									href={helpers.leagueUrl([
										"frivolities",
										"family_trees",
										r.id!,
									])}
								>
									{r.name}
								</a>
							</div>
						</div>
					))}
			</div>

			<h2>Families</h2>
			<DataTable
				cols={familyCols}
				defaultSort={[4, "desc"]}
				name="FamilyTrees"
				pagination={familyRows.length > 20}
				rows={familyRows}
				small
			/>

			<h2 className="mt-4">
				{father}-{son.toLowerCase()} pairs
			</h2>
			{fatherSon.length > 0 ? (
				<DataTable
					cols={pairCols(father, son)}
					defaultSort={[2, "desc"]}
					name="FamilyTreesFatherSon"
					pagination={fatherSon.length > 20}
					rows={pairRows(fatherSon)}
					small
				/>
			) : (
				<p>None yet.</p>
			)}

			<h2 className="mt-4">{brother}s</h2>
			{brothers.length > 0 ? (
				<DataTable
					cols={pairCols(
						`Older ${brother.toLowerCase()}`,
						`Younger ${brother.toLowerCase()}`,
					)}
					defaultSort={[2, "desc"]}
					name="FamilyTreesBrothers"
					pagination={brothers.length > 20}
					rows={pairRows(brothers)}
					small
				/>
			) : (
				<p>None yet.</p>
			)}
		</>
	);
};

const FamilyTreesLoading = ({ progress }: { progress: string }) => {
	useTitleBar({ title: "Family Trees", customMenu: frivolitiesMenu });
	return <HistoryLoading progress={progress} />;
};

const FamilyTrees = (props: View<"familyTrees">) => {
	if (props.loading) {
		return <FamilyTreesLoading progress={props.progress} />;
	}
	return <FamilyTreesLoaded {...props} />;
};

export default FamilyTrees;
