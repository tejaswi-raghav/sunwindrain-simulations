import React, { useEffect, useMemo, useState } from "react";
import { createRoot } from "react-dom/client";
import { compareScenarios, DEFAULT_CONFIG, optimizeDesign, resultsToCsv, SCENARIOS, simulateDay } from "./simulation.js";
import "./style.css";

const fmt = (value, digits = 1) => Number(value).toFixed(digits);

function Icon({ name }) {
  const paths = {
    sun: <><circle cx="12" cy="12" r="4"/><path d="M12 2v2m0 16v2M4.9 4.9l1.4 1.4m11.4 11.4 1.4 1.4M2 12h2m16 0h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4"/></>,
    wind: <><path d="M3 8h10.5a2.5 2.5 0 1 0-2.5-2.5M3 12h15a3 3 0 1 1-3 3M3 16h7"/></>,
    water: <path d="M12 2.5S6 9.4 6 14a6 6 0 0 0 12 0c0-4.6-6-11.5-6-11.5Z"/>,
    battery: <><rect x="3" y="6" width="17" height="12" rx="2"/><path d="M20 10h2v4h-2M7 12h9"/></>,
    grid: <><path d="M12 2 5 22m7-20 7 20M7 8h10M5 14h14M3 22h18"/></>,
    download: <><path d="M12 3v12m0 0 4-4m-4 4-4-4M4 20h16"/></>,
  };
  return <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">{paths[name]}</svg>;
}

function Slider({ label, value, min, max, step, unit, onChange, hint }) {
  return <label className="control"><span><b>{label}</b><output>{value}{unit}</output></span><input type="range" min={min} max={max} step={step} value={value} onChange={(e) => onChange(Number(e.target.value))}/><small>{hint}</small></label>;
}

function DispatchChart({ rows }) {
  const width = 920, height = 300, pad = { left: 45, right: 18, top: 22, bottom: 32 };
  const innerW = width-pad.left-pad.right, innerH = height-pad.top-pad.bottom;
  const maxPower = Math.max(0.8, ...rows.flatMap((row) => [row.generationKw,row.loadKw]))*1.18;
  const x = (hour) => pad.left+(hour/23)*innerW;
  const yPower = (value) => pad.top+innerH-(value/maxPower)*innerH;
  const ySoc = (value) => pad.top+innerH-(value/100)*innerH;
  const pathFor = (key,scale) => rows.map((row,index) => `${index?"L":"M"}${x(row.hour).toFixed(1)},${scale(row[key]).toFixed(1)}`).join(" ");
  const area = `${pathFor("generationKw",yPower)} L${x(23)},${pad.top+innerH} L${x(0)},${pad.top+innerH} Z`;
  return <div className="chart-wrap">
    <div className="legend"><span className="generation">Generation</span><span className="load">Load</span><span className="soc">Battery SOC</span></div>
    <svg className="chart" viewBox={`0 0 ${width} ${height}`} role="img" aria-label="24-hour energy generation, household load, and battery state of charge">
      <defs><linearGradient id="energy-fill" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stopColor="#a8db58" stopOpacity=".42"/><stop offset="1" stopColor="#a8db58" stopOpacity=".02"/></linearGradient></defs>
      {[0,.25,.5,.75,1].map((fraction) => <line key={fraction} x1={pad.left} x2={width-pad.right} y1={pad.top+innerH*fraction} y2={pad.top+innerH*fraction} className="gridline"/>)}
      {[0,6,12,18,23].map((hour) => <g key={hour}><line x1={x(hour)} x2={x(hour)} y1={pad.top} y2={pad.top+innerH} className="gridline vertical"/><text x={x(hour)} y={height-8} textAnchor="middle">{String(hour).padStart(2,"0")}:00</text></g>)}
      <text x="8" y="18">kW</text><text x={width-12} y="18" textAnchor="end">SOC %</text>
      <path d={area} fill="url(#energy-fill)"/><path d={pathFor("generationKw",yPower)} className="series series-generation"/><path d={pathFor("loadKw",yPower)} className="series series-load"/><path d={pathFor("socPercent",ySoc)} className="series series-soc"/>
    </svg>
  </div>;
}

function Metric({ icon, label, value, detail, tone="" }) {
  return <article className={`metric ${tone}`}><div className="metric-icon"><Icon name={icon}/></div><span>{label}</span><strong>{value}</strong><small>{detail}</small></article>;
}

function EnergyFlow({ row, hour, playing, onPlayingChange, onHourChange }) {
  const batteryPower = Math.abs(row.batteryFlowKwh);
  const gridPower = row.gridImportKwh || row.gridExportKwh;
  const flowWidth = (power) => 2 + Math.min(7, power * 7);
  const batteryCharging = row.batteryFlowKwh > 0;
  const gridImporting = row.gridImportKwh > 0;
  const state = row.gridImportKwh > 0.01 ? "Grid assisting loads" : row.gridExportKwh > 0.01 ? "Surplus exported" : batteryCharging ? "Renewables charging battery" : batteryPower > 0.01 ? "Battery supporting loads" : "Renewables serving loads";
  return <section className="panel system-panel">
    <div className="panel-head"><div><span>LIVE ENERGY SYSTEM</span><small>{state}</small></div><i>{String(hour).padStart(2,"0")}:00</i></div>
    <div className="system-visual" aria-live="polite">
      <svg viewBox="0 0 760 330" role="img" aria-label={`Energy flow at ${hour}:00. Solar ${row.solarKw} kilowatts, wind ${row.windKw} kilowatts, load ${row.loadKw} kilowatts, battery ${row.socPercent} percent.`}>
        <defs><marker id="flow-arrow" viewBox="0 0 10 10" refX="8" refY="5" markerWidth="5" markerHeight="5" orient="auto-start-reverse"><path d="M 0 0 L 10 5 L 0 10 z"/></marker></defs>
        <path className={`energy-path solar-flow ${row.solarKw>0.01?"active":""}`} style={{strokeWidth:flowWidth(row.solarKw)}} d="M154 78 C230 78 245 148 310 148" markerEnd="url(#flow-arrow)"/>
        <path className={`energy-path wind-flow ${row.windKw>0.01?"active":""}`} style={{strokeWidth:flowWidth(row.windKw)}} d="M154 250 C230 250 245 176 310 176" markerEnd="url(#flow-arrow)"/>
        <path className="energy-path load-flow active" style={{strokeWidth:flowWidth(row.loadKw)}} d="M390 150 C470 150 475 76 545 76" markerEnd="url(#flow-arrow)"/>
        <path className={`energy-path battery-flow ${batteryPower>0.01?"active":""}`} style={{strokeWidth:flowWidth(batteryPower)}} d={batteryCharging?"M390 164 L545 164":"M545 164 L390 164"} markerEnd="url(#flow-arrow)"/>
        <path className={`energy-path grid-flow ${gridPower>0.01?"active":""}`} style={{strokeWidth:flowWidth(gridPower)}} d={gridImporting?"M545 252 C470 252 465 180 390 180":"M390 180 C465 180 470 252 545 252"} markerEnd="url(#flow-arrow)"/>
        <g className="system-node source-node" transform="translate(54 42)"><circle cx="50" cy="36" r="35"/><text x="50" y="31" textAnchor="middle">SOLAR</text><text className="node-value" x="50" y="49" textAnchor="middle">{fmt(row.solarKw,2)} kW</text></g>
        <g className="system-node source-node" transform="translate(54 214)"><circle cx="50" cy="36" r="35"/><text x="50" y="31" textAnchor="middle">WIND</text><text className="node-value" x="50" y="49" textAnchor="middle">{fmt(row.windKw,2)} kW</text></g>
        <g className="system-node bus-node" transform="translate(310 124)"><rect width="80" height="80" rx="8"/><text x="40" y="34" textAnchor="middle">DC BUS</text><text className="node-value" x="40" y="52" textAnchor="middle">{fmt(row.generationKw,2)} kW</text></g>
        <g className="system-node load-node" transform="translate(545 40)"><rect width="150" height="72" rx="8"/><text x="75" y="30" textAnchor="middle">HOME LOADS</text><text className="node-value" x="75" y="50" textAnchor="middle">{fmt(row.loadKw,2)} kW</text></g>
        <g className="system-node battery-node" transform="translate(545 128)"><rect width="150" height="72" rx="8"/><text x="75" y="30" textAnchor="middle">BATTERY · {batteryCharging?"CHARGING":"DISCHARGING"}</text><text className="node-value" x="75" y="50" textAnchor="middle">{fmt(row.socPercent,0)}% SOC · {fmt(batteryPower,2)} kW</text></g>
        <g className="system-node grid-node" transform="translate(545 216)"><rect width="150" height="72" rx="8"/><text x="75" y="30" textAnchor="middle">GRID · {gridImporting?"IMPORT":"EXPORT"}</text><text className="node-value" x="75" y="50" textAnchor="middle">{fmt(gridPower,2)} kW</text></g>
      </svg>
    </div>
    <div className="timeline"><button onClick={() => onPlayingChange(!playing)} aria-label={playing?"Pause simulation":"Play simulation"}>{playing?"Ⅱ":"▶"}</button><input aria-label="Simulation hour" type="range" min="0" max="23" step="1" value={hour} onChange={(e) => onHourChange(Number(e.target.value))}/><output>{String(hour).padStart(2,"0")}:00</output></div>
  </section>;
}

function OptimizerPanel({ optimization, goal, onGoalChange, onApply }) {
  const { baseline, recommended, evaluatedDesigns } = optimization;
  const specs = [
    ["PV array", baseline.config.pvCapacityKw, recommended.config.pvCapacityKw, "kW"],
    ["Wind turbine", baseline.config.windCapacityKw, recommended.config.windCapacityKw, "kW"],
    ["Battery", baseline.config.batteryCapacityKwh, recommended.config.batteryCapacityKwh, "kWh"],
  ];
  return <section className="panel optimizer-panel">
    <div className="panel-head"><div><span>DESIGN OPTIMIZER</span><small>{evaluatedDesigns} system combinations tested across clear, dusty and storm weather</small></div><i>10-year view</i></div>
    <div className="optimizer-body">
      <div className="optimizer-controls"><span>Optimize for</span>{[["balanced","Balanced"],["autonomy","Autonomy"],["cost","Lowest cost"]].map(([key,label]) => <button key={key} className={goal===key?"active":""} onClick={() => onGoalChange(key)}>{label}</button>)}</div>
      <div className="optimizer-grid">
        <div className="sizing-comparison"><div className="optimizer-labels"><span>System component</span><span>Current</span><span>Recommended</span></div>{specs.map(([label,current,next,unit]) => <div className="sizing-row" key={label}><b>{label}</b><span>{fmt(current,1)} {unit}</span><strong>{fmt(next,1)} {unit}</strong><div className="size-track"><i style={{width:`${Math.min(100,(current/Math.max(current,next))*100)}%`}}/><em style={{width:`${Math.min(100,(next/Math.max(current,next))*100)}%`}}/></div></div>)}</div>
        <div className="optimizer-impact">
          <span>EXPECTED WEATHER-WEIGHTED IMPACT</span>
          <div><small>Self-sufficiency</small><b>{fmt(baseline.metrics.selfSufficiencyPercent,0)}% <i>→</i> {fmt(recommended.metrics.selfSufficiencyPercent,0)}%</b></div>
          <div><small>Daily grid energy</small><b>{fmt(baseline.metrics.gridImportKwh)} <i>→</i> {fmt(recommended.metrics.gridImportKwh)} kWh</b></div>
          <div><small>Estimated hardware</small><b>AED {baseline.capexAed.toLocaleString()} <i>→</i> {recommended.capexAed.toLocaleString()}</b></div>
          <button onClick={onApply}>Apply recommended design <span>↗</span></button>
        </div>
      </div>
      <p className="optimizer-note">Recommendation uses directional component costs and representative weather weights. Field measurements should replace these assumptions before procurement.</p>
    </div>
  </section>;
}

function App() {
  const [config,setConfig] = useState(DEFAULT_CONFIG);
  const [hour,setHour] = useState(12);
  const [playing,setPlaying] = useState(false);
  const [goal,setGoal] = useState("balanced");
  const result = useMemo(() => simulateDay(config),[config]);
  const comparisons = useMemo(() => compareScenarios(config),[config]);
  const optimization = useMemo(() => optimizeDesign(config,goal),[config,goal]);
  const update = (key,value) => setConfig((current) => ({...current,[key]:value}));
  const m = result.metrics;
  useEffect(() => {
    if (!playing) return undefined;
    const timer = window.setInterval(() => setHour((current) => (current+1)%24),700);
    return () => window.clearInterval(timer);
  },[playing]);
  const downloadCsv = () => {
    const blob = new Blob([resultsToCsv(result)],{type:"text/csv;charset=utf-8"});
    const url = URL.createObjectURL(blob); const link = document.createElement("a");
    link.href=url; link.download=`sunwindrain-${config.scenario}-simulation.csv`; link.click(); URL.revokeObjectURL(url);
  };
  return <div className="app">
    <header className="topbar">
      <a className="brand" href="#top"><span className="brand-glyph">SWR</span><span><b>SunWindRain</b><small>Simulation workspace</small></span></a>
      <div className="top-status"><span className="status-dot"/> MODEL ONLINE <i>v0.2</i></div>
      <button className="export" onClick={downloadCsv}><Icon name="download"/> Export CSV</button>
    </header>
    <main id="top">
      <section className="intro"><div><p className="eyebrow">ENERGY SYSTEM VISUALIZER / UAE ROOFTOP</p><h1>Watch energy move.<br/><em>Optimize the system.</em></h1></div><p className="intro-copy">Scrub through a day to see solar, wind, battery and grid power move through the architecture—then compare hundreds of system sizes to find a better design.</p></section>
      <section className="workspace">
        <aside className="sidebar">
          <div className="side-head"><span>SCENARIO</span><small>01</small></div>
          <div className="scenario-list">{Object.entries(SCENARIOS).map(([key,s]) => <button key={key} className={config.scenario===key?"active":""} onClick={() => update("scenario",key)}><span className={`scenario-icon ${key}`}><Icon name={key==="clear"?"sun":key==="dusty"?"wind":"water"}/></span><span><b>{s.label}</b><small>{s.description}</small></span><i>↗</i></button>)}</div>
          <div className="side-head parameters"><span>PARAMETERS</span><small>02</small></div>
          <Slider label="Household load" value={config.dailyLoadKwh} min={2} max={18} step={0.2} unit=" kWh" onChange={(v) => update("dailyLoadKwh",v)} hint="Representative daily demand"/>
          <Slider label="Starting battery" value={config.initialSocPercent} min={20} max={100} step={1} unit="%" onChange={(v) => update("initialSocPercent",v)} hint={`${fmt(config.batteryCapacityKwh,1)} kWh usable storage`}/>
          <Slider label="Panel soiling" value={config.soilingPercent} min={0} max={30} step={1} unit="%" onChange={(v) => update("soilingPercent",v)} hint="Cleaning trigger is above 15%"/>
          <Slider label="Rainfall event" value={config.rainMm} min={0} max={60} step={1} unit=" mm" onChange={(v) => update("rainMm",v)} hint="Applied to the rain-event scenario"/>
          <Slider label="Starting tank" value={config.initialWaterLitres} min={0} max={300} step={5} unit=" L" onChange={(v) => update("initialWaterLitres",v)} hint="300 L storage capacity"/>
          <label className="toggle"><span><b>Grid export</b><small>Route battery surplus to grid</small></span><input type="checkbox" checked={config.exportEnabled} onChange={(e) => update("exportEnabled",e.target.checked)}/><i/></label>
        </aside>
        <div className="results">
          <div className="results-head"><div><p className="eyebrow">24-HOUR DISPATCH</p><h2>{SCENARIOS[config.scenario].label}</h2></div><div className={`decision ${m.gridImportKwh<0.5?"good":"watch"}`}><span>CONTROLLER VERDICT</span><b>{m.gridImportKwh<0.5?"LOADS COVERED":"GRID SUPPORT REQUIRED"}</b></div></div>
          <div className="metrics">
            <Metric icon="sun" label="Renewable yield" value={`${fmt(m.generationKwh)} kWh`} detail={`${fmt(m.solarKwh)} solar + ${fmt(m.windKwh)} wind`} tone="green"/>
            <Metric icon="battery" label="Self-sufficiency" value={`${fmt(m.selfSufficiencyPercent,0)}%`} detail={`${fmt(m.endSocPercent,0)}% ending battery SOC`} tone="blue"/>
            <Metric icon="grid" label="Grid import" value={`${fmt(m.gridImportKwh)} kWh`} detail={`${fmt(m.gridExportKwh)} kWh exported`} tone="amber"/>
            <Metric icon="water" label="Water recovered" value={`${fmt(m.capturedWaterLitres,0)} L`} detail={`${fmt(m.endWaterLitres,0)} L ending tank level`} tone="cyan"/>
          </div>
          <EnergyFlow row={result.rows[hour]} hour={hour} playing={playing} onPlayingChange={setPlaying} onHourChange={(next) => {setPlaying(false);setHour(next);}}/>
          <section className="panel chart-panel"><div className="panel-head"><div><span>ENERGY DISPATCH</span><small>Generation, demand and storage state</small></div><i>Hourly timestep</i></div><DispatchChart rows={result.rows}/></section>
          <OptimizerPanel optimization={optimization} goal={goal} onGoalChange={setGoal} onApply={() => setConfig((current) => ({...current,pvCapacityKw:optimization.recommended.config.pvCapacityKw,windCapacityKw:optimization.recommended.config.windCapacityKw,batteryCapacityKwh:optimization.recommended.config.batteryCapacityKwh}))}/>
          <div className="lower-grid">
            <section className="panel scenario-panel"><div className="panel-head"><div><span>SCENARIO COMPARISON</span><small>Same system settings, different weather</small></div><i>3 runs</i></div><div className="comparison-table">
              <div className="table-row table-labels"><span>Scenario</span><span>Yield</span><span>Autonomy</span><span>Water</span></div>
              {comparisons.map((item) => <div className={`table-row ${item.config.scenario===config.scenario?"selected":""}`} key={item.config.scenario}><span><b>{SCENARIOS[item.config.scenario].label}</b><small>{item.metrics.gridImportKwh>0.5?"Grid assisted":"Self supplied"}</small></span><span>{fmt(item.metrics.generationKwh)} kWh</span><span>{fmt(item.metrics.selfSufficiencyPercent,0)}%</span><span>{fmt(item.metrics.capturedWaterLitres,0)} L</span></div>)}
            </div></section>
            <section className="panel controller-panel"><div className="panel-head"><div><span>CONTROL LOG</span><small>Edge decisions generated by this run</small></div><i>Live</i></div>
              <div className="log-entry"><time>06:00</time><span className={m.cleaningTriggered?"log-on":"log-idle"}/><p><b>{m.cleaningTriggered?"Cleaning cycle executed":"Cleaning cycle withheld"}</b><small>{m.cleaningTriggered?"8 L rinse · soiling reset to 3%":config.soilingPercent<=15?"Soiling remains below threshold":"Water or wind safety condition not met"}</small></p></div>
              <div className="log-entry"><time>12:00</time><span className="log-on"/><p><b>Generation routed to priority loads</b><small>Surplus charges battery before export</small></p></div>
              <div className="log-entry"><time>23:00</time><span className={m.endSocPercent>20?"log-on":"log-idle"}/><p><b>Battery reserve protected</b><small>Discharge floor held at 20% SOC</small></p></div>
              <div className="assumptions">Model assumptions: hourly dispatch; 95% charge and 94% discharge efficiency; 215 W/m² PV density; 85% runoff coefficient; 1 mm first flush. Results are directional and require field-data calibration.</div>
            </section>
          </div>
        </div>
      </section>
    </main>
    <footer><span>SunWindRain MVP · Model inputs derived from the commercialization overview</span><span>PV {fmt(config.pvCapacityKw,1)} kW · VAWT {fmt(config.windCapacityKw,1)} kW · LiFePO₄ {fmt(config.batteryCapacityKwh,1)} kWh · Water 300 L</span></footer>
  </div>;
}

createRoot(document.getElementById("root")).render(<App/>);
