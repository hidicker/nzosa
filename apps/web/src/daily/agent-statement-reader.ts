import { note } from "../ui.js";
import { promptControls, sendPdfWithOwnKey } from "./ai-pdf.js";
import { agentStatementPrompt, propertyForAddress, readAgentStatements } from "@nzosa/core";
import type { Entity, ReadAgentStatement } from "@nzosa/core";

/**
 * Reading a property manager's statement with an AI, into the statement editor.
 *
 * Copy the prompt and give it with the PDF to any AI, or send the PDF from
 * here under your own key; paste the answer; then open each property's
 * statement in the editor, its lines already given accounts, to check against
 * the PDF and save. Nothing is saved from here.
 */

let pasted = "";
let reading: ReturnType<typeof readAgentStatements> | null = null;

function dollars(cents: number): string {
  return (cents / 100).toLocaleString("en-NZ", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

export function agentReaderPanel(
  rentals: readonly Entity[],
  open: (read: ReadAgentStatement, entity: Entity | null) => void,
  redraw: () => void,
): HTMLElement {
  const box = document.createElement("details");
  box.className = "agent-reader";
  box.open = reading !== null;
  const summary = document.createElement("summary");
  summary.textContent = "Read a statement with AI";
  box.append(
    summary,
    note(
      "Save the manager's statement as a PDF -- a year-end summary is best. Copy the prompt, give it " +
        "with the PDF to any AI you use, and paste its answer here. Each property's statement then " +
        "opens in the editor below with its accounts filled in, to check against the PDF and save.",
    ),
    ...promptControls(agentStatementPrompt),
  );

  const area = document.createElement("textarea");
  area.rows = 5;
  area.placeholder = "Paste the AI's answer here";
  area.value = pasted;
  area.addEventListener("input", () => {
    pasted = area.value;
  });
  const read = document.createElement("button");
  read.type = "button";
  read.textContent = "Read the answer";
  read.addEventListener("click", () => {
    reading = readAgentStatements(pasted);
    redraw();
  });
  box.append(
    area,
    read,
    sendPdfWithOwnKey({
      prompt: agentStatementPrompt,
      contains: "your name and address",
      onAnswer: (text) => {
        pasted = text;
        reading = readAgentStatements(pasted);
        redraw();
      },
    }),
  );

  if (reading === null) return box;
  if (reading.problems.length > 0) {
    const list = document.createElement("ul");
    list.className = "variance-problems";
    for (const problem of reading.problems) {
      const li = document.createElement("li");
      li.textContent = problem;
      list.append(li);
    }
    box.append(list);
  }
  for (const statement of reading.statements) {
    const entity = propertyForAddress(statement.property, rentals);
    const card = document.createElement("div");
    card.className = "journal-card";
    const collected = statement.income.reduce((s, l) => s + l.amount, 0);
    const paidOut = statement.expenses.reduce((s, l) => s + l.amount, 0);
    card.append(
      note(
        `${statement.agent || "Property manager"}: ${statement.property}, ${statement.from} to ${statement.to}. ` +
          `Collected ${dollars(collected)}, paid out ${dollars(paidOut)}, paid to you ` +
          `${dollars(statement.paidToOwner)}, held at the end ${dollars(statement.heldAtEnd)}` +
          (statement.difference === 0 ? " -- it adds up." : `, ${dollars(Math.abs(statement.difference))} out.`) +
          (entity === null ? " Choose the property in the editor: the address matched none of them, or more than one." : ""),
      ),
    );
    const use = document.createElement("button");
    use.type = "button";
    use.className = "primary";
    use.textContent = entity === null ? "Open in the editor" : `Open in the editor for ${entity.name}`;
    use.addEventListener("click", () => {
      open(statement, entity);
      reading = { ...reading!, statements: reading!.statements.filter((s) => s !== statement) };
      if (reading.statements.length === 0) {
        reading = null;
        pasted = "";
      }
    });
    card.append(use);
    box.append(card);
  }
  return box;
}
