export const linearRegression = (
	points: {
		x: number;
		y: number;
	}[],
) => {
	const numPoints = points.length;

	let rSquared = 1;

	if (numPoints === 0) {
		return {
			m: 0,
			b: 0,
			rSquared,
		};
	}

	let sum_x = 0;
	let sum_y = 0;
	let sum_xy = 0;
	let sum_xx = 0;

	for (const point of points) {
		const { x, y } = point;
		sum_x += x;
		sum_y += y;
		sum_xx += x * x;
		sum_xy += x * y;
	}

	// All x values equal (like a stat that's 0 for everyone before any games): no slope to fit, so a flat line at the mean
	// instead of NaN everywhere
	const denominator = numPoints * sum_xx - sum_x * sum_x;
	const m =
		denominator === 0 ? 0 : (numPoints * sum_xy - sum_x * sum_y) / denominator;
	const b = sum_y / numPoints - (m * sum_x) / numPoints;

	if (numPoints > 1) {
		const yAvg = sum_y / numPoints;

		let sumSquaresTotal = 0;
		for (const point of points) {
			sumSquaresTotal += Math.pow(point.y - yAvg, 2);
		}

		let sumSquaresResidual = 0;
		for (const point of points) {
			sumSquaresResidual += Math.pow(point.y - (m * point.x + b), 2);
		}

		if (sumSquaresResidual !== 0) {
			rSquared = 1 - sumSquaresResidual / sumSquaresTotal;
		}
	}

	return { m, b, rSquared };
};
