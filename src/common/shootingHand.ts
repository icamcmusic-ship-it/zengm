// Which hand a player shoots with. Derived from the player (never stored), so it never changes and works in every existing league:
// - real players (an srID from Basketball-Reference): left only for the notable lefties listed below, else right (the real-player
//   data has no handedness)
// - random players (and real-league draft prospects, srID "dp_..."): about 1 in 10, from a hash of the player id (NBA history is
//   roughly 5-10% lefties)
// Used by the player page, and with Game Sim Fixes by the basketball sim (a small at-rim/post edge, see GameSim.basketball).
export const LEFTY_RATE = 0.1;

export type ShootingHand = "left" | "right";

// Notable left-handed NBA shooters, by Basketball-Reference ID. Only players whose left-handedness is well known
export const REAL_LEFTIES: ReadonlySet<string> = new Set([
	"russebi01", // Bill Russell
	"wilkele01", // Lenny Wilkens
	"reedwi01", // Willis Reed
	"goodrga01", // Gail Goodrich
	"barnedi01", // Dick Barnett
	"cowenda01", // Dave Cowens
	"architi01", // Tiny Archibald
	"gilmoar01", // Artis Gilmore
	"mullich01", // Chris Mullin
	"robinda01", // David Robinson
	"colemde01", // Derrick Coleman
	"anderke01", // Kenny Anderson
	"vanexni01", // Nick Van Exel
	"millemi01", // Mike Miller
	"ginobma01", // Manu Ginóbili
	"reddmi01", // Michael Redd
	"odomla01", // Lamar Odom
	"randoza01", // Zach Randolph
	"boshch01", // Chris Bosh
	"dragigo01", // Goran Dragić
	"conlemi01", // Mike Conley
	"hardeja01", // James Harden
	"beaslmi01", // Michael Beasley
	"millspa02", // Patty Mills
	"monrogr01", // Greg Monroe
	"randlju01", // Julius Randle
	"sabondo01", // Domantas Sabonis
	"russeda01", // D'Angelo Russell
	"brunsja01", // Jalen Brunson
	"foxde01", // De'Aaron Fox
	"barrerj01", // RJ Barrett
	"willizi01", // Zion Williamson
]);

// League-independent salt, so the lefties are not the same "every 10th id" pattern as other pid-derived flavor
const SALT = 0x5bd1e995;

// lowbias32 (two xor-shift-multiply rounds), applied twice: well mixed even for consecutive ids, deterministic across browsers
const mix = (n: number) => {
	let x = n | 0;
	x ^= x >>> 16;
	x = Math.imul(x, 0x7feb352d);
	x ^= x >>> 15;
	x = Math.imul(x, 0x846ca68b);
	x ^= x >>> 16;
	return x;
};

export const handHash = (pid: number) =>
	(mix(mix(pid ^ SALT) + 0x9e3779b9) >>> 0) / 4294967296;

export const getShootingHand = (p: {
	pid: number;
	srID?: string;
}): ShootingHand => {
	if (p.srID !== undefined && !p.srID.startsWith("dp_")) {
		return REAL_LEFTIES.has(p.srID) ? "left" : "right";
	}
	return handHash(p.pid) < LEFTY_RATE ? "left" : "right";
};
