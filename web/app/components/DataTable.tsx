import { StatusBadge } from "./StatusBadge";

export function DataTable({
  headers,
  rows,
  statusIndex,
  onRowClick,
  activeRowIndex
}: {
  headers: string[];
  rows: string[][];
  statusIndex?: number;
  onRowClick?: (index: number) => void;
  activeRowIndex?: number;
}) {
  return (
    <div className="tableWrap">
      <table>
        <thead>
          <tr>
            {headers.map((header) => (
              <th key={header}>{header}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((row, rowIndex) => (
            <tr
              key={row.join("-")}
              onClick={onRowClick ? () => onRowClick(rowIndex) : undefined}
              style={onRowClick ? { cursor: "pointer" } : undefined}
              className={activeRowIndex === rowIndex ? "active" : undefined}
            >
              {row.map((cell, index) => (
                <td key={`${cell}-${index}`}>
                  {index === statusIndex ? <StatusBadge value={cell} /> : cell}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
