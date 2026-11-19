// Pre-Draft Injuries & Combine Medicals: a prospect's medical grade from the combine, as your medical staff reads it (combine results,
// College/Overseas page, Draft Scouting, Draft Board)
import {
	MEDICAL_EXPLANATION,
	MEDICAL_GRADE_NAMES,
	type MedicalGrade as Grade,
} from "../../common/draftCombine.ts";

const BADGE: Record<Grade, string> = {
	clean: "text-bg-success",
	minor: "text-bg-warning",
	redFlag: "text-bg-danger",
};

// For sorting: worse is higher
export const MEDICAL_SORT: Record<Grade, number> = {
	clean: 0,
	minor: 1,
	redFlag: 2,
};

export const MedicalGrade = ({
	grade,
	reason,
}: {
	grade: Grade;
	// One line on why, shown on hover
	reason?: string;
}) => {
	return (
		<span
			className={`badge ${BADGE[grade]} fw-normal text-nowrap`}
			data-medical={grade}
			title={`${MEDICAL_GRADE_NAMES[grade]}${reason ? `: ${reason}` : ""}. ${MEDICAL_EXPLANATION}`}
		>
			{MEDICAL_GRADE_NAMES[grade]}
		</span>
	);
};
