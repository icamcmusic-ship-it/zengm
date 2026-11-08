import {
	useCallback,
	useEffect,
	useRef,
	useState,
	type ReactNode,
} from "react";
import type {
	Article,
	Block,
	Paper,
	Section,
	Seg,
	Sidebar,
} from "../../../common/newspaper/types.ts";
import type { View } from "../../../common/types.ts";
import { PlayerPicture } from "../../components/PlayerPicture.tsx";
import { TeamLogoInline } from "../../components/TeamLogoInline.tsx";
import useTitleBar from "../../hooks/useTitleBar.tsx";
import { helpers } from "../../util/helpers.ts";

type Abbrevs = Map<number, string>;
type Logos = Record<number, { imgURL?: string; imgURLSmall?: string }>;
type Photo = {
	face?: any;
	imgURL?: string;
	colors: [string, string, string];
	jersey?: string;
};

// Everything the pieces of the paper need to draw links, logos and faces
type Env = {
	abbrevs: Abbrevs;
	logos: Logos;
	photos: Record<number, Photo>;
	printing: boolean;
};

const teamParam = (env: Env, team: number | "all") =>
	team === "all" ? "all" : `${env.abbrevs.get(team) ?? ""}_${team}`;

const SegView = ({ seg, env }: { seg: Seg; env: Env }) => {
	if (typeof seg === "string") {
		return seg;
	}
	if ("pid" in seg) {
		return <a href={helpers.leagueUrl(["player", seg.pid])}>{seg.t}</a>;
	}
	if ("paper" in seg) {
		return (
			<a
				href={helpers.leagueUrl([
					"newspaper",
					teamParam(env, seg.paper.team),
					seg.paper.season,
				])}
			>
				{seg.t}
			</a>
		);
	}
	const abbrev = env.abbrevs.get(seg.tid) ?? "";
	if ("gid" in seg) {
		return (
			<a
				href={helpers.leagueUrl([
					"game_log",
					`${abbrev}_${seg.tid}`,
					seg.season,
					seg.gid,
				])}
			>
				{seg.t}
			</a>
		);
	}
	return (
		<a href={helpers.leagueUrl(["roster", `${abbrev}_${seg.tid}`, seg.season])}>
			{seg.t}
		</a>
	);
};

const Segs = ({ segs, env }: { segs: Seg[]; env: Env }) => (
	<>
		{segs.map((seg, i) => (
			<SegView key={i} seg={seg} env={env} />
		))}
	</>
);

// A team cell in a table gets the team's logo in front of the link
const TeamCell = ({ segs, env }: { segs: Seg[]; env: Env }) => {
	const first = segs.find(
		(s): s is Extract<Seg, { tid: number }> =>
			typeof s !== "string" && "tid" in s && !("gid" in s),
	);
	const logo = first ? env.logos[first.tid] : undefined;
	return (
		<span className="d-inline-flex align-items-center">
			{logo && (logo.imgURLSmall ?? logo.imgURL) ? (
				<TeamLogoInline
					imgURL={logo.imgURL}
					imgURLSmall={logo.imgURLSmall}
					size={16}
					className="me-1 flex-shrink-0"
				/>
			) : null}
			<span>
				<Segs segs={segs} env={env} />
			</span>
		</span>
	);
};

const Quote = ({ block }: { block: Extract<Block, { type: "quote" }> }) => (
	<blockquote className="np-quote">
		<span
			className="np-colour-tag"
			title="Written by the newsroom from the numbers, not a real quote"
		>
			Colour
		</span>
		<p>“{block.text}”</p>
		{block.cite ? <cite>— {block.cite}</cite> : null}
	</blockquote>
);

const BlockView = ({ block, env }: { block: Block; env: Env }) => {
	switch (block.type) {
		case "p":
			return (
				<p>
					<Segs segs={block.segs} env={env} />
				</p>
			);
		case "sub":
			return <h4 className="np-sub">{block.text}</h4>;
		case "quote":
			return <Quote block={block} />;
		case "aside":
			return (
				<p className="np-aside">
					<Segs segs={block.segs} env={env} />
				</p>
			);
		case "fold":
			return null;
		case "list": {
			const items = block.items.map((item, i) => (
				<li key={i}>
					<Segs segs={item} env={env} />
				</li>
			));
			return block.ordered ? (
				<ol>{items}</ol>
			) : (
				<ul className="np-notebook">{items}</ul>
			);
		}
		case "notebook":
			return (
				<ul className="np-notebook">
					{block.items.map((item, i) => (
						<li key={i}>
							<strong>{item.lead}</strong> <Segs segs={item.segs} env={env} />
						</li>
					))}
				</ul>
			);
		case "timeline":
			return (
				<ol className="np-timeline">
					{block.items.map((item, i) => (
						<li key={i}>
							<span className="np-timeline-label">{item.label}</span>
							<span>
								<Segs segs={item.segs} env={env} />
							</span>
						</li>
					))}
				</ol>
			);
		case "tape":
			return (
				<div className="table-responsive">
					<table className="table table-sm np-tape mb-2">
						<thead>
							<tr>
								<th className="text-end">{block.a}</th>
								<th className="text-center">vs.</th>
								<th>{block.b}</th>
							</tr>
						</thead>
						<tbody>
							{block.rows.map((row, i) => (
								<tr key={i}>
									<td className="text-end">{row.a}</td>
									<td className="text-center text-body-secondary">
										{row.label}
									</td>
									<td>{row.b}</td>
								</tr>
							))}
						</tbody>
					</table>
				</div>
			);
		case "nums":
			return (
				<dl className="np-nums">
					{block.items.map((item, i) => (
						<div key={i} style={{ display: "contents" }}>
							<dt>{item.value}</dt>
							<dd>{item.label}</dd>
						</div>
					))}
				</dl>
			);
		case "table": {
			const teamCols = new Set(
				block.head.flatMap((h, i) =>
					h === "Team" || h === "Teams" ? [i] : [],
				),
			);
			return (
				<div className="table-responsive">
					<table className="table table-sm table-striped mb-2">
						<thead>
							<tr>
								{block.head.map((h, i) => (
									<th
										key={i}
										className={
											block.numCols?.includes(i) ? "text-end" : undefined
										}
									>
										{h}
									</th>
								))}
							</tr>
						</thead>
						<tbody>
							{block.rows.map((row, i) => (
								<tr
									key={i}
									className={block.hl === i ? "table-info" : undefined}
								>
									{row.map((cell, j) => (
										<td
											key={j}
											className={
												block.numCols?.includes(j) ? "text-end" : undefined
											}
										>
											{teamCols.has(j) ? (
												<TeamCell segs={cell} env={env} />
											) : (
												<Segs segs={cell} env={env} />
											)}
										</td>
									))}
								</tr>
							))}
						</tbody>
					</table>
				</div>
			);
		}
	}
};

const PHOTO_WIDTH = { lead: 96, feature: 78, brief: 56 } as const;

const ArticlePhoto = ({ article, env }: { article: Article; env: Env }) => {
	const photo =
		article.photoPid !== undefined ? env.photos[article.photoPid] : undefined;
	if (!photo || (!photo.face && !photo.imgURL)) {
		return null;
	}
	return (
		<figure className="np-photo" style={{ width: PHOTO_WIDTH[article.size] }}>
			<a href={helpers.leagueUrl(["player", article.photoPid!])}>
				<PlayerPicture
					face={photo.face}
					imgURL={photo.imgURL}
					colors={photo.colors}
					jersey={photo.jersey}
					lazy
				/>
			</a>
		</figure>
	);
};

const ArticleView = ({ article, env }: { article: Article; env: Env }) => {
	const [open, setOpen] = useState(false);
	const lead = article.size === "lead";
	const foldAt = article.body.findIndex((b) => b.type === "fold");
	const top = foldAt < 0 ? article.body : article.body.slice(0, foldAt);
	const rest = foldAt < 0 ? [] : article.body.slice(foldAt + 1);
	const showRest = open || env.printing;
	const long =
		article.body.length >= 5 && article.size !== "brief" && foldAt < 0;
	return (
		<article className={`np-article np-${article.size}`}>
			{article.kicker || article.colour ? (
				<div className="np-kicker">
					{article.kicker}
					{article.colour ? (
						<span
							className="np-colour-tag ms-2"
							title="The newsroom's own voice: the numbers are real, the voices are invented"
						>
							Newsroom colour
						</span>
					) : null}
				</div>
			) : null}
			{lead ? (
				<h2 className="np-headline">{article.head}</h2>
			) : (
				<h3 className="np-head">{article.head}</h3>
			)}
			{article.deck ? (
				<p className="np-deck">
					<Segs segs={article.deck} env={env} />
				</p>
			) : null}
			{article.byline ? (
				<div className="np-byline">
					By <strong>{article.byline.name}</strong> · {article.byline.role}
					{article.byline.dateline ? ` · ${article.byline.dateline}` : null}
				</div>
			) : null}
			{/* the photo and the numbers box share one right-hand column: side by side when there's room, so the box doesn't leave a gap under the photo */}
			<div className="np-figs">
				<ArticlePhoto article={article} env={env} />
				{article.box ? (
					<aside className="np-box">
						<div className="np-side-title">{article.box.title}</div>
						<dl className="np-nums">
							{article.box.items.map((item, i) => (
								<div key={i} style={{ display: "contents" }}>
									<dt>{item.value}</dt>
									<dd>{item.label}</dd>
								</div>
							))}
						</dl>
					</aside>
				) : null}
			</div>
			<div className={`np-body${lead && long ? " np-columns" : ""}`}>
				{top.map((block, i) => (
					<BlockView key={i} block={block} env={env} />
				))}
			</div>
			{rest.length > 0 ? (
				<>
					{showRest ? (
						<div className="np-body np-more-body">
							{rest.map((block, i) => (
								<BlockView key={i} block={block} env={env} />
							))}
						</div>
					) : null}
					{env.printing ? null : (
						<button
							type="button"
							className="btn btn-link btn-sm p-0 np-more"
							onClick={() => {
								setOpen(!open);
							}}
						>
							{open ? "Show less" : "Continue reading"}
						</button>
					)}
				</>
			) : null}
		</article>
	);
};

const SidebarView = ({ sidebar, env }: { sidebar: Sidebar; env: Env }) => (
	<aside className="np-side">
		<div className="np-side-title">{sidebar.title}</div>
		{sidebar.body.map((block, i) => (
			<BlockView key={i} block={block} env={env} />
		))}
	</aside>
);

const SectionView = ({
	section,
	env,
	front,
}: {
	section: Section;
	env: Env;
	front: boolean;
}) => {
	const [first, ...rest] = section.articles;
	const main: ReactNode = (
		<>
			{rest.map((a) => (
				<ArticleView key={a.id} article={a} env={env} />
			))}
		</>
	);
	return (
		<section>
			{front && !env.printing ? null : (
				<h2 className="np-section-title">{section.label}</h2>
			)}
			<div className="row">
				<div className={section.sidebars.length > 0 ? "col-lg-8" : "col-12"}>
					{first ? <ArticleView article={first} env={env} /> : null}
					{section.sidebars.length > 0 ? (
						main
					) : (
						<div className="np-columns">{main}</div>
					)}
				</div>
				{section.sidebars.length > 0 ? (
					<div className="col-lg-4">
						{section.sidebars.map((s) => (
							<SidebarView key={s.id} sidebar={s} env={env} />
						))}
					</div>
				) : null}
			</div>
		</section>
	);
};

const Masthead = ({ paper, env }: { paper: Paper; env: Env }) => {
	const logo = paper.tid !== undefined ? env.logos[paper.tid] : undefined;
	return (
		<header className="np-masthead">
			<div className="d-flex align-items-center justify-content-center gap-3">
				{logo && (logo.imgURL ?? logo.imgURLSmall) ? (
					<TeamLogoInline
						imgURL={logo.imgURL}
						imgURLSmall={logo.imgURL ? undefined : logo.imgURLSmall}
						size={56}
						className="flex-shrink-0 np-masthead-logo"
					/>
				) : null}
				<h1>{paper.name}</h1>
			</div>
			<div className="np-motto">{paper.motto}</div>
			<div className="np-dateline-bar">
				<span>Vol. {paper.volume}</span>
				<span>{paper.editionLabel}</span>
				<span>{paper.dateline}</span>
				<span>{paper.price}</span>
			</div>
		</header>
	);
};

// A strip of every issue, newest at the right, with the champion of each season. The current issue is centred when it opens
const BackIssues = ({
	seasons,
	season,
	team,
	champs,
	env,
}: {
	seasons: number[];
	season: number;
	team: number | "all";
	champs: Record<number, number>;
	env: Env;
}) => {
	const ref = useRef<HTMLDivElement>(null);
	useEffect(() => {
		const el = ref.current;
		const cur = el?.querySelector<HTMLElement>(".np-issue-cur");
		if (el && cur) {
			el.scrollLeft = cur.offsetLeft - el.clientWidth / 2 + cur.offsetWidth / 2;
		}
	}, [season, team]);
	return (
		<nav className="np-backissues" aria-label="Back issues">
			<div className="np-side-title">Back issues</div>
			<div className="np-issues" ref={ref}>
				{seasons.map((s) => {
					const champ = champs[s];
					return (
						<a
							key={s}
							className={`np-issue${s === season ? " np-issue-cur" : ""}`}
							aria-current={s === season ? "page" : undefined}
							href={helpers.leagueUrl(["newspaper", teamParam(env, team), s])}
							title={
								champ !== undefined
									? `${s}: champions ${env.abbrevs.get(champ) ?? ""}`
									: String(s)
							}
						>
							<span className="np-issue-y">{s}</span>
							<span className="np-issue-c">
								{champ !== undefined ? (env.abbrevs.get(champ) ?? "–") : "–"}
							</span>
						</a>
					);
				})}
			</div>
		</nav>
	);
};

// Other editions of the same issue: the league paper, and a local paper for every team
const Editions = ({
	season,
	team,
	env,
}: {
	season: number;
	team: number | "all";
	env: Env;
}) => (
	<details className="np-editions">
		<summary>
			{team === "all"
				? "Local editions"
				: "League edition and other local editions"}
		</summary>
		<div className="np-edition-list">
			{team !== "all" ? (
				<a href={helpers.leagueUrl(["newspaper", "all", season])}>
					League edition
				</a>
			) : null}
			{[...env.abbrevs.entries()].map(([tid, abbrev]) => {
				const logo = env.logos[tid];
				return (
					<a
						key={tid}
						className={tid === team ? "fw-bold" : undefined}
						href={helpers.leagueUrl(["newspaper", `${abbrev}_${tid}`, season])}
					>
						{logo && (logo.imgURLSmall ?? logo.imgURL) ? (
							<TeamLogoInline
								imgURL={logo.imgURL}
								imgURLSmall={logo.imgURLSmall}
								size={16}
								className="me-1 d-inline-flex"
							/>
						) : null}
						{abbrev}
					</a>
				);
			})}
		</div>
	</details>
);

const Newspaper = (props: View<"newspaper">) => {
	const [sectionId, setSectionId] = useState("front");
	const [printing, setPrinting] = useState(false);

	const season = props.error === undefined ? props.season : 0;
	const team = props.error === undefined ? props.team : "all";
	useTitleBar({
		title: "Newspaper",
		dropdown: {
			fields: [
				{ key: "team", options: { type: "teams", all: true }, value: team },
				{ key: "season", options: { type: "seasons" }, value: season },
			],
			view: "newspaper",
		},
	});

	// The browser's own print command should also print the whole paper
	useEffect(() => {
		const before = () => {
			setPrinting(true);
		};
		const after = () => {
			setPrinting(false);
		};
		window.addEventListener("beforeprint", before);
		window.addEventListener("afterprint", after);
		return () => {
			window.removeEventListener("beforeprint", before);
			window.removeEventListener("afterprint", after);
		};
	}, []);

	const printEdition = useCallback(() => {
		setPrinting(true);
		// Let the whole paper render before the print dialog opens
		setTimeout(() => {
			window.print();
		}, 250);
	}, []);

	if (props.error !== undefined) {
		return <p>{props.error}</p>;
	}

	const { paper } = props;
	const abbrevs: Abbrevs = new Map();
	for (const [tid, abbrev] of Object.entries(props.abbrevs)) {
		abbrevs.set(Number(tid), abbrev);
	}
	const env: Env = {
		abbrevs,
		logos: props.logos,
		photos: props.photos as Record<number, Photo>,
		printing,
	};

	const current =
		paper.sections.find((s) => s.id === sectionId) ?? paper.sections[0];
	const shown = printing ? paper.sections : current ? [current] : [];

	return (
		<div className={`np-paper${printing ? " np-printing" : ""}`}>
			<div className="np-toolbar d-flex flex-wrap align-items-center gap-2 mb-2">
				<button
					type="button"
					className="btn btn-outline-secondary btn-sm"
					onClick={printEdition}
				>
					Print edition
				</button>
				{props.team !== "all" ? (
					<a
						className="btn btn-link btn-sm"
						href={helpers.leagueUrl(["newspaper", "all", props.season])}
					>
						League edition
					</a>
				) : null}
				{props.season > props.seasons[0]! ? (
					<a
						className="btn btn-link btn-sm"
						href={helpers.leagueUrl([
							"newspaper",
							teamParam(env, props.team),
							props.season - 1,
						])}
					>
						← {props.season - 1} issue
					</a>
				) : null}
				{props.season < props.seasons.at(-1)! ? (
					<a
						className="btn btn-link btn-sm"
						href={helpers.leagueUrl([
							"newspaper",
							teamParam(env, props.team),
							props.season + 1,
						])}
					>
						{props.season + 1} issue →
					</a>
				) : null}
			</div>
			<Masthead paper={paper} env={env} />
			{paper.ticker.length > 0 ? (
				<div className="np-ticker">
					<strong>Inside: </strong>
					{paper.ticker.map((t, i) => (
						<span key={i}>
							<Segs segs={t} env={env} />
						</span>
					))}
				</div>
			) : null}
			<ul
				className="nav nav-pills mb-2 flex-wrap np-tabs"
				style={{ fontFamily: "var(--bs-body-font-family)" }}
			>
				{paper.sections.map((s) => (
					<li key={s.id} className="nav-item">
						<button
							type="button"
							className={`nav-link py-1 px-2${s.id === current?.id ? " active" : ""}`}
							onClick={() => {
								setSectionId(s.id);
							}}
						>
							{s.label}
						</button>
					</li>
				))}
			</ul>
			{shown.length > 0 ? (
				shown.map((s) => (
					<SectionView
						key={s.id}
						section={s}
						env={env}
						front={s.id === "front"}
					/>
				))
			) : (
				<p>No news is good news: nothing to report for this season.</p>
			)}
			<BackIssues
				seasons={props.seasons}
				season={props.season}
				team={props.team}
				champs={props.champs}
				env={env}
			/>
			<Editions season={props.season} team={props.team} env={env} />
		</div>
	);
};

export default Newspaper;
