// League Extras "Face Aging": then and now (his first pro season's face, his prime for a retired player, and today's), and
// his face in each season it changed. Never a draft prospect's face. Each face wears the jersey of the team he played the
// most games for that season, in that season's colours (worker/util/faceAging.ts playerFaceHistory).
import HideableSection from "../../components/HideableSection.tsx";
import { PlayerPicture } from "../../components/PlayerPicture.tsx";
import type { FaceHistoryEntry } from "../../../common/faceHistory.ts";

export const FaceHistory = ({
	bornYear,
	faceHistory,
}: {
	bornYear: number;
	faceHistory: { entries: FaceHistoryEntry[]; prime?: FaceHistoryEntry };
}) => {
	const { entries, prime } = faceHistory;
	if (entries.length < 2) {
		return null;
	}
	const first = entries[0]!;
	const now = entries.at(-1)!;

	const figures = [
		{ label: first.label ?? "Then", row: first },
		...(prime ? [{ label: "Prime", row: prime }] : []),
		{ label: "Now", row: now },
	];

	return (
		<div data-testid="face-history">
			<HideableSection title="Then and Now" className="mt-3">
				<div className="d-flex flex-wrap gap-4 align-items-end">
					{figures.map(({ label, row }) => (
						<figure key={label} className="mb-0 text-center">
							<div style={{ width: 100, height: 150 }}>
								<PlayerPicture
									face={row.face}
									colors={row.colors}
									jersey={row.jersey}
								/>
							</div>
							<figcaption className="small">
								<b>{label}</b>: {row.season}, age {row.season - bornYear}
							</figcaption>
						</figure>
					))}
				</div>
				{entries.length > 2 ? (
					<details className="mt-2">
						<summary>Every season his face changed</summary>
						<div className="d-flex flex-wrap gap-2 mt-2">
							{entries.map((row) => (
								<figure key={row.season} className="mb-0 text-center">
									<div style={{ width: 54, height: 81 }}>
										<PlayerPicture
											face={row.face}
											colors={row.colors}
											jersey={row.jersey}
											lazy
										/>
									</div>
									<figcaption className="small text-body-secondary">
										{row.season}
									</figcaption>
								</figure>
							))}
						</div>
					</details>
				) : null}
			</HideableSection>
		</div>
	);
};
