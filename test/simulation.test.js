import test from "node:test";
import assert from "node:assert/strict";
import { DEFAULT_CONFIG, resultsToCsv, simulateDay } from "../src/simulation.js";

test("runs a complete 24-hour dispatch", () => {
  const result = simulateDay(DEFAULT_CONFIG);
  assert.equal(result.rows.length, 24);
  assert.ok(result.metrics.generationKwh > 0);
  assert.ok(result.metrics.endSocPercent >= 20);
  assert.ok(result.metrics.selfSufficiencyPercent >= 0 && result.metrics.selfSufficiencyPercent <= 100);
});
test("protects the configured battery reserve", () => {
  const result = simulateDay({ ...DEFAULT_CONFIG, dailyLoadKwh: 18, initialSocPercent: 25 });
  assert.ok(result.metrics.endSocPercent >= DEFAULT_CONFIG.minSocPercent - 0.1);
  assert.ok(result.metrics.gridImportKwh > 0);
});
test("captures water after first flush during a rain event", () => {
  const result = simulateDay({ ...DEFAULT_CONFIG, scenario: "storm", rainMm: 20, initialWaterLitres: 0 });
  assert.ok(result.metrics.capturedWaterLitres > 0);
  assert.ok(result.metrics.endWaterLitres <= DEFAULT_CONFIG.tankCapacityLitres);
});
test("triggers cleaning only above the soiling threshold", () => {
  assert.equal(simulateDay({ ...DEFAULT_CONFIG, soilingPercent: 20, initialWaterLitres: 120 }).metrics.cleaningTriggered, true);
  assert.equal(simulateDay({ ...DEFAULT_CONFIG, soilingPercent: 8, initialWaterLitres: 120 }).metrics.cleaningTriggered, false);
});
test("exports one header and 24 hourly CSV rows", () => {
  const csv = resultsToCsv(simulateDay(DEFAULT_CONFIG));
  assert.equal(csv.trim().split("\n").length, 25);
  assert.match(csv, /^hour,solar_kw/);
});
