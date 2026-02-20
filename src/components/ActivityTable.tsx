import dayjs from "dayjs";
import { Link } from "react-router-dom";
import type { SubmissionEvent } from "@shared/types";
import { Card, CardBody, CardHeader } from "./ui/Card";
import { StatusPill } from "./ui/StatusPill";

interface ActivityTableProps {
  events: SubmissionEvent[];
  workspaceId?: string;
}

export function ActivityTable({ events, workspaceId }: ActivityTableProps): JSX.Element {
  return (
    <Card>
      <CardHeader>
        <h3 className="text-sm font-semibold">Form Submission Activity</h3>
      </CardHeader>
      <CardBody className="p-0">
        <div className="max-h-[420px] overflow-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="sticky top-0 z-10 border-b border-slate-100 bg-slate-50 text-left dark:border-slate-700 dark:bg-slate-800">
                <th className="px-5 py-2 text-xs font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400">Company</th>
                <th className="px-5 py-2 text-xs font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400">Status</th>
                <th className="px-5 py-2 text-xs font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400">Proof</th>
                <th className="px-5 py-2 text-xs font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400">Attempted</th>
                <th className="px-5 py-2 text-xs font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400">Last Milestone</th>
                <th className="px-5 py-2 text-xs font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400">Blocked Reason</th>
                <th className="px-5 py-2 text-xs font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400">Notes</th>
              </tr>
            </thead>
            <tbody>
              {events.map((event) => {
                const lastMilestone = event.submittedAt ?? event.filledAt ?? event.discoveredAt ?? event.attemptedAt;
                return (
                  <tr key={event.id} className="border-b border-slate-50 transition-colors hover:bg-slate-50 dark:border-slate-700/50 dark:hover:bg-slate-700/30">
                    <td className="px-5 py-2 font-medium text-slate-900 dark:text-slate-100">{event.firmName}</td>
                    <td className="px-5 py-2">
                      <StatusPill status={event.status} />
                    </td>
                    <td className="px-5 py-2 text-xs text-slate-500 dark:text-slate-400">
                      {event.proofLevel === "submitted_confirmation"
                        ? "Submitted confirmed"
                        : event.proofLevel === "pre_submit_screenshot"
                          ? "Screenshot captured"
                          : event.executionMode === "simulated"
                            ? "Simulated only"
                            : "No proof"}
                    </td>
                    <td className="px-5 py-2 text-slate-500 dark:text-slate-400">{dayjs(event.attemptedAt).format("MMM D, YYYY HH:mm")}</td>
                    <td className="px-5 py-2 text-slate-500 dark:text-slate-400">{dayjs(lastMilestone).format("MMM D, YYYY HH:mm")}</td>
                    <td className="px-5 py-2 text-slate-500 dark:text-slate-400">{event.blockedReason ?? "-"}</td>
                    <td className="px-5 py-2 text-slate-500 dark:text-slate-400 max-w-xs truncate">
                      {event.note ?? "-"}
                      {workspaceId && event.requestId ? (
                        <span className="ml-2">
                          <Link
                            to={`/projects/${workspaceId}/submissions/${event.requestId}`}
                            className="font-medium text-primary-700 hover:underline"
                          >
                            View
                          </Link>
                        </span>
                      ) : null}
                    </td>
                  </tr>
                );
              })}
              {events.length === 0 && (
                <tr>
                  <td colSpan={7} className="px-5 py-8 text-center text-slate-400 dark:text-slate-500">
                    No activity yet.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </CardBody>
    </Card>
  );
}
