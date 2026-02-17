import { CartesianGrid, Legend, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import type { OverviewResponse } from "@shared/types";

interface WeeklyTrendProps {
  data: OverviewResponse["weeklyTrend"];
}

export function WeeklyTrend({ data }: WeeklyTrendProps): JSX.Element {
  return (
    <div className="card card-pad">
      <h3 className="card-title">Weekly Form Operations Trend</h3>
      <div style={{ width: "100%", height: 280 }}>
        <ResponsiveContainer>
          <LineChart data={data} margin={{ top: 5, right: 16, left: 0, bottom: 0 }}>
            <CartesianGrid stroke="#e8eef7" />
            <XAxis dataKey="weekLabel" tick={{ fill: "#566b82", fontSize: 11 }} />
            <YAxis tick={{ fill: "#566b82", fontSize: 11 }} />
            <Tooltip />
            <Legend />
            <Line type="monotone" dataKey="attempts" stroke="#1f5fc5" strokeWidth={2} dot={{ r: 3 }} />
            <Line type="monotone" dataKey="discovered" stroke="#4c84da" strokeWidth={2} dot={{ r: 3 }} />
            <Line type="monotone" dataKey="filled" stroke="#5e8bd8" strokeWidth={2} dot={{ r: 3 }} />
            <Line type="monotone" dataKey="submitted" stroke="#279f59" strokeWidth={2} dot={{ r: 3 }} />
          </LineChart>
        </ResponsiveContainer>
      </div>
    </div>
  );
}
