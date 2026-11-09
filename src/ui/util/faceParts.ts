// UI side of the fork's face parts (common/faceParts.ts). The parts are always registered at startup (append-only, so
// facesjs' own faces draw exactly as before): a league with the League Extras "Fork face parts" switch on gives new
// players fork part ids, and those faces have to draw in every browser that opens the league or its exported file.
import { registerForkFaceParts } from "../../common/faceParts.ts";

export const initForkFaceParts = () => {
	registerForkFaceParts();
};
