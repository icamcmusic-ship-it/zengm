// A minimal zip writer (stored, no compression) for "Download players" as one PDF per player. PDFs barely compress
// anyway (the faces are JPEG).

const CRC_TABLE = (() => {
	const table = new Uint32Array(256);
	for (let n = 0; n < 256; n++) {
		let c = n;
		for (let k = 0; k < 8; k++) {
			c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
		}
		table[n] = c >>> 0;
	}
	return table;
})();

export const crc32 = (bytes: Uint8Array) => {
	let crc = 0xffffffff;
	for (const byte of bytes) {
		crc = CRC_TABLE[(crc ^ byte) & 0xff]! ^ (crc >>> 8);
	}
	return (crc ^ 0xffffffff) >>> 0;
};

const encoder = new TextEncoder();

export const makeZip = (
	files: { name: string; bytes: Uint8Array }[],
	date = new Date(),
): Uint8Array<ArrayBuffer> => {
	const dosTime =
		(date.getHours() << 11) |
		(date.getMinutes() << 5) |
		Math.floor(date.getSeconds() / 2);
	const dosDate =
		((date.getFullYear() - 1980) << 9) |
		((date.getMonth() + 1) << 5) |
		date.getDate();

	const parts: Uint8Array[] = [];
	const central: Uint8Array[] = [];
	let offset = 0;

	for (const file of files) {
		const name = encoder.encode(file.name);
		const crc = crc32(file.bytes);
		const size = file.bytes.length;

		const local = new Uint8Array(30 + name.length);
		const lv = new DataView(local.buffer);
		lv.setUint32(0, 0x04034b50, true);
		lv.setUint16(4, 20, true);
		// Bit 11: file names are UTF-8
		lv.setUint16(6, 0x0800, true);
		lv.setUint16(8, 0, true);
		lv.setUint16(10, dosTime, true);
		lv.setUint16(12, dosDate, true);
		lv.setUint32(14, crc, true);
		lv.setUint32(18, size, true);
		lv.setUint32(22, size, true);
		lv.setUint16(26, name.length, true);
		lv.setUint16(28, 0, true);
		local.set(name, 30);

		const entry = new Uint8Array(46 + name.length);
		const cv = new DataView(entry.buffer);
		cv.setUint32(0, 0x02014b50, true);
		cv.setUint16(4, 20, true);
		cv.setUint16(6, 20, true);
		cv.setUint16(8, 0x0800, true);
		cv.setUint16(10, 0, true);
		cv.setUint16(12, dosTime, true);
		cv.setUint16(14, dosDate, true);
		cv.setUint32(16, crc, true);
		cv.setUint32(20, size, true);
		cv.setUint32(24, size, true);
		cv.setUint16(28, name.length, true);
		cv.setUint32(42, offset, true);
		entry.set(name, 46);

		parts.push(local, file.bytes);
		central.push(entry);
		offset += local.length + size;
	}

	const centralSize = central.reduce((sum, e) => sum + e.length, 0);
	const end = new Uint8Array(22);
	const ev = new DataView(end.buffer);
	ev.setUint32(0, 0x06054b50, true);
	ev.setUint16(8, files.length, true);
	ev.setUint16(10, files.length, true);
	ev.setUint32(12, centralSize, true);
	ev.setUint32(16, offset, true);

	const all = [...parts, ...central, end];
	const out = new Uint8Array(all.reduce((sum, p) => sum + p.length, 0));
	let at = 0;
	for (const p of all) {
		out.set(p, at);
		at += p.length;
	}
	return out;
};
