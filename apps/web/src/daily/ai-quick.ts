import { aiAsk, aiRoute } from "../ai-backend.js";
import { reviewFacts } from "../ai-review.js";
import { note } from "../ui.js";
import { taxYearEndSaid } from "../tax-year.js";

/**
 * Questions asked in one press, beside the review: each the same year's
 * figures the review reads, with one question in front of them. With a key of
 * the books' own, asked and answered here; otherwise copied, to paste into an
 * assistant somebody already has.
 */

export const QUICK_ANALYSES: readonly { title: string; ask: string }[] = [
  {
    title: "Explain the year",
    ask: "In plain words for the owner, explain this year's result: what earned the money, what the biggest costs were, and what changed most. Keep it to a short page.",
  },
  {
    title: "Unusual figures",
    ask: "Which account totals look unusual for a business like this -- too large, too small, or in an account they do not belong in? List each with the reason, most important first.",
  },
  {
    title: "Deductions to check",
    ask: "Which deductions here need records kept or an apportionment worked out (home office, vehicle, entertainment, mixed-use assets)? Say what record each one needs.",
  },
  {
    title: "Likely missing",
    ask: "What would normally be in the books of a business like this that is not here -- costs, income, accruals, depreciation, a GST adjustment? List what to look for.",
  },
  {
    title: "GST risks",
    ask: "Looking at the GST registrations and the GST figures, where could the returns be wrong? Name each risk and how to check it.",
  },
  {
    title: "Cash and paying",
    ask: "From the invoices and the totals, how is the business doing at being paid and paying its bills? Suggest two or three practical steps.",
  },
  {
    title: "Questions for the accountant",
    ask: "Write the questions an accountant would ask the owner before finishing this year's accounts, grouped by topic, each one short.",
  },
  {
    title: "Ways to save tax",
    ask: "Within New Zealand rules, what legitimate ways might this business lower its tax for the year (timing, deductions it may be missing, provisional tax)? Say what each depends on; do not overstate.",
  },
];

function promptFor(ask: string, year: number): string {
  return [
    ask,
    "",
    `The books' figures for the year ended ${taxYearEndSaid(year)}:`,
    "",
    ...reviewFacts(year),
    "",
    "Answer from these figures. Where something cannot be told from them, say so rather than guess.",
  ].join("\n");
}

export function quickAnalysesPanel(pickYear: HTMLSelectElement): HTMLElement {
  const wrap = document.createElement("div");
  wrap.className = "ai-carry";
  const direct = aiRoute() === "folder" || aiRoute() === "cloud";
  wrap.append(
    note(
      direct
        ? "Each asks one question about the year's figures, with these books' own key, and shows the answer here."
        : "Each copies one question with the year's figures, to paste into an assistant you already use.",
    ),
  );
  const said = document.createElement("p");
  said.className = "cloud-said";
  const answer = document.createElement("pre");
  answer.className = "ai-prompt";
  answer.hidden = true;
  const row = document.createElement("div");
  row.className = "migration-actions";
  for (const one of QUICK_ANALYSES) {
    const b = document.createElement("button");
    b.type = "button";
    b.textContent = one.title;
    b.title = one.ask;
    b.addEventListener("click", () => {
      const prompt = promptFor(one.ask, Number(pickYear.value));
      if (!direct) {
        void navigator.clipboard.writeText(prompt).then(
          () => {
            answer.hidden = true;
            said.textContent = `Copied "${one.title}" with the year's figures. Paste it into your assistant.`;
          },
          () => {
            answer.textContent = prompt;
            answer.hidden = false;
            said.textContent = "This browser would not let the page reach the clipboard, so here it is to copy by hand.";
          },
        );
        return;
      }
      for (const other of row.querySelectorAll("button")) other.disabled = true;
      said.textContent = `Asking: ${one.title}…`;
      answer.hidden = true;
      void aiAsk(prompt).then((got) => {
        for (const other of row.querySelectorAll("button")) other.disabled = false;
        if (got === null || got.error !== undefined || (got.text ?? "").trim() === "") {
          said.textContent = got?.error ?? "No answer came back.";
          return;
        }
        said.textContent = `${one.title}${got.demo === true ? " (answered with the shared allowance)" : ""}:`;
        answer.textContent = got.text ?? "";
        answer.hidden = false;
      });
    });
    row.append(b);
  }
  wrap.append(row, said, answer);
  return wrap;
}
