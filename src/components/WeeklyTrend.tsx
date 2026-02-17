import { CartesianGrid, Legend, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import type { OverviewResponse } from "@shared/types";
import { Card, CardBody, CardHeader } from "./ui/Card";

interface WeeklyTrendProps {
  data: OverviewResponse["weeklyTrend"];
}

export function WeeklyTrend({ data }: WeeklyTrendProps): JSX.Element {
  return (
    <Card>
      <CardHeader>
        <h3 className="text-sm font-semibold">Weekly Form Operations Trend</h3>
      </CardHeader>
      <CardBody>
        <div className="h-[280px] w-full">
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
      </CardBody>
    </Card>
  );
}
