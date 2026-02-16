import dayjs from "dayjs";
import type { Firm } from "../types";

interface FirmPipelineTableProps {
  firms: Firm[];
  selectedFirmId?: string;
  onSelectFirm: (firmId: string) => void;
}

export function FirmPipelineTable({ firms, selectedFirmId, onSelectFirm }: FirmPipelineTableProps): JSX.Element {
  return (
    <div className="card card-pad">
      <h3 className="card-title">Investor Pipeline</h3>
      <div className="table-wrap">
        <table>
          <thead>
            <tr>
              <th>Company</th>
              <th>Type</th>
              <th>Focus</th>
              <th>Check Size</th>
              <th>Stage</th>
              <th>Last Contact</th>
            </tr>
          </thead>
          <tbody>
            {firms.map((firm) => {
              const selected = selectedFirmId === firm.id;
              return (
                <tr key={firm.id} onClick={() => onSelectFirm(firm.id)} style={{ background: selected ? "#eef4ff" : undefined, cursor: "pointer" }}>
                  <td>
                    <div style={{ fontWeight: 600 }}>{firm.name}</div>
                    <div style={{ color: "#5f7288", fontSize: 12 }}>{firm.website}</div>
                  </td>
                  <td>{firm.investorType}</td>
                  <td>{firm.focusSectors.join(", ")}</td>
                  <td>{firm.checkSizeRange}</td>
                  <td>
                    <span className={`status-pill ${firm.stage === "submitted" ? "submitted" : "form_filled"}`}>{firm.stage}</span>
                  </td>
                  <td>{firm.lastTouchedAt ? dayjs(firm.lastTouchedAt).format("MMM D, YYYY") : "-"}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}
