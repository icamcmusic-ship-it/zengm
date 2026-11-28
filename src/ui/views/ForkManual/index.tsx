// Fork Manual: a player-facing guide to everything this fork adds or changes compared to upstream Basketball GM.
// League independent, static content from ./content.ts.
import { useState, type MouseEvent } from "react";
import useTitleBar from "../../hooks/useTitleBar.tsx";
import { MANUAL_SECTIONS, type ManualEntry } from "./content.ts";

const slug = (text: string) =>
	text
		.toLowerCase()
		.replace(/[^\da-z]+/g, "-")
		.replace(/^-|-$/g, "");

const entryText = (entry: ManualEntry) =>
	[entry.title, entry.where, entry.toggle, ...entry.body]
		.join(" ")
		.toLowerCase();

// Scroll in the page instead of letting the router handle the hash link
const scrollTo = (id: string) => (event: MouseEvent) => {
	event.preventDefault();
	document.getElementById(id)?.scrollIntoView();
};

const ForkManual = () => {
	useTitleBar({ title: "Fork Manual" });

	const [search, setSearch] = useState("");
	const words = search.toLowerCase().split(/\s+/).filter(Boolean);

	const sections = MANUAL_SECTIONS.map((section) => ({
		...section,
		entries: section.entries.filter((entry) => {
			const text = `${section.title.toLowerCase()} ${entryText(entry)}`;
			return words.every((word) => text.includes(word));
		}),
	})).filter((section) => section.entries.length > 0);

	return (
		<>
			<p id="fork-manual-top">
				Everything this version of the game adds or changes compared to the
				original Basketball GM: what each feature is, where to find it, and
				which <b>League Extras</b> switch (Tools → League Settings → League
				Extras) controls it. Defaults are given as{" "}
				<i>new leagues / existing leagues</i>.
			</p>

			<div className="mb-3" style={{ maxWidth: 400 }}>
				<input
					type="search"
					className="form-control"
					placeholder="Search the manual"
					aria-label="Search the manual"
					value={search}
					onChange={(event) => {
						setSearch(event.target.value);
					}}
				/>
			</div>

			<nav className="card mb-4" aria-label="Table of contents">
				<div className="card-body">
					<h2 className="h5 card-title">Contents</h2>
					<ol className="mb-0">
						{sections.map((section) => (
							<li key={section.id}>
								<a href={`#${section.id}`} onClick={scrollTo(section.id)}>
									{section.title}
								</a>{" "}
								<span className="text-body-secondary">
									({section.entries.length})
								</span>
							</li>
						))}
					</ol>
					{sections.length === 0 ? (
						<p className="mb-0">Nothing matches your search.</p>
					) : null}
				</div>
			</nav>

			{sections.map((section) => (
				<section key={section.id} className="mb-5">
					<h2 id={section.id} className="border-bottom pb-1">
						{section.title}
					</h2>
					{section.intro ? <p>{section.intro}</p> : null}
					{section.entries.map((entry) => (
						<div
							key={entry.title}
							id={`${section.id}-${slug(entry.title)}`}
							className="mb-4"
						>
							<h3 className="h5">{entry.title}</h3>
							{entry.where || entry.toggle ? (
								<ul className="list-unstyled small text-body-secondary mb-2">
									{entry.where ? (
										<li>
											<b>Where:</b> {entry.where}
										</li>
									) : null}
									{entry.toggle ? (
										<li>
											<b>Setting:</b> {entry.toggle}
										</li>
									) : null}
								</ul>
							) : null}
							{entry.body.map((paragraph, i) => (
								<p key={i} className="mb-2">
									{paragraph}
								</p>
							))}
						</div>
					))}
					<a
						href="#fork-manual-top"
						className="small"
						onClick={scrollTo("fork-manual-top")}
					>
						Back to top
					</a>
				</section>
			))}
		</>
	);
};

export default ForkManual;
