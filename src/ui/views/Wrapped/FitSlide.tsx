import { useLayoutEffect, useRef, type ReactNode } from "react";

// Zoom levels to try, biggest first
const STEPS = [1, 0.93, 0.86, 0.79, 0.72, 0.65, 0.58, 0.52];

// Shrinks a slide that is taller than the screen so it fits without scrolling, down to about half size. Uses CSS zoom, so text reflows instead of being scaled as a picture.
export const FitSlide = ({ children, dep }: { children: ReactNode; dep: string }) => {
	const ref = useRef<HTMLDivElement>(null);

	useLayoutEffect(() => {
		const el = ref.current;
		if (!el) {
			return;
		}
		const fit = () => {
			const avail = Math.max(340, window.innerHeight - 170);
			let used = 1;
			for (const z of STEPS) {
				el.style.zoom = String(z);
				used = z;
				if (el.getBoundingClientRect().height <= avail) {
					break;
				}
			}
			el.dataset.fitZoom = String(used);
		};
		fit();
		window.addEventListener("resize", fit);
		return () => window.removeEventListener("resize", fit);
	}, [dep]);

	return <div ref={ref}>{children}</div>;
};
