import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { test } from "node:test";
import ts from "typescript";

// Load only the pure validator and static catalog. No page, API client, database,
// or device operation is imported or invoked by these tests.
async function loadPureTypeScript(path) {
  const sourceUrl = new URL(path, import.meta.url);
  const source = await readFile(sourceUrl, "utf8");
  const javascript = ts.transpileModule(source, {
    compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 },
    fileName: sourceUrl.pathname,
  }).outputText;
  return import(`data:text/javascript;base64,${Buffer.from(javascript).toString("base64")}`);
}

const { validateGateConfig } = await loadPureTypeScript("../src/app/lib/electronicGateValidation.ts");
const { GATE_DEFINITIONS } = await loadPureTypeScript("../apps/api/src/modules/electronic-gate/electronic-gate.catalog.ts");

function fixture(id, values = {}) {
  const definition = GATE_DEFINITIONS.find(item => item.id === id);
  assert.ok(definition, `Expected catalog item ${id}`);
  const item = { ...definition, draft: null, active: null, revision: 0, updatedAt: null, updatedBy: null, publishedAt: null };
  const config = {
    ...structuredClone(definition.defaults),
    model: "TEST-MODEL",
    market: "TEST-MARKET",
    values: { ...definition.defaults.values, evidence: "Pure validation test fixture", ...values },
  };
  return { item, config };
}

test("incomplete drafts can be saved while validation prevents publication", () => {
  const { item } = fixture("default-sensitivity");
  const incomplete = structuredClone(item.defaults);
  assert.deepEqual(validateGateConfig(item, incomplete), {});
  const errors = validateGateConfig(item, incomplete, true);
  assert.deepEqual(Object.keys(errors).sort(), ["evidence", "market", "model", "readbackSource"]);
});

test("complete valid configuration passes validation without changing input", () => {
  const { item, config } = fixture("default-sensitivity", { operator: "equals", expected: " 3 ", readbackSource: "TEST-READBACK" });
  const snapshot = structuredClone(config);
  Object.freeze(config.values);
  Object.freeze(config);
  assert.deepEqual(validateGateConfig(item, config), {});
  assert.deepEqual(validateGateConfig(item, config, true), {});
  assert.deepEqual(config, snapshot);
});

test("display name is required for drafts and publication", () => {
  const { item, config } = fixture("response-timeout", { timeoutMs: "1500" });
  config.displayName = "   ";
  assert.ok(validateGateConfig(item, config).displayName);
  assert.ok(validateGateConfig(item, config, true).displayName);
});

test("invalid number formats fail before saving a draft", () => {
  for (const timeoutMs of ["NaN", "Infinity", "1e3", "0x10", "3.", "1,5", "100 ms", "9".repeat(400)]) {
    const { item, config } = fixture("response-timeout", { timeoutMs });
    assert.equal(validateGateConfig(item, config).timeoutMs, "请输入有效数字", timeoutMs);
  }
});

test("grade and millisecond timeout require safe integers", () => {
  for (const [id, key] of [["default-sensitivity", "expected"], ["response-timeout", "timeoutMs"]]) {
    for (const value of ["1.5", "9007199254740992"]) {
      const { item, config } = fixture(id, { [key]: value });
      assert.equal(validateGateConfig(item, config)[key], "请输入有效整数", `${id}: ${value}`);
    }
  }
});

test("signed micropressure and temperature ranges accept negative lower and upper bounds", () => {
  const values = { operator: "range", minimum: "-10.5", maximum: "-2", boundary: "inclusive", readbackSource: "TEST-READBACK", measurementUnit: "TEST-UNIT" };
  for (const id of ["v-pressure", "internal-temperature", "v-pressure-temperature"]) {
    const { item, config } = fixture(id, values);
    assert.deepEqual(validateGateConfig(item, config), {}, id);
    assert.deepEqual(validateGateConfig(item, config, true), {}, id);
    config.values.maximum = "10.5";
    assert.deepEqual(validateGateConfig(item, config, true), {}, `${id}: zero crossing`);
  }
});

test("negative permission is explicit metadata and does not depend on a unit label", () => {
  const { item, config } = fixture("v-pressure", { minimum: "-10", maximum: "-2" });
  const renamedUnit = structuredClone(item);
  for (const field of renamedUnit.fields) if (field.type === "number") field.unit = "待确认";
  assert.deepEqual(validateGateConfig(renamedUnit, config), {});
  const unsigned = structuredClone(item);
  for (const field of unsigned.fields) { delete field.allowNegative; field.unit = "°C"; }
  assert.equal(validateGateConfig(unsigned, config).minimum, "不能填写负数");
  assert.equal(validateGateConfig(unsigned, config).maximum, "不能填写负数");
  assert.deepEqual(GATE_DEFINITIONS.flatMap(definition => definition.fields.filter(field => field.allowNegative).map(field => `${definition.id}.${field.key}`)).sort(), [
    "internal-temperature.maximum", "internal-temperature.minimum", "v-pressure-temperature.maximum", "v-pressure-temperature.minimum", "v-pressure.maximum", "v-pressure.minimum",
  ].sort());
});

test("absolute pressure, speed, counts, grades and duration still reject negative values", () => {
  for (const [id, key] of [["startup-pressure", "minimum"], ["sensor-pressure", "minimum"], ["compressor-speed", "minimum"], ["built-in-parameters", "time310"], ["total-usage", "maximum"], ["button-volume", "expected"], ["default-sensitivity", "expected"], ["compressor-recovery", "observationMs"]]) {
    const { item, config } = fixture(id, { [key]: "-1" });
    assert.equal(validateGateConfig(item, config)[key], "不能填写负数", id);
    assert.equal(validateGateConfig(item, config, true)[key], "不能填写负数", `${id}: publish`);
  }
});

test("signed ranges retain order and open-boundary validation without invented thresholds", () => {
  const { item, config } = fixture("v-pressure", { operator: "range", minimum: "-2", maximum: "-10", boundary: "inclusive", readbackSource: "TEST-READBACK", measurementUnit: "TEST-UNIT" });
  assert.equal(validateGateConfig(item, config, true).maximum, "上限不能小于下限");
  config.values.minimum = "-10";
  config.values.boundary = "exclusive";
  assert.deepEqual(validateGateConfig(item, config), {});
  assert.equal(validateGateConfig(item, config, true).maximum, "不包含上下限时，上限必须大于下限");
  assert.equal(item.defaults.values.minimum, "");
  assert.equal(item.defaults.values.maximum, "");
  assert.equal(item.defaults.values.measurementUnit, "");
  assert.equal(item.defaults.values.readbackSource, "");
  for (const field of item.fields.filter(field => field.type === "number")) {
    assert.equal(field.min, undefined);
    assert.equal(field.max, undefined);
  }
});

test("timing windows must be positive but retry seconds may be fractional", () => {
  for (const [id, key] of [["response-timeout", "timeoutMs"], ["retry-delay", "retrySeconds"], ["compressor-recovery", "observationMs"]]) {
    const { item, config } = fixture(id, { [key]: "0" });
    assert.equal(validateGateConfig(item, config)[key], "必须大于 0", id);
  }
  const retry = fixture("retry-delay", { retrySeconds: "1.5" });
  assert.deepEqual(validateGateConfig(retry.item, retry.config, true), {});
});

test("reversed bounds fail for drafts as well as publication", () => {
  const { item, config } = fixture("startup-pressure", { operator: "range", minimum: "110", maximum: "90", boundary: "inclusive", readbackSource: "TEST-READBACK" });
  assert.equal(validateGateConfig(item, config).maximum, "上限不能小于下限");
  assert.equal(validateGateConfig(item, config, true).maximum, "上限不能小于下限");
});

test("an empty open interval can remain a draft but cannot pass publication validation", () => {
  const { item, config } = fixture("startup-pressure", { operator: "range", minimum: "100", maximum: "100", boundary: "exclusive", readbackSource: "TEST-READBACK" });
  assert.deepEqual(validateGateConfig(item, config), {});
  assert.equal(validateGateConfig(item, config, true).maximum, "不包含上下限时，上限必须大于下限");
  config.values.boundary = "inclusive";
  assert.deepEqual(validateGateConfig(item, config, true), {});
  config.values.boundary = "exclusive";
  config.values.maximum = "101";
  assert.deepEqual(validateGateConfig(item, config, true), {});
});

test("fixed serial port requires a name at publication, automatic discovery does not", () => {
  const { item, config } = fixture("serial-port", { mode: "fixed", port: "  " });
  assert.deepEqual(validateGateConfig(item, config), {});
  assert.equal(validateGateConfig(item, config, true).port, "固定串口模式下请填写串口名称");
  config.values.port = "COM3";
  assert.deepEqual(validateGateConfig(item, config, true), {});
  config.values.mode = "auto";
  config.values.port = "";
  assert.deepEqual(validateGateConfig(item, config, true), {});
});

test("selection values must be supported by that catalog item", () => {
  const { item, config } = fixture("default-sensitivity", { operator: "range", expected: "3", readbackSource: "TEST-READBACK" });
  assert.equal(validateGateConfig(item, config).operator, "请选择有效选项");
  assert.equal(validateGateConfig(item, config, true).operator, "请选择有效选项");
});


test("serial field constraints match the Windows ranges and millisecond precision", () => {
  for (const [id, key, invalid, valid] of [
    ["baud-rate", "baudRate", ["299", "3000001", "9600.5"], ["300", "115200", "3000000"]],
    ["response-timeout", "timeoutMs", ["99", "10001"], ["100", "10000"]],
    ["scan-interval", "scanIntervalMs", ["249", "60001", "300.1"], ["250", "60000"]],
    ["retry-delay", "retrySeconds", ["0.5", "300.001", "1.0001"], ["1", "1.001", "300"]],
  ]) {
    for (const value of invalid) {
      const { item, config } = fixture(id, { [key]: value });
      assert.ok(validateGateConfig(item, config)[key], `${id}: ${value}`);
    }
    for (const value of valid) {
      const { item, config } = fixture(id, { [key]: value });
      config.model = ""; config.market = ""; config.values.evidence = "";
      assert.deepEqual(validateGateConfig(item, config, true), {}, `${id}: ${value}`);
    }
  }
});

test("all 12 serial parameters are independent and do not require business scope", () => {
  const serialItems = GATE_DEFINITIONS.filter(item => item.category === "connection");
  assert.equal(serialItems.length, 12);
  for (const definition of serialItems) {
    const { item } = fixture(definition.id);
    assert.deepEqual(validateGateConfig(item, structuredClone(definition.defaults), true), {}, definition.id);
  }
  for (const port of ["COM0", "COM-TEST", "../COM3", "COM12345678901234"]) {
    const { item, config } = fixture("serial-port", { mode: "fixed", port });
    assert.ok(validateGateConfig(item, config).port, port);
  }
});
