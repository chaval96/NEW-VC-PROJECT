import { useMemo, useState } from "react";
import dayjs from "dayjs";
import type { Firm } from "@shared/types";
import { Card, CardBody, CardHeader } from "./ui/Card";
import { StatusPill } from "./ui/StatusPill";

interface FirmPipelineTableProps {
  firms: Firm[];
  selectedFirmId?: string;
  onSelectFirm: (firmId: string) => void;
}

const PAGE_SIZE = 50;

export function FirmPipelineTable({ firms, selectedFirmId, onSelectFirm }: FirmPipelineTableProps): JSX.Element {
  const [page, setPage] = useState(0);
  const totalPages = Math.max(1, Math.ceil(firms.length / PAGE_SIZE));
  const visibleFirms = useMemo(() => firms.slice(page * PAGE_SIZE, (page + 1) * PAGE_SIZE), [firms, page]);

  return (
    <Card>
      <CardHeader>
        <div className="flex items-center justify-between">
          <h3 className="text-sm font-semibold">Investor Pipeline ({firms.length})</h3>
          {totalPages > 1 && (
            <div className="flex items-center gap-2 text-xs text-slate-500 dark:text-slate-400">
              <button
                onClick={() => setPage((p) => Math.max(0, p - 1))}
                disabled={page === 0}
                className="rounded px-2 py-0.5 hover:bg-slate-100 disabled:opacity-40 dark:hover:bg-slate-700"
              >
                Prev
              </button>
              <span>{page + 1} / {totalPages}</span>
              <button
                onClick={() => setPage((p) => Math.min(totalPages - 1, p + 1))}
                disabled={page >= totalPages - 1}
                className="rounded px-2 py-0.5 hover:bg-slate-100 disabled:opacity-40 dark:hover:bg-slate-700"
              >
                Next
              </button>
            </div>
          )}
        </div>
      </CardHeader>
      <CardBody className="p-0">
        <div className="overflow-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-slate-100 text-left dark:border-slate-700">
                <th className="px-5 py-2 text-xs font-medium uppercase text-slate-500 dark:text-slate-400">Company</th>
                <th className="px-5 py-2 text-xs font-medium uppercase text-slate-500 dark:text-slate-400">Type</th>
                <th className="px-5 py-2 text-xs font-medium uppercase text-slate-500 dark:text-slate-400">Focus</th>
                <th className="px-5 py-2 text-xs font-medium uppercase text-slate-500 dark:text-slate-400">Check Size</th>
                <th className="px-5 py-2 text-xs font-medium uppercase text-slate-500 dark:text-slate-400">Stage</th>
                <th className="px-5 py-2 text-xs font-medium uppercase text-slate-500 dark:text-slate-400">Last Contact</th>
              </tr>
            </thead>
            <tbody>
              {visibleFirms.map((firm) => {
                const selected = selectedFirmId === firm.id;
                return (
                  <tr
                    key={firm.id}
                    onClick={() => onSelectFirm(firm.id)}
                    className={`cursor-pointer border-b border-slate-50 transition-colors dark:border-slate-700/50 ${
                      selected
                        ? "bg-primary-50 dark:bg-primary-600/10"
                        : "hover:bg-slate-50 dark:hover:bg-slate-700/50"
                    }`}
                  >
                    <td className="px-5 py-2">
                      <div className="font-semibold text-slate-900 dark:text-slate-100">{firm.name}</div>
                      <div className="text-xs text-slate-500 dark:text-slate-400">{firm.website}</div>
                    </td>
                    <td className="px-5 py-2 text-slate-600 dark:text-slate-300">{firm.investorType}</td>
                    <td className="px-5 py-2 text-slate-600 dark:text-slate-300">{firm.focusSectors.join(", ")}</td>
                    <td className="px-5 py-2 text-slate-600 dark:text-slate-300">{firm.checkSizeRange}</td>
                    <td className="px-5 py-2">
                      <StatusPill status={firm.stage} />
                    </td>
                    <td className="px-5 py-2 text-slate-500 dark:text-slate-400">{firm.lastTouchedAt ? dayjs(firm.lastTouchedAt).format("MMM D, YYYY") : "-"}</td>
                  </tr>
                );
              })}
              {firms.length === 0 && (
                <tr>
                  <td colSpan={6} className="px-5 py-8 text-center text-slate-400 dark:text-slate-500">
                    No investors in pipeline yet.
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
