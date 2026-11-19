// Hall of Fame induction speeches and plaque text, written from each inductee's career (common/hofStory.ts). Most recent first.
import { useState } from "react";
import HideableSection from "../components/HideableSection.tsx";
import type { HofWords } from "../../common/faceHistory.ts";
import { helpers } from "../util/helpers.ts";

export const HallOfFameSpeeches = ({ words }: { words: HofWords[] }) => {
	const [pid, setPid] = useState<number | undefined>(undefined);
	if (words.length === 0) {
		return null;
	}
	const w = words.find((x) => x.pid === pid) ?? words[0]!;
	return (
		<div data-testid="hof-speeches">
			<HideableSection
				title="Induction speeches"
				className="mb-3"
				pageName="hallOfFame"
			>
				<select
					className="form-select form-select-sm mb-2"
					style={{ maxWidth: 360 }}
					value={w.pid}
					onChange={(event) => setPid(Number(event.target.value))}
					aria-label="Inductee"
				>
					{words.map((x) => (
						<option key={x.pid} value={x.pid}>
							{x.retiredYear}: {x.name}
						</option>
					))}
				</select>
				<div
					className="border rounded p-3 bg-body-tertiary"
					style={{ maxWidth: 720 }}
				>
					<h3 className="h5 mb-1">
						<a href={helpers.leagueUrl(["player", w.pid])}>{w.name}</a>
					</h3>
					<p className="small text-body-secondary" data-testid="hof-plaque">
						{w.plaque}
					</p>
					{w.speech.map((para, i) => (
						<p
							key={i}
							className={i === w.speech.length - 1 ? "mb-0" : undefined}
						>
							{i === 0 ? "“" : ""}
							{para}
							{i === w.speech.length - 1 ? "”" : ""}
						</p>
					))}
				</div>
			</HideableSection>
		</div>
	);
};
