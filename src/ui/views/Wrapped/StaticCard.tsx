import clsx from "clsx";
import {
	useEffect,
	useLayoutEffect,
	useMemo,
	useRef,
	useState,
	type CSSProperties,
} from "react";
import type { Slide } from "../../../common/wrapped/types.ts";
import type { View } from "../../../common/types.ts";
import {
	FALLBACK_ACCENTS,
	readAccents,
	SlideCard,
	slideLook,
} from "./SlideCard.tsx";

// A slide on its own inside a page (the compare view): the same card as in a deck, sized to fit its column, with no controls and no animation.
export const StaticCard = ({
	slide,
	index,
	faces,
	teams,
	foot,
	ring,
}: {
	slide: Slide;
	index: number;
	faces: Extract<View<"wrapped">, { loading: false }>["faces"];
	teams: Extract<View<"wrapped">, { loading: false }>["teams"];
	foot?: string;
	// The side that stands out more gets a ring
	ring?: boolean;
}) => {
	const ref = useRef<HTMLDivElement>(null);
	const [w, setW] = useState(300);
	const [accents, setAccents] = useState(FALLBACK_ACCENTS);

	useEffect(() => {
		setAccents(readAccents());
	}, []);
	useLayoutEffect(() => {
		const el = ref.current;
		if (!el) {
			return;
		}
		const measure = () => {
			const next = Math.max(220, Math.min(360, Math.floor(el.clientWidth)));
			setW((old) => (old === next ? old : next));
		};
		measure();
		const observer = new ResizeObserver(measure);
		observer.observe(el);
		return () => observer.disconnect();
	}, []);

	const look = useMemo(
		() => slideLook(slide, teams, index, accents),
		[slide, teams, index, accents],
	);
	const h = Math.round((w * 16) / 9);
	return (
		<div ref={ref}>
			<div
				className={clsx(
					"wrapped-card wrapped-card--compact",
					look.solid && "wrapped-card--solid",
				)}
				style={
					{
						...look.vars,
						width: w,
						height: h,
						boxShadow: ring ? "0 0 0 3px var(--bs-warning)" : undefined,
						"--wrapped-u": `${w / 100}px`,
					} as CSSProperties
				}
			>
				<SlideCard
					slide={slide}
					index={index}
					count={0}
					look={look}
					faces={faces}
					teams={teams}
					unit={w / 100}
					staticMode
					foot={foot}
				/>
			</div>
		</div>
	);
};
