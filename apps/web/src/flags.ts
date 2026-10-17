/**
 * Small flags for the books' country, drawn here rather than as emoji: flag
 * emoji show as two letters ("AU") on Windows. Each is an SVG 30 by 20,
 * simplified to read at icon size.
 */

const BLUE = "#012169";
const RED = "#C8102E";

/** A five-pointed star's points, centred on (x, y), outer radius r. */
function star(x: number, y: number, r: number): string {
  const points: string[] = [];
  for (let i = 0; i < 10; i++) {
    const radius = i % 2 === 0 ? r : r * 0.42;
    const angle = (Math.PI / 5) * i - Math.PI / 2;
    points.push(`${(x + radius * Math.cos(angle)).toFixed(2)},${(y + radius * Math.sin(angle)).toFixed(2)}`);
  }
  return points.join(" ");
}

/** The Union Jack in the top left quarter, clipped by its own nested box. */
const UNION_JACK =
  `<svg x="0" y="0" width="15" height="10" viewBox="0 0 30 20">` +
  `<rect width="30" height="20" fill="${BLUE}"/>` +
  `<path d="M0,0 30,20 M30,0 0,20" stroke="#fff" stroke-width="4"/>` +
  `<path d="M0,0 30,20 M30,0 0,20" stroke="${RED}" stroke-width="1.6"/>` +
  `<path d="M15,0v20M0,10h30" stroke="#fff" stroke-width="6"/>` +
  `<path d="M15,0v20M0,10h30" stroke="${RED}" stroke-width="3.6"/>` +
  `</svg>`;

const FLAGS: Readonly<Record<string, string>> = {
  nz:
    `<rect width="30" height="20" fill="${BLUE}"/>${UNION_JACK}` +
    [
      [22.5, 16, 2],
      [19.5, 9, 1.7],
      [22.5, 4, 1.6],
      [26, 7.5, 1.7],
    ]
      .map(([x, y, r]) => `<polygon points="${star(x!, y!, r!)}" fill="${RED}" stroke="#fff" stroke-width="0.5"/>`)
      .join(""),
  au:
    `<rect width="30" height="20" fill="${BLUE}"/>${UNION_JACK}` +
    `<polygon points="${star(7.5, 15, 2.6)}" fill="#fff"/>` +
    [
      [22.5, 16.5, 1.5],
      [19, 9, 1.4],
      [22.5, 4, 1.4],
      [26.2, 7.8, 1.4],
      [24.3, 11.2, 0.8],
    ]
      .map(([x, y, r]) => `<polygon points="${star(x!, y!, r!)}" fill="#fff"/>`)
      .join(""),
  us:
    `<rect width="30" height="20" fill="#fff"/>` +
    Array.from({ length: 7 }, (_, i) => `<rect y="${(i * 2 * 20) / 13}" width="30" height="${20 / 13}" fill="#B22234"/>`).join("") +
    `<rect width="12" height="${(7 * 20) / 13}" fill="#3C3B6E"/>` +
    Array.from({ length: 12 }, (_, i) => `<circle cx="${1.5 + (i % 4) * 3}" cy="${1.6 + Math.floor(i / 4) * 3.4}" r="0.55" fill="#fff"/>`).join(""),
  kr:
    `<rect width="30" height="20" fill="#fff"/>` +
    `<path d="M10,10 a5,5 0 0 1 10,0 a2.5,2.5 0 0 1 -5,0 a2.5,2.5 0 0 0 -5,0z" fill="#CD2E3A"/>` +
    `<path d="M10,10 a5,5 0 0 0 10,0 a2.5,2.5 0 0 1 -5,0 a2.5,2.5 0 0 0 -5,0z" fill="#0047A0"/>` +
    [
      [5, 4.5, 34],
      [25, 4.5, -34],
      [5, 15.5, -34],
      [25, 15.5, 34],
    ]
      .map(
        ([x, y, turn]) =>
          `<g transform="rotate(${turn} ${x} ${y})" fill="#000">` +
          `<rect x="${x! - 2.2}" y="${y! - 2}" width="4.4" height="0.9"/>` +
          `<rect x="${x! - 2.2}" y="${y! - 0.45}" width="4.4" height="0.9"/>` +
          `<rect x="${x! - 2.2}" y="${y! + 1.1}" width="4.4" height="0.9"/></g>`,
      )
      .join(""),
};

/** A globe, for books kept anywhere else. */
const GLOBE =
  `<circle cx="15" cy="10" r="8.5" fill="#e6eef7" stroke="#5d6b7f" stroke-width="1"/>` +
  `<path d="M6.5,10h17M15,1.5c-3.5,4.5-3.5,12.5,0,17M15,1.5c3.5,4.5,3.5,12.5,0,17" fill="none" stroke="#5d6b7f" stroke-width="0.8"/>`;

/** A country's flag as an SVG element, with its name for screen readers and on hover. */
export function flagIcon(country: string, name: string): SVGSVGElement {
  const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
  svg.setAttribute("viewBox", "0 0 30 20");
  svg.setAttribute("class", "country-flag");
  svg.setAttribute("role", "img");
  svg.setAttribute("aria-label", name);
  svg.innerHTML = `<title>${name}</title>${FLAGS[country] ?? GLOBE}`;
  return svg;
}
