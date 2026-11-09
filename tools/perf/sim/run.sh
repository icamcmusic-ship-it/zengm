#!/bin/bash
# Sim benchmark: all League extras on / off / new league defaults, and each feature alone (off + one), JOBS at a time.
# Usage: tools/perf/sim/run.sh OUT_FILE [all|modes|features:id1,id2] [JOBS]   (run from the repo root). Summarize with summarize.cjs.
OUT=${1:?out file}
WHAT=${2:-modes}
JOBS=${3:-3}
run() {
	SIM_BENCH=$1 SIM_BENCH_FEATURE=$2 SIM_BENCH_OUT=$OUT node_modules/.bin/vitest run --project basketball \
		src/worker/core/game/simBenchmark.test.ts >/dev/null 2>&1 || echo "failed: $1 $2" >&2
}
export -f run
export OUT
{
	echo "on -"; echo "off -"; echo "stock -"
	if [ "$WHAT" = all ]; then
		node -e 'import("./common/nativeFeatures.ts").then(m => m.NATIVE_FEATURES.forEach(f => console.log("off " + f.id)))'
	elif [ "${WHAT#features:}" != "$WHAT" ]; then
		echo "${WHAT#features:}" | tr ',' '\n' | sed 's/^/off /'
	fi
} | xargs -P "$JOBS" -L 1 bash -c 'run $0 $([ "$1" = - ] || echo $1)'
