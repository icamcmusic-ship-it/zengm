import { useState, type ReactNode } from "react";
import type {
	Article,
	Block,
	Paper,
	Section,
	Seg,
	Sidebar,
} from "../../../common/newspaper/types.ts";
import type { View } from "../../../common/types.ts";
import useTitleBar from "../../hooks/useTitleBar.tsx";
import { helpers } from "../../util/helpers.ts";

type Abbrevs = Map<number, string>;

const SegView = ({ seg, abbrevs }: { seg: Seg; abbrevs: Abbrevs }) => {
	if (typeof seg === "string") {
		return seg;
	}
	if ("pid" in seg) {
		return <a href={helpers.leagueUrl(["player", seg.pid])}>{seg.t}</a>;
	}
	const abbrev = abbrevs.get(seg.tid) ?? "";
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

const Segs = ({ segs, abbrevs }: { segs: Seg[]; abbrevs: Abbrevs }) => (
	<>
		{segs.map((seg, i) => (
			<SegView key={i} seg={seg} abbrevs={abbrevs} />
		))}
	</>
);

const BlockView = ({ block, abbrevs }: { block: Block; abbrevs: Abbrevs }) => {
	switch (block.type) {
		case "p":
			return (
				<p>
					<Segs segs={block.segs} abbrevs={abbrevs} />
				</p>
			);
		case "sub":
			return <h4 className="np-sub">{block.text}</h4>;
		case "quote":
			return (
				<blockquote className="np-quote">
					<p>“{block.text}”</p>
					{block.cite ? <cite>— {block.cite}</cite> : null}
				</blockquote>
			);
		case "list": {
			const items = block.items.map((item, i) => (
				<li key={i}>
					<Segs segs={item} abbrevs={abbrevs} />
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
							<strong>{item.lead}</strong>{" "}
							<Segs segs={item.segs} abbrevs={abbrevs} />
						</li>
					))}
				</ul>
			);
		case "nums":
			return (
				<dl className="np-nums">
					{block.items.map((item, i) => (
						<div key={i} className="contents" style={{ display: "contents" }}>
							<dt>{item.value}</dt>
							<dd>{item.label}</dd>
						</div>
					))}
				</dl>
			);
		case "table":
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
											<Segs segs={cell} abbrevs={abbrevs} />
										</td>
									))}
								</tr>
							))}
						</tbody>
					</table>
				</div>
			);
	}
};

const ArticleView = ({
	article,
	abbrevs,
}: {
	article: Article;
	abbrevs: Abbrevs;
}) => {
	const lead = article.size === "lead";
	const long = article.body.length >= 5 && article.size !== "brief";
	return (
		<article className={`np-article np-${article.size}`}>
			{article.kicker ? (
				<div className="np-kicker">{article.kicker}</div>
			) : null}
			{lead ? (
				<h2 className="np-headline">{article.head}</h2>
			) : (
				<h3 className="np-head">{article.head}</h3>
			)}
			{article.deck ? (
				<p className="np-deck">
					<Segs segs={article.deck} abbrevs={abbrevs} />
				</p>
			) : null}
			{article.byline ? (
				<div className="np-byline">
					By <strong>{article.byline.name}</strong> · {article.byline.role}
					{article.byline.dateline ? ` · ${article.byline.dateline}` : null}
				</div>
			) : null}
			<div className={`np-body${lead && long ? " np-columns" : ""}`}>
				{article.body.map((block, i) => (
					<BlockView key={i} block={block} abbrevs={abbrevs} />
				))}
			</div>
		</article>
	);
};

const SidebarView = ({
	sidebar,
	abbrevs,
}: {
	sidebar: Sidebar;
	abbrevs: Abbrevs;
}) => (
	<aside className="np-side">
		<div className="np-side-title">{sidebar.title}</div>
		{sidebar.body.map((block, i) => (
			<BlockView key={i} block={block} abbrevs={abbrevs} />
		))}
	</aside>
);

const SectionView = ({
	section,
	abbrevs,
	front,
}: {
	section: Section;
	abbrevs: Abbrevs;
	front: boolean;
}) => {
	const [first, ...rest] = section.articles;
	const main: ReactNode = (
		<>
			{rest.map((a) => (
				<ArticleView key={a.id} article={a} abbrevs={abbrevs} />
			))}
		</>
	);
	return (
		<section>
			{front ? null : <h2 className="np-section-title">{section.label}</h2>}
			<div className="row">
				<div className={section.sidebars.length > 0 ? "col-lg-8" : "col-12"}>
					{first ? <ArticleView article={first} abbrevs={abbrevs} /> : null}
					{section.sidebars.length > 0 ? (
						main
					) : (
						<div className="np-columns">{main}</div>
					)}
				</div>
				{section.sidebars.length > 0 ? (
					<div className="col-lg-4">
						{section.sidebars.map((s) => (
							<SidebarView key={s.id} sidebar={s} abbrevs={abbrevs} />
						))}
					</div>
				) : null}
			</div>
		</section>
	);
};

const Masthead = ({ paper }: { paper: Paper }) => (
	<header className="np-masthead">
		<h1>{paper.name}</h1>
		<div className="np-motto">{paper.motto}</div>
		<div className="np-dateline-bar">
			<span>Vol. {paper.volume}</span>
			<span>{paper.editionLabel}</span>
			<span>{paper.dateline}</span>
			<span>{paper.price}</span>
		</div>
	</header>
);

const Newspaper = (props: View<"newspaper">) => {
	const [sectionId, setSectionId] = useState("front");

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

	if (props.error !== undefined) {
		return <p>{props.error}</p>;
	}

	const { paper } = props;
	const abbrevs: Abbrevs = new Map();
	for (const [tid, abbrev] of Object.entries(props.abbrevs)) {
		abbrevs.set(Number(tid), abbrev);
	}

	const current =
		paper.sections.find((s) => s.id === sectionId) ?? paper.sections[0];

	return (
		<div className="np-paper">
			<Masthead paper={paper} />
			{paper.ticker.length > 0 ? (
				<div className="np-ticker">
					<strong>Inside: </strong>
					{paper.ticker.map((t, i) => (
						<span key={i}>
							<Segs segs={t} abbrevs={abbrevs} />
						</span>
					))}
				</div>
			) : null}
			<ul
				className="nav nav-pills mb-2 flex-wrap"
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
			{current ? (
				<SectionView
					key={current.id}
					section={current}
					abbrevs={abbrevs}
					front={current.id === "front"}
				/>
			) : (
				<p>No news is good news: nothing to report for this season.</p>
			)}
		</div>
	);
};

export default Newspaper;
