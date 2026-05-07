/**
 * CityPulse — In-Browser Simulator
 *
 * Runs the entire CityPulse simulator (zones, bins, RVMs, desal trains,
 * beach zones, marine stations, AI decision engine) inside the browser
 * so the dashboard works on a static host (Vercel) with no backend.
 *
 * Exposes a `CityPulseSim` global with a `connect(handler)` method that
 * mirrors the WebSocket interface — handler receives the same
 * { type: 'hello' | 'tick' | 'decision', payload } messages the
 * server used to broadcast.
 */
(function () {
  // ---- helpers ----
  const ISO = () => new Date().toISOString();
  const rand = (a, b) => Math.random() * (b - a) + a;
  const choice = a => a[Math.floor(Math.random() * a.length)];
  const clamp = (v, a, b) => Math.max(a, Math.min(b, v));

  // simulated time (1 real second = 1 sim minute)
  let simMinutes = 6 * 60; // start 06:00
  function simHourFraction() { return (simMinutes / 60) % 24; }
  function simClock() {
    const h = Math.floor((simMinutes / 60) % 24);
    const m = Math.floor(simMinutes % 60);
    return String(h).padStart(2, '0') + ':' + String(m).padStart(2, '0');
  }
  function occupancyFactor(hour) {
    // bimodal: morning + afternoon + evening peaks
    const morn = Math.exp(-Math.pow(hour - 9, 2) / 8) * 0.55;
    const noon = Math.exp(-Math.pow(hour - 14, 2) / 6) * 0.85;
    const eve  = Math.exp(-Math.pow(hour - 21, 2) / 5) * 0.95;
    return clamp(0.10 + morn + noon + eve, 0.10, 1.0);
  }
  function beachDemand(hour) {
    return clamp(Math.exp(-Math.pow(hour - 15, 2) / 7) * 0.95 + 0.05, 0.05, 1.0);
  }

  // ---- city state ----
  const zones = [
    { id: 'z1', name: 'North Edge Tower A', lat: 30.8475, lon: 28.9620, capacity: 420 },
    { id: 'z2', name: 'North Edge Tower B', lat: 30.8460, lon: 28.9655, capacity: 380 },
    { id: 'z3', name: 'Gate Tower 1',       lat: 30.8410, lon: 28.9700, capacity: 540 },
    { id: 'z4', name: 'Gate Tower 2',       lat: 30.8395, lon: 28.9720, capacity: 510 },
    { id: 'z5', name: 'Downtown Plaza',     lat: 30.8350, lon: 28.9760, capacity: 360 },
    { id: 'z6', name: 'Mazarine Tower',     lat: 30.8310, lon: 28.9810, capacity: 600 },
    { id: 'z7', name: 'Latin District',     lat: 30.8275, lon: 28.9870, capacity: 420 },
    { id: 'z8', name: 'Coastal Hotel',      lat: 30.8500, lon: 28.9590, capacity: 480 }
  ];

  const bins = Array.from({ length: 6 }, (_, i) => ({
    id: 'b' + (i + 1),
    name: 'Bin ' + (i + 1),
    lat: 30.835 + (Math.random() - 0.5) * 0.025,
    lon: 28.965 + (Math.random() - 0.5) * 0.030,
    fill: Math.random() * 0.5,
    full_count_today: 0
  }));

  const desalTrains = [
    { id: 1, flow: 1041, pressure: 62, salt_rejection: 0.992, health: 0.95, active: true  },
    { id: 2, flow: 1015, pressure: 61, salt_rejection: 0.990, health: 0.97, active: true  },
    { id: 3, flow: 1052, pressure: 63, salt_rejection: 0.994, health: 0.98, active: false },
    { id: 4, flow:  998, pressure: 60, salt_rejection: 0.987, health: 0.78, active: false }
  ];

  const beachZones = [
    { id: 'beach1', name: 'North Beach',       capacity: 800, lat: 30.8530, lon: 28.9580 },
    { id: 'beach2', name: 'Marina Beach',      capacity: 1200, lat: 30.8510, lon: 28.9650 },
    { id: 'beach3', name: 'Promenade Central', capacity: 1000, lat: 30.8470, lon: 28.9720 },
    { id: 'beach4', name: 'Mazarine Beach',    capacity: 900,  lat: 30.8400, lon: 28.9810 },
    { id: 'beach5', name: 'Latin Bay',         capacity: 700,  lat: 30.8350, lon: 28.9890 },
    { id: 'beach6', name: 'East Pier',         capacity: 600,  lat: 30.8310, lon: 28.9950 }
  ];

  const marineStations = beachZones.map(b => ({
    id: 'm-' + b.id,
    zone_id: b.id,
    ph: rand(7.9, 8.3),
    dissolved_oxygen: rand(7, 9),
    turbidity: rand(1, 3),
    chlorophyll_a: rand(0.5, 2.5),
    temperature: rand(24, 28),
    swimming_score: 5,
    swimming_rating: 'excellent'
  }));

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

  const decisionsBuf = [];
  let handler = null;

  function emit(type, payload) {
    if (handler) handler({ type, payload });
  }

  function pushDecision(d) {
    d.ts = ISO();
    d.sim_clock = simClock();
    decisionsBuf.unshift(d);
    if (decisionsBuf.length > 50) decisionsBuf.pop();
    counters.decisions_total += 1;
    emit('decision', d);
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

  function tick() {
    simMinutes += 1;
    const hour = simHourFraction();
    const occ = occupancyFactor(hour);
    const beachOcc = beachDemand(hour);

    let totalLoadKw = 0, totalSavedKwh = 0;
    zones.forEach(z => {
      z.occupancy_pct = clamp(occ * 100 + rand(-5, 5), 0, 100);
      z.current_count = Math.round((z.occupancy_pct / 100) * z.capacity);
      const baselineKw = z.capacity * 0.45 * (0.55 + 0.45 * occ);
      const savingsPct = clamp(0.12 + (1 - occ) * 0.45, 0.12, 0.55);
      const currentKw = baselineKw * (1 - savingsPct);
      z.baseline_kw = +baselineKw.toFixed(1);
      z.current_kw = +currentKw.toFixed(1);
      z.savings_pct = +(savingsPct * 100).toFixed(1);
      z.hvac_setpoint = occ < 0.3 ? 26 : 23;
      z.lighting_pct = Math.round(clamp(35 + occ * 60, 25, 95));
      totalLoadKw += currentKw;
      totalSavedKwh += (baselineKw - currentKw) / 60;
    });
    counters.energy_saved_kwh += totalSavedKwh;
    counters.energy_cost_saved_egp += totalSavedKwh * 2.30;
    counters.co2_avoided_kg += totalSavedKwh * 0.51;

    if (Math.random() < 0.25) {
      const z = choice(zones);
      if (z.occupancy_pct < 25) {
        pushDecision({
          module: 'EcoSync',
          action: 'hvac_setpoint_raised',
          zone: z.name,
          detail: 'Occupancy ' + z.occupancy_pct.toFixed(0) + '% → HVAC 22→26°C, lighting → ' + z.lighting_pct + '%',
          saved_kwh: +(rand(4, 12)).toFixed(1)
        });
      } else if (z.occupancy_pct > 70 && hour >= 11 && hour <= 16) {
        pushDecision({
          module: 'EcoSync',
          action: 'pre_cool_active',
          zone: z.name,
          detail: 'Peak hour pre-cooling — shift load to off-peak window',
          saved_kwh: +(rand(2, 6)).toFixed(1)
        });
      }
    }

    const fillRate = (hour > 7 && hour < 22) ? 0.004 : 0.0008;
    bins.forEach(b => {
      b.fill = clamp(b.fill + rand(0, fillRate), 0, 1.0);
      if (b.fill >= 0.85 && Math.random() < 0.10) {
        b.fill = 0.05;
        b.full_count_today += 1;
        counters.diesel_saved_l += 12;
        pushDecision({
          module: 'EcoSync',
          action: 'waste_collection_dispatched',
          zone: 'Bin ' + b.id.toUpperCase(),
          detail: 'Fill 85%+ → truck routed; 3 empty bins skipped',
          saved_l_diesel: 12
        });
      }
    });

    if (Math.random() < 0.20) {
      counters.truck_trips_cancelled += 1;
      counters.diesel_saved_l += 25;
    }

    const rvmRate = beachOcc * 8;
    counters.bottles_recycled += rvmRate;
    counters.co2_avoided_kg += rvmRate * 0.025 * 0.55;

    const waterDemandM3h = (occ * 4500 + 800) + (beachOcc * 1500);
    let desalEnergyMw = 0;
    desalTrains.forEach(t => {
      const demandThreshold = [1500, 3500, 5000, 6500][t.id - 1];
      const shouldBeActive = waterDemandM3h > demandThreshold;
      if (t.active !== shouldBeActive) {
        t.active = shouldBeActive;
        pushDecision({
          module: 'TideSync / DesalSync',
          action: shouldBeActive ? 'desal_train_started' : 'desal_train_paused',
          zone: 'RO Train ' + t.id,
          detail: shouldBeActive
            ? 'Demand ' + waterDemandM3h.toFixed(0) + ' m³/h above threshold → starting train'
            : 'Demand below threshold → pausing train, saving ~' + Math.round(t.flow * 3.5 / 1000) + ' MW'
        });
      }
      if (t.active) {
        t.pressure += rand(-0.3, 0.3);
        t.pressure = clamp(t.pressure, 58, 68);
        t.salt_rejection = clamp(t.salt_rejection + rand(-0.001, 0.001), 0.985, 0.998);
        desalEnergyMw += (t.flow / 1000) * 3.5;
      }
      t.health = clamp(t.health + (t.id === 4 ? -0.00002 : 0), 0.5, 1.0);
    });
    const baselineDesalMw = (1041 + 1015 + 1052 + 998) / 1000 * 3.5;
    const desalSavedKwh = Math.max(0, baselineDesalMw - desalEnergyMw) * 1000 / 60;
    counters.desal_energy_saved_kwh += desalSavedKwh;
    counters.desal_cost_saved_egp += desalSavedKwh * 2.30;
    counters.co2_avoided_kg += desalSavedKwh * 0.51;
    counters.water_optimized_m3 += waterDemandM3h / 60;

    if (Math.floor(simMinutes) % 1440 === 0) {
      pushDecision({
        module: 'TideSync / DesalSync',
        action: 'overnight_schedule_optimized',
        zone: 'Desalination Plant',
        detail: "Tomorrow's demand forecast 96,500 m³ (conf 93%). Shifting 72% of cycles to off-peak (23:00–06:00)."
      });
    }

    marineStations.forEach(s => {
      s.ph = clamp(s.ph + rand(-0.005, 0.005), 7.8, 8.4);
      s.dissolved_oxygen = clamp(s.dissolved_oxygen + rand(-0.05, 0.05), 6, 9);
      s.turbidity = clamp(s.turbidity + rand(-0.05, 0.05), 0.5, 8);
      s.chlorophyll_a = clamp(s.chlorophyll_a + rand(-0.03, 0.04), 0.3, 6);
      s.temperature = clamp(s.temperature + rand(-0.05, 0.05), 22, 30);
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
        const bz = beachZones.find(b => b.id === s.zone_id);
        pushDecision({
          module: 'TideSync / AquaGuard',
          action: 'hab_early_warning',
          zone: bz ? bz.name : s.zone_id,
          detail: 'Chlorophyll-a rising (' + s.chlorophyll_a.toFixed(1) + ' μg/L) — 48h HAB risk forecast'
        });
      }
    });

    beachZones.forEach((b, idx) => {
      const noise = rand(-0.05, 0.05);
      b.current_count = Math.round(b.capacity * clamp(beachOcc + noise + (idx === 1 ? 0.05 : 0), 0, 1));
      b.occupancy_pct = +(b.current_count / b.capacity * 100).toFixed(1);
      const surge = b.occupancy_pct > 80 ? 1.5 : b.occupancy_pct > 60 ? 1.2 : 1.0;
      b.surge = surge;
      b.price_egp = Math.round(150 * surge);
      b.tier = surge >= 1.5 ? 'high_demand' : surge >= 1.2 ? 'elevated' : 'standard';
      const newAccess = Math.max(0, b.current_count * 0.01);
      counters.beach_revenue_egp += newAccess * b.price_egp / 60;
    });

    if (Math.random() < 0.12) {
      const overcrowded = beachZones.find(b => b.occupancy_pct > 80);
      const underused = beachZones.find(b => b.occupancy_pct < 40);
      if (overcrowded && underused) {
        pushDecision({
          module: 'TideSync / BeachPulse',
          action: 'visitor_redirect_recommended',
          zone: overcrowded.name,
          detail: overcrowded.occupancy_pct + '% full → redirect to ' + underused.name +
            ' (' + underused.occupancy_pct + '%, EGP ' + underused.price_egp + ')'
        });
      }
    }

    emit('tick', {
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
    });
  }

  // public API
  window.CityPulseSim = {
    connect(h) {
      handler = h;
      // mirror the server's "hello" message
      h({
        type: 'hello',
        payload: {
          sim_clock: simClock(),
          counters: serializeCounters(),
          decisions: decisionsBuf.slice(0, 20),
          zones, bins, desalTrains, beachZones, marineStations
        }
      });
      // first tick immediately to populate the dashboard, then 1Hz
      tick();
      setInterval(tick, 1000);
    }
  };
})();
