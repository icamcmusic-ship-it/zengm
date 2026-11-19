// Real Player Comps (League Extras, basketball): the real NBA players a draft prospect plays like, as the scouts see him. See
// common/realComps.ts.
import { becameText, compText, type RealComp } from "../../common/realComps.ts";

const SIMILARITY_CLASS: Record<string, string> = {
	"very close": "text-bg-success",
	close: "text-bg-info",
	fair: "text-bg-secondary",
	loose: "text-bg-light border",
};

export const compsTooltip = (comps: RealComp[]) =>
	comps
		.map(
			(c, i) =>
				`${i + 1}. ${compText(c)}, ${c.similarity}. Became: ${becameText(c)}`,
		)
		.join("\n");

// Table cell: the top comp's name, all three in the tooltip
export const RealCompCell = ({ comps }: { comps: RealComp[] }) => {
	const top = comps[0];
	if (!top) {
		return null;
	}
	return (
		<span
			className="text-nowrap"
			title={compsTooltip(comps)}
			data-testid="real-comp"
		>
			{top.name}{" "}
			<span className="text-body-secondary small">({top.similarity})</span>
		</span>
	);
};

// Player page: "Plays like: Name (2003-04, age 20), close. Became: All-Star (6 seasons)" and the other two
export const RealCompsSummary = ({ comps }: { comps: RealComp[] }) => {
	if (comps.length === 0) {
		return null;
	}
	return (
		<div className="mb-3" data-testid="real-comps">
			<b>Plays like:</b>{" "}
			{comps.map((c, i) => (
				<span key={c.name} className="me-2 d-inline-block">
					{i > 0 ? "· " : null}
					{compText(c)}{" "}
					<span
						className={`badge fw-normal ${SIMILARITY_CLASS[c.similarity] ?? "text-bg-secondary"}`}
						title="How closely his ratings, as your scouts see them, match that real season"
					>
						{c.similarity}
					</span>{" "}
					<span className="text-body-secondary small">
						became: {becameText(c)}
					</span>
				</span>
			))}
			<div className="text-body-secondary small">
				Real NBA players at about his age whose ratings were most like his, as
				your scouts see him.
			</div>
		</div>
	);
};
