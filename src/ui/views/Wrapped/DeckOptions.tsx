import { setDeckPref, useDeckPrefs } from "./deckState.ts";

// Quiz round and no-spoilers switches, for the settings dialog
export const DeckOptions = ({ showSpoil }: { showSpoil: boolean }) => {
	const prefs = useDeckPrefs();
	return (
		<>
			<div className="form-check form-switch mb-3">
				<input
					className="form-check-input"
					type="checkbox"
					role="switch"
					id="wrapped-quiz"
					checked={prefs.quiz}
					onChange={(e) => setDeckPref("quiz", e.target.checked)}
				/>
				<label className="form-check-label" htmlFor="wrapped-quiz">
					Quiz round
					<div className="form-text mt-0">
						A few questions about the deck, with a score at the end.
					</div>
				</label>
			</div>
			{showSpoil ? (
				<div className="form-check form-switch mb-3">
					<input
						className="form-check-input"
						type="checkbox"
						role="switch"
						id="wrapped-nospoil"
						checked={prefs.noSpoil}
						onChange={(e) => setDeckPref("noSpoil", e.target.checked)}
					/>
					<label className="form-check-label" htmlFor="wrapped-nospoil">
						No spoilers
						<div className="form-text mt-0">
							Holds the champion back until the end.
						</div>
					</label>
				</div>
			) : null}
		</>
	);
};
