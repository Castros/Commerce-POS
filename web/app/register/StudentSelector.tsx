"use client";

import type { DemoStudent, StudentAppSearchResult } from "../lib/demoTypes";
import { formatMoney } from "../lib/format";

type StudentSelectorProps = {
  students: DemoStudent[];
  selectedStudentId: string;
  studentSearch: string;
  searchResults: StudentAppSearchResult[];
  searchingStudents: boolean;
  onSearchChange: (value: string) => void;
  onSearchSubmit: () => void;
  onStudentResultSelect: (student: StudentAppSearchResult) => void;
  onStudentSelect: (studentId: string) => void;
};

export function StudentSelector({
  students,
  selectedStudentId,
  studentSearch,
  searchResults,
  searchingStudents,
  onSearchChange,
  onSearchSubmit,
  onStudentResultSelect,
  onStudentSelect
}: StudentSelectorProps) {
  return (
    <>
      <div className="linkStudentPanel">
        <span>Student lookup</span>
        <input
          placeholder="Search by matricula, name, or email"
          value={studentSearch}
          onChange={(event) => onSearchChange(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === "Enter") {
              event.preventDefault();
              onSearchSubmit();
            }
          }}
        />
        <button type="button" onClick={onSearchSubmit} disabled={!studentSearch.trim() || searchingStudents}>
          {searchingStudents ? "Searching..." : "Search students"}
        </button>
        {searchResults.length > 0 ? (
          <div className="studentSearchResults">
            {searchResults.map((student) => (
              <button
                type="button"
                key={student.id}
                onClick={() => onStudentResultSelect(student)}
              >
                <strong>{student.name}</strong>
                <span>
                  {student.externalId || "No matricula"} -{" "}
                  {student.classroom?.name || "No classroom"} -{" "}
                  {student.preferredGrade || student.classroom?.grade || "No grade"}
                </span>
              </button>
            ))}
          </div>
        ) : null}
        <small>Optional for cash/card. Required for student wallet payment.</small>
      </div>

      <div className="studentAccountList">
        <span>Selected student wallet</span>
        {students.length === 0 ? (
          <p className="emptyState">No student selected. Search A-1042 or Emma for wallet sales.</p>
        ) : null}
        {students.map((student) => (
          <button
            type="button"
            className={student.id === selectedStudentId ? "active" : ""}
            key={student.id}
            onClick={() => onStudentSelect(student.id)}
          >
            <strong>{student.name}</strong>
            <small>{formatMoney(student.wallet.balanceCents)}</small>
          </button>
        ))}
      </div>
    </>
  );
}

