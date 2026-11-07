/* BBGM worker-console script: rare random unretirements.

   Each "roll", with a small chance, ONE random retired player whose retirement came at age 35 or older comes out of
   retirement, becomes a free agent, and gets +3 to +6 overall added to his last (retirement-year) rating.

   HOW TO USE
   1. Open your league in BBGM (the local dev build or the site), then open the browser dev tools.
   2. Switch the console's JavaScript context to the BBGM worker (Chrome: the "top" dropdown above the console ->
      pick the "worker" / shared worker entry; the `bbgm` object only exists there).
   3. Paste this whole file and press Enter.
   4. Commands (they are created on `bbgm.unretire`):
        bbgm.unretire.run()             roll once now (uses the chance below). Returns what happened.
        bbgm.unretire.run({force:true}) skip the dice and unretire one eligible player right now
        bbgm.unretire.start()           watch the league and roll once per season when the phase below begins
        bbgm.unretire.stop()            stop watching
        bbgm.unretire.list()            show who is eligible
        bbgm.unretire.config            edit settings, e.g. bbgm.unretire.config.chance = 0.25
   The watcher lives in memory only. If you reload the page, paste the script again and call start().

   NOTES
   - "Retired at 35 or older" is measured as retiredYear minus birth year. BBGM only stores the LATEST retirement,
     so a player who already came back and retired again is judged by his latest retirement.
   - Dead players are skipped. Players this script already brought back are skipped (flag: unretiredByScript).
   - The new rating is built by raising his non-height ratings one point at a time (favouring his strong areas)
     until BBGM's own ovr formula reads (last ovr + a random 3..6). Then ovr, pot, position and skills are
     recomputed with the game's own functions. Ratings never exceed 100.
   - He gets a fresh ratings row for the current season (a copy of his last row, boosted), so his history is intact.
   - Back up the league first (Tools -> Export League) if you care about it. */
(function () {
	"use strict";
	if (typeof bbgm === "undefined" || !bbgm.idb) {
		console.error("`bbgm` not found. Switch the console to the BBGM worker context first (see the notes at the top of this script).");
		return;
	}
	const { idb, g, player, PLAYER, PHASE, logEvent, helpers } = bbgm;
	const RATING_KEYS = ["stre", "spd", "jmp", "endu", "ins", "dnk", "ft", "fg", "tp", "oiq", "diq", "drb", "pss", "reb"]; // hgt is never changed

	const config = {
		chance: 0.1, // chance per roll that anyone comes back (one roll per season when watching)
		minRetireAge: 35, // age in his (latest) retirement year
		boostMin: 3, // overall points added to his last rating
		boostMax: 6,
		phase: PHASE.FREE_AGENCY, // when the watcher rolls (once per season)
		allowHof: true, // Hall of Famers may come back too
		notify: true, // show a notification when someone returns
	};

	const randInt = (lo, hi) => lo + Math.floor(Math.random() * (hi - lo + 1));

	async function eligible() {
		await idb.cache.flush();
		const players = await idb.league.getAll("players");
		return players.filter((p) => {
			if (p.tid !== PLAYER.RETIRED) return false;
			if (p.diedYear !== undefined && p.diedYear !== null) return false;
			if (p.unretiredByScript) return false;
			if (!config.allowHof && p.hof) return false;
			if (!p.born || typeof p.born.year !== "number" || !Number.isFinite(p.retiredYear)) return false;
			if (!p.ratings || p.ratings.length === 0) return false;
			return p.retiredYear - p.born.year >= config.minRetireAge;
		});
	}

	// Raise ratings one point at a time until the game's own ovr formula reaches the target.
	function boostTo(ratings, targetOvr) {
		let guard = 0;
		while (player.ovr(ratings) < targetOvr && guard++ < 2000) {
			const open = RATING_KEYS.filter((k) => ratings[k] < 100);
			if (open.length === 0) break;
			// Favour strong ratings (a good player gets better at what he is good at), but let weak ones move too
			const weights = open.map((k) => 20 + ratings[k]);
			let r = Math.random() * weights.reduce((a, b) => a + b, 0);
			let pick = open[open.length - 1];
			for (let i = 0; i < open.length; i++) {
				r -= weights[i];
				if (r <= 0) {
					pick = open[i];
					break;
				}
			}
			ratings[pick] += 1;
		}
		return ratings;
	}

	async function unretire(p) {
		const last = p.ratings[p.ratings.length - 1];
		const oldOvr = last.ovr;
		const boost = randInt(config.boostMin, config.boostMax);

		// Fresh ratings row for this season, copied from his last one (history stays intact)
		const season = g.get("season");
		if (last.season !== season) {
			player.addRatingsRow(p);
		}
		const row = p.ratings[p.ratings.length - 1];
		row.locked = false;
		boostTo(row, Math.min(100, oldOvr + boost));

		// Recompute ovr, pot, pos and skills exactly as the game does (0 seasons of development)
		await player.develop(p, 0);
		await player.updateValues(p);

		p.retiredYear = Infinity;
		p.unretiredByScript = true;
		player.addToFreeAgents(p, {});
		await idb.cache.players.put(p);

		const name = `${p.firstName} ${p.lastName}`;
		const newOvr = p.ratings[p.ratings.length - 1].ovr;
		const text = `<a href="${helpers.leagueUrl(["player", p.pid])}">${name}</a> has come out of retirement and is now a free agent.`;
		if (config.notify && logEvent) {
			logEvent({ type: "freeAgent", text, showNotification: true, pids: [p.pid], tids: [], score: 20 });
		}
		const result = { pid: p.pid, name, age: season - p.born.year, oldOvr, newOvr, boost: newOvr - oldOvr };
		console.log("[unretire] " + name + ": ovr " + oldOvr + " -> " + newOvr + " (age " + result.age + "), now a free agent");
		return result;
	}

	async function run(opts) {
		const force = !!(opts && opts.force);
		if (!force && Math.random() >= config.chance) {
			console.log("[unretire] roll: nobody this time (chance " + config.chance + ")");
			return null;
		}
		const pool = await eligible();
		if (pool.length === 0) {
			console.log("[unretire] no eligible retired players (retired at " + config.minRetireAge + "+)");
			return null;
		}
		const p = pool[Math.floor(Math.random() * pool.length)];
		return unretire(p);
	}

	async function list() {
		const pool = await eligible();
		const rows = pool
			.map((p) => ({ pid: p.pid, name: p.firstName + " " + p.lastName, retiredYear: p.retiredYear, ageAtRetirement: p.retiredYear - p.born.year, lastOvr: p.ratings[p.ratings.length - 1].ovr, hof: !!p.hof }))
			.sort((a, b) => b.lastOvr - a.lastOvr);
		console.table(rows.slice(0, 50));
		console.log("[unretire] " + rows.length + " eligible");
		return rows;
	}

	// Watcher: one roll per season, when the chosen phase begins. Memory only.
	let timer = null;
	let lastRolled = null;
	function start() {
		stop();
		timer = setInterval(async () => {
			try {
				const key = g.get("season") + ":" + g.get("phase");
				if (g.get("phase") === config.phase && key !== lastRolled) {
					lastRolled = key;
					await run();
				}
			} catch (e) {
				console.error("[unretire] watcher error", e);
			}
		}, 3000);
		console.log("[unretire] watching: one roll per season at phase " + config.phase + " (" + Object.keys(PHASE).find((k) => PHASE[k] === config.phase) + ")");
	}
	function stop() {
		if (timer) clearInterval(timer);
		timer = null;
		console.log("[unretire] stopped");
	}

	bbgm.unretire = { run, list, start, stop, config, eligible };
	console.log("[unretire] ready. Try bbgm.unretire.list(), bbgm.unretire.run({force:true}), bbgm.unretire.start()");
})();
