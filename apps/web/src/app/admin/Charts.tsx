"use client";

import { ColumnChart, type Point } from "@/components/admin/ColumnChart";
import { compactINR } from "@/lib/admin-format";

// Formatters are functions, so the chart wrappers live on the client side of the boundary.
export const MoneyChart = ({ title, points }: { title: string; points: Point[] }) => <ColumnChart title={title} points={points} format={compactINR} />;
export const CountChart = ({ title, points }: { title: string; points: Point[] }) => <ColumnChart title={title} points={points} format={(n) => Math.round(n).toLocaleString("en-IN")} />;
