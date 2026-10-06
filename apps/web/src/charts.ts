import { formatAmount } from "@nzosa/core";
import type { Cents } from "@nzosa/core";

/**
 * The two charts a set of books is actually read for.
 *
 * A year of coded transactions answers two questions before any other: what
 * came in and went out each month, and where the money went. Both are already
 * in the profit and loss, and a table of thirty-one accounts is a poor way to
 * see either -- a bad month and a runaway account are shapes, and a column of
 * figures hides shapes well.
 *
 * Drawn by hand in SVG rather than by a charting library. The whole app is one
 * bundle with no runtime dependencies, which is what lets it open from a folder
 * and keeps somebody's bank data off the network, and a chart is not worth
 * giving that up for.
 *
 * The colours are the validated categorical pair rather than the green and red
 * this app uses for money in and out everywhere else. Those two fail a
 * colour-blindness check against each other -- red and green, measured rather
 * than guessed at -- which is survivable on a figure that also carries a minus
 * sign, and is not survivable when the colour is the only thing saying which
 * bar is which.
 */

const AXIS_LEFT = 76;
const AXIS_BOTTOM = 34;
const TOP_ROOM = 22;
const SVG_NS = "http://www.w3.org/2000/svg";

function svgRoot(width: number, height: number): SVGSVGElement {
  const element = document.createElementNS(SVG_NS, "svg");
  element.setAttribute("viewBox", `0 0 ${width} ${height}`);
  element.setAttribute("width", "100%");
  element.setAttribute("role", "img");
  element.classList.add("chart");
  return element;
}

function node<K extends keyof SVGElementTagNameMap>(
  name: K,
  attributes: Record<string, string | number>,
): SVGElementTagNameMap[K] {
  const element = document.createElementNS(SVG_NS, name) as SVGElementTagNameMap[K];
  for (const [key, value] of Object.entries(attributes)) {
    element.setAttribute(key, String(value));
  }
  return element;
}

/** Axis ticks a person would have chosen: 1, 2, 5 and their powers of ten. */
function niceStep(rough: number): number {
  const power = 10 ** Math.floor(Math.log10(Math.max(rough, 1)));
  const scaled = rough / power;
  const step = scaled <= 1 ? 1 : scaled <= 2 ? 2 : scaled <= 5 ? 5 : 10;
  return step * power;
}

function ticksTo(max: number, wanted = 4): { top: number; values: number[] } {
  if (max <= 0) return { top: 1, values: [0] };
  const step = niceStep(max / wanted);
  const top = Math.ceil(max / step) * step;
  const values: number[] = [];
  for (let at = 0; at <= top + step / 2; at += step) values.push(at);
  return { top, values };
}

/** Whole dollars, which is the only precision an axis can actually show. */
function short(dollars: number): string {
  const rounded = Math.round(dollars);
  return Math.abs(rounded) >= 1000
    ? `${Math.round(rounded / 1000)}k`
    : String(rounded);
}

/**
 * One tooltip, moved and refilled.
 *
 * A chart with no hover is a picture of the data rather than a way to read it:
 * the axis rounds, the direct labels are sparing by design, and the exact
 * figure still has to be somewhere that is not a second table.
 */
function hoverLayer(host: HTMLElement): (target: SVGElement, html: string) => void {
  const tip = document.createElement("div");
  tip.className = "chart-tip";
  tip.hidden = true;
  host.append(tip);

  return (target, html) => {
    target.addEventListener("mouseenter", () => {
      tip.innerHTML = html;
      tip.hidden = false;
    });
    target.addEventListener("mousemove", (event) => {
      const box = host.getBoundingClientRect();
      const at = event as MouseEvent;
      tip.style.left = `${at.clientX - box.left + 14}px`;
      tip.style.top = `${at.clientY - box.top + 14}px`;
    });
    target.addEventListener("mouseleave", () => {
      tip.hidden = true;
    });
  };
}

/** Escaped, because a payee is somebody's typing and this becomes markup. */
function safe(text: string): string {
  return text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

export interface MonthPoint {
  label: string;
  income: Cents;
  expenses: Cents;
}

/**
 * Money in and money out, month by month.
 *
 * Two series that have to be told apart, so grouped columns and the
 * categorical pair, with a legend rather than a number on every column.
 */
export function monthlyColumns(months: readonly MonthPoint[]): HTMLElement {
  const wrap = document.createElement("figure");
  wrap.className = "chart-figure";

  const width = 760;
  const height = 300;
  const chart = svgRoot(width, height);
  const plotWidth = width - AXIS_LEFT - 16;
  const plotHeight = height - AXIS_BOTTOM - TOP_ROOM;
  const baseline = TOP_ROOM + plotHeight;

  const biggest = Math.max(0, ...months.map((m) => Math.max(m.income, Math.abs(m.expenses))));
  const { top, values } = ticksTo(biggest / 100);
  const heightOf = (cents: Cents): number =>
    top === 0 ? 0 : (Math.abs(cents) / 100 / top) * plotHeight;

  for (const value of values) {
    const at = baseline - (value / top) * plotHeight;
    chart.append(
      node("line", { x1: AXIS_LEFT, y1: at, x2: AXIS_LEFT + plotWidth, y2: at, class: "chart-grid" }),
    );
    const label = node("text", {
      x: AXIS_LEFT - 10,
      y: at + 4,
      class: "chart-tick",
      "text-anchor": "end",
    });
    label.textContent = short(value);
    chart.append(label);
  }

  const band = plotWidth / Math.max(months.length, 1);
  // Capped rather than filling the band: the leftover is the air that keeps
  // one month readably apart from the next, and the 2px between the pair is
  // the surface gap that separates two touching marks.
  const barWidth = Math.max(3, Math.min(24, (band - 14) / 2));
  const showTip = hoverLayer(wrap);

  months.forEach((month, index) => {
    const middle = AXIS_LEFT + band * index + band / 2;
    const tip =
      `<strong>${safe(month.label)}</strong><br>` +
      `In ${formatAmount(month.income)}<br>` +
      `Out ${formatAmount(Math.abs(month.expenses))}<br>` +
      `Net ${formatAmount(month.income - Math.abs(month.expenses))}`;

    const pairs: readonly (readonly [Cents, string])[] = [
      [month.income, "chart-series-1"],
      [month.expenses, "chart-series-2"],
    ];
    pairs.forEach(([amount, className], side) => {
      const tall = heightOf(amount);
      if (tall <= 0) return;
      const x = middle - barWidth - 1 + side * (barWidth + 2);
      const bar = node("path", {
        d: roundedTop(x, baseline - tall, barWidth, tall, 4),
        class: className,
      });
      chart.append(bar);
      showTip(bar, tip);
    });

    const label = node("text", {
      x: middle,
      y: baseline + 20,
      class: "chart-tick",
      "text-anchor": "middle",
    });
    label.textContent = month.label;
    chart.append(label);
  });

  chart.append(
    node("line", {
      x1: AXIS_LEFT,
      y1: baseline,
      x2: AXIS_LEFT + plotWidth,
      y2: baseline,
      class: "chart-axis",
    }),
  );

  wrap.append(
    legend([
      ["chart-series-1", "Money in"],
      ["chart-series-2", "Money out"],
    ]),
    chart,
  );
  return wrap;
}

/** A column with its data end rounded and its foot square on the baseline. */
function roundedTop(x: number, y: number, width: number, height: number, radius: number): string {
  const r = Math.max(0, Math.min(radius, width / 2, height));
  return (
    `M ${x} ${y + height} L ${x} ${y + r} Q ${x} ${y} ${x + r} ${y} ` +
    `L ${x + width - r} ${y} Q ${x + width} ${y} ${x + width} ${y + r} ` +
    `L ${x + width} ${y + height} Z`
  );
}

/** A bar with its data end rounded and its foot square on the baseline. */
function roundedEnd(x: number, y: number, width: number, height: number, radius: number): string {
  if (width <= 0) return "";
  const r = Math.max(0, Math.min(radius, width, height / 2));
  return (
    `M ${x} ${y} L ${x + width - r} ${y} Q ${x + width} ${y} ${x + width} ${y + r} ` +
    `L ${x + width} ${y + height - r} Q ${x + width} ${y + height} ${x + width - r} ${y + height} ` +
    `L ${x} ${y + height} Z`
  );
}

function legend(items: readonly (readonly [string, string])[]): HTMLElement {
  const box = document.createElement("div");
  box.className = "chart-legend";
  for (const [className, label] of items) {
    const item = document.createElement("span");
    item.className = "chart-legend-item";
    const swatch = document.createElement("span");
    swatch.className = `chart-swatch ${className}`;
    item.append(swatch, document.createTextNode(label));
    box.append(item);
  }
  return box;
}

export interface RankedItem {
  label: string;
  value: Cents;
}

/**
 * Where the money went: the accounts that took the most of it.
 *
 * One series, so one colour. Length already carries the magnitude, and shading
 * each bar by its own size would spend the only free channel restating what
 * the chart has already said. No legend either: with one colour, the heading
 * above it is the legend.
 */
export function rankedBars(items: readonly RankedItem[]): HTMLElement {
  const wrap = document.createElement("figure");
  wrap.className = "chart-figure";
  if (items.length === 0) return wrap;

  const rowHeight = 30;
  const width = 760;
  const chart = svgRoot(width, items.length * rowHeight + 16);
  const labelRoom = 250;
  const valueRoom = 96;
  const plotWidth = width - labelRoom - valueRoom;
  const biggest = Math.max(...items.map((i) => Math.abs(i.value)));
  const showTip = hoverLayer(wrap);

  items.forEach((item, index) => {
    const y = index * rowHeight + 8;
    const long = biggest === 0 ? 0 : (Math.abs(item.value) / biggest) * plotWidth;

    const name = node("text", {
      x: labelRoom - 12,
      y: y + 15,
      class: "chart-name",
      "text-anchor": "end",
    });
    // Measured against the room there is rather than clipped by it.
    name.textContent = item.label.length > 32 ? `${item.label.slice(0, 31)}…` : item.label;
    chart.append(name);

    const bar = node("path", { d: roundedEnd(labelRoom, y + 2, long, 16, 4), class: "chart-series-1" });
    chart.append(bar);
    showTip(bar, `<strong>${safe(item.label)}</strong><br>${formatAmount(Math.abs(item.value))}`);

    // At the tip: where a bar's value goes, and where its own mark cannot clip it.
    const value = node("text", { x: labelRoom + long + 10, y: y + 15, class: "chart-value" });
    value.textContent = formatAmount(Math.abs(item.value));
    chart.append(value);
  });

  wrap.append(chart);
  return wrap;
}

/**
 * The headline figures, which are not a chart.
 *
 * Three numbers do not need three bars: a bar chart of income, expenses and
 * net is a picture of something a person reads faster as three numbers.
 */
export function statTiles(
  tiles: readonly { label: string; value: Cents; note?: string }[],
): HTMLElement {
  const row = document.createElement("div");
  row.className = "chart-tiles";
  for (const tile of tiles) {
    const box = document.createElement("div");
    box.className = "chart-tile";
    const label = document.createElement("span");
    label.className = "chart-tile-label";
    label.textContent = tile.label;
    const value = document.createElement("strong");
    value.className = "chart-tile-value";
    value.textContent = formatAmount(tile.value);
    box.append(label, value);
    if (tile.note !== undefined) {
      const note = document.createElement("span");
      note.className = "chart-tile-note";
      note.textContent = tile.note;
      box.append(note);
    }
    row.append(box);
  }
  return row;
}
