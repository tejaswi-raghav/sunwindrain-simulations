# SunWindRain Simulation MVP

Interactive React/Vite digital-twin workspace for the SunWindRain integrated renewable-energy and rainwater system.

## Run
1. Install Node.js.
2. Open this folder in a terminal.
3. Run `npm install`
4. Run `npm run dev`
5. Open the local URL shown by Vite.

Run `npm test` for the dispatch-engine tests and `npm run build` for a production bundle.

## Included
- Hourly solar, wind, load, battery, and grid dispatch model
- Clear-day, dust-event, and rain-event scenarios
- Battery reserve protection and configurable grid export
- Rainwater capture with first-flush diversion and tank limits
- Condition-based solar cleaning logic
- Scenario comparison, control log, and CSV export

## Model scope
The MVP uses the commercialization overview's headline system specification: 800 W PV, 400 W VAWT, 3.5 kWh usable LiFePO4 storage, 300 L water storage, and a 20% battery reserve. Results are directional engineering estimates and should be calibrated against measured UAE rooftop data before investment or equipment decisions.
