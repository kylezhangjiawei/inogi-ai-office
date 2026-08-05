import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { test } from "node:test";
import ts from "typescript";

const sourceUrl = new URL("../src/app/lib/attendanceStatusLabels.ts", import.meta.url);
const source = await readFile(sourceUrl, "utf8");
const transpiled = ts.transpileModule(source, {
  compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 },
  fileName: sourceUrl.pathname,
}).outputText;
const moduleUrl = `data:text/javascript;base64,${Buffer.from(transpiled).toString("base64")}`;
const { attendanceSpecialStatusLabel } = await import(moduleUrl);

test("attendance export renders rest days as a dash", () => {
  assert.equal(attendanceSpecialStatusLabel("rest"), "-");
});

test("attendance export keeps the established special-status labels", () => {
  assert.deepEqual(
    ["absent", "leave", "business_trip", "holiday", "sick_leave", "compensatory_leave"]
      .map(attendanceSpecialStatusLabel),
    ["旷工", "休假", "市内出差", "放假", "病假", "调休"],
  );
});
