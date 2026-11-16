export const downloadFile = (
	fileName: string,
	contents: string | Uint8Array<ArrayBuffer>[],
	mimeType: string,
) => {
	let contents2;
	if (typeof contents === "string") {
		// Magic number from http://stackoverflow.com/a/18925211/786644 to force UTF-8 encoding
		contents2 = ["\ufeff", contents];
	} else {
		contents2 = contents;
	}

	const blob = new Blob(contents2, {
		type: mimeType,
	});
	const a = document.createElement("a");
	a.download = fileName;
	a.href = URL.createObjectURL(blob);
	a.dataset.downloadurl = [mimeType, a.download, a.href].join(":");
	a.style.display = "none";

	document.body.append(a);
	a.click();

	document.body.removeChild(a);
	setTimeout(() => {
		URL.revokeObjectURL(a.href);
	}, 1500);
};

// A JSON file's bytes, UTF-8 without the byte order mark downloadFile puts before text: JSON may not start with one, and
// JSON.parse of the file as read by Node (readFileSync(file, "utf8"), e.g. the archetype refit scripts) fails on it
export const jsonFileBytes = (
	value: unknown,
	space?: number,
): Uint8Array<ArrayBuffer>[] => [
	new TextEncoder().encode(JSON.stringify(value, null, space)),
];
