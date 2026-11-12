// Realistic Turnovers (the realisticTurnovers setting of the League extras, see docs/native-features.md): with the other new-league
// settings the sim had about 16.5 turnovers per team game, against about 14.5 in the modern NBA. With the setting on, the turnover
// chance of every possession (and with it the shot-clock violation tendency of the realistic possession model, which reads it) is
// scaled down, and the share of turnovers that are steals scaled up so steals stay where they were. Only multiplications: with the
// setting off nothing here is used and the same random numbers are drawn.
export const TURNOVERS = {
	// The turnover chance of a possession
	tovMult: 0.875,
	// The chance that a turnover is a steal (about 1 / tovMult, so steals per game stay the same)
	stlMult: 1.155,
};
