import asyncio
import json
import logging
import os
from contextlib import asynccontextmanager
from typing import List, Set, Any

from fastapi import FastAPI, WebSocket, WebSocketDisconnect, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles
from fastapi.responses import FileResponse
from pydantic import BaseModel

from ..simulation.engine import SimulationEngine

logging.basicConfig(level=logging.INFO, format="%(asctime)s [%(levelname)s] %(message)s")
logger = logging.getLogger("nuclear_sim")

engine = SimulationEngine()
active_websockets: Set[WebSocket] = set()
sim_task: asyncio.Task = None


class ControlRequest(BaseModel):
    command: str
    value: Any = None


class ScenarioRequest(BaseModel):
    active: bool


@asynccontextmanager
async def lifespan(app: FastAPI):
    global sim_task
    logger.info("Инициализация цикла симуляции реактора (20 Гц)...")
    sim_task = asyncio.create_task(run_simulation_loop())
    yield
    if sim_task:
        sim_task.cancel()
        try:
            await sim_task
        except asyncio.CancelledError:
            pass
    logger.info("Цикл симуляции остановлен.")


def get_full_telemetry_dict() -> dict:
    telemetry = engine.get_telemetry()
    return {
        "timestamp": telemetry.timestamp,
        "sim_time_s": telemetry.sim_time_s,
        "state": telemetry.state.value,
        "thermal_power_mw": telemetry.thermal_power_mw,
        "relative_power_pct": telemetry.relative_power_pct,
        "electric_power_mw": telemetry.electric_power_mw,
        "residual_heat_mw": telemetry.residual_heat_mw,
        "reactivity_pcm": telemetry.reactivity_pcm,
        "period_s": telemetry.period_s,
        "pressure_1k_mpa": telemetry.pressure_1k_mpa,
        "t_hot_c": telemetry.t_hot_c,
        "t_cold_c": telemetry.t_cold_c,
        "t_fuel_c": telemetry.t_fuel_c,
        "flow_1k_kg_s": telemetry.flow_1k_kg_s,
        "t_sat_1k_c": telemetry.t_sat_1k_c,
        "subcooling_margin_c": telemetry.subcooling_margin_c,
        "boron_ppm": telemetry.boron_ppm,
        "saoz_active": telemetry.saoz_active,
        "saoz_flow_kg_s": telemetry.saoz_flow_kg_s,
        "saoz_accum_pressure_mpa": telemetry.saoz_accum_pressure_mpa,
        "saoz_accum_level_pct": telemetry.saoz_accum_level_pct,
        "pz_level_m": telemetry.pz_level_m,
        "pz_heaters_kw": telemetry.pz_heaters_kw,
        "pz_spray_active": telemetry.pz_spray_active,
        "pressure_2k_mpa": telemetry.pressure_2k_mpa,
        "sg_level_m": telemetry.sg_level_m,
        "steam_flow_kg_s": telemetry.steam_flow_kg_s,
        "feedwater_flow_kg_s": telemetry.feedwater_flow_kg_s,
        "turbine_rpm": telemetry.turbine_rpm,
        "condenser_vacuum_kpa": telemetry.condenser_vacuum_kpa,
        "rod_position_pct": telemetry.rod_position_pct,
        "bru_k_pct": telemetry.bru_k_pct,
        "bru_a_pct": telemetry.bru_a_pct,
        "rcp_active_count": telemetry.rcp_active_count,
        "rcp_status": engine.primary_state.rcp_status,
        "auto_power": engine.controls_state.auto_power_controller,
        "pz_heaters_auto": engine.pz_state.heaters_auto,
        "feedwater_pumps_on": engine.secondary_state.feedwater_pumps_on,
        "core_damage_pct": telemetry.core_damage_pct,
        "containment_pressure_kpa": telemetry.containment_pressure_kpa,
        "radiation_level_mr_h": telemetry.radiation_level_mr_h,
        "hydrogen_pct": telemetry.hydrogen_pct,
        "primary_rupture": telemetry.primary_rupture,
        "steam_pipe_ruptured": telemetry.steam_pipe_ruptured,
        "explosion_active": telemetry.explosion_active,
        "explosion_type": telemetry.explosion_type,
        "nuclear_detonation": telemetry.nuclear_detonation,
        "reactor_head_blown": telemetry.reactor_head_blown,
        "safety_system_bypassed": telemetry.safety_system_bypassed,
        "is_paused": engine.is_paused,
        "time_scale": engine.time_scale,
        "active_scenarios": engine.active_scenarios,
        "alarms": telemetry.alarms
    }


async def run_simulation_loop():
    """
    Асинхронный цикл симуляции реального времени (20 Гц).
    """
    tick_interval = 0.05  # 50 мс
    broadcast_skip = 0
    while True:
        try:
            t0 = asyncio.get_event_loop().time()
            engine.step()

            # Стримим телеметрию клиентам каждые 50 мс (20 FPS)
            broadcast_skip += 1
            if broadcast_skip >= 1 and active_websockets:
                telemetry_dict = get_full_telemetry_dict()
                msg = json.dumps(telemetry_dict)
                # Рассылка всем подключенным клиентам
                dead_sockets = set()
                for ws in active_websockets:
                    try:
                        await ws.send_text(msg)
                    except Exception:
                        dead_sockets.add(ws)
                active_websockets.difference_update(dead_sockets)
                broadcast_skip = 0

            elapsed = asyncio.get_event_loop().time() - t0
            sleep_time = max(0.001, tick_interval - elapsed)
            await asyncio.sleep(sleep_time)

        except asyncio.CancelledError:
            break
        except Exception as e:
            logger.error(f"Ошибка в цикле симуляции: {e}", exc_info=True)
            await asyncio.sleep(0.1)


app = FastAPI(
    title="Nuce - Симулятор энергоблока ВВЭР-1000",
    description="Интерактивный симулятор и SCADA-интерфейс энергоблока АЭС",
    version="1.0.0",
    lifespan=lifespan
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


@app.get("/api/state")
def get_state():
    return get_full_telemetry_dict()


@app.post("/api/control")
def apply_control(req: ControlRequest):
    engine.apply_control(req.command, req.value)
    return {"status": "ok", "command": req.command, "value": req.value}


@app.post("/api/scenarios/{scenario_id}")
def set_scenario(scenario_id: str, req: ScenarioRequest):
    if scenario_id not in engine.active_scenarios:
        raise HTTPException(status_code=404, detail="Сценарий не найден")
    engine.trigger_scenario(scenario_id, req.active)
    return {"status": "ok", "scenario": scenario_id, "active": req.active}


@app.post("/api/reset")
def reset_sim():
    engine.reset()
    return {"status": "ok", "message": "Симуляция сброшена на 100% Nном"}


@app.post("/api/pause")
def toggle_pause(paused: bool = True):
    engine.apply_control("set_pause", paused)
    return {"status": "ok", "paused": engine.is_paused}


@app.post("/api/speed")
def set_speed(speed: float = 1.0):
    engine.apply_control("set_time_scale", speed)
    return {"status": "ok", "speed": engine.time_scale}


@app.websocket("/ws/telemetry")
async def websocket_telemetry_endpoint(websocket: WebSocket):
    await websocket.accept()
    active_websockets.add(websocket)
    logger.info(f"Клиент WebSocket подключен. Всего клиентов: {len(active_websockets)}")
    try:
        while True:
            data_text = await websocket.receive_text()
            try:
                data = json.loads(data_text)
                msg_type = data.get("type")
                if msg_type == "control":
                    engine.apply_control(data.get("command"), data.get("value"))
                elif msg_type == "scenario":
                    engine.trigger_scenario(data.get("id"), bool(data.get("active")))
                elif msg_type == "reset":
                    engine.reset()
                elif msg_type == "pause":
                    engine.apply_control("set_pause", data.get("value"))
                elif msg_type == "speed":
                    engine.apply_control("set_time_scale", data.get("value"))
                elif msg_type == "ack_alarms":
                    engine.apply_control("ack_alarms")
            except Exception as e:
                logger.error(f"Ошибка разбора команды клиента: {e}")
    except WebSocketDisconnect:
        active_websockets.discard(websocket)
        logger.info(f"Клиент отключен. Осталось клиентов: {len(active_websockets)}")
    except Exception as e:
        active_websockets.discard(websocket)
        logger.error(f"WebSocket исключение: {e}")


# Монтирование статических файлов веб-интерфейса
frontend_dir = os.path.abspath(os.path.join(os.path.dirname(__file__), "..", "..", "frontend"))
if os.path.isdir(frontend_dir):
    app.mount("/static", StaticFiles(directory=frontend_dir), name="static")

    @app.get("/")
    async def serve_index():
        return FileResponse(os.path.join(frontend_dir, "index.html"))
