# CityPulse — EcoSync + TideSync

**AI-Powered Smart Coastal City Operating System**
New Alamein City · Alamein AI Hackathon · May 2026

CityPulse turns New Alamein's existing IoT infrastructure into an autonomous decision layer. It sits on top of the city's IoT API platform, ingests live telemetry from sensors, smart bins, RVMs, CCTV cameras, desalination SCADA, and marine buoys — and issues automated operational decisions in under 5 seconds, 24/7, without human intervention.

> **One-line pitch:** New Alamein is one of the smartest cities ever built — yet 73% of its IoT data is unused because there's no AI brain converting it into decisions. CityPulse is that brain.

---

## Headline Numbers (Pilot — 8,000 Active Units)

| Metric | EcoSync | TideSync | **Combined** |
|---|---|---|---|
| Energy saved | 2.5 GWh/yr | 25.5 GWh/yr | **28.0 GWh/yr** |
| Cost savings | EGP 5.87M/yr | EGP 58.7M/yr | **EGP 64.6M/yr** |
| New revenue | — | EGP 15-25M/yr | **EGP 15-25M/yr** |
| CO₂ avoided | 1,408 t/yr | 13,005 t/yr | **14,413 t/yr** |
| Plastic bottles recycled | 720,000/yr | — | **720,000/yr** |
| Diesel saved | 36,250 L/yr | — | **36,250 L/yr** |
| Customer payback | 8 months | 4 months | **4 months (Phase A)** |

**Real-world equivalents:** 3,133 cars removed · 240,217 trees planted · 4.6 M m³/yr of freshwater optimized · 4,804 households' worth of carbon footprint avoided.

---

## What's Inside the Demo

- **3D operations map** (MapLibre GL JS) — 8 windowed buildings, 14 km coastline, 6 beach platforms, desalination plant. Every element is clickable for live status popups.
- **Live KPI strip** — energy saved, desal energy saved, CO₂ avoided, EGP saved, bottles recycled, truck trips cancelled.
- **AI decision stream** — every decision spawns a glowing ripple at the affected map location, color-coded by module.
- **Charts** (Chart.js) — 60-point rolling load curve (kW) and water demand (m³/h) with active RO trains overlay.
- **Bottom row** — 6-zone beach grid (BeachPulse + AquaGuard), 4 RO trains live status, 6 smart bins.
- **Cinematic flyover** — togglable camera rotation around the city.

### Modules

| Module | Sub-module | What it does |
|---|---|---|
| **EcoSync** | Energy Optimizer | Occupancy-driven HVAC, lighting, pool heating, off-peak pre-cooling |
| **EcoSync** | Smart Waste Routing | Bin fill-level → dynamic truck dispatch over 48 km coastal footprint |
| **EcoSync** | RVM Network | 40 beach-grade Reverse Vending Machines for plastic + reward points |
| **TideSync** | DesalSync | AI-optimized desalination: demand prediction, off-peak scheduling, membrane health ML |
| **TideSync** | AquaGuard | Marine water quality (pH, DO, turbidity, chlorophyll-a) on 24 buoys; 48-72h HAB prediction |
| **TideSync** | BeachPulse | Live beach occupancy, dynamic zone pricing, cabana allocation |

---

## Quick Start (Local)

```bash
npm install
npm start
```

Open <http://localhost:3000> for the live operations dashboard. The simulator ticks once per real second (= 1 simulated minute), so KPI counters and decision feed update continuously.

## Live Deployment (Render)

This repo is configured for one-click deployment on [Render](https://render.com) using `render.yaml`:

1. Sign in to Render with your GitHub account.
2. Click **New → Blueprint** and select `CityPulse-Ai-Hackathon-Alamein`.
3. Render reads `render.yaml` and provisions a free Node web service.
4. Build runs `npm install`; start runs `node server.js`.
5. Public URL is live in ~3 minutes — share it with hackathon judges.

The dashboard auto-detects HTTPS and upgrades the WebSocket to `wss://`, so the live KPI strip, AI ripples, and 3D map work over Render's HTTPS endpoint without any client-side changes.

> **Why not Vercel?** Vercel's serverless model can't host the WebSocket server, the 1-second simulator interval, or the in-memory accumulating state — all of which are core to the live demo. Render runs the persistent Node process unchanged.

## REST API Endpoints

| Method | Path | Purpose |
|---|---|---|
| GET | `/api/dashboard/city-overview` | Aggregate KPIs across both modules (also used as healthcheck) |
| GET | `/api/ecosync/zones/:zoneId/status` | Per-zone occupancy, load, savings %, HVAC setpoint, lighting % |
| GET | `/api/tidesync/desal/status` | All 4 RO trains: state, throughput, energy draw |
| GET | `/api/tidesync/aquaguard/zones/:zoneId` | Per-zone water quality + safety score |
| GET | `/api/tidesync/beach/:zoneId/occupancy` | Per-zone occupancy + dynamic price + cabana availability |
| GET | `/api/decisions/recent` | Ring buffer of recent AI decisions |
| WS | `/live` | Real-time stream: `hello`, `tick`, `decision` messages |

## Tech Stack

Node.js 18+ · Express · ws (WebSocket) · MapLibre GL JS · Chart.js · vanilla JS · Carto dark raster tiles (no API key required).

## Architecture (5 layers)

```
L0  Data Sources    IoT sensors · 420 CCTV · 200 bins · 40 RVMs · desal SCADA · 24 marine buoys
L1  Ingestion       MQTT (Mosquitto) · 24h SQLite buffer · City IoT Gateway adapter
L2  Intelligence    Decision engine (FastAPI) · Redis cache · YOLOv8 edge · Prophet/LSTM · circuit breakers
L3  Action          HVAC commands · fleet dispatch · desal scheduling · beach pricing · RVM rewards
L4  Presentation    Operations dashboard · resident app · City Authority reports · public displays
```

Three independent failure domains (cloud, edge, on-device); end-to-end p99 decision latency under 200 ms.

## Repository Structure

```
.
├── server.js              # Express + WebSocket simulator + REST API
├── public/
│   └── index.html         # Self-contained 3D dashboard (no build step)
├── package.json           # Node 18+ · express · ws
├── render.yaml            # Render Blueprint (one-click deploy)
├── .gitignore
├── LICENSE                # MIT
└── README.md
```

## License

MIT — see [LICENSE](LICENSE).

## Acknowledgments

New Alamein Hackathon (ACIE) · New Alamein Development Authority · City Edge Developments · NUCA · MHUUC · IEA · IDA · IFC · ASHRAE · OpenWeather · Foundation for Environmental Education · the open-source maintainers of Express, ws, MapLibre GL JS, Chart.js, Mosquitto, Redis, PostgreSQL, FastAPI, nginx, Casbin, PyTorch, and Prophet.
