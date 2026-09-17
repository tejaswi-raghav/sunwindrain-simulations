const HOURS = Array.from({ length: 24 }, (_, hour) => hour);

export const SCENARIOS = {
  clear: { label: "Clear UAE day", description: "High irradiance, light rooftop wind, no rain", solarScale: 1, windScale: 0.9, rainScale: 0 },
  dusty: { label: "Dust event", description: "Reduced irradiance, stronger wind, elevated soiling", solarScale: 0.82, windScale: 1.35, rainScale: 0 },
  storm: { label: "Rain event", description: "Cloud-limited PV with wind and recoverable rainfall", solarScale: 0.48, windScale: 1.7, rainScale: 1 },
};

export const DEFAULT_CONFIG = {
  scenario: "clear", pvCapacityKw: 0.8, windCapacityKw: 0.4,
  batteryCapacityKwh: 3.5, minSocPercent: 20, initialSocPercent: 62,
  dailyLoadKwh: 7.2, soilingPercent: 9, rainMm: 18,
  initialWaterLitres: 120, tankCapacityLitres: 300, exportEnabled: true,
};

const LOAD_PROFILE = [0.72,0.62,0.57,0.54,0.56,0.7,1.05,1.2,0.88,0.68,0.62,0.64,0.68,0.72,0.75,0.8,0.94,1.25,1.48,1.58,1.44,1.2,0.98,0.82];
const round = (value, digits = 2) => Number(value.toFixed(digits));
const clamp = (value, min, max) => Math.min(max, Math.max(min, value));

function solarIrradiance(hour, scenario) {
  if (hour < 6 || hour > 18) return 0;
  const daylight = Math.sin(((hour - 6) / 12) * Math.PI);
  const afternoonCloud = scenario === "storm" && hour >= 13 && hour <= 17 ? 0.45 : 1;
  return clamp(daylight * afternoonCloud, 0, 1);
}

function windSpeed(hour, scenario) {
  const base = 2.35 + 0.55 * Math.sin(((hour - 11) / 24) * Math.PI * 2);
  const gust = scenario === "storm" && hour >= 13 && hour <= 18 ? 1.3 : 0;
  return Math.max(0, base * SCENARIOS[scenario].windScale + gust);
}

function windOutputKw(speed, capacity) {
  const cutIn = 2, rated = 10, cutOut = 20;
  if (speed < cutIn || speed >= cutOut) return 0;
  if (speed >= rated) return capacity;
  return capacity * clamp((speed ** 3 - cutIn ** 3) / (rated ** 3 - cutIn ** 3), 0, 1);
}

function rainAtHour(hour, totalRainMm, scenario) {
  if (scenario !== "storm") return 0;
  const distribution = { 13: 0.08, 14: 0.2, 15: 0.34, 16: 0.24, 17: 0.1, 18: 0.04 };
  return totalRainMm * (distribution[hour] || 0);
}

export function simulateDay(input = {}) {
  const config = { ...DEFAULT_CONFIG, ...input };
  const scenario = SCENARIOS[config.scenario] || SCENARIOS.clear;
  const loadTotal = LOAD_PROFILE.reduce((sum, value) => sum + value, 0);
  const usableMin = config.batteryCapacityKwh * (config.minSocPercent / 100);
  let battery = config.batteryCapacityKwh * (config.initialSocPercent / 100);
  let water = clamp(config.initialWaterLitres, 0, config.tankCapacityLitres);
  let currentSoiling = config.scenario === "dusty" ? Math.max(config.soilingPercent, 18) : config.soilingPercent;
  let firstFlushRemainingMm = config.scenario === "storm" ? 1 : 0;
  let cleaningTriggered = false, capturedWater = 0, curtailed = 0;

  const rows = HOURS.map((hour) => {
    const windMps = windSpeed(hour, config.scenario);
    let cleaningLitres = 0;
    if (!cleaningTriggered && hour === 6 && currentSoiling > 15 && water > config.tankCapacityLitres * 0.2 && windMps < 5) {
      cleaningLitres = Math.min(8, water); water -= cleaningLitres; currentSoiling = 3; cleaningTriggered = true;
    }
    const irradiance = solarIrradiance(hour, config.scenario);
    const moduleTempC = 31 + irradiance * 25;
    const temperatureFactor = clamp(1 - Math.max(0, moduleTempC - 25) * 0.004, 0.72, 1);
    const solarKw = config.pvCapacityKw * irradiance * scenario.solarScale * temperatureFactor * (1 - currentSoiling / 100);
    const windKw = windOutputKw(windMps, config.windCapacityKw);
    const generationKw = solarKw + windKw;
    const loadKw = config.dailyLoadKwh * (LOAD_PROFILE[hour] / loadTotal);
    let gridImportKwh = 0, gridExportKwh = 0, batteryFlowKwh = 0;
    const netKwh = generationKw - loadKw;
    if (netKwh >= 0) {
      const room = config.batteryCapacityKwh - battery;
      const chargeInput = Math.min(netKwh, 1.5, room / 0.95);
      battery += chargeInput * 0.95; batteryFlowKwh = chargeInput;
      const remainder = netKwh - chargeInput;
      if (config.exportEnabled) gridExportKwh = remainder; else curtailed += remainder;
    } else {
      const deficit = -netKwh;
      const availableOutput = Math.max(0, (battery - usableMin) * 0.94);
      const dischargeOutput = Math.min(deficit, 1.5, availableOutput);
      battery -= dischargeOutput / 0.94; batteryFlowKwh = -dischargeOutput; gridImportKwh = deficit - dischargeOutput;
    }
    const rainMm = rainAtHour(hour, config.rainMm * scenario.rainScale, config.scenario);
    const divertedMm = Math.min(rainMm, firstFlushRemainingMm); firstFlushRemainingMm -= divertedMm;
    const captureAreaM2 = config.pvCapacityKw * 1000 / 215;
    const captured = Math.max(0, rainMm - divertedMm) * captureAreaM2 * 0.85;
    const accepted = Math.min(captured, config.tankCapacityLitres - water);
    water += accepted; capturedWater += accepted;
    return {
      hour, solarKw: round(solarKw,3), windKw: round(windKw,3), generationKw: round(generationKw,3), loadKw: round(loadKw,3),
      batteryKwh: round(battery,3), socPercent: round((battery/config.batteryCapacityKwh)*100,1), gridImportKwh: round(gridImportKwh,3),
      gridExportKwh: round(gridExportKwh,3), batteryFlowKwh: round(batteryFlowKwh,3), windMps: round(windMps,2), rainMm: round(rainMm,2),
      waterLitres: round(water,1), soilingPercent: round(currentSoiling,1), cleaningLitres,
    };
  });
  const sum = (key) => rows.reduce((total,row) => total + row[key], 0);
  const generation = sum("generationKw"), load = sum("loadKw"), gridImport = sum("gridImportKwh"), gridExport = sum("gridExportKwh");
  const renewableUsed = Math.max(0, generation - gridExport - curtailed);
  return { config, rows, metrics: {
    generationKwh: round(generation), solarKwh: round(sum("solarKw")), windKwh: round(sum("windKw")), loadKwh: round(load),
    gridImportKwh: round(gridImport), gridExportKwh: round(gridExport), endSocPercent: round((battery/config.batteryCapacityKwh)*100,1),
    selfSufficiencyPercent: round((load ? clamp((load-gridImport)/load,0,1) : 1)*100,1),
    selfConsumptionPercent: round((generation ? clamp(renewableUsed/generation,0,1) : 0)*100,1), capturedWaterLitres: round(capturedWater,1),
    endWaterLitres: round(water,1), cleaningTriggered, cleaningWaterLitres: cleaningTriggered ? 8 : 0, curtailmentKwh: round(curtailed),
  }};
}

export function compareScenarios(config = {}) { return Object.keys(SCENARIOS).map((scenario) => simulateDay({ ...config, scenario })); }

const WEATHER_WEIGHTS = { clear: 0.65, dusty: 0.25, storm: 0.1 };

export function estimateCapexAed(config) {
  return round(5800 + config.pvCapacityKw * 4250 + config.windCapacityKw * 7000 + config.batteryCapacityKwh * 1286, 0);
}

export function evaluateDesign(input = {}) {
  const config = { ...DEFAULT_CONFIG, ...input };
  const weighted = { selfSufficiencyPercent: 0, selfConsumptionPercent: 0, gridImportKwh: 0, generationKwh: 0, curtailmentKwh: 0 };
  Object.keys(WEATHER_WEIGHTS).forEach((scenario) => {
    const metrics = simulateDay({ ...config, scenario }).metrics;
    const weight = WEATHER_WEIGHTS[scenario];
    Object.keys(weighted).forEach((key) => { weighted[key] += metrics[key] * weight; });
  });
  Object.keys(weighted).forEach((key) => { weighted[key] = round(weighted[key], 1); });
  return {
    config,
    metrics: weighted,
    capexAed: estimateCapexAed(config),
    annualGridCostAed: round(weighted.gridImportKwh * 365 * 0.38, 0),
  };
}

export function optimizeDesign(input = {}, goal = "balanced") {
  const config = { ...DEFAULT_CONFIG, ...input };
  const candidates = [];
  for (let pv = 0.6; pv <= 2.01; pv += 0.2) {
    for (let wind = 0; wind <= 1.01; wind += 0.2) {
      for (let battery = 2; battery <= 8.01; battery += 1) {
        const design = evaluateDesign({ ...config, pvCapacityKw: round(pv, 1), windCapacityKw: round(wind, 1), batteryCapacityKwh: battery });
        const m = design.metrics;
        const tenYearEnergyCost = design.annualGridCostAed * 10;
        if (goal === "autonomy") design.score = m.selfSufficiencyPercent * 100 - design.capexAed / 100 - m.curtailmentKwh * 8;
        else if (goal === "cost") design.score = -(design.capexAed + tenYearEnergyCost);
        else design.score = m.selfSufficiencyPercent * 1.2 + m.selfConsumptionPercent * 0.25 - design.capexAed / 700 - m.curtailmentKwh * 2;
        candidates.push(design);
      }
    }
  }
  candidates.sort((a, b) => b.score - a.score);
  const recommended = candidates[0];
  return { goal, baseline: evaluateDesign(config), recommended, evaluatedDesigns: candidates.length };
}

export function resultsToCsv(result) {
  const headers = ["hour","solar_kw","wind_kw","generation_kw","load_kw","battery_kwh","soc_percent","grid_import_kwh","grid_export_kwh","wind_mps","rain_mm","water_litres","soiling_percent","cleaning_litres"];
  const lines = result.rows.map((r) => [r.hour,r.solarKw,r.windKw,r.generationKw,r.loadKw,r.batteryKwh,r.socPercent,r.gridImportKwh,r.gridExportKwh,r.windMps,r.rainMm,r.waterLitres,r.soilingPercent,r.cleaningLitres].join(","));
  return [headers.join(","), ...lines].join("\n");
}
