import assert from "node:assert/strict";
import test from "node:test";
import * as XLSX from "xlsx";

import { normalizeQuoteImportTiers, parseQuoteBookFile } from "../src/app/procurement/quoteBookXlsx.ts";

test("AI 识别预览沿用后端的最后档位口径且不改写识别原始数据", () => {
  const recognized = [{ minQty: 500, unitPrice: 8 }, { minQty: 0, unitPrice: 12 }, { minQty: 500, unitPrice: 7.5 }];
  const original = structuredClone(recognized);
  assert.deepEqual(normalizeQuoteImportTiers(recognized), [{ minQty: 0, unitPrice: 12 }, { minQty: 500, unitPrice: 7.5 }]);
  assert.deepEqual(recognized, original);
});

test("多轮同起订量报价只保留最后现行价，并逐轮保留被覆盖价格", async () => {
  const workbook = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(workbook, XLSX.utils.aoa_to_sheet([
    ["型号/名称", "厂家", "起订量", "单价", "币种"],
    ["减震垫", "甲厂", 3000, 9, "USD"],
    ["减震垫", "甲厂", 1000, 12, "USD"],
    ["减震垫", "甲厂", 1000, 11, "USD"],
    ["减震垫", "甲厂", 1000, 10, "USD"],
    ["减震垫", "甲厂", 3000, 9, "USD"],
  ]), "报价");
  const bytes = XLSX.write(workbook, { type: "buffer", bookType: "biff8" });
  const result = await parseQuoteBookFile(new File([bytes], "报价.xls"));

  assert.deepEqual(result.errors, []);
  assert.equal(result.items.length, 1);
  assert.equal(result.items[0].currency, "USD");
  assert.deepEqual(result.items[0].tiers, [
    { minQty: 1000, unitPrice: 10 },
    { minQty: 3000, unitPrice: 9 },
  ]);
  assert.deepEqual(result.items[0].historyPrices.map(({ minQty, unitPrice }) => ({ minQty, unitPrice })), [
    { minQty: 1000, unitPrice: 12 },
    { minQty: 1000, unitPrice: 11 },
  ]);
  assert.equal(result.warnings.length, 2);
  assert.equal(result.images.length, result.items.length);
});
