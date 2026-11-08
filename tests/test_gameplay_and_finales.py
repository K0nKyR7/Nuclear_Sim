"""
Тесты для глобальной переработки геймплея и финалов:
- Сменные задания (missions) и отслеживание целей
- Спринклерная система ГО и аварийный ввод бора ВД
- Все 5 аутентичных финалов (TRIUMPH_SHIFT, COLD_SHUTDOWN_SAFE, CRISIS_CONTAINED, CORE_MELTDOWN, PROMPT_CRITICAL)
- Оценка оператора, начисление штрафов и присвоение категорий
- API эндпоинты и команды вебсокета
- Процедурные звуки финалов и методы фронтенда
"""
import os
import pytest
from fastapi.testclient import TestClient
from py_mini_racer import MiniRacer

from backend.api.main import app
from backend.physics.models import FinaleType, PlantState
from backend.simulation.engine import SimulationEngine, MISSIONS


@pytest.fixture
def engine():
    eng = SimulationEngine()
    eng.reset()
    return eng


def test_mission_definitions_and_switching(engine):
    """Проверка доступности всех сменных заданий и корректности их переключения."""
    assert "BASE_LOAD" in MISSIONS
    assert "MANEUVER" in MISSIONS
    assert "COLD_SHUTDOWN" in MISSIONS
    assert "CRISIS_LOCA" in MISSIONS
    assert "CRISIS_SBO" in MISSIONS
    assert "SANDBOX" in MISSIONS

    # Диспетчерский маневр
    engine.set_mission("MANEUVER")
    assert engine.mission_id == "MANEUVER"
    assert engine.shift_time_s == 0.0

    objs = engine.get_mission_objectives_status()
    assert len(objs) == 4
    assert any("580..620" in o["title"] for o in objs)
    assert any("title" in o and "status" in o for o in objs)

    # Холодный останов
    engine.set_mission("COLD_SHUTDOWN")
    assert engine.mission_id == "COLD_SHUTDOWN"
    objs_cold = engine.get_mission_objectives_status()
    assert any("1800 ppm" in o["title"] for o in objs_cold)

    # Телеметрия содержит информацию о миссии
    t = engine.get_telemetry()
    assert t.mission_id == "COLD_SHUTDOWN"
    assert t.operator_score == 100.0
    assert "A+" in t.operator_grade
    assert t.violations_count == 0


def test_containment_spray_physics(engine):
    """Проверка физического действия спринклерной системы ГО на давление, пар и радиацию."""
    p_before = 320.0
    h2_before = 4.0
    rad_before = 850.0
    engine.thermal_model.containment_pressure_kpa = p_before
    engine.thermal_model.hydrogen_pct = h2_before

    # Включаем спринклер через apply_control
    engine.apply_control("toggle_containment_spray")
    assert engine.thermal_model.containment_spray_active is True
    engine.thermal_model.radiation_level_mr_h = rad_before

    # Шаги со спринклером
    for _ in range(20):  # 1 секунда (dt = 0.05)
        engine.step()

    # Давление в ГО должно заметно упасть (конденсация пара)
    assert engine.thermal_model.containment_pressure_kpa < p_before
    # Радиоактивный фон должен снизиться (мокрый смыв аэрозолей)
    assert engine.thermal_model.radiation_level_mr_h < rad_before
    # Концентрация водорода должна снижаться
    assert engine.thermal_model.hydrogen_pct < h2_before

    # В телеметрии спринклер активен
    telemetry = engine.get_telemetry()
    assert telemetry.containment_spray_active is True


def test_emergency_high_pressure_boron_injection(engine):
    """Проверка аварийного впрыска высококонцентрированного бора ВД."""
    b_initial = engine.primary_state.boron_ppm
    engine.apply_control("toggle_emergency_boron")
    assert engine.thermal_model.emergency_boron_active is True

    for _ in range(40):  # 2 секунды
        engine.step()

    # Концентрация бора в 1К должна возрасти
    assert engine.primary_state.boron_ppm > b_initial + 30.0

    # Проверяем выключение
    engine.apply_control("toggle_emergency_boron")
    assert engine.thermal_model.emergency_boron_active is False


def test_manual_bru_a_steam_dump(engine):
    """Проверка ручного открытия БРУ-А для аварийного расхолаживания."""
    engine.apply_control("set_bru_a", 75.0)
    assert engine.secondary_state.manual_bru_a_pct == 75.0

    telemetry = engine.get_telemetry()
    assert telemetry.bru_a_pct == 75.0


def test_operator_penalty_scoring_and_grading(engine):
    """Проверка начисления штрафных баллов за нарушения и снижения грейда."""
    assert engine.operator_score == 100.0
    assert "A+" in engine.operator_grade

    # Срабатывание АЗ-5 штрафуется на 25 баллов
    engine.safety.trigger_scram("ТЕСТОВЫЙ ШТРАФ", engine.sim_time_s)
    engine.step()

    assert engine.operator_score <= 75.0
    assert len(engine.violations) >= 1 or engine.get_telemetry().violations_count >= 1
    assert "B" in engine.operator_grade or "C" in engine.operator_grade

    # Блокировка АЗ-5 штрафуется на 30 баллов
    engine.apply_control("toggle_bypass_safety")
    engine.step()

    assert engine.operator_score <= 45.0
    assert "D" in engine.operator_grade or "F" in engine.operator_grade


def test_all_five_finales_generation(engine):
    """Проверка генерации отчетов Госкомиссии для всех 5 вариантов финала."""
    # 1. TRIUMPH_SHIFT
    triumph = engine.build_finale_data(FinaleType.TRIUMPH_SHIFT.value)
    assert triumph["ines_level"] == 0
    assert triumph["badge_class"] == "ines-badge-triumph"
    assert "ТРИУМФ ОПЕРАТОРА" in triumph["title"]
    assert len(triumph["cards"]) == 4

    # 2. COLD_SHUTDOWN_SAFE
    cold = engine.build_finale_data(FinaleType.COLD_SHUTDOWN_SAFE.value)
    assert cold["ines_level"] == 0
    assert cold["badge_class"] == "ines-badge-safe"
    assert "ХОЛОДНЫЙ ОСТАНОВ" in cold["title"]

    # 3. CRISIS_CONTAINED
    contained = engine.build_finale_data(FinaleType.CRISIS_CONTAINED.value)
    assert contained["ines_level"] == 2
    assert contained["badge_class"] == "ines-badge-contained"
    assert "ЛОКАЛИЗАЦИЯ" in contained["title"]

    # 4. CORE_MELTDOWN
    meltdown = engine.build_finale_data(FinaleType.CORE_MELTDOWN.value)
    assert meltdown["ines_level"] == 5
    assert meltdown["badge_class"] == "ines-badge-meltdown"
    assert "ПЛАВЛЕНИЕ" in meltdown["title"]

    # 5. PROMPT_CRITICAL
    fatal = engine.build_finale_data(FinaleType.PROMPT_CRITICAL.value)
    assert fatal["ines_level"] == 7
    assert fatal["badge_class"] == "ines-badge-fatal"
    assert "ПОЛНОСТЬЮ УНИЧТОЖЕН" in fatal["title"]


def test_evaluate_shift_and_trigger_finale_conditions(engine):
    """Проверка логики оценки состояния энергоблока при завершении смены."""
    # 1. Штатный режим на 100% мощности -> TRIUMPH_SHIFT
    engine.evaluate_shift_and_trigger_finale(manual=True)
    assert engine.finale_triggered is True
    assert engine.finale_type == FinaleType.TRIUMPH_SHIFT.value

    # Сброс
    engine.reset()

    # 2. Холодный останов
    engine.plant_state = PlantState.COLD_SHUTDOWN
    engine.primary_state.t_hot_c = 85.0
    engine.primary_state.pressure_mpa = 2.5
    engine.primary_state.boron_ppm = 2000.0
    engine.controls_state.rod_position_pct = 0.0
    engine.evaluate_shift_and_trigger_finale(manual=True)
    assert engine.finale_triggered is True
    assert engine.finale_type == FinaleType.COLD_SHUTDOWN_SAFE.value

    # Сброс
    engine.reset()

    # 3. Плавление зоны
    engine.thermal_model.core_damage_pct = 40.0
    engine.evaluate_shift_and_trigger_finale(manual=True)
    assert engine.finale_triggered is True
    assert engine.finale_type == FinaleType.CORE_MELTDOWN.value

    # Сброс
    engine.reset()

    # 4. Локализованный кризис (была течь, но зона спасена, давление снижено спринклером)
    engine.mission_id = "CRISIS_LOCA"
    engine.thermal_model.primary_rupture = True
    engine.safety.saoz_active = True
    engine.thermal_model.containment_spray_active = True
    engine.thermal_model.core_damage_pct = 5.0
    engine.thermal_model.containment_pressure_kpa = 150.0
    engine.evaluate_shift_and_trigger_finale(manual=True)
    assert engine.finale_triggered is True
    assert engine.finale_type == FinaleType.CRISIS_CONTAINED.value

    # 5. Сброс АЗ-5 без повреждения активной зоны -> UNPLANNED_SCRAM
    engine.reset()
    engine.safety.scrammed = True
    engine.thermal_model.core_damage_pct = 0.0
    engine.evaluate_shift_and_trigger_finale(manual=True)
    assert engine.finale_triggered is True
    assert engine.finale_type == FinaleType.UNPLANNED_SCRAM.value


def test_api_mission_and_end_shift_endpoints():
    """Проверка REST эндпоинтов для миссий и сдачи смены."""
    client = TestClient(app)

    # Смена миссии
    resp = client.post("/api/mission", json={"mission_id": "MANEUVER"})
    assert resp.status_code == 200
    data = resp.json()
    assert data["status"] == "ok"
    assert data["mission_id"] == "MANEUVER"

    # Сдача смены
    resp_end = client.post("/api/shift/end")
    assert resp_end.status_code == 200
    end_data = resp_end.json()
    assert end_data["status"] == "ok"
    assert end_data["finale_triggered"] is True
    assert "finale_data" in end_data
    assert end_data["finale_data"]["title"] is not None


def test_audio_fanfares_and_chimes():
    """Проверка аудио-методов для различных финалов в audio.js."""
    base_dir = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
    audio_path = os.path.join(base_dir, "frontend", "js", "audio.js")
    with open(audio_path, "r", encoding="utf-8") as f:
        audio_code = f.read()

    mr = MiniRacer()
    mr.eval("globalThis.window = { addEventListener: () => {} };")
    mr.eval(audio_code)

    assert mr.eval("typeof window.plantAudio.playTriumphFanfare === 'function'") is True
    assert mr.eval("typeof window.plantAudio.playColdShutdownConfirmation === 'function'") is True
    assert mr.eval("typeof window.plantAudio.playCrisisContainedChime === 'function'") is True
    assert mr.eval("typeof window.plantAudio.playObjectiveDing === 'function'") is True


def test_app_shift_finale_methods():
    """Проверка методов triggerShiftFinale и populateGameOverModal в app.js."""
    base_dir = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
    app_path = os.path.join(base_dir, "frontend", "js", "app.js")
    with open(app_path, "r", encoding="utf-8") as f:
        app_code = f.read()

    mr = MiniRacer()
    mock_env = """
    globalThis.window = {
        addEventListener: () => {},
        location: { protocol: 'http:', host: 'localhost:8000' }
    };
    globalThis.document = {
        getElementById: () => ({ addEventListener: () => {}, classList: { add: () => {}, remove: () => {} } }),
        addEventListener: () => {},
        body: { classList: { add: () => {}, remove: () => {} } }
    };
    globalThis.WebSocket = function() {};
    globalThis.PlantMimic = function() {};
    globalThis.TelemetryChart = function() {};
    """
    mr.eval(mock_env)
    mr.eval(app_code)

    assert mr.eval("typeof ScadaApp.prototype.triggerShiftFinale === 'function'") is True
    assert mr.eval("typeof ScadaApp.prototype.populateGameOverModal === 'function'") is True
    assert mr.eval("typeof ScadaApp.prototype.returnFromInspection === 'function'") is True


def test_unplanned_scram_finale_classification(engine):
    """Проверка, что штатный сброс АЗ-5 без повреждения топлива дает INES 1, а не расплавление зоны."""
    engine.safety.trigger_scram("Тестовый сброс защит", engine.sim_time_s)
    engine.thermal_model.core_damage_pct = 0.0
    engine.evaluate_shift_and_trigger_finale(manual=True)

    assert engine.finale_triggered is True
    assert engine.finale_type == FinaleType.UNPLANNED_SCRAM.value
    data = engine.finale_data
    assert data["ines_level"] == 1
    assert data["badge_class"] == "ines-badge-scram"
    assert "ВНЕПЛАНОВЫЙ СБРОС" in data["title"]
    assert "100.0% ЦЕЛЫХ ТВЭЛ" in data["cards"][0]["val"]


def test_operator_shift_grades_consequences(engine):
    """Проверка дифференцированного заключения комиссии в зависимости от рейтинга оператора."""
    # 1. Отличная смена (score >= 80)
    engine.operator_score = 95.0
    engine.operator_grade = "A+ (МАСТЕР)"
    d_master = engine.build_finale_data(FinaleType.TRIUMPH_SHIFT.value)
    assert "ТРИУМФ ОПЕРАТОРА" in d_master["title"]
    assert d_master["ines_level"] == 0

    # 2. Смена с замечаниями (50 <= score < 80)
    engine.operator_score = 65.0
    engine.operator_grade = "B (ШТАТНЫЙ ОПЕРАТОР)"
    d_warn = engine.build_finale_data(FinaleType.TRIUMPH_SHIFT.value)
    assert "ПРЕДУПРЕЖДЕНИЕМ" in d_warn["title"]
    assert "ДЕЖУРСТВО С ЗАМЕЧАНИЯМИ" in d_warn["badge_text"]

    # 3. Смена провалена / трибунал (score < 50)
    engine.operator_score = 20.0
    engine.operator_grade = "F (ТРИБУНАЛ)"
    d_tribunal = engine.build_finale_data(FinaleType.TRIUMPH_SHIFT.value)
    assert "ПРОВАЛЕНА" in d_tribunal["title"]
    assert "ДИСЦИПЛИНАРНОЕ" in d_tribunal["title"]
    assert "ГРУБЫЕ НАРУШЕНИЯ" in d_tribunal["badge_text"]


def test_mission_switching_scenario_cleanup(engine):
    """Проверка очистки аварийных воздействий при переходе между миссиями."""
    # Запускаем LOCA
    engine.set_mission("CRISIS_LOCA")
    assert engine.active_scenarios["loca_leak"] is True
    assert engine.thermal_model.loca_leak_rate_kg_s == 350.0

    # Переключаемся на BASE_LOAD
    engine.set_mission("BASE_LOAD")
    assert engine.active_scenarios["loca_leak"] is False
    assert engine.thermal_model.loca_leak_rate_kg_s == 0.0

    # Запускаем SBO
    engine.set_mission("CRISIS_SBO")
    assert engine.active_scenarios["station_blackout"] is True
    assert all(not r for r in engine.primary_state.rcp_status)
    assert engine.thermal_model.grid_disconnected is True

    # Переключаемся на MANEUVER
    engine.set_mission("MANEUVER")
    assert engine.active_scenarios["station_blackout"] is False
    assert all(r for r in engine.primary_state.rcp_status)
    assert engine.thermal_model.grid_disconnected is False


def test_cold_shutdown_physics_and_completion(engine):
    """Проверка достижения параметров холодного останова при штатных действиях оператора."""
    engine.set_mission("COLD_SHUTDOWN")
    # Глушим АЗ-5
    engine.apply_control("az5")
    # Вводим бор высокого давления
    engine.apply_control("toggle_emergency_boron")
    # Открываем БРУ-А на 100%
    engine.apply_control("set_bru_a", 100.0)

    # Моделируем 90 секунд расхолаживания (1800 шагов по dt = 0.05)
    for _ in range(1800):
        engine.step()

    assert engine.controls_state.rod_position_pct == 0.0
    assert engine.primary_state.boron_ppm >= 1800.0
    assert engine.primary_state.t_hot_c < 100.0
    assert engine.primary_state.pressure_mpa < 3.5
    assert engine.plant_state == PlantState.COLD_SHUTDOWN


def test_inspect_hud_bar_and_audio_horn():
    """Проверка наличия элементов inspect HUD и аудио метода playUnplannedScramHorn."""
    base_dir = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
    html_path = os.path.join(base_dir, "frontend", "index.html")
    css_path = os.path.join(base_dir, "frontend", "css", "style.css")
    audio_path = os.path.join(base_dir, "frontend", "js", "audio.js")

    with open(html_path, "r", encoding="utf-8") as f:
        html = f.read()
    with open(css_path, "r", encoding="utf-8") as f:
        css = f.read()
    with open(audio_path, "r", encoding="utf-8") as f:
        audio = f.read()

    assert "inspectHudBar" in html
    assert "btnReturnToReport" in html
    assert "btnInspectRestart" in html
    assert ".inspect-hud-bar" in css
    assert ".game-over-box.unplanned-scram" in css
    assert ".ines-badge-scram" in css

    mr = MiniRacer()
    mr.eval("globalThis.window = { addEventListener: () => {} };")
    mr.eval(audio)
    assert mr.eval("typeof window.plantAudio.playUnplannedScramHorn === 'function'") is True
