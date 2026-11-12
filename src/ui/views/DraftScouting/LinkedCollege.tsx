// Linked college league (docs/college-mode.md): pick a college league in this browser whose departed players become this league's draft
// classes, and import its latest class
import { useState } from "react";
import type { View } from "../../../common/types.ts";
import { toWorker } from "../../util/toWorker.ts";

type Linkable = {
	lid: number;
	name: string;
	season: number;
	phase: number;
	level: string | undefined;
};

export const LinkedCollege = ({
	linkedCollege,
}: {
	linkedCollege: View<"draftScouting">["linkedCollege"];
}) => {
	const [open, setOpen] = useState(false);
	const [leagues, setLeagues] = useState<Linkable[] | undefined>();
	const [selected, setSelected] = useState<number | undefined>();
	const [status, setStatus] = useState<string | undefined>();
	const [busy, setBusy] = useState(false);

	const loadLeagues = async () => {
		setOpen(true);
		setBusy(true);
		const list = await toWorker("main", "getLinkableCollegeLeagues", undefined);
		setLeagues(list);
		setSelected(linkedCollege?.lid ?? list[0]?.lid);
		setBusy(false);
	};

	const run = async (f: () => Promise<string | undefined>) => {
		setBusy(true);
		setStatus(undefined);
		try {
			setStatus(await f());
		} catch (error) {
			setStatus((error as Error).message);
		}
		setBusy(false);
	};

	return (
		<div
			className="card mb-3"
			style={{ maxWidth: 720 }}
			data-testid="linked-college"
		>
			<div className="card-body py-2">
				<h2 className="fs-6 mb-1">Linked college league</h2>
				{linkedCollege ? (
					<>
						<p className="mb-1">
							Draft classes come from{" "}
							<a href={`/l/${linkedCollege.lid}`}>{linkedCollege.name}</a>: the
							players who left it after its latest season (early entrants and
							seniors), with their school, college stats and honors.{" "}
							{linkedCollege.auto
								? "Imported automatically when the season is over, before each draft."
								: "Import it by hand below."}
						</p>
						{linkedCollege.imports.length > 0 ? (
							<p className="mb-1 small text-body-secondary">
								Imported:{" "}
								{linkedCollege.imports
									.map(
										(row: {
											collegeSeason: number;
											draftYear: number;
											num: number;
										}) =>
											`class of ${row.collegeSeason} → ${row.draftYear} draft (${row.num})`,
									)
									.join(", ")}
							</p>
						) : null}
						<div className="d-flex flex-wrap gap-1">
							<button
								type="button"
								className="btn btn-sm btn-primary"
								disabled={busy}
								onClick={() =>
									run(async () => {
										const out = await toWorker(
											"main",
											"importLinkedCollegeClass",
											undefined,
										);
										return out.error
											? out.error
											: `Imported ${out.num} prospects, the class of ${out.collegeSeason}.`;
									})
								}
							>
								Import latest class now
							</button>
							<button
								type="button"
								className="btn btn-sm btn-light-bordered"
								disabled={busy}
								onClick={() =>
									run(async () => {
										await toWorker("main", "setLinkedCollege", {
											lid: linkedCollege.lid,
											auto: !linkedCollege.auto,
										});
										return undefined;
									})
								}
							>
								{linkedCollege.auto
									? "Turn off auto import"
									: "Turn on auto import"}
							</button>
							<button
								type="button"
								className="btn btn-sm btn-light-bordered"
								disabled={busy}
								onClick={() =>
									run(async () => {
										await toWorker("main", "setLinkedCollege", {
											lid: undefined,
										});
										return undefined;
									})
								}
							>
								Unlink
							</button>
						</div>
					</>
				) : (
					<>
						<p className="mb-1">
							Run a college league next to this one: link a college league in
							this browser and its departed players (early entrants and seniors)
							become your draft classes, keeping their school, college stats and
							honors.
						</p>
						{!open ? (
							<button
								type="button"
								className="btn btn-sm btn-light-bordered"
								onClick={loadLeagues}
							>
								Link a college league…
							</button>
						) : leagues === undefined ? (
							<p className="mb-0">Looking for college leagues…</p>
						) : leagues.length === 0 ? (
							<p className="mb-0">
								No college leagues in this browser.{" "}
								<a href="/new_league/college">Create one</a>.
							</p>
						) : (
							<div className="d-flex flex-wrap gap-1 align-items-center">
								<select
									className="form-select form-select-sm"
									style={{ width: "auto", maxWidth: "100%" }}
									aria-label="College league"
									value={selected}
									onChange={(event) =>
										setSelected(Number.parseInt(event.target.value))
									}
								>
									{leagues.map((l) => (
										<option key={l.lid} value={l.lid}>
											{l.name} ({l.season})
										</option>
									))}
								</select>
								<button
									type="button"
									className="btn btn-sm btn-primary"
									disabled={busy || selected === undefined}
									onClick={() =>
										run(async () => {
											await toWorker("main", "setLinkedCollege", {
												lid: selected,
												auto: true,
											});
											return undefined;
										})
									}
								>
									Link
								</button>
							</div>
						)}
					</>
				)}
				{status ? <p className="mb-0 mt-1 small">{status}</p> : null}
			</div>
		</div>
	);
};
