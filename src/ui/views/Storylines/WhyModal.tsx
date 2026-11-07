import { useEffect, useState } from "react";
import { Modal } from "../../components/Modal.tsx";
import { toWorker } from "../../util/toWorker.ts";
import { RichText, type Teams } from "./RichText.tsx";
import type { WhySection } from "../../../common/storylines/why.ts";

// "Why this story?": the data behind a storyline, fetched from the worker when opened
export const WhyModal = ({
	storyId,
	headline,
	teams,
	onHide,
}: {
	storyId: string | undefined;
	headline: string;
	teams: Teams;
	onHide: () => void;
}) => {
	const [sections, setSections] = useState<WhySection[] | undefined | null>(
		null,
	);

	useEffect(() => {
		let ignore = false;
		setSections(null);
		if (storyId !== undefined) {
			(async () => {
				const x = await toWorker("main", "getStorylineWhy", storyId);
				if (!ignore) {
					setSections(x);
				}
			})();
		}
		return () => {
			ignore = true;
		};
	}, [storyId]);

	return (
		<Modal show={storyId !== undefined} onHide={onHide} size="lg" scrollable>
			<Modal.Header closeButton>
				<Modal.Title>Why this story?</Modal.Title>
			</Modal.Header>
			<Modal.Body>
				<p className="fw-bold">{headline}</p>
				{sections === null ? <p>Loading...</p> : null}
				{sections === undefined ? (
					<p>That story is no longer in the league’s records.</p>
				) : null}
				{sections?.map((sec) => (
					<div key={sec.id} className="mb-3" data-why={sec.id}>
						<h3 className="h6">{sec.title}</h3>
						{sec.note ? (
							<p className="small text-body-secondary mb-1">{sec.note}</p>
						) : null}
						<div className="table-responsive">
							<table className="table table-sm table-striped mb-0">
								{sec.cols.some((c) => c !== "") ? (
									<thead>
										<tr>
											{sec.cols.map((c, i) => (
												<th key={i}>{c}</th>
											))}
										</tr>
									</thead>
								) : null}
								<tbody>
									{sec.rows.map((row, i) => (
										<tr key={i}>
											{row.map((cell, j) => (
												<td key={j}>
													<RichText text={cell} teams={teams} />
												</td>
											))}
										</tr>
									))}
								</tbody>
							</table>
						</div>
					</div>
				))}
			</Modal.Body>
			<Modal.Footer>
				<button type="button" className="btn btn-secondary" onClick={onHide}>
					Close
				</button>
			</Modal.Footer>
		</Modal>
	);
};
