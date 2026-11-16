import { assert, test } from "vitest";
import { hofWordsOn } from "./hofStory.ts";

// The Hall of Fame words are basketball careers (points, rebounds, assists): football's Hall of Fame page gets none, not a
// "0 points, 0 rebounds, 0 assists" plaque and a speech about shooting on a hoop
test("no Hall of Fame plaque text or speeches outside basketball", () => {
	assert.isFalse(hofWordsOn());
});
