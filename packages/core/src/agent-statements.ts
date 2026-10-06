import type { Cents } from "./money.js";
import type { IsoDate } from "./dates.js";
import type { ManualJournal } from "./manual-journals.js";

/**
 * A property manager's statement, and the journal it implies.
 *
 * A property manager collects the rent, pays the fees and the tradespeople out
 * of it, and passes on what is left. The bank sees only what is left. Coding
 * those payments to rent under-reports the rent and hides every deduction, and
 * the payments do not even fall in the same months as the rent they came from
 * -- March's rent is paid out on the first of April.
 *
 * So the agent is treated as what it is: somewhere the owner's money is held.
 * The agent's payments are coded to a property manager account, and the
 * statement posts what the agent did with the money -- rent collected into it,
 * fees and invoices paid out of it. What is left in the account is what the
 * agent is holding, and the statement says what that should be. When the two
 * agree, the rent, the deductions and the bank all reconcile; when they do
 * not, the difference is on the screen rather than inside a figure.
 */

export interface AgentStatementLine {
  /** The account the line belongs to, as the ledger writes it. */
  code: string;
  /** What the statement calls it: "Management fees", "Bathroom renovation". */
  description: string;
  /**
   * The amount as the statement shows it, positive.
   *
   * For a rental that is not registered for GST this includes the GST the agent
   * charged, because the owner cannot claim it back and it is part of the cost.
   */
  amount: Cents;
}

export interface AgentStatement {
  /** Stable id, so the statement can be edited and undone. */
  id: string;
  /** The rental entity the statement is for. */
  entity: string;
  /** Who manages the property, as the statement names them. */
  agent: string;
  from: IsoDate;
  to: IsoDate;
  /** The account the agent's payments to the owner are coded to. */
  heldCode: string;
  /** Owed to the owner at the start of the period, not yet paid out. */
  heldAtStart: Cents;
  /** Rent, and anything else collected from the tenant. */
  income: AgentStatementLine[];
  /** Fees, commissions and invoices the agent paid out of the rent. */
  expenses: AgentStatementLine[];
  /** What the agent paid to the owner in the period. */
  paidToOwner: Cents;
  /** Owed to the owner at the end of the period, not yet paid out. */
  heldAtEnd: Cents;
}

export interface AgentStatementTotals {
  income: Cents;
  expenses: Cents;
  /** What should be left: held at the start, plus collected, less paid out. */
  expectedHeldAtEnd: Cents;
  /** The statement's closing figure less the expected one; zero when it adds up. */
  difference: Cents;
}

export function agentStatementTotals(statement: AgentStatement): AgentStatementTotals {
  const income = statement.income.reduce((sum, line) => sum + line.amount, 0);
  const expenses = statement.expenses.reduce((sum, line) => sum + line.amount, 0);
  const expectedHeldAtEnd = statement.heldAtStart + income - expenses - statement.paidToOwner;
  return { income, expenses, expectedHeldAtEnd, difference: statement.heldAtEnd - expectedHeldAtEnd };
}

const ISO = /^\d{4}-\d{2}-\d{2}$/;

/**
 * Everything stopping a statement being posted, or an empty list.
 *
 * It has to add up. A statement that does not is either mistyped or missing a
 * line, and posting it would put the gap into the rent or the fees with
 * nothing left to find it by.
 */
export function agentStatementProblems(statement: AgentStatement): string[] {
  const problems: string[] = [];
  if (statement.entity.trim() === "") problems.push("choose the property");
  if (statement.agent.trim() === "") problems.push("say who the property manager is");
  if (!ISO.test(statement.from) || !ISO.test(statement.to)) problems.push("give the period the statement covers");
  else if (statement.from > statement.to) problems.push("the period ends before it starts");
  if (statement.heldCode.trim() === "") problems.push("choose the account the manager's payments are coded to");
  if (statement.income.length === 0 && statement.expenses.length === 0) {
    problems.push("enter the rent collected and what was paid out of it");
  }
  for (const [kind, lines] of [["income", statement.income], ["expense", statement.expenses]] as const) {
    lines.forEach((line, index) => {
      if (line.code.trim() === "") problems.push(`${kind} line ${index + 1} needs an account`);
      if (line.amount === 0) problems.push(`${kind} line ${index + 1} needs an amount`);
    });
  }
  const { difference, expectedHeldAtEnd } = agentStatementTotals(statement);
  if (difference !== 0) {
    problems.push(
      `it does not add up: held at the end should be ${(expectedHeldAtEnd / 100).toFixed(2)}, ` +
        `not ${(statement.heldAtEnd / 100).toFixed(2)}`,
    );
  }
  return problems;
}

/**
 * The journal a statement implies.
 *
 * Dated the last day of the period. Income is credited to its accounts and
 * expenses debited to theirs; the difference goes into the property manager
 * account, where the owner's payments from the bank take it out again. The
 * payments and the balances held are not in it -- the bank already carries the
 * payments, and the balances are what the account is checked against.
 */
export function agentStatementJournal(statement: AgentStatement): ManualJournal {
  const { income, expenses } = agentStatementTotals(statement);
  const lines = [
    ...statement.income.map((line) => ({ code: line.code, amount: -line.amount, description: line.description })),
    ...statement.expenses.map((line) => ({ code: line.code, amount: line.amount, description: line.description })),
  ];
  if (income !== expenses) {
    lines.push({
      code: statement.heldCode,
      amount: income - expenses,
      description: `Collected by ${statement.agent}, less paid out`,
    });
  }
  return {
    id: `agent-${statement.id}`,
    date: statement.to,
    narration: `${statement.agent} statement, ${statement.from} to ${statement.to}`,
    lines,
    source: "Property manager statement",
  };
}
