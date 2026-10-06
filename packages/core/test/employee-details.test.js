import test from "node:test";
import assert from "node:assert/strict";
import { bankParts, employeeDetailsProblems, generateEmployeeDetailsCsv, isValidIrdNumber, splitName } from "../dist/index.js";

const base = {
  taxCode: "M",
  payFrequency: "weekly",
  kiwiSaverRate: 0.035,
  kiwiSaverEmployerRate: 0.035,
  esctRate: 0,
  bankAccount: "",
};

// The two employees in IR's example file (Payday Filing File Upload Specification 2026-27, 3.3.3).
const mary = {
  ...base,
  id: "mary",
  name: "Smith Mary",
  irdNumber: "123018635",
  startDate: "2019-10-15",
  details: {
    title: "Mrs",
    firstName: "Mary",
    lastName: "Smith",
    dateOfBirth: "1985-06-14",
    email: "mary.smith@company.co.nz",
    mobile: "021123456",
    address: { street: "12 Small Street", city: "Springfield", postcode: "6881" },
    kiwiSaverEligibility: "NE",
    kiwiSaverStatus: "AK",
  },
};
const brian = {
  ...base,
  id: "brian",
  name: "Hall Brian",
  irdNumber: "",
  taxCode: "M SL",
  startDate: "2019-10-15",
  bankAccount: "08-0456-0123456-25",
  details: {
    title: "Mr",
    firstName: "Brian",
    middleName: "Jack",
    lastName: "Hall",
    dateOfBirth: "1955-03-08",
    daytimePhone: "041234567",
    address: { street: "23 Tall Road", city: "Huttville", postcode: "6547" },
    kiwiSaverEligibility: "NE",
    kiwiSaverStatus: "CT",
    optedOut: true,
    optOutAccountHolder: "Brian J Hall",
    optOutSigned: "2019-10-31",
  },
};

test("IR's example file, line for line", () => {
  const lines = generateEmployeeDetailsCsv("123250265", [mary, brian]).split("\r\n");
  assert.equal(lines[0], "HED2,123250265,NZOSA_Payroll_v1.0,2");
  assert.equal(
    lines[1],
    "DED,123018635,Smith Mary,Mrs,Mary,,Smith,19850614,20191015,,NE,AK,,mary.smith@company.co.nz,NZL,021123456,,,,,NZL,,,,,,12 Small Street,,Springfield,6881,,N,,,,,,,,,",
  );
  assert.equal(lines[2], "TED,M");
  assert.equal(
    lines[3],
    "DED,000000000,Hall Brian,Mr,Brian,Jack,Hall,19550308,20191015,,NE,CT,,,,,,NZL,041234567,,NZL,,,,,,23 Tall Road,,Huttville,6547,,Y,08,0456,0123456,0025,,Brian J Hall,20191031,,",
  );
  assert.equal(lines[4], "TED,M SL");
  // Every DED line has the specification's 41 fields.
  for (const line of lines.filter((l) => l.startsWith("DED"))) assert.equal(line.split(",").length, 41);
});

test("what IR would refuse is said first", () => {
  assert.ok(isValidIrdNumber("123250265"));
  assert.deepEqual(employeeDetailsProblems("123250265", [mary]), []);
  const said = employeeDetailsProblems("123250265", [
    { ...base, id: "x", name: "Cher", irdNumber: "", details: { kiwiSaverEligibility: "NE" } },
  ]).join(" | ");
  assert.match(said, /last name/);
  assert.match(said, /start date/);
  assert.match(said, /KiwiSaver status/);
  assert.match(said, /email, a phone number or a postal address/);
  // CT cannot opt out (IR's own example shows it, but its rules refuse it).
  assert.match(employeeDetailsProblems("123250265", [brian]).join(" "), /only somebody auto-enrolled/);
  const late = { ...brian, details: { ...brian.details, kiwiSaverStatus: "AE", optOutSigned: "2020-01-31" } };
  assert.match(employeeDetailsProblems("123250265", [late]).join(" "), /more than 56 days/);
  assert.match(employeeDetailsProblems("12345", [mary]).join(" "), /employer IRD number/);
});

test("names and bank accounts are taken apart as IR wants them", () => {
  assert.deepEqual(splitName("Ana Maree Whitcombe"), { first: "Ana", middle: "Maree", last: "Whitcombe" });
  assert.deepEqual(bankParts("08-0456-0123456-25"), { bank: "08", branch: "0456", number: "0123456", suffix: "0025" });
  assert.deepEqual(bankParts("021234005679000 2".replace(" ", "")), { bank: "02", branch: "1234", number: "0056790", suffix: "0002" });
  assert.equal(bankParts("not an account"), null);
});
