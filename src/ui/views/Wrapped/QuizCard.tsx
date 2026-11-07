import type { CSSProperties } from "react";
import type { Slide } from "../../../common/wrapped/types.ts";
import { answerQuiz, resetQuiz, useQuizAnswers } from "./deckState.ts";

const style: CSSProperties = {
	background: "linear-gradient(150deg, #3b2a99 0%, #3b2a99 40%, #0b7285 140%)",
	color: "#fff",
	borderRadius: 16,
	minHeight: 480,
	maxWidth: 520,
	overflow: "hidden",
	textShadow: "0 1px 3px rgba(0,0,0,0.45)",
};

// One quiz question: tap an answer to reveal it
export const QuizCard = ({ slide, deck }: { slide: Slide; deck: string }) => {
	const q = slide.quiz!;
	const get = useQuizAnswers();
	const done = get(deck, slide.id);
	return (
		<div className="p-4 d-flex flex-column mx-auto wrapped-slide" style={style}>
			<div
				className="text-uppercase fw-bold small"
				style={{ letterSpacing: "0.08em", opacity: 0.85 }}
			>
				{slide.kicker}
			</div>
			<h2 className="fw-bold mt-2 mb-3" style={{ fontSize: "1.7rem", lineHeight: 1.15 }}>
				{q.q}
			</h2>
			{q.clue ? <div className="mb-2" style={{ opacity: 0.9 }}>{q.clue}</div> : null}
			{q.chips && q.chips.length > 0 ? (
				<div className="d-flex flex-wrap gap-2 mb-3">
					{q.chips.map(([k, v]) => (
						<span
							key={k}
							className="px-2 py-1 rounded"
							style={{ background: "rgba(0,0,0,0.25)", textShadow: "none" }}
						>
							<span style={{ opacity: 0.8 }}>{k}</span> <b>{v}</b>
						</span>
					))}
				</div>
			) : null}
			<div className="d-grid gap-2 mb-3" role="group" aria-label="Answers">
				{q.opts.map((o, i) => {
					const picked = done?.pick === i;
					let bg = "rgba(255,255,255,0.18)";
					if (done) {
						if (o.ok) {
							bg = "rgba(47,158,68,0.85)";
						} else if (picked) {
							bg = "rgba(224,49,49,0.85)";
						}
					}
					return (
						<button
							key={o.name}
							type="button"
							className="btn text-start"
							disabled={!!done}
							data-testid={done && o.ok ? "quiz-right" : undefined}
							style={{
								background: bg,
								color: "#fff",
								border: picked ? "2px solid #fff" : "2px solid transparent",
								opacity: done && !o.ok && !picked ? 0.55 : 1,
							}}
							onClick={() => answerQuiz(deck, slide.id, { pick: i, ok: o.ok })}
						>
							{o.name}
						</button>
					);
				})}
			</div>
			<div aria-live="polite" className="mt-auto">
				{done ? (
					<>
						<div className="fw-bold fs-5">{done.ok ? "Correct!" : "Not quite."}</div>
						<div>
							{q.answer.name}
							{q.answer.extra ? ` · ${q.answer.extra}` : ""}
						</div>
					</>
				) : (
					<div className="small" style={{ opacity: 0.8 }}>
						Tap an answer.
					</div>
				)}
			</div>
		</div>
	);
};

// The score after the quiz round
export const QuizScoreCard = ({
	slide,
	deck,
	questions,
}: {
	slide: Slide;
	deck: string;
	questions: Slide[];
}) => {
	const get = useQuizAnswers();
	const rows = questions.map((s) => ({ s, a: get(deck, s.id) }));
	const right = rows.filter((r) => r.a?.ok).length;
	const answered = rows.filter((r) => r.a).length;
	return (
		<div className="p-4 d-flex flex-column mx-auto wrapped-slide" style={style}>
			<div
				className="text-uppercase fw-bold small"
				style={{ letterSpacing: "0.08em", opacity: 0.85 }}
			>
				{slide.kicker}
			</div>
			<h2 className="fw-bold mt-2 mb-3" style={{ fontSize: "2rem" }}>
				{answered === 0
					? "Take the quiz to get a score"
					: `You got ${right} of ${rows.length}`}
			</h2>
			<table className="mb-3 w-100" style={{ color: "#fff" }}>
				<tbody>
					{rows.map((r) => (
						<tr key={r.s.id} style={{ borderBottom: "1px solid rgba(255,255,255,0.2)" }}>
							<td className="py-1 pe-2">{r.s.quiz!.q}</td>
							<td className="py-1 text-end fw-bold">
								{r.a ? (r.a.ok ? "Right" : "Missed") : "Skipped"}
							</td>
						</tr>
					))}
				</tbody>
			</table>
			{answered < rows.length ? (
				<div className="small" style={{ opacity: 0.85 }}>
					Questions you skipped count as missed. Go back and tap an answer to play along.
				</div>
			) : null}
			<div className="mt-auto">
				<button
					type="button"
					className="btn btn-light btn-sm"
					onClick={() => resetQuiz(deck)}
				>
					Reset answers
				</button>
			</div>
		</div>
	);
};
