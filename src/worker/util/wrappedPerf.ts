// Timing marks for the Wrapped and Storylines loading flow. They are kept in a small ring on the worker global (self.__wperf) so a profiling script can read them with worker.evaluate; there is no other output.

type Mark = { name: string; ms: number; at: number };

const MAX_MARKS = 300;

const marks = (): Mark[] => {
	const w = globalThis as { __wperf?: Mark[] };
	w.__wperf ??= [];
	return w.__wperf;
};

export const wperfMark = (name: string, ms: number) => {
	const list = marks();
	list.push({ name, ms, at: performance.now() });
	if (list.length > MAX_MARKS) {
		list.splice(0, list.length - MAX_MARKS);
	}
};

export const wperfTime = async <T>(
	name: string,
	f: () => Promise<T> | T,
): Promise<T> => {
	const t0 = performance.now();
	try {
		return await f();
	} finally {
		wperfMark(name, performance.now() - t0);
	}
};

// Profiling scripts set self.__wperfOn before opening a page, then read back what the views returned (to check that a refactor doesn't change output) and the snapshot they were built from
export const wperfOutput = (name: string, data: unknown) => {
	const w = globalThis as { __wperfOn?: boolean; __wperfOut?: Record<string, string> };
	if (!w.__wperfOn) {
		return;
	}
	w.__wperfOut ??= {};
	w.__wperfOut[name] = JSON.stringify(data);
};
