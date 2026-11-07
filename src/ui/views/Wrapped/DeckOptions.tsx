import { helpers } from "../../util/helpers.ts";
import { setDeckPref, useDeckPrefs } from "./deckState.ts";

// Quiz round and no-spoilers switches, plus the way to the compare view
export const DeckOptions = ({ showSpoil }: { showSpoil: boolean }) => {
	const prefs = useDeckPrefs();
	return (
		<div className="d-flex flex-wrap gap-3 align-items-center mb-3">
			<div className="form-check mb-0">
				<input
					className="form-check-input"
					type="checkbox"
					id="wrapped-quiz"
					checked={prefs.quiz}
					onChange={(e) => setDeckPref("quiz", e.target.checked)}
				/>
				<label className="form-check-label" htmlFor="wrapped-quiz">
					Quiz round
				</label>
			</div>
			{showSpoil ? (
				<div className="form-check mb-0">
					<input
						className="form-check-input"
						type="checkbox"
						id="wrapped-nospoil"
						checked={prefs.noSpoil}
						onChange={(e) => setDeckPref("noSpoil", e.target.checked)}
					/>
					<label className="form-check-label" htmlFor="wrapped-nospoil">
						No spoilers (champion last)
					</label>
				</div>
			) : null}
			<a href={helpers.leagueUrl(["wrapped", "compare"])}>Compare two</a>
		</div>
	);
};
