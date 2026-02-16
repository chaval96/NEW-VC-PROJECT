import { Bar, BarChart, CartesianGrid, Cell, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";

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
    <div className="card card-pad">
      <h3 className="card-title">Form Submission Funnel</h3>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(6, 1fr)", gap: 8, marginBottom: 8 }}>
        {data.map((item) => (
          <div key={item.stage} style={{ textAlign: "center" }}>
            <div style={{ fontSize: 12, color: "#5f7288" }}>{((item.value / top) * 100).toFixed(1)}%</div>
            <div style={{ fontSize: 18, fontFamily: "IBM Plex Mono, monospace" }}>{item.value}</div>
          </div>
        ))}
      </div>
      <div style={{ width: "100%", height: 280 }}>
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
    </div>
  );
}
