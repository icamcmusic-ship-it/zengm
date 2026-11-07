import { helpers } from "../../util/helpers.ts";
import type { View } from "../../../common/types.ts";
import { RichText, type Teams } from "./RichText.tsx";

type LoadedData = Extract<View<"storylines">, { loading: false }>;

export type UIStory = LoadedData["stories"][number];

export const StoryCard = ({
	story: s,
	teams,
	onWhy,
	phase,
	hideThread,
}: {
	story: UIStory;
	teams: Teams;
	onWhy: (s: UIStory) => void;
	phase?: { label: string; note?: string };
	hideThread?: boolean;
}) => {
	const t = s.tids[0] !== undefined ? teams[s.tids[0]] : undefined;
	return (
		<div
			className="card h-100"
			style={t ? { borderLeft: `5px solid ${t.colors[0]}` } : undefined}
			data-story={s.id}
		>
			<div className="card-body">
				<div className="d-flex justify-content-between small text-body-secondary mb-1">
					<span className="text-uppercase fw-bold">{s.kind}</span>
					<span>
						{s.span && s.span[0] !== s.span[1]
							? `${s.span[0]}–${s.span[1]}`
							: s.season}
					</span>
				</div>
				{phase ? (
					<div className="mb-1">
						<span className="badge text-bg-primary me-1">{phase.label}</span>
						{phase.note ? (
							<span className="small text-body-secondary">{phase.note}</span>
						) : null}
					</div>
				) : null}
				<h3 className="card-title h5">{s.headline}</h3>
				<p className="card-text mb-2">
					<RichText text={s.body} teams={teams} />
				</p>
				<div className="d-flex flex-wrap gap-1 mb-2">
					{s.evidence.map(([k, v]) => (
						<span key={k} className="badge text-bg-secondary fw-normal">
							{k}: <b>{v}</b>
						</span>
					))}
				</div>
				<div className="d-flex flex-wrap gap-2">
					<button
						type="button"
						className="btn btn-sm btn-outline-secondary"
						onClick={() => onWhy(s)}
					>
						Why this story?
					</button>
					{s.thread && !hideThread ? (
						<a
							className="btn btn-sm btn-outline-secondary"
							href={helpers.leagueUrl(["storylines", "thread", s.thread.key])}
						>
							Follow the thread ({s.thread.n} stories)
						</a>
					) : null}
				</div>
			</div>
		</div>
	);
};
