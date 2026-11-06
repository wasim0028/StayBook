"use client";

import { Download } from "lucide-react";
import { Button } from "@/components/ui";
import { isMoney, METRIC_FIELDS, METRIC_LABEL, type Metrics } from "@/lib/admin-types";

/** Daily numbers as CSV for spreadsheets. Money in rupees (two decimals), not paise. */
export function CsvButton({ metrics }: { metrics: Metrics }) {
  function download() {
    const head = ["Date", ...METRIC_FIELDS.map((f) => (isMoney(f) ? `${METRIC_LABEL[f]} (INR)` : METRIC_LABEL[f]))];
    const rows = metrics.days.map((d) => [d.day, ...METRIC_FIELDS.map((f) => (isMoney(f) ? (d[f] / 100).toFixed(2) : String(d[f])))]);
    const csv = [head, ...rows].map((r) => r.map((c) => (/[",\n]/.test(c) ? `"${c.replace(/"/g, '""')}"` : c)).join(",")).join("\n");
    const url = URL.createObjectURL(new Blob([csv], { type: "text/csv;charset=utf-8" }));
    const a = document.createElement("a");
    a.href = url;
    a.download = `staybook-metrics-${metrics.from}-to-${metrics.to}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  }
  return (
    <Button variant="outline" size="sm" onClick={download}>
      <Download className="size-4" /> CSV
    </Button>
  );
}
