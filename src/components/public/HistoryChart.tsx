import { api } from "@/convex/_generated/api";
import { cn } from "@/lib/utils";
import { useQuery } from "convex/react";
import { format, subDays } from "date-fns";
import { Loader2 } from "lucide-react";
import { useMemo, useState } from "react";
import {
  Bar,
  CartesianGrid,
  ComposedChart,
  Line,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";

const nf = new Intl.NumberFormat("en-IN");

const RANGES = [
  { id: "7", label: "7 Days", days: 7 },
  { id: "14", label: "14 Days", days: 14 },
  { id: "30", label: "30 Days", days: 30 },
  { id: "all", label: "All", days: 0 },
] as const;

type RangeId = (typeof RANGES)[number]["id"];

export default function HistoryChart() {
  const [range, setRange] = useState<RangeId>("7");
  const days = RANGES.find((r) => r.id === range)?.days ?? 7;
  const fromKey = days > 0 ? format(subDays(new Date(), days - 1), "yyyy-MM-dd") : undefined;
  const data = useQuery(api.stats.dailySeries, { fromKey });

  const points = useMemo(
    () =>
      (data?.series ?? []).map((row) => ({
        ...row,
        label: format(
          new Date(`${row.dateKey}T00:00:00`),
          "d MMM",
        ),
      })),
    [data],
  );

  if (!data) {
    return (
      <div className="flex items-center justify-center py-10">
        <Loader2 className="size-5 animate-spin text-primary" />
      </div>
    );
  }

  if (points.length === 0) {
    return (
      <p className="rounded border border-dashed border-border px-4 py-8 text-center text-sm text-muted-foreground">
        No vaccination records for this period yet.
      </p>
    );
  }

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-1.5">
        {RANGES.map((r) => (
          <button
            key={r.id}
            type="button"
            onClick={() => setRange(r.id)}
            className={cn(
              "rounded border px-3 py-1.5 text-xs font-medium transition-colors",
              range === r.id
                ? "border-primary bg-primary text-primary-foreground"
                : "border-border bg-background text-muted-foreground hover:bg-muted",
            )}
          >
            {r.label}
          </button>
        ))}
        <span className="ml-auto text-xs text-muted-foreground">
          Period total:{" "}
          <span className="font-semibold text-foreground tabular-nums">
            {nf.format(data.total)}
          </span>
        </span>
      </div>

      <div className="h-[260px] w-full rounded-md border border-border bg-card px-1 py-3 sm:h-[320px]">
        <ResponsiveContainer width="100%" height="100%">
          <ComposedChart data={points} margin={{ top: 8, right: 8, left: -12, bottom: 0 }}>
            <CartesianGrid strokeDasharray="3 3" stroke="var(--rule-line)" />
            <XAxis
              dataKey="label"
              tick={{ fontSize: 11, fill: "var(--muted-foreground)" }}
              tickLine={false}
              axisLine={{ stroke: "var(--border)" }}
              interval="preserveStartEnd"
              minTickGap={16}
            />
            <YAxis
              tick={{ fontSize: 11, fill: "var(--muted-foreground)" }}
              tickLine={false}
              axisLine={false}
              allowDecimals={false}
              width={46}
            />
            <Tooltip
              cursor={{ fill: "oklch(0.5 0.05 257 / 0.08)" }}
              contentStyle={{
                background: "var(--card)",
                border: "1px solid var(--border)",
                borderRadius: 6,
                fontSize: 12,
                color: "var(--foreground)",
              }}
              formatter={(value: number, name: string) => [
                nf.format(value),
                name === "total" ? "Vaccinated on day" : "Cumulative",
              ]}
              labelFormatter={(label, payload) => {
                const row = payload?.[0]?.payload as
                  | { dateKey?: string; label?: string }
                  | undefined;
                return row?.dateKey
                  ? format(new Date(`${row.dateKey}T00:00:00`), "dd-MM-yyyy")
                  : String(label);
              }}
            />
            <Bar dataKey="total" name="total" fill="var(--chart-2)" radius={[3, 3, 0, 0]} maxBarSize={36} />
            <Line
              type="monotone"
              dataKey="cumulative"
              name="cumulative"
              stroke="var(--chart-1)"
              strokeWidth={2}
              dot={{ r: 2 }}
              activeDot={{ r: 4 }}
            />
          </ComposedChart>
        </ResponsiveContainer>
      </div>

      <div className="flex flex-wrap items-center gap-4 text-xs text-muted-foreground">
        <span className="inline-flex items-center gap-1.5">
          <span className="inline-block size-3 rounded-sm bg-[var(--chart-2)]" />
          Daily vaccination
        </span>
        <span className="inline-flex items-center gap-1.5">
          <span className="inline-block h-0.5 w-4 rounded bg-[var(--chart-1)]" />
          Cumulative vaccination
        </span>
      </div>
    </div>
  );
}
