// College mode: where schools and recruits are (docs/college-mode.md). Every school of the college list has its campus coordinates; a
// recruit's hometown is a point in his home state (from his birthplace, "Ohio, USA"), spread around the state's population center and
// fixed per player. Distances drive the "close to home" recruiting pitch and the travel effect of road games.

export type LatLong = readonly [number, number];

// Campus coordinates (latitude, longitude), rounded to about 1 km
const SCHOOL_COORDS: Record<string, LatLong> = {
	"Abilene Christian": [32.47, -99.71],
	"Air Force": [38.99, -104.86],
	Akron: [41.08, -81.51],
	"Alabama A&M": [34.78, -86.57],
	"Alabama State": [32.36, -86.3],
	Alabama: [33.21, -87.55],
	Albany: [42.69, -73.82],
	"Alcorn State": [31.87, -91.13],
	"American University": [38.94, -77.09],
	"Appalachian State": [36.21, -81.68],
	"Arizona State": [33.42, -111.93],
	Arizona: [32.23, -110.95],
	"Arkansas State": [35.84, -90.68],
	"Arkansas-Pine Bluff": [34.24, -92.01],
	Arkansas: [36.07, -94.17],
	Army: [41.39, -73.96],
	Auburn: [32.6, -85.49],
	"Austin Peay": [36.53, -87.35],
	BYU: [40.25, -111.65],
	"Ball State": [40.21, -85.41],
	Baylor: [31.55, -97.11],
	Bellarmine: [38.22, -85.7],
	Belmont: [36.13, -86.79],
	"Bethune-Cookman": [29.21, -81.04],
	Binghamton: [42.09, -75.97],
	"Boise State": [43.6, -116.2],
	"Boston College": [42.34, -71.17],
	"Boston University": [42.35, -71.1],
	"Bowling Green": [41.38, -83.64],
	Bradley: [40.7, -89.62],
	Brown: [41.83, -71.4],
	"Bryant University": [41.92, -71.54],
	Bucknell: [40.95, -76.88],
	Buffalo: [43, -78.79],
	Butler: [39.84, -86.17],
	"Cal Poly": [35.3, -120.66],
	"Cal State Bakersfield": [35.35, -119.1],
	"Cal State Fullerton": [33.88, -117.89],
	"Cal State Northridge": [34.24, -118.53],
	"California Baptist": [33.93, -117.43],
	California: [37.87, -122.26],
	Campbell: [35.41, -78.74],
	Canisius: [42.93, -78.85],
	"Central Arkansas": [35.08, -92.46],
	"Central Connecticut State": [41.69, -72.77],
	"Central Michigan": [43.59, -84.77],
	"Charleston Southern": [32.98, -80.07],
	Charleston: [32.78, -79.94],
	Charlotte: [35.31, -80.73],
	Chattanooga: [35.05, -85.3],
	"Chicago State": [41.72, -87.61],
	Cincinnati: [39.13, -84.52],
	Citadel: [32.8, -79.96],
	Clemson: [34.68, -82.84],
	"Cleveland State": [41.5, -81.67],
	"Coastal Carolina": [33.8, -79.01],
	Colgate: [42.82, -75.54],
	"Colorado State": [40.57, -105.08],
	Colorado: [40.01, -105.27],
	Columbia: [40.81, -73.96],
	Connecticut: [41.81, -72.25],
	"Coppin State": [39.31, -76.66],
	Cornell: [42.45, -76.48],
	Creighton: [41.27, -95.95],
	Dartmouth: [43.7, -72.29],
	Davidson: [35.5, -80.85],
	Dayton: [39.74, -84.18],
	DePaul: [41.92, -87.65],
	"Delaware State": [39.19, -75.54],
	Delaware: [39.68, -75.75],
	Denver: [39.68, -104.96],
	"Detroit Mercy": [42.41, -83.14],
	Drake: [41.6, -93.65],
	Drexel: [39.96, -75.19],
	Duke: [36, -78.94],
	Duquesne: [40.44, -79.99],
	"East Carolina": [35.61, -77.37],
	"East Tennessee State": [36.3, -82.37],
	"East Texas A&M": [33.24, -95.91],
	"Eastern Illinois": [39.48, -88.18],
	"Eastern Kentucky": [37.74, -84.3],
	"Eastern Michigan": [42.25, -83.62],
	"Eastern Washington": [47.49, -117.58],
	Elon: [36.1, -79.5],
	Evansville: [37.97, -87.53],
	Fairfield: [41.16, -73.26],
	"Fairleigh Dickinson": [40.89, -74.03],
	"Florida A&M": [30.42, -84.29],
	"Florida Atlantic": [26.37, -80.1],
	"Florida Gulf Coast": [26.46, -81.77],
	"Florida International": [25.76, -80.37],
	"Florida State": [30.44, -84.3],
	Florida: [29.65, -82.32],
	Fordham: [40.86, -73.89],
	"Fresno State": [36.81, -119.75],
	Furman: [34.93, -82.44],
	"Gardner-Webb": [35.25, -81.67],
	"George Mason": [38.83, -77.31],
	"George Washington": [38.9, -77.05],
	Georgetown: [38.91, -77.07],
	"Georgia Southern": [32.42, -81.78],
	"Georgia State": [33.75, -84.39],
	"Georgia Tech": [33.78, -84.4],
	Georgia: [33.95, -83.37],
	Gonzaga: [47.67, -117.4],
	"Grambling State": [32.52, -92.71],
	"Grand Canyon": [33.51, -112.13],
	"Green Bay": [44.53, -87.92],
	Hampton: [37.02, -76.34],
	Harvard: [42.37, -71.12],
	Hawaii: [21.3, -157.82],
	"High Point": [35.97, -79.99],
	Hofstra: [40.71, -73.6],
	"Holy Cross": [42.24, -71.81],
	"Houston Christian": [29.69, -95.52],
	Houston: [29.72, -95.34],
	Howard: [38.92, -77.02],
	"IU Indianapolis": [39.77, -86.18],
	"Idaho State": [42.86, -112.43],
	Idaho: [46.73, -117.01],
	"Illinois State": [40.51, -88.99],
	"Illinois-Chicago": [41.87, -87.65],
	Illinois: [40.11, -88.23],
	"Incarnate Word": [29.47, -98.47],
	"Indiana State": [39.47, -87.41],
	Indiana: [39.17, -86.52],
	Iona: [40.93, -73.79],
	"Iowa State": [42.03, -93.65],
	Iowa: [41.66, -91.54],
	"Jackson State": [32.3, -90.21],
	"Jacksonville State": [33.82, -85.77],
	Jacksonville: [30.35, -81.61],
	"James Madison": [38.44, -78.87],
	"Kansas City": [39.03, -94.58],
	"Kansas State": [39.19, -96.58],
	Kansas: [38.96, -95.25],
	"Kennesaw State": [34.04, -84.58],
	"Kent State": [41.15, -81.34],
	Kentucky: [38.03, -84.5],
	LIU: [40.69, -73.98],
	LSU: [30.41, -91.18],
	"La Salle": [40.04, -75.15],
	Lafayette: [40.7, -75.21],
	Lamar: [30.04, -94.07],
	"Le Moyne": [43.05, -76.09],
	Lehigh: [40.61, -75.38],
	Liberty: [37.35, -79.18],
	Lindenwood: [38.79, -90.5],
	Lipscomb: [36.1, -86.8],
	"Little Rock": [34.72, -92.34],
	"Long Beach State": [33.78, -118.11],
	Longwood: [37.3, -78.4],
	"Louisiana Tech": [32.53, -92.65],
	"Louisiana-Monroe": [32.53, -92.07],
	Louisiana: [30.21, -92.02],
	Louisville: [38.21, -85.76],
	"Loyola (MD)": [39.35, -76.62],
	"Loyola Chicago": [42, -87.66],
	"Loyola Marymount": [33.97, -118.42],
	Maine: [44.9, -68.67],
	Manhattan: [40.89, -73.9],
	Marist: [41.72, -73.93],
	Marquette: [43.04, -87.93],
	Marshall: [38.42, -82.43],
	"Maryland-Eastern Shore": [38.21, -75.69],
	Maryland: [38.99, -76.94],
	"Massachusetts-Lowell": [42.65, -71.32],
	Massachusetts: [42.39, -72.53],
	"McNeese State": [30.18, -93.22],
	Memphis: [35.12, -89.94],
	Mercer: [32.83, -83.65],
	Mercyhurst: [42.11, -80.05],
	Merrimack: [42.67, -71.12],
	"Miami (FL)": [25.72, -80.28],
	"Miami (OH)": [39.51, -84.73],
	"Michigan State": [42.7, -84.48],
	Michigan: [42.28, -83.74],
	"Middle Tennessee": [35.85, -86.37],
	Milwaukee: [43.08, -87.88],
	Minnesota: [44.97, -93.23],
	"Mississippi State": [33.46, -88.79],
	"Mississippi Valley State": [33.5, -90.33],
	"Missouri State": [37.2, -93.28],
	Missouri: [38.94, -92.33],
	Monmouth: [40.28, -74],
	"Montana State": [45.67, -111.05],
	Montana: [46.86, -113.98],
	"Morehead State": [38.19, -83.43],
	"Morgan State": [39.34, -76.58],
	"Mount St. Mary's": [39.68, -77.35],
	"Murray State": [36.61, -88.32],
	"N.J.I.T.": [40.74, -74.18],
	Navy: [38.98, -76.48],
	Nebraska: [40.82, -96.7],
	Nevada: [39.54, -119.82],
	"New Hampshire": [43.14, -70.93],
	"New Haven": [41.29, -72.96],
	"New Mexico State": [32.28, -106.75],
	"New Mexico": [35.08, -106.62],
	"New Orleans": [30.03, -90.07],
	Niagara: [43.14, -79.04],
	"Nicholls State": [29.79, -90.8],
	"Norfolk State": [36.85, -76.26],
	"North Alabama": [34.81, -87.68],
	"North Carolina A&T": [36.08, -79.77],
	"North Carolina Central": [35.97, -78.9],
	"North Carolina State": [35.79, -78.68],
	"North Carolina-Wilmington": [34.23, -77.87],
	"North Carolina": [35.9, -79.05],
	"North Dakota State": [46.9, -96.8],
	"North Dakota": [47.92, -97.07],
	"North Florida": [30.27, -81.51],
	"North Texas": [33.21, -97.15],
	Northeastern: [42.34, -71.09],
	"Northern Arizona": [35.19, -111.65],
	"Northern Colorado": [40.4, -104.7],
	"Northern Illinois": [41.93, -88.77],
	"Northern Iowa": [42.51, -92.46],
	"Northern Kentucky": [39.03, -84.46],
	"Northwestern State": [31.75, -93.1],
	Northwestern: [42.06, -87.68],
	"Notre Dame": [41.7, -86.24],
	Oakland: [42.67, -83.22],
	"Ohio State": [40, -83.03],
	Ohio: [39.32, -82.1],
	"Oklahoma State": [36.13, -97.07],
	Oklahoma: [35.21, -97.44],
	"Old Dominion": [36.89, -76.31],
	"Ole Miss": [34.37, -89.54],
	Omaha: [41.26, -96.01],
	"Oral Roberts": [36.05, -95.95],
	"Oregon State": [44.56, -123.28],
	Oregon: [44.05, -123.07],
	Pacific: [37.98, -121.31],
	"Penn State": [40.8, -77.86],
	Pennsylvania: [39.95, -75.19],
	Pepperdine: [34.04, -118.71],
	Pittsburgh: [40.44, -79.96],
	"Portland State": [45.51, -122.68],
	Portland: [45.57, -122.73],
	"Prairie View A&M": [30.09, -95.99],
	Presbyterian: [34.47, -81.88],
	Princeton: [40.34, -74.66],
	Providence: [41.84, -71.44],
	"Purdue Fort Wayne": [41.12, -85.11],
	Purdue: [40.42, -86.91],
	Queens: [35.19, -80.83],
	Quinnipiac: [41.42, -72.89],
	Radford: [37.14, -80.55],
	"Rhode Island": [41.48, -71.53],
	Rice: [29.72, -95.4],
	Richmond: [37.57, -77.54],
	Rider: [40.28, -74.74],
	"Robert Morris": [40.52, -80.19],
	Rutgers: [40.52, -74.46],
	"SIU-Edwardsville": [38.79, -89.99],
	SMU: [32.84, -96.78],
	"Sacramento State": [38.56, -121.42],
	"Sacred Heart": [41.22, -73.24],
	"Saint Joseph's (PA)": [40, -75.24],
	"Saint Louis": [38.64, -90.23],
	"Saint Mary's": [37.84, -122.11],
	"Sam Houston State": [30.71, -95.55],
	Samford: [33.46, -86.79],
	"San Diego State": [32.77, -117.07],
	"San Diego": [32.77, -117.19],
	"San Francisco": [37.78, -122.45],
	"San Jose State": [37.34, -121.88],
	"Santa Clara": [37.35, -121.94],
	Seattle: [47.61, -122.32],
	"Seton Hall": [40.74, -74.25],
	Siena: [42.72, -73.75],
	"South Alabama": [30.7, -88.18],
	"South Carolina State": [33.5, -80.85],
	"South Carolina": [33.99, -81.03],
	"South Dakota State": [44.32, -96.78],
	"South Dakota": [42.79, -96.93],
	"South Florida": [28.06, -82.41],
	"Southeast Missouri State": [37.31, -89.53],
	"Southeastern Louisiana": [30.52, -90.47],
	"Southern Illinois": [37.71, -89.22],
	"Southern Indiana": [37.96, -87.68],
	"Southern Miss": [31.33, -89.33],
	"Southern University": [30.52, -91.19],
	"Southern Utah": [37.68, -113.07],
	"St. Bonaventure": [42.08, -78.48],
	"St. John's": [40.72, -73.79],
	"St. Peter's": [40.73, -74.06],
	"St. Thomas": [44.94, -93.19],
	Stanford: [37.43, -122.17],
	"Stephen F. Austin": [31.62, -94.65],
	Stetson: [29.03, -81.3],
	Stonehill: [42.06, -71.08],
	"Stony Brook": [40.91, -73.12],
	Syracuse: [43.04, -76.13],
	TCU: [32.71, -97.36],
	"Tarleton State": [32.22, -98.22],
	Temple: [39.98, -75.16],
	"Tennessee State": [36.17, -86.83],
	"Tennessee Tech": [36.18, -85.51],
	"Tennessee-Martin": [36.34, -88.87],
	Tennessee: [35.95, -83.93],
	"Texas A&M-CC": [27.71, -97.33],
	"Texas A&M": [30.62, -96.34],
	"Texas Southern": [29.72, -95.36],
	"Texas State": [29.89, -97.94],
	"Texas Tech": [33.58, -101.87],
	"Texas-Arlington": [32.73, -97.11],
	Texas: [30.28, -97.73],
	Toledo: [41.66, -83.61],
	Towson: [39.39, -76.61],
	Troy: [31.8, -85.96],
	Tulane: [29.94, -90.12],
	Tulsa: [36.15, -95.94],
	UAB: [33.5, -86.8],
	"UC Davis": [38.54, -121.75],
	"UC Irvine": [33.64, -117.84],
	"UC Riverside": [33.97, -117.33],
	"UC San Diego": [32.88, -117.23],
	"UC Santa Barbara": [34.41, -119.85],
	UCF: [28.6, -81.2],
	UCLA: [34.07, -118.44],
	UMBC: [39.26, -76.71],
	"UNC Asheville": [35.62, -82.57],
	"UNC Greensboro": [36.07, -79.81],
	UNLV: [36.11, -115.14],
	"USC Upstate": [34.98, -81.97],
	USC: [34.02, -118.29],
	"UT Rio Grande Valley": [26.31, -98.17],
	UTEP: [31.77, -106.5],
	UTSA: [29.58, -98.62],
	"Utah State": [41.75, -111.81],
	"Utah Tech": [37.1, -113.57],
	"Utah Valley": [40.28, -111.71],
	Utah: [40.76, -111.84],
	VCU: [37.55, -77.45],
	Valparaiso: [41.46, -87.04],
	Vanderbilt: [36.14, -86.8],
	Vermont: [44.48, -73.2],
	Villanova: [40.04, -75.34],
	"Virginia Military": [37.79, -79.44],
	"Virginia Tech": [37.23, -80.42],
	Virginia: [38.03, -78.51],
	Wagner: [40.62, -74.09],
	"Wake Forest": [36.13, -80.28],
	"Washington State": [46.73, -117.16],
	Washington: [47.66, -122.3],
	"Weber State": [41.19, -111.94],
	"West Georgia": [33.57, -85.1],
	"West Virginia": [39.65, -79.96],
	"Western Carolina": [35.31, -83.18],
	"Western Illinois": [40.47, -90.68],
	"Western Kentucky": [36.99, -86.46],
	"Western Michigan": [42.28, -85.61],
	"Wichita State": [37.72, -97.29],
	"William & Mary": [37.27, -76.71],
	Winthrop: [34.94, -81.03],
	Wisconsin: [43.08, -89.41],
	Wofford: [34.96, -81.94],
	"Wright State": [39.78, -84.06],
	Wyoming: [41.31, -105.58],
	Xavier: [39.15, -84.47],
	Yale: [41.31, -72.92],
	"Youngstown State": [41.11, -80.65],
};

// Population center of each state / province (latitude, longitude) and the radius (km) hometowns are spread over
const STATE_CENTERS: Record<string, readonly [number, number, number]> = {
	Alabama: [33.0, -86.8, 200],
	Alaska: [61.2, -149.9, 300],
	Arizona: [33.4, -111.9, 250],
	Arkansas: [34.9, -92.4, 200],
	California: [35.5, -119.4, 400],
	Colorado: [39.6, -105.0, 200],
	Connecticut: [41.6, -72.7, 60],
	Delaware: [39.4, -75.6, 50],
	"District of Columbia": [38.9, -77.0, 10],
	Florida: [27.8, -81.6, 300],
	Georgia: [33.3, -84.1, 200],
	Hawaii: [21.3, -157.9, 100],
	Idaho: [43.7, -115.4, 250],
	Illinois: [41.3, -88.4, 200],
	Indiana: [40.0, -86.3, 170],
	Iowa: [41.9, -92.9, 200],
	Kansas: [38.4, -96.8, 250],
	Kentucky: [37.8, -85.3, 200],
	Louisiana: [30.7, -91.5, 200],
	Maine: [44.4, -69.8, 150],
	Maryland: [39.1, -76.8, 100],
	Massachusetts: [42.3, -71.4, 100],
	Michigan: [42.8, -84.2, 200],
	Minnesota: [45.2, -93.6, 200],
	Mississippi: [32.6, -89.6, 200],
	Missouri: [38.4, -92.3, 250],
	Montana: [46.6, -110.7, 350],
	Nebraska: [41.2, -97.4, 250],
	Nevada: [36.7, -116.7, 250],
	"New Hampshire": [43.0, -71.5, 80],
	"New Jersey": [40.4, -74.4, 80],
	"New Mexico": [34.6, -106.3, 250],
	"New York": [41.5, -74.6, 200],
	"North Carolina": [35.6, -79.6, 250],
	"North Dakota": [47.4, -99.0, 250],
	Ohio: [40.5, -82.6, 180],
	Oklahoma: [35.6, -96.8, 220],
	Oregon: [44.7, -122.6, 200],
	Pennsylvania: [40.5, -77.0, 220],
	"Rhode Island": [41.8, -71.4, 30],
	"South Carolina": [34.0, -81.0, 180],
	"South Dakota": [44.0, -98.0, 250],
	Tennessee: [35.8, -86.4, 250],
	Texas: [30.9, -97.4, 450],
	Utah: [40.5, -111.9, 200],
	Vermont: [44.1, -72.8, 80],
	Virginia: [37.8, -77.8, 220],
	Washington: [47.3, -121.6, 220],
	"West Virginia": [38.8, -80.8, 150],
	Wisconsin: [43.7, -89.0, 200],
	Wyoming: [42.8, -107.0, 250],
	// Canada
	Alberta: [52.0, -113.8, 250],
	"British Columbia": [49.5, -122.5, 200],
	Manitoba: [50.2, -97.4, 200],
	"New Brunswick": [46.2, -66.0, 150],
	"Newfoundland and Labrador": [48.0, -55.0, 300],
	"Northwest Territories": [62.4, -114.4, 300],
	"Nova Scotia": [45.0, -63.5, 150],
	Nunavut: [63.7, -68.5, 300],
	Ontario: [43.9, -79.6, 250],
	"Prince Edward Island": [46.3, -63.2, 50],
	Quebec: [45.9, -73.4, 200],
	Saskatchewan: [51.5, -106.0, 250],
	Yukon: [60.7, -135.0, 300],
};

// Longest names first, so "West Virginia" wins over "Virginia". State names are letters and spaces only
const STATE_REGEXES = Object.keys(STATE_CENTERS)
	.sort((a, b) => b.length - a.length)
	.map((state) => [state, new RegExp(String.raw`\b${state}\b`)] as const);

/**
 * A school's campus coordinates. Schools not in the list (a renamed team) fall back to the center of the state in their name, if any.
 */
export const schoolCoords = (school: string): LatLong | undefined => {
	const known = SCHOOL_COORDS[school];
	if (known) {
		return known;
	}
	for (const [state, regex] of STATE_REGEXES) {
		if (regex.test(school)) {
			const center = STATE_CENTERS[state]!;
			return [center[0], center[1]];
		}
	}
	return undefined;
};

/**
 * A player's home state or province from his birthplace ("Ohio, USA"), or undefined for a player from outside the US and Canada.
 */
export const homeState = (loc: string): string | undefined => {
	const comma = loc.lastIndexOf(", ");
	if (comma < 0) {
		return undefined;
	}
	const country = loc.slice(comma + 2);
	if (country !== "USA" && country !== "Canada") {
		return undefined;
	}
	const state = loc.slice(0, comma);
	return STATE_CENTERS[state] ? state : undefined;
};

// A number in [0, 1) from an integer seed (a player's pid), so his hometown is the same every time
const unit = (seed: number, salt: number) => {
	let h =
		Math.imul(seed ^ 0x9e3779b9, 0x85ebca6b) ^ Math.imul(salt, 0xc2b2ae35);
	h ^= h >>> 16;
	h = Math.imul(h, 0x7feb352d);
	h ^= h >>> 15;
	h = Math.imul(h, 0x846ca68b);
	h ^= h >>> 16;
	return (h >>> 0) / 4294967296;
};

/**
 * A player's hometown: a point in his home state, spread around its population center (closer to it more often), fixed by his pid.
 * Undefined for a player from outside the US and Canada.
 */
export const hometownCoords = (
	loc: string,
	pid: number,
): LatLong | undefined => {
	const state = homeState(loc);
	if (state === undefined) {
		return undefined;
	}
	const [lat, long, radius] = STATE_CENTERS[state]!;
	const r = radius * unit(pid, 1) ** 0.75;
	const angle = 2 * Math.PI * unit(pid, 2);
	const dLat = (r * Math.cos(angle)) / 111;
	const dLong = (r * Math.sin(angle)) / (111 * Math.cos((lat * Math.PI) / 180));
	return [
		Math.round((lat + dLat) * 100) / 100,
		Math.round((long + dLong) * 100) / 100,
	];
};

/**
 * Great-circle distance in km.
 */
export const distanceKm = (a: LatLong, b: LatLong) => {
	const rad = Math.PI / 180;
	const dLat = (b[0] - a[0]) * rad;
	const dLong = (b[1] - a[1]) * rad;
	const h =
		Math.sin(dLat / 2) ** 2 +
		Math.cos(a[0] * rad) * Math.cos(b[0] * rad) * Math.sin(dLong / 2) ** 2;
	return 2 * 6371 * Math.asin(Math.min(1, Math.sqrt(h)));
};

/**
 * Distance in km between two schools (for the travel effect of road games), undefined if either is not known.
 */
export const schoolDistanceKm = (
	from: string | undefined,
	to: string | undefined,
) => {
	const a = from === undefined ? undefined : schoolCoords(from);
	const b = to === undefined ? undefined : schoolCoords(to);
	return a && b ? distanceKm(a, b) : undefined;
};

export const kmToMiles = (km: number) => km * 0.621371;
