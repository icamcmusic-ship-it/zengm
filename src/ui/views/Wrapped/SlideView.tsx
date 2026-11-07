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
	let card;
	if (slide.quiz) {
		card = <QuizCard slide={slide} deck={deck} />;
	} else if (slide.id === "quizscore") {
		card = (
			<QuizScoreCard
				slide={slide}
				deck={deck}
				questions={all.filter((s) => s.quiz)}
			/>
		);
	} else {
		card = (
			<SlideCard slide={slide} index={index} faces={faces} teams={teams} />
		);
	}
	return <FitSlide dep={`${deck}|${slide.id}`}>{card}</FitSlide>;
};
