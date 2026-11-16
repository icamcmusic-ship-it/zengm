import { assert, test } from "vitest";
import { jsonFileBytes } from "./downloadFile.ts";

test("JSON files are written without a byte order mark", () => {
	const [bytes] = jsonFileBytes({ kind: "x", picks: [1] }, 1);
	assert.notStrictEqual(bytes![0], 0xef);
	const text = new TextDecoder("utf-8", { ignoreBOM: true }).decode(bytes);
	assert.deepStrictEqual(JSON.parse(text), { kind: "x", picks: [1] });
});
