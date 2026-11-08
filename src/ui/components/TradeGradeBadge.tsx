import clsx from "clsx";

// A letter grade from the Trade grader (A+ to F), or "?" when it can't be graded
export const gradeClass = (g: string | null | undefined) => {
	if (!g) {
		return "text-bg-secondary";
	}
	const l = g[0];
	if (l === "A") {
		return "text-bg-success";
	}
	if (l === "B") {
		return "text-bg-primary";
	}
	if (l === "C") {
		return "text-bg-warning";
	}
	return "text-bg-danger";
};

export const TradeGradeBadge = ({
	grade,
	title,
	className,
}: {
	grade: string | null | undefined;
	title?: string;
	className?: string;
}) => {
	return (
		<span
			className={clsx("badge", gradeClass(grade), className)}
			style={{ minWidth: "2.2em" }}
			title={
				title ??
				(grade
					? `Trade grade ${grade}`
					: "Not graded: win shares unknown for some of the pieces")
			}
		>
			{grade ?? "?"}
		</span>
	);
};
