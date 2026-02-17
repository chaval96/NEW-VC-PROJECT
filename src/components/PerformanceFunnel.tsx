import { Bar, BarChart, CartesianGrid, Cell, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { Card, CardBody, CardHeader } from "./ui/Card";

interface PerformanceFunnelProps {
  attempts: number;
  discovered: number;
  filled: number;
  submitted: number;
  blocked: number;
  noFormFound: number;
}

const colors = ["#1f5fc5", "#376fcc", "#5e8bd8", "#279f59", "#b43535", "#b7871c"];

export function PerformanceFunnel({ attempts, discovered, filled, submitted, blocked, noFormFound }: PerformanceFunnelProps): JSX.Element {
  const data = [
    { stage: "Attempts", value: attempts },
    { stage: "Forms found", value: discovered },
    { stage: "Forms filled", value: filled },
    { stage: "Submitted", value: submitted },
    { stage: "Blocked", value: blocked },
    { stage: "No form", value: noFormFound }
  ];

  const top = attempts || 1;

  return (
    <Card>
      <CardHeader>
        <h3 className="text-sm font-semibold">Form Submission Funnel</h3>
      </CardHeader>
      <CardBody>
        <div className="mb-2 grid grid-cols-6 gap-2">
          {data.map((item) => (
            <div key={item.stage} className="text-center">
              <div className="text-xs text-slate-500 dark:text-slate-400">{((item.value / top) * 100).toFixed(1)}%</div>
              <div className="text-lg font-mono text-slate-900 dark:text-slate-100">{item.value}</div>
            </div>
          ))}
        </div>
        <div className="h-[280px] w-full">
          <ResponsiveContainer>
            <BarChart data={data} margin={{ top: 8, right: 8, left: -12, bottom: 12 }}>
              <CartesianGrid stroke="#e8eef7" vertical={false} />
              <XAxis dataKey="stage" tick={{ fill: "#566b82", fontSize: 12 }} interval={0} />
              <YAxis tick={{ fill: "#566b82", fontSize: 12 }} />
              <Tooltip formatter={(value: number) => [value.toLocaleString(), "Count"]} />
              <Bar dataKey="value" radius={[8, 8, 0, 0]}>
                {data.map((entry, index) => (
                  <Cell key={entry.stage} fill={colors[index]} />
                ))}
              </Bar>
            </BarChart>
          </ResponsiveContainer>
        </div>
      </CardBody>
    </Card>
  );
}
