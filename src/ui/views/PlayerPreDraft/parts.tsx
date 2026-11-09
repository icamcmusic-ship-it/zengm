// Small pieces of the College/Overseas page: a school badge, recruiting stars and the draft stock chart

// Same string hash as common/collegeStats/rng.ts, so a school gets the same colors everywhere
const hash = (str: string) => {
	let h = 2166136261;
	for (let i = 0; i < str.length; i++) {
		h = Math.imul(h ^ str.charCodeAt(i), 16777619);
	}
	return h >>> 0;
};

const initials = (name: string) => {
	const words = name
		.replace(/[^ &'A-Za-zÀ-ž]/g, " ")
		.split(" ")
		.filter((word) => word.length > 0 && !/^(of|the|at|de|and|&)$/i.test(word));
	if (words.length === 0) {
		return "?";
	}
	if (words.length === 1) {
		return words[0]!.slice(0, 2).toUpperCase();
	}
	return words
		.slice(0, 3)
		.map((word) => word[0]!.toUpperCase())
		.join("");
};

// A logo-ish round badge with the team's initials in colors picked from its name
export const SchoolBadge = ({ name }: { name: string }) => {
	const h = hash(name);
	const hue = h % 360;
	const text = initials(name);
	return (
		<span
			aria-hidden="true"
			title={name}
			className="d-inline-flex align-items-center justify-content-center rounded-circle fw-bold align-middle"
			style={{
				width: 22,
				height: 22,
				fontSize: text.length > 2 ? 7.5 : 9,
				backgroundColor: `hsl(${hue} 60% 32%)`,
				color: `hsl(${(hue + 40) % 360} 90% 85%)`,
				border: `2px solid hsl(${(hue + 180) % 360} 55% 60%)`,
			}}
		>
			{text}
		</span>
	);
};

export const Stars = ({ n }: { n: number }) => (
	<span title={`${n} star recruit`} className="text-warning">
		{"★".repeat(n)}
		<span className="text-body-secondary">
			{"★".repeat(Math.max(0, 5 - n))}
		</span>
	</span>
);

/**
 * Projected pick over time, with the top of the draft at the top. Undrafted projections sit on a line below the last pick.
 */
export const StockChart = ({
	points,
	numPicks,
}: {
	points: { label: string; pick: number | undefined }[];
	numPicks: number;
}) => {
	const width = 520;
	const height = 240;
	const pad = { left: 40, right: 16, top: 12, bottom: 30 };
	const bottom = Math.round(numPicks * 1.7) + 4;
	// Log scale, so movement near the top of the draft shows
	const y = (pick: number | undefined) => {
		const value = Math.log(pick ?? bottom);
		return (
			pad.top + ((height - pad.top - pad.bottom) * value) / Math.log(bottom)
		);
	};
	const x = (i: number) =>
		pad.left +
		((width - pad.left - pad.right) * i) / Math.max(1, points.length - 1);
	const ticks = [1, 5, 10, 20, 30, numPicks].filter(
		(tick, i, array) => tick <= numPicks && array.indexOf(tick) === i,
	);
	const path = points
		.map(
			(point, i) =>
				`${i === 0 ? "M" : "L"}${x(i).toFixed(1)},${y(point.pick).toFixed(1)}`,
		)
		.join(" ");

	return (
		<svg
			viewBox={`0 0 ${width} ${height}`}
			className="w-100"
			style={{ maxWidth: width }}
			role="img"
			aria-label="Projected draft position over time"
			data-testid="pre-draft-stock-chart"
		>
			{ticks.map((tick) => (
				<g key={tick}>
					<line
						x1={pad.left}
						x2={width - pad.right}
						y1={y(tick)}
						y2={y(tick)}
						stroke="currentColor"
						strokeOpacity={0.12}
					/>
					<text
						x={pad.left - 6}
						y={y(tick) + 4}
						fontSize={11}
						textAnchor="end"
						fill="currentColor"
						fillOpacity={0.7}
					>
						#{tick}
					</text>
				</g>
			))}
			<line
				x1={pad.left}
				x2={width - pad.right}
				y1={y(undefined)}
				y2={y(undefined)}
				stroke="currentColor"
				strokeOpacity={0.3}
				strokeDasharray="4 4"
			/>
			<text
				x={pad.left - 6}
				y={y(undefined) + 4}
				fontSize={10}
				textAnchor="end"
				fill="currentColor"
				fillOpacity={0.7}
			>
				UD
			</text>
			<path d={path} fill="none" stroke="var(--bs-primary)" strokeWidth={2.5} />
			{points.map((point, i) => (
				<circle
					key={i}
					cx={x(i)}
					cy={y(point.pick)}
					r={i === points.length - 1 ? 5 : 3}
					fill="var(--bs-primary)"
				>
					<title>
						{point.label}:{" "}
						{point.pick !== undefined ? `#${point.pick}` : "Undrafted"}
					</title>
				</circle>
			))}
			{points.map((point, i) =>
				point.label.endsWith("preseason") || i === points.length - 1 ? (
					<text
						key={`l${i}`}
						x={x(i)}
						y={height - 8}
						fontSize={10}
						textAnchor={i === points.length - 1 ? "end" : "start"}
						fill="currentColor"
						fillOpacity={0.7}
					>
						{i === points.length - 1
							? point.label
							: point.label.replace(" preseason", "")}
					</text>
				) : null,
			)}
		</svg>
	);
};
