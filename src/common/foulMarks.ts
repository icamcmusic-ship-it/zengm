// "1 technical foul, 1 flagrant foul": the hover text of a box score's technical and flagrant fouls (ui/components/FoulMarks.basketball.tsx).
// Undefined when there were none (or the box score is from before they were recorded)
export const foulMarksTitle = (
	tf: number | undefined,
	ff: number | undefined,
) => {
	const parts = [];
	if (tf) {
		parts.push(`${tf} technical foul${tf === 1 ? "" : "s"}`);
	}
	if (ff) {
		parts.push(`${ff} flagrant foul${ff === 1 ? "" : "s"}`);
	}
	return parts.length > 0 ? parts.join(", ") : undefined;
};
