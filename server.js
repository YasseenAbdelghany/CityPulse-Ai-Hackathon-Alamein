/**
 * CityPulse — EcoSync + TideSync
 * Live Demo Server (1-Day Hackathon Build)
 *
 * - Express REST API matching the spec endpoints
 * - WebSocket live stream of sensor data + AI decisions
 * - Simulator engine: zones, bins, RVMs, desal trains, beach zones, marine sensors
 * - Static dashboard served at /
 *
 * Run:   node server.js
 * Open:  http://localhost:3000
 */

const express = require('express');
const http = require('http');
const path = require('path');
const { WebSocketServer } = require('ws');

const app = express();
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

const server = http.createServer(app);
const wss = new WebSocketServer({ server, path: '/live' });

// ---------------------------------------------------------------------------
// 1. SIMULATED CITY STATE
// ---------------------------------------------------------------------------

const NOW = () => new Date();
const ISO = () => NOW().toISOString();
const rand = (min, max) => Math.random() * (max - min) + min;
const randInt = (min, max) => Math.floor(rand(min, max + 1));
const choice = arr => arr[Math.floor(Math.random() * arr.length)];
const clamp = (v, min, max) => Math.max(min, Math.min(max, v));

// Simulated time-of-day (accelerated): 1 real second = 60 simulated seconds
let simMinutes = 6 * 60; // start at 06:00
function simHourFraction() { return (simMinutes / 60) % 24; }
function simClock() {
  const h = Math.floor((simMinutes / 60) % 24);
  const m = Math.floor(simMinutes % 60);
  return `${String(h).padStart(2,'0')}:${String(m).padStart(2,'0')}`;
}

// Daily occupancy curve (residential coastal — peaks at 14:00 beach + 21:00 evening)
function occupancyFactor(hour) {
  // Bimodal curve, scaled 0.05 to 0.95
  const morning = Math.exp(-Math.pow((hour - 9) / 3, 2)) * 0.5;
  const afternoon = Math.exp(-Math.pow((hour - 14) / 2.5, 2)) * 0.85;
  const evening = Math.exp(-Math.pow((hour - 21) / 2, 2)) * 0.75;
  return clamp(0.08 + morning + afternoon + evening, 0.05, 0.98);
}

// Beach demand curve (peaks 13:00–17:00)
function beachDemand(hour) {
  if (hour < 8 || hour > 20) return 0.05;
  return clamp(Math.exp(-Math.pow((hour - 14.5) / 3, 2)) * 0.95, 0.05, 0.95);
}

// 8 building zones (towers across districts)
const zones = [
  { id: 'zone_north_edge_A1',  name: 'North Edge Tower A1',     lat: 30.8408, lon: 28.9503, capacity: 320 },
  { id: 'zone_north_edge_B3',  name: 'North Edge Tower B3',     lat: 30.8392, lon: 28.9540, capacity: 280 },
  { id: 'zone_gate_t1',        name: 'Gate Tower T1',           lat: 30.8365, lon: 28.9612, capacity: 410 },
  { id: 'zone_gate_t4',        name: 'Gate Tower T4',           lat: 30.8350, lon: 28.9655, capacity: 390 },
  { id: 'zone_downtown_plaza', name: 'Downtown Plaza',          lat: 30.8338, lon: 28.9701, capacity: 220 },
  { id: 'zone_mazarine_M2',    name: 'Mazarine Block M2',       lat: 30.8302, lon: 28.9758, capacity: 260 },
  { id: 'zone_latin_L1',       name: 'Latin District L1',       lat: 30.8277, lon: 28.9820, capacity: 240 },
  { id: 'zone_promenade_PR3',  name: 'Promenade Lighting PR3',  lat: 30.8420, lon: 28.9450, capacity: 100 }
];

// 6 smart bins (along promenade + tower clusters)
const bins = Array.from({ length: 6 }, (_, i) => ({
  id: `bin_${String(i+1).padStart(2,'0')}`,
  lat: 30.842 - i * 0.0024,
  lon: 28.945 + i * 0.0070,
  fill: rand(0.10, 0.55),
  full_count_today: 0
}));

// 4 RO desalination trains
const desalTrains = [
  { id: 1, pressure: 62.1, flow: 1041, salt_rejection: 0.994, health: 0.92, active: true },
  { id: 2, pressure: 63.8, flow: 1015, salt_rejection: 0.991, health: 0.87, active: true },
  { id: 3, pressure: 61.5, flow: 1052, salt_rejection: 0.995, health: 0.95, active: true },
  { id: 4, pressure: 64.2, flow:  998, salt_rejection: 0.988, health: 0.78, active: true, alert: 'fouling_trend_detected' }
];

// 6 beach zones (subset of the 12 in the spec — for visual density)
const beachZones = [
  { id: 'beach_zone_01', name: 'North Edge Beach',     lat: 30.8456, lon: 28.9420, capacity: 2200 },
  { id: 'beach_zone_03', name: 'Gate Beach',           lat: 30.8410, lon: 28.9590, capacity: 2500 },
  { id: 'beach_zone_05', name: 'Downtown Beach',       lat: 30.8380, lon: 28.9700, capacity: 2000 },
  { id: 'beach_zone_07', name: 'Latin District Beach', lat: 30.8330, lon: 28.9810, capacity: 1800 },
  { id: 'beach_zone_09', name: 'Mazarine Beach',       lat: 30.8290, lon: 28.9900, capacity: 1900 },
  { id: 'beach_zone_11', name: 'East Marina Beach',    lat: 30.8255, lon: 28.9985, capacity: 2100 }
];

// Marine water quality stations (one per beach zone for the demo)
const marineStations = beachZones.map(b => ({
  station_id: `aq_${b.id}`,
  zone_id: b.id,
  ph: 8.10 + rand(-0.05, 0.05),
  dissolved_oxygen: 7.6 + rand(-0.3, 0.4),
  turbidity: rand(1.2, 3.5),
  chlorophyll_a: rand(0.8, 2.5),
  temperature: 25 + rand(0, 4),
  salinity: 38.0 + rand(-0.3, 0.3)
}));

// Cumulative counters (since simulator started)
const counters = {
  energy_saved_kwh: 0,
  energy_cost_saved_egp: 0,
  co2_avoided_kg: 0,
  truck_trips_cancelled: 0,
  diesel_saved_l: 0,
  bottles_recycled: 0,
  water_optimized_m3: 0,
  desal_energy_saved_kwh: 0,
  desal_cost_saved_egp: 0,
  beach_revenue_egp: 0,
  decisions_total: 0
};

// AI decisions ring buffer (last 50)
const decisions = [];
function pushDecision(d) {
  d.ts = ISO();
  d.sim_clock = simClock();
  decisions.unshift(d);
  if (decisions.length > 50) decisions.pop();
  counters.decisions_total += 1;
  broadcast({ type: 'decision', payload: d });
}

// ---------------------------------------------------------------------------
// 2. SIMULATOR TICK — runs every 1 real second (= 1 sim minute)
// ---------------------------------------------------------------------------

function tick() {
  simMinutes += 1;
  const hour = simHourFraction();
  const occ = occupancyFactor(hour);
  const beachOcc = beachDemand(hour);

  // Update zones — energy load and AI savings
  let totalLoadKw = 0, totalSavedKwh = 0;
  zones.forEach(z => {
    z.occupancy_pct = clamp(occ * 100 + rand(-5, 5), 0, 100);
    z.current_count = Math.round((z.occupancy_pct / 100) * z.capacity);
    // baseline kW scaled by capacity (assume 0.45 kW per max occupant peak)
    const baselineKw = z.capacity * 0.45 * (0.55 + 0.45 * occ);
    // AI savings — bigger when occupancy low
    const savingsPct = clamp(0.12 + (1 - occ) * 0.45, 0.12, 0.55);
    const currentKw = baselineKw * (1 - savingsPct);
    z.baseline_kw = +baselineKw.toFixed(1);
    z.current_kw = +currentKw.toFixed(1);
    z.savings_pct = +(savingsPct * 100).toFixed(1);
    z.hvac_setpoint = occ < 0.3 ? 26 : 23;
    z.lighting_pct = Math.round(clamp(35 + occ * 60, 25, 95));
    totalLoadKw += currentKw;
    totalSavedKwh += (baselineKw - currentKw) / 60; // 1 sim minute
  });
  counters.energy_saved_kwh += totalSavedKwh;
  counters.energy_cost_saved_egp += totalSavedKwh * 2.30;
  counters.co2_avoided_kg += totalSavedKwh * 0.51;

  // Random AI decision on a zone (about every 4 sim minutes)
  if (Math.random() < 0.25) {
    const z = choice(zones);
    if (z.occupancy_pct < 25) {
      pushDecision({
        module: 'EcoSync',
        action: 'hvac_setpoint_raised',
        zone: z.name,
        detail: `Occupancy ${z.occupancy_pct.toFixed(0)}% → HVAC 22→26°C, lighting → ${z.lighting_pct}%`,
        saved_kwh: +(rand(4, 12)).toFixed(1)
      });
    } else if (z.occupancy_pct > 70 && hour >= 11 && hour <= 16) {
      pushDecision({
        module: 'EcoSync',
        action: 'pre_cool_active',
        zone: z.name,
        detail: `Peak hour pre-cooling — shift load to off-peak window`,
        saved_kwh: +(rand(2, 6)).toFixed(1)
      });
    }
  }

  // Bins — fill grows during active hours
  const fillRate = (hour > 7 && hour < 22) ? 0.004 : 0.0008;
  bins.forEach(b => {
    b.fill = clamp(b.fill + rand(0, fillRate), 0, 1.0);
    if (b.fill >= 0.85 && Math.random() < 0.10) {
      // AI dispatches truck to this bin
      b.fill = 0.05;
      b.full_count_today += 1;
      counters.truck_trips_cancelled += 0; // collected; trips_cancelled tracked elsewhere
      counters.diesel_saved_l += 12; // optimized route saves vs full sweep
      pushDecision({
        module: 'EcoSync',
        action: 'waste_collection_dispatched',
        zone: `Bin ${b.id.toUpperCase()}`,
        detail: `Fill 85%+ → truck routed; 3 empty bins skipped`,
        saved_l_diesel: 12
      });
    }
  });

  // Trip cancellations every ~5 sim minutes
  if (Math.random() < 0.20) {
    counters.truck_trips_cancelled += 1;
    counters.diesel_saved_l += 25;
  }

  // RVM bottles recycled — peak summer hours
  const rvmRate = beachOcc * 8;
  counters.bottles_recycled += rvmRate;
  counters.co2_avoided_kg += rvmRate * 0.025 * 0.55;

  // Desalination — demand-matched scheduling
  const waterDemandM3h = (occ * 4500 + 800) + (beachOcc * 1500); // m³/h
  let desalEnergyMw = 0;
  desalTrains.forEach(t => {
    // AI decides which trains run based on demand
    const demandThreshold = [1500, 3500, 5000, 6500][t.id - 1];
    const shouldBeActive = waterDemandM3h > demandThreshold;
    if (t.active !== shouldBeActive) {
      t.active = shouldBeActive;
      pushDecision({
        module: 'TideSync / DesalSync',
        action: shouldBeActive ? 'desal_train_started' : 'desal_train_paused',
        zone: `RO Train ${t.id}`,
        detail: shouldBeActive
          ? `Demand ${waterDemandM3h.toFixed(0)} m³/h above threshold → starting train`
          : `Demand below threshold → pausing train, saving ~${Math.round(t.flow*3.5/1000)} MW`
      });
    }
    if (t.active) {
      t.pressure += rand(-0.3, 0.3);
      t.pressure = clamp(t.pressure, 58, 68);
      t.salt_rejection = clamp(t.salt_rejection + rand(-0.001, 0.001), 0.985, 0.998);
      desalEnergyMw += (t.flow / 1000) * 3.5; // 3.5 kWh/m³
    }
    // Health degrades very slowly; train 4 has fouling alert
    t.health = clamp(t.health + (t.id === 4 ? -0.00002 : 0), 0.5, 1.0);
  });
  // Energy savings vs running ALL trains continuously at full capacity
  const baselineDesalMw = (1041 + 1015 + 1052 + 998) / 1000 * 3.5;
  const desalSavedKwh = Math.max(0, baselineDesalMw - desalEnergyMw) * 1000 / 60;
  counters.desal_energy_saved_kwh += desalSavedKwh;
  counters.desal_cost_saved_egp += desalSavedKwh * 2.30;
  counters.co2_avoided_kg += desalSavedKwh * 0.51;
  counters.water_optimized_m3 += waterDemandM3h / 60;

  // Off-peak shift decision at midnight
  if (Math.floor(simMinutes) % 1440 === 0) {
    pushDecision({
      module: 'TideSync / DesalSync',
      action: 'overnight_schedule_optimized',
      zone: 'Desalination Plant',
      detail: `Tomorrow's demand forecast 96,500 m³ (conf 93%). Shifting 72% of cycles to off-peak (23:00–06:00).`
    });
  }

  // Marine water quality — slow drift, occasional anomaly
  marineStations.forEach(s => {
    s.ph = clamp(s.ph + rand(-0.005, 0.005), 7.8, 8.4);
    s.dissolved_oxygen = clamp(s.dissolved_oxygen + rand(-0.05, 0.05), 6, 9);
    s.turbidity = clamp(s.turbidity + rand(-0.05, 0.05), 0.5, 8);
    s.chlorophyll_a = clamp(s.chlorophyll_a + rand(-0.03, 0.04), 0.3, 6);
    s.temperature = clamp(s.temperature + rand(-0.05, 0.05), 22, 30);
    // Compute swimming score
    let score = 5.0;
    if (s.ph < 7.9 || s.ph > 8.3) score -= 0.5;
    if (s.dissolved_oxygen < 6.5) score -= 1;
    if (s.turbidity > 4) score -= 1;
    if (s.chlorophyll_a > 3.5) score -= 1.5;
    s.swimming_score = +clamp(score, 1, 5).toFixed(1);
    s.swimming_rating =
      s.swimming_score >= 4.5 ? 'excellent' :
      s.swimming_score >= 3.5 ? 'good' :
      s.swimming_score >= 2.5 ? 'caution' : 'closed';
    if (s.chlorophyll_a > 3.0 && Math.random() < 0.005) {
      pushDecision({
        module: 'TideSync / AquaGuard',
        action: 'hab_early_warning',
        zone: beachZones.find(b => b.id === s.zone_id).name,
        detail: `Chlorophyll-a rising (${s.chlorophyll_a.toFixed(1)} μg/L) — 48h HAB risk forecast`
      });
    }
  });

  // Beach occupancy + dynamic pricing
  beachZones.forEach((b, idx) => {
    const noise = rand(-0.05, 0.05);
    b.current_count = Math.round(b.capacity * clamp(beachOcc + noise + (idx === 1 ? 0.05 : 0), 0, 1));
    b.occupancy_pct = +(b.current_count / b.capacity * 100).toFixed(1);
    // Dynamic pricing
    const surge = b.occupancy_pct > 80 ? 1.5 : b.occupancy_pct > 60 ? 1.2 : 1.0;
    b.surge = surge;
    b.price_egp = Math.round(150 * surge);
    b.tier = surge >= 1.5 ? 'high_demand' : surge >= 1.2 ? 'elevated' : 'standard';
    // Revenue per minute — 1% of current_count buys access
    const newAccess = Math.max(0, b.current_count * 0.01);
    counters.beach_revenue_egp += newAccess * b.price_egp / 60;
  });

  // Beach redirect decision
  if (Math.random() < 0.12) {
    const overcrowded = beachZones.find(b => b.occupancy_pct > 80);
    const underused = beachZones.find(b => b.occupancy_pct < 40);
    if (overcrowded && underused) {
      pushDecision({
        module: 'TideSync / BeachPulse',
        action: 'visitor_redirect_recommended',
        zone: overcrowded.name,
        detail: `${overcrowded.occupancy_pct}% full → redirect to ${underused.name} (${underused.occupancy_pct}%, EGP ${underused.price_egp})`
      });
    }
  }

  // Broadcast snapshot every tick
  broadcast({
    type: 'tick',
    payload: {
      sim_clock: simClock(),
      hour,
      occupancy_pct: +(occ * 100).toFixed(1),
      beach_demand_pct: +(beachOcc * 100).toFixed(1),
      total_load_kw: +totalLoadKw.toFixed(1),
      water_demand_m3h: +waterDemandM3h.toFixed(0),
      desal_active_trains: desalTrains.filter(t => t.active).length,
      desal_energy_mw: +desalEnergyMw.toFixed(2),
      counters: serializeCounters(),
      zones,
      bins,
      desalTrains,
      beachZones,
      marineStations
    }
  });
}

function serializeCounters() {
  return {
    energy_saved_kwh: Math.round(counters.energy_saved_kwh),
    energy_cost_saved_egp: Math.round(counters.energy_cost_saved_egp),
    co2_avoided_kg: Math.round(counters.co2_avoided_kg),
    truck_trips_cancelled: counters.truck_trips_cancelled,
    diesel_saved_l: Math.round(counters.diesel_saved_l),
    bottles_recycled: Math.round(counters.bottles_recycled),
    water_optimized_m3: Math.round(counters.water_optimized_m3),
    desal_energy_saved_kwh: Math.round(counters.desal_energy_saved_kwh),
    desal_cost_saved_egp: Math.round(counters.desal_cost_saved_egp),
    beach_revenue_egp: Math.round(counters.beach_revenue_egp),
    decisions_total: counters.decisions_total,
    total_egp_saved: Math.round(counters.energy_cost_saved_egp + counters.desal_cost_saved_egp + counters.beach_revenue_egp)
  };
}

setInterval(tick, 1000);

// ---------------------------------------------------------------------------
// 3. WEBSOCKET BROADCAST
// ---------------------------------------------------------------------------

function broadcast(msg) {
  const json = JSON.stringify(msg);
  wss.clients.forEach(c => {
    if (c.readyState === 1) c.send(json);
  });
}

wss.on('connection', ws => {
  // Send a hello with last 20 decisions
  ws.send(JSON.stringify({
    type: 'hello',
    payload: {
      sim_clock: simClock(),
      counters: serializeCounters(),
      decisions: decisions.slice(0, 20),
      zones, bins, desalTrains, beachZones, marineStations
    }
  }));
});

// ---------------------------------------------------------------------------
// 4. REST API (matching the spec)
// ---------------------------------------------------------------------------

app.get('/api/dashboard/city-overview', (req, res) => {
  res.json({
    timestamp: ISO(),
    city: 'new_alamein',
    pilot_zone: 'coastal_towers_district',
    active_units: 8000,
    sim_clock: simClock(),
    counters: serializeCounters(),
    system_health: 'all_nominal',
    uptime_pct: 99.97
  });
});

app.get('/api/ecosync/zones/:zoneId/status', (req, res) => {
  const z = zones.find(x => x.id === req.params.zoneId);
  if (!z) return res.status(404).json({ error: 'zone_not_found' });
  res.json({
    zone_id: z.id,
    timestamp: ISO(),
    occupancy: { current_count: z.current_count, capacity: z.capacity, occupancy_pct: z.occupancy_pct },
    energy: {
      current_load_kw: z.current_kw,
      baseline_load_kw: z.baseline_kw,
      savings_pct: z.savings_pct,
      hvac_setpoint: z.hvac_setpoint,
      lighting_pct: z.lighting_pct
    }
  });
});

app.get('/api/tidesync/desal/status', (req, res) => {
  res.json({
    timestamp: ISO(),
    plant_id: 'desal_alamein_phase1',
    trains: desalTrains,
    active_trains: desalTrains.filter(t => t.active).length,
    energy_saved_today_kwh: Math.round(counters.desal_energy_saved_kwh)
  });
});

app.get('/api/tidesync/aquaguard/zones/:zoneId', (req, res) => {
  const s = marineStations.find(x => x.zone_id === req.params.zoneId);
  if (!s) return res.status(404).json({ error: 'zone_not_found' });
  res.json({ zone_id: s.zone_id, timestamp: ISO(), water_quality: s, safety: { swimming_score: s.swimming_score, swimming_rating: s.swimming_rating } });
});

app.get('/api/tidesync/beach/:zoneId/occupancy', (req, res) => {
  const b = beachZones.find(x => x.id === req.params.zoneId);
  if (!b) return res.status(404).json({ error: 'zone_not_found' });
  res.json(b);
});

app.get('/api/decisions/recent', (req, res) => {
  res.json(decisions.slice(0, 50));
});

// ---------------------------------------------------------------------------
// 5. START
// ---------------------------------------------------------------------------

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
  console.log('═══════════════════════════════════════════════════════════════');
  console.log('  CityPulse — EcoSync + TideSync Live Demo');
  console.log('  AI-Powered Smart Coastal City Operating System');
  console.log('═══════════════════════════════════════════════════════════════');
  console.log(`  Dashboard:  http://localhost:${PORT}`);
  console.log(`  WebSocket:  ws://localhost:${PORT}/live`);
  console.log(`  REST API:   http://localhost:${PORT}/api/dashboard/city-overview`);
  console.log('═══════════════════════════════════════════════════════════════');
  console.log('  Simulator running — 1 real second = 1 simulated minute');
  console.log('  Press Ctrl+C to stop');
  console.log('═══════════════════════════════════════════════════════════════');
});
