import { foulMarksTitle } from "../../common/foulMarks.ts";

// Technical and flagrant fouls, after the personal fouls in a box score ("3 T"): nothing when there were none, or in a box score
// from before they were recorded
export const FoulMarks = ({ tf, ff }: { tf?: number; ff?: number }) => {
	const title = foulMarksTitle(tf, ff);
	if (!title) {
		return null;
	}
	const marks = [
		tf ? `${tf > 1 ? tf : ""}T` : "",
		ff ? `${ff > 1 ? ff : ""}F` : "",
	]
		.filter(Boolean)
		.join(" ");
	return (
		<span className="text-danger ms-1" title={title}>
			{marks}
		</span>
	);
};
