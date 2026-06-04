"use client";

import type { DemoStudent } from "../lib/demoTypes";
import { formatMoney } from "../lib/format";
import type { RegisterSearchResult } from "./types";

type StudentSelectorProps = {
  students: DemoStudent[];
  selectedStudentId: string;
  studentSearch: string;
  searchResults: RegisterSearchResult[];
  searchingStudents: boolean;
  serialSupported: boolean;
  serialConnecting: boolean;
  serialConnected: boolean;
  serialMessage: string | null;
  onSearchChange: (value: string) => void;
  onSearchSubmit: () => void;
  onStudentResultSelect: (student: RegisterSearchResult) => void;
  onStudentSelect: (studentId: string) => void;
  onClearStudent: () => void;
  onNfcConnect: () => void;
};

export function StudentSelector({
  students,
  selectedStudentId,
  studentSearch,
  searchResults,
  searchingStudents,
  serialSupported,
  serialConnecting,
  serialConnected,
  serialMessage,
  onSearchChange,
  onSearchSubmit,
  onStudentResultSelect,
  onStudentSelect,
  onClearStudent,
  onNfcConnect
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
        <div className="studentLookupActions">
          <button type="button" onClick={onSearchSubmit} disabled={!studentSearch.trim() || searchingStudents}>
            {searchingStudents ? "Searching..." : "Search students"}
          </button>
          <button type="button" onClick={onNfcConnect} disabled={!serialSupported || serialConnecting || serialConnected}>
            {serialConnected ? "NFC connected" : serialConnecting ? "Connecting..." : "Connect NFC reader"}
          </button>
        </div>
        {serialMessage ? (
          <small className={serialConnected ? "successText" : undefined}>{serialMessage}</small>
        ) : null}
        {!serialSupported ? (
          <small>Web Serial requires Chrome or Edge over HTTPS or localhost.</small>
        ) : null}
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
                  {student.externalId || "No matricula"} - {student.classroomLabel} -{" "}
                  {student.source === "pos" ? "POS customer" : "Student app"}
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
          <p className="emptyState">No student selected. Search by name/matricula or tap an NFC card.</p>
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
        {students.length > 0 ? (
          <button type="button" onClick={onClearStudent}>
            Clear student
          </button>
        ) : null}
      </div>
    </>
  );
}
