import dayjs from "dayjs";
import type { SubmissionEvent } from "../types";

interface ActivityTableProps {
  events: SubmissionEvent[];
}

export function ActivityTable({ events }: ActivityTableProps): JSX.Element {
  return (
    <div className="card card-pad">
      <h3 className="card-title">Form Submission Activity</h3>
      <div className="table-wrap">
        <table>
          <thead>
            <tr>
              <th>Company</th>
              <th>Status</th>
              <th>Attempted</th>
              <th>Last Milestone</th>
              <th>Blocked Reason</th>
              <th>Notes</th>
            </tr>
          </thead>
          <tbody>
            {events.map((event) => {
              const lastMilestone = event.submittedAt ?? event.filledAt ?? event.discoveredAt ?? event.attemptedAt;
              return (
                <tr key={event.id}>
                  <td>{event.firmName}</td>
                  <td>
                    <span className={`status-pill ${event.status}`}>{event.status.replaceAll("_", " ")}</span>
                  </td>
                  <td>{dayjs(event.attemptedAt).format("MMM D, YYYY HH:mm")}</td>
                  <td>{dayjs(lastMilestone).format("MMM D, YYYY HH:mm")}</td>
                  <td>{event.blockedReason ?? "-"}</td>
                  <td>{event.note ?? "-"}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}
