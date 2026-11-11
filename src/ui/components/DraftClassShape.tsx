// The Draft Class Shapes setting: a class's shape, its description and a few storylines read off the class (Draft Scouting, Mock Draft)
export const DraftClassShape = ({
	shape,
}: {
	shape: {
		key: string;
		name: string;
		description: string;
		storylines?: string[];
	};
}) => {
	return (
		<div className="draft-class-shape mb-3" data-shape={shape.key}>
			<p className="mb-1">
				<span className="badge text-bg-primary fw-normal me-1">
					{shape.name}
				</span>
				<span className="text-body-secondary">{shape.description}</span>
			</p>
			{shape.storylines && shape.storylines.length > 0 ? (
				<ul className="draft-class-storylines small mb-0 ps-4">
					{shape.storylines.map((line, i) => (
						<li key={i}>{line}</li>
					))}
				</ul>
			) : null}
		</div>
	);
};
