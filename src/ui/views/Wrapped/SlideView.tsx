import type { View } from "../../../common/types.ts";
import type { Slide } from "../../../common/wrapped/types.ts";
import { FitSlide } from "./FitSlide.tsx";
import { QuizCard, QuizScoreCard } from "./QuizCard.tsx";
import { SlideCard } from "./SlideCard.tsx";

type Data = View<"wrapped">;

// Shows one item of the deck: a normal slide (fitted to the screen), a quiz question or the quiz score
export const SlideView = ({
	slide,
	index,
	faces,
	teams,
	deck,
	all,
}: {
	slide: Slide;
	index: number;
	faces: Data["faces"];
	teams: Data["teams"];
	deck: string;
	all: Slide[];
}) => {
	if (slide.quiz) {
		return <QuizCard slide={slide} deck={deck} />;
	}
	if (slide.id === "quizscore") {
		return (
			<QuizScoreCard
				slide={slide}
				deck={deck}
				questions={all.filter((s) => s.quiz)}
			/>
		);
	}
	return (
		<FitSlide dep={`${deck}|${slide.id}`}>
			<SlideCard slide={slide} index={index} faces={faces} teams={teams} />
		</FitSlide>
	);
};
