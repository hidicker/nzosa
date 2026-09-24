import type { GstReturnLine, GstReturnResult } from "./gst.js";
import type { Cents } from "./money.js";
import { gstWithin } from "./reports.js";

/**
 * A GST return as a report: the boxes, and the transactions behind them.
 *
 * Set out the way Xero presents a return and the command line prints one, so
 * a return here can be read beside one filed there without translating: the
 * boxes in order, then the transactions grouped by tax rate, expenses shown as
 * positive amounts under their own heading.
 */

export type GstRateGroup =
  | "15% GST on Income"
  | "Zero Rated"
  | "15% GST on Expenses"
  | "GST on Imports"
  | "No GST";

const GROUP_ORDER: readonly GstRateGroup[] = [
  "15% GST on Income",
  "Zero Rated",
  "15% GST on Expenses",
  "GST on Imports",
  "No GST",
];

/** Which rate a line of the return is grouped under. */
export function gstRateGroup(line: Pick<GstReturnLine, "classification">): GstRateGroup {
  const { classification } = line;
  if (classification.side === "imports") return "GST on Imports";
  if (classification.treatment === "zero-rated") return "Zero Rated";
  if (classification.treatment !== "standard") return "No GST";
  return classification.side === "sales" ? "15% GST on Income" : "15% GST on Expenses";
}

export interface GstTransactionRow {
  date: string;
  contact: string;
  description: string;
  /** Positive under every heading: an expense is shown as what was spent. */
  gross: Cents;
  gst: Cents;
  net: Cents;
  transactionId: string;
}

export interface GstTransactionGroup {
  group: GstRateGroup;
  rows: GstTransactionRow[];
  gross: Cents;
  gst: Cents;
  net: Cents;
}

/** Lines of a return grouped by rate, in the order a return lists them. */
export function gstTransactionGroups(lines: readonly GstReturnLine[]): GstTransactionGroup[] {
  const byGroup = new Map<GstRateGroup, GstTransactionRow[]>();
  for (const line of lines) {
    const group = gstRateGroup(line);
    // Money out is shown as a positive amount under an expense heading, so the
    // sign is carried by the heading rather than repeated on every row.
    const outwards = line.classification.side === "purchases" || line.classification.side === "imports";
    const gross = outwards ? -line.amount : line.amount;
    const tax =
      line.classification.side === "imports"
        ? gross
        : Math.abs(gstWithin(line.amount, line.classification)) * Math.sign(gross);
    const t = line.transaction;
    const row: GstTransactionRow = {
      date: t.date,
      contact: t.otherParty || "",
      description: [t.particulars, t.reference].filter((part) => part !== undefined && part !== "").join(" "),
      gross,
      gst: tax,
      net: gross - tax,
      transactionId: t.id,
    };
    const rows = byGroup.get(group);
    if (rows) rows.push(row);
    else byGroup.set(group, [row]);
  }
  return GROUP_ORDER.filter((group) => byGroup.has(group)).map((group) => {
    const rows = [...(byGroup.get(group) ?? [])].sort((a, b) => a.date.localeCompare(b.date));
    return {
      group,
      rows,
      gross: rows.reduce((sum, r) => sum + r.gross, 0),
      gst: rows.reduce((sum, r) => sum + r.gst, 0),
      net: rows.reduce((sum, r) => sum + r.net, 0),
    };
  });
}

/** What Box 15 says, in words. */
export function gstOutcomeLabel(result: Pick<GstReturnResult, "boxes">): string {
  if (result.boxes.outcome === "refund") return "GST refund";
  if (result.boxes.outcome === "nil") return "Nothing to pay";
  return "GST to pay";
}

/** The boxes of a return, in the form's order and wording. */
export function gstReturnBoxRows(result: Pick<GstReturnResult, "boxes">): { box: string; label: string; amount: Cents; section: "sales" | "purchases" }[] {
  const b = result.boxes;
  return [
    { box: "Box 5", label: "Total sales and income", amount: b.box5, section: "sales" },
    { box: "Box 6", label: "Zero-rated supplies", amount: b.box6, section: "sales" },
    { box: "Box 7", label: "Net GST sales and income", amount: b.box7, section: "sales" },
    { box: "Box 8", label: "Total GST collected on sales and income", amount: b.box8, section: "sales" },
    { box: "Box 9", label: "Any debit adjustments", amount: b.box9, section: "sales" },
    { box: "Box 10", label: "Total GST collected for the period", amount: b.box10, section: "sales" },
    { box: "Box 11", label: "Total purchases and expenses", amount: b.box11, section: "purchases" },
    { box: "Box 12", label: "Total GST credits on purchases and expenses", amount: b.box12, section: "purchases" },
    { box: "Box 13", label: "Any credit adjustments", amount: b.box13, section: "purchases" },
    { box: "Box 14", label: "Total GST credit", amount: b.box14, section: "purchases" },
    { box: "Box 15", label: gstOutcomeLabel(result), amount: b.box15, section: "purchases" },
  ];
}

/** A return, its boxes and its transactions, as CSV. */
export function formatGstReturn(result: GstReturnResult, title: string): string {
  const money = (cents: Cents): string => (cents / 100).toFixed(2);
  const rows: string[][] = [
    [title],
    [
      `For the period ${result.period.from} to ${result.period.to}`,
      // The due date the law names, and -- where it falls on a weekend or a
      // holiday -- the working day it can still be paid on.
      result.period.payBy !== undefined && result.period.payBy !== result.period.due
        ? `Due ${result.period.due} (a weekend or public holiday: pay by ${result.period.payBy})`
        : `Due ${result.period.due}`,
    ],
    [`${result.basis.charAt(0).toUpperCase()}${result.basis.slice(1)} basis`],
    [gstOutcomeLabel(result), money(result.boxes.box15)],
    [],
    ["Box", "Description", "Amount"],
    ...gstReturnBoxRows(result).map((r) => [r.box, r.label, money(r.amount)]),
    [],
    ["Transactions"],
  ];
  const groups = [
    ...gstTransactionGroups(result.lines).map((g) => ({ ...g, heading: g.group as string })),
    ...(result.lateClaims.length > 0
      ? gstTransactionGroups(result.lateClaims).map((g) => ({ ...g, heading: `Late claims: ${g.group}` }))
      : []),
  ];
  for (const group of groups) {
    rows.push([]);
    rows.push([group.heading]);
    rows.push(["Date", "Contact", "Description", "Gross", "GST", "Net"]);
    for (const row of group.rows) {
      rows.push([row.date, row.contact, row.description, money(row.gross), money(row.gst), money(row.net)]);
    }
    rows.push(["Total", "", "", money(group.gross), money(group.gst), money(group.net)]);
  }
  return (
    rows
      .map((row) => row.map((cell) => (/[",\r\n]/.test(cell) ? `"${cell.replace(/"/g, '""')}"` : cell)).join(","))
      .join("\r\n") + "\r\n"
  );
}
