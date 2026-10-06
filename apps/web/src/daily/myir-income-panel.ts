import { record } from "../books.js";
import { promptControls, sendPdfWithOwnKey } from "./ai-pdf.js";
import { state } from "../state.js";
import { savePart } from "../store.js";
import { note } from "../ui.js";
import { INCOME_HEAD, incomeRows } from "./income-rows.js";
import { MYIR_NOTE, myirIncomePrompt, myirTaxExtras, readMyirIncome } from "@nzosa/core";
import { booksLocale } from "../country.js";
import { taxYearEndSaid } from "../tax-year.js";

/**
 * Reading myIR's income details for a person's year, by way of a model.
 *
 * The same two ways in as a filed return: carry the PDF and the prompt to a
 * model somebody already uses and paste its answer here, or send the PDF from
 * here under their own key. Either way the answer has to add up to myIR's own
 * totals before it is shown, and is kept only when somebody says so -- as the
 * person's income from outside the books for that year, replacing what an
 * earlier reading of the same page put there and nothing typed by hand.
 */

let pasted = "";
let reading: ReturnType<typeof readMyirIncome> | null = null;

function dollars(cents: number): string {
  return (cents / 100).toLocaleString(booksLocale(), { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

async function keep(owner: string, year: number): Promise<void> {
  const income = reading?.income;
  if (income === undefined) return;
  const before = state.ledger.taxExtras ?? [];
  // An earlier reading for the same person and year is replaced; what was
  // typed in by hand stays, since it may be income myIR does not hold.
  const after = [
    ...before.filter((e) => !(e.owner === owner && e.year === year && (e.note ?? "").startsWith(MYIR_NOTE))),
    ...myirTaxExtras(income, owner),
  ];
  state.ledger = { ...state.ledger, taxExtras: after };
  state.persistent = await savePart(state.ledger, "taxExtras");
  await record("taxExtras", `${owner} FY${year}: income details from myIR, ${income.lines.length} lines`, before, after);
  reading = null;
  pasted = "";
}

export function myirIncomePanel(owner: string, year: number, redraw: () => void): HTMLElement {
  const wrap = document.createElement("div");
  wrap.className = "myir-income";
  wrap.append(
    note(
      "From myIR: the income Inland Revenue holds for the year -- wages, benefits and pensions, " +
        "schedular payments, interest, dividends, KiwiSaver and other PIE income, Maori " +
        "authority distributions -- payer by payer. In myIR, open the income details for the " +
        "year (“Income from myIR”) and save them as a PDF. An AI reads it: copy the " +
        "prompt, give it with the PDF to any AI you use, and paste the answer here.",
    ),
  );

  wrap.append(...promptControls(myirIncomePrompt));

  const box = document.createElement("textarea");
  box.rows = 5;
  box.placeholder = "Paste the AI's answer here";
  box.value = pasted;
  box.addEventListener("input", () => {
    pasted = box.value;
  });
  const read = document.createElement("button");
  read.type = "button";
  read.textContent = "Read the answer";
  read.addEventListener("click", () => {
    reading = readMyirIncome(pasted);
    redraw();
  });
  wrap.append(
    box,
    read,
    sendPdfWithOwnKey({
      prompt: myirIncomePrompt,
      contains: "the IRD number and name",
      onAnswer: (text) => {
        pasted = text;
        reading = readMyirIncome(pasted);
        redraw();
      },
    }),
  );

  if (reading !== null) {
    if (reading.problems.length > 0) {
      const list = document.createElement("ul");
      list.className = "variance-problems";
      for (const problem of reading.problems) {
        const li = document.createElement("li");
        li.textContent = problem;
        list.append(li);
      }
      wrap.append(note("The answer does not add up to myIR's own totals, so it is not kept. Check it against the PDF:"), list);
    }
    const income = reading.income;
    if (income !== undefined) {
      const table = document.createElement("table");
      table.className = "report-table owner-table";
      const head = document.createElement("thead");
      head.innerHTML = INCOME_HEAD;
      const tbody = document.createElement("tbody");
      incomeRows(tbody, income.lines);
      table.append(head, tbody);
      wrap.append(
        note(
          `myIR's income for ${income.from} to ${income.to}: ${dollars(income.totalIncome)} income, ` +
            `${dollars(income.totalDeductions)} deductions, and the lines add up to both.`,
        ),
        table,
      );
      if (income.year !== year) {
        wrap.append(
          note(
            `That is the year to ${taxYearEndSaid(income.year)}, and this page is on the year to 31 March ` +
              `${year}. Change the year above to keep it.`,
          ),
        );
      } else {
        const typed = (state.ledger.taxExtras ?? []).filter(
          (e) => e.owner === owner && e.year === year && !(e.note ?? "").startsWith(MYIR_NOTE),
        );
        if (typed.length > 0) {
          wrap.append(
            note(
              `${typed.length} entered by hand for this year ${typed.length === 1 ? "stays" : "stay"}. ` +
                "Remove any that these lines now cover, or the income is counted twice.",
            ),
          );
        }
        const keepIt = document.createElement("button");
        keepIt.type = "button";
        keepIt.className = "primary";
        keepIt.textContent = `Keep as ${owner}'s income for the year to ${taxYearEndSaid(year)}`;
        keepIt.addEventListener("click", () => {
          keepIt.disabled = true;
          void keep(owner, year).then(redraw);
        });
        wrap.append(keepIt);
      }
    }
  }
  return wrap;
}
