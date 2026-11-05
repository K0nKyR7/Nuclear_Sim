import json
import os
import re
import pytest
from py_mini_racer import MiniRacer
from fastapi.testclient import TestClient
from backend.api.main import app, get_full_telemetry_dict


@pytest.fixture
def mini_racer_mimic():
    base_dir = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
    mimic_path = os.path.join(base_dir, "frontend", "js", "mimic.js")
    with open(mimic_path, "r", encoding="utf-8") as f:
        js_code = f.read()

    mr = MiniRacer()
    mock_env = """
    const calls = [];
    const mockCanvas = {
        style: { cursor: 'default' },
        getContext: () => mockCtx,
        getBoundingClientRect: () => ({ width: 1200, height: 750, left: 0, top: 0 }),
        parentElement: {
            getBoundingClientRect: () => ({ width: 1200, height: 750 })
        },
        addEventListener: (event, handler) => {
            mockCanvas['on_' + event] = handler;
        }
    };
    const mockCtx = {
        save: () => calls.push('save'),
        restore: () => calls.push('restore'),
        clearRect: (...args) => calls.push(['clearRect', ...args]),
        beginPath: () => calls.push('beginPath'),
        closePath: () => calls.push('closePath'),
        moveTo: (...args) => calls.push(['moveTo', ...args]),
        lineTo: (...args) => calls.push(['lineTo', ...args]),
        stroke: () => calls.push('stroke'),
        fill: () => calls.push('fill'),
        arc: (...args) => calls.push(['arc', ...args]),
        bezierCurveTo: (...args) => calls.push(['bezierCurveTo', ...args]),
        ellipse: (...args) => calls.push(['ellipse', ...args]),
        rect: (...args) => calls.push(['rect', ...args]),
        roundRect: (...args) => calls.push(['roundRect', ...args]),
        fillRect: (...args) => calls.push(['fillRect', ...args]),
        strokeRect: (...args) => calls.push(['strokeRect', ...args]),
        fillText: (...args) => calls.push(['fillText', ...args]),
        measureText: () => ({ width: 50 }),
        setLineDash: () => calls.push('setLineDash'),
        createLinearGradient: () => ({ addColorStop: () => {} }),
        createRadialGradient: () => ({ addColorStop: () => {} }),
        resetTransform: () => calls.push('resetTransform'),
        setTransform: () => calls.push('setTransform'),
        scale: (...args) => calls.push(['scale', ...args])
    };
    globalThis.window = {
        addEventListener: () => {},
        devicePixelRatio: 1
    };
    globalThis.document = {
        getElementById: (id) => mockCanvas
    };
    globalThis.CanvasRenderingContext2D = function() {};
    CanvasRenderingContext2D.prototype = mockCtx;
    globalThis.mockCanvas = mockCanvas;
    globalThis.calls = calls;
    """
    mr.eval(mock_env)
    mr.eval(js_code)
    mr.eval('globalThis.mimicInstance = new PlantMimic("mimicCanvas");')
    return mr


def test_no_undefined_variables_in_mimic_source():
    """Проверяем отсутствие опечаток и необъявленных переменных в drawRealisticReactor."""
    base_dir = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
    mimic_path = os.path.join(base_dir, "frontend", "js", "mimic.js")
    with open(mimic_path, "r", encoding="utf-8") as f:
        code = f.read()

    reactor_func = code.split("drawRealisticReactor(x, y, w, h, s) {")[1].split("drawRealisticPressurizer")[0]
    # Внутри drawRealisticReactor переменные ry и rh не должны использоваться (должны быть y и h)
    assert not re.search(r"\bry\b", reactor_func), "Found undeclared 'ry' in drawRealisticReactor"
    assert not re.search(r"\brh\b", reactor_func), "Found undeclared 'rh' in drawRealisticReactor"
    assert "const hotNozzleY = y - h * 0.16;" in reactor_func
    assert "const coldNozzleY = y + h * 0.16;" in reactor_func


def test_render_with_null_state(mini_racer_mimic):
    """При отсутствии данных с сервера мнемосхема должна рендерить демо/исходное состояние реактора без падения."""
    mr = mini_racer_mimic
    mr.eval('calls.length = 0;')
    mr.eval('mimicInstance.render(0);')
    num_calls = mr.eval('calls.length')
    # Должен отрисоваться реактор и все контуры даже без начальной телеметрии
    assert num_calls > 500, f"Expected > 500 render calls with null state, got {num_calls}"


def test_render_nominal_power_operation(mini_racer_mimic):
    """Рендеринг в режиме 100% мощности ВВЭР-1000."""
    mr = mini_racer_mimic
    telemetry = get_full_telemetry_dict()
    mr.eval(f'mimicInstance.updateState({json.dumps(telemetry)});')
    mr.eval('calls.length = 0;')
    mr.eval('mimicInstance.render(1000);')
    num_calls = mr.eval('calls.length')
    assert num_calls > 1000, f"Expected > 1000 canvas calls on nominal render, got {num_calls}"


def test_render_scrammed_az5(mini_racer_mimic):
    """Рендеринг после срабатывания АЗ-5 (затухающее вишневое свечение, погруженные стержни)."""
    mr = mini_racer_mimic
    telemetry = get_full_telemetry_dict()
    telemetry["state"] = "SCRAMMED"
    telemetry["relative_power_pct"] = 1.5
    telemetry["rod_position_pct"] = 0.0
    telemetry["turbine_rpm"] = 0.0
    telemetry["steam_flow_kg_s"] = 20.0
    telemetry["pz_spray_active"] = False

    mr.eval(f'mimicInstance.updateState({json.dumps(telemetry)});')
    mr.eval('calls.length = 0;')
    mr.eval('mimicInstance.render(2000);')
    num_calls = mr.eval('calls.length')
    assert num_calls > 800


def test_render_zero_coolant_flow_and_trip(mini_racer_mimic):
    """Рендеринг при полной остановке всех 4 ГЦН."""
    mr = mini_racer_mimic
    telemetry = get_full_telemetry_dict()
    telemetry["flow_1k_kg_s"] = 0.0
    telemetry["rcp_active_count"] = 0
    telemetry["rcp_status"] = [False, False, False, False]
    telemetry["feedwater_flow_kg_s"] = 0.0
    telemetry["feedwater_pumps_on"] = [False, False, False]

    mr.eval(f'mimicInstance.updateState({json.dumps(telemetry)});')
    mr.eval('calls.length = 0;')
    mr.eval('mimicInstance.render(3000);')
    num_calls = mr.eval('calls.length')
    assert num_calls > 800


def test_interactive_click_handling(mini_racer_mimic):
    """Интерактивные клики по ГЦН и турбине не должны вызывать исключений."""
    mr = mini_racer_mimic
    telemetry = get_full_telemetry_dict()
    mr.eval(f'mimicInstance.updateState({json.dumps(telemetry)});')

    # Имитация кликов по разным координатам
    mr.eval('mockCanvas.on_click({ clientX: 100, clientY: 100 });')
    mr.eval('mockCanvas.on_click({ clientX: 500, clientY: 350 });')
    mr.eval('mockCanvas.on_click({ clientX: 900, clientY: 200 });')


def test_api_state_returns_full_dict():
    """Эндпоинт /api/state должен возвращать полный набор данных для отрисовки мнемосхемы."""
    client = TestClient(app)
    resp = client.get("/api/state")
    assert resp.status_code == 200
    data = resp.json()

    required_keys = [
        "timestamp", "sim_time_s", "state", "thermal_power_mw",
        "relative_power_pct", "electric_power_mw", "pressure_1k_mpa",
        "t_hot_c", "t_cold_c", "t_fuel_c", "flow_1k_kg_s",
        "pz_level_m", "pz_heaters_kw", "pz_spray_active",
        "pressure_2k_mpa", "sg_level_m", "steam_flow_kg_s",
        "feedwater_flow_kg_s", "turbine_rpm", "condenser_vacuum_kpa",
        "rod_position_pct", "rcp_active_count", "rcp_status"
    ]
    for key in required_keys:
        assert key in data, f"Key '{key}' missing from /api/state response"


def test_render_with_partial_telemetry(mini_racer_mimic):
    """Частичная телеметрия (отсутствие части ключей) не должна крашить отрисовку реактора."""
    mr = mini_racer_mimic
    mr.eval('calls.length = 0;')
    # Передаем телеметрию только с одним полем
    mr.eval('mimicInstance.updateState({ state: "POWER_OPERATION" });')
    mr.eval('mimicInstance.render(100);')
    num_calls = mr.eval('calls.length')
    assert num_calls > 1000, f"Expected > 1000 render calls with partial telemetry, got {num_calls}"


def test_render_with_null_and_nan_values(mini_racer_mimic):
    """Поля с null или NaN значениями должны заменяться безопасными дефолтами без падения toFixed."""
    mr = mini_racer_mimic
    mr.eval('calls.length = 0;')
    mr.eval('''mimicInstance.updateState({
        t_hot_c: null,
        t_cold_c: null,
        flow_1k_kg_s: null,
        rod_position_pct: null,
        pressure_1k_mpa: null,
        pz_level_m: null,
        turbine_rpm: NaN
    });''')
    mr.eval('mimicInstance.render(200);')
    num_calls = mr.eval('calls.length')
    assert num_calls > 1000, f"Expected > 1000 render calls with null/nan values, got {num_calls}"


def test_dynamic_container_resize_handling(mini_racer_mimic):
    """При изменении геометрии родительского контейнера холст должен адаптироваться автоматически."""
    mr = mini_racer_mimic
    mr.eval('mockCanvas.parentElement.getBoundingClientRect = () => ({ width: 1600, height: 900 });')
    mr.eval('mimicInstance.render(300);')
    w = mr.eval('mimicInstance.width')
    h = mr.eval('mimicInstance.height')
    assert w == 1600, f"Expected width 1600 after resize, got {w}"
    assert h == 900, f"Expected height 900 after resize, got {h}"


def test_dpr_scaling(mini_racer_mimic):
    """При высоком DPI (Retina / масштабирование 150%) canvas.width должен масштабироваться без искажения координат."""
    mr = mini_racer_mimic
    mr.eval('globalThis.window.devicePixelRatio = 2.0;')
    mr.eval('mockCanvas.parentElement.getBoundingClientRect = () => ({ width: 1000, height: 600 });')
    mr.eval('mimicInstance.resize();')
    c_w = mr.eval('mockCanvas.width')
    c_h = mr.eval('mockCanvas.height')
    assert c_w == 2000, f"Expected physical canvas width 2000 at DPR 2, got {c_w}"
    assert c_h == 1200, f"Expected physical canvas height 1200 at DPR 2, got {c_h}"
    assert mr.eval('mimicInstance.width') == 1000
    assert mr.eval('mimicInstance.height') == 600


def test_core_cross_section_163_assemblies(mini_racer_mimic):
    """Картограмма активной зоны ВВЭР-1000 должна содержать ровно 163 гексагональные ТВС."""
    mr = mini_racer_mimic
    count = mr.eval('mimicInstance.coreAssemblies.length')
    assert count == 163, f"Ожидалось ровно 163 ТВС в активной зоне ВВЭР-1000, получено: {count}"

    # Переключаем мнемосхему в режим картограммы активной зоны
    mr.eval('mimicInstance.viewMode = "core";')
    mr.eval('calls.length = 0;')
    mr.eval('mimicInstance.render(500);')
    num_calls = mr.eval('calls.length')
    assert num_calls > 1000, f"Expected > 1000 calls on core cartogram render, got {num_calls}"

    # Проверяем, что созданы хитбоксы всех 163 ТВС
    rendered_count = mr.eval('mimicInstance.renderedAssemblies.length')
    assert rendered_count == 163, f"Ожидалась отрисовка 163 хитбоксов ТВС, получено: {rendered_count}"


def test_crt_phosphor_p31_rendering(mini_racer_mimic):
    """Монохромный режим P31 зеленого люминофора с растровыми строками ЭЛТ."""
    mr = mini_racer_mimic
    mr.eval('mimicInstance.crtMode = "p31";')
    mr.eval('mimicInstance.viewMode = "schematic";')
    mr.eval('calls.length = 0;')
    mr.eval('mimicInstance.render(600);')
    assert mr.eval('calls.length') > 1000

    mr.eval('mimicInstance.viewMode = "core";')
    mr.eval('calls.length = 0;')
    mr.eval('mimicInstance.render(700);')
    assert mr.eval('calls.length') > 1000


def test_saoz_injection_and_four_loops_rendering(mini_racer_mimic):
    """Отрисовка пассивного впрыска САОЗ (P1 < 6.0 МПа) и арматуры ГОСТ (БРУ-К, БРУ-А)."""
    mr = mini_racer_mimic
    telemetry = get_full_telemetry_dict()
    telemetry["pressure_1k_mpa"] = 5.2
    telemetry["saoz_active"] = True
    telemetry["saoz_flow_kg_s"] = 450.0
    telemetry["bru_k_pct"] = 80.0
    telemetry["bru_a_pct"] = 35.0

    mr.eval('mimicInstance.viewMode = "schematic";')
    mr.eval(f'mimicInstance.updateState({json.dumps(telemetry)});')
    mr.eval('calls.length = 0;')
    mr.eval('mimicInstance.render(800);')
    assert mr.eval('calls.length') > 1000

    # Проверяем наличие 4 хитбоксов ГЦН на схеме
    rcp_count = mr.eval('mimicInstance.renderedRcps.length')
    assert rcp_count == 4, f"Ожидалось 4 петли ГЦН, получено: {rcp_count}"


def test_interactive_clicks_rcp_and_core_assemblies(mini_racer_mimic):
    """Интерактивный выбор ТВС по клику и клик по ГЦН петель."""
    mr = mini_racer_mimic
    # В режиме картограммы клик по центру холста выбирает центральную ТВС
    mr.eval('mimicInstance.viewMode = "core";')
    mr.eval('mimicInstance.render(900);')

    # Получаем координаты центральной ТВС (id=82)
    center_cx = mr.eval('mimicInstance.renderedAssemblies.find(a => a.id === 82).cx')
    center_cy = mr.eval('mimicInstance.renderedAssemblies.find(a => a.id === 82).cy')

    mr.eval(f'mockCanvas.on_click({{ clientX: {center_cx}, clientY: {center_cy} }});')
    selected_id = mr.eval('mimicInstance.selectedAssemblyId')
    assert selected_id == 82, f"Expected selected assembly 82, got {selected_id}"

    # В режиме схемы клик по петле ГЦН
    mr.eval('mimicInstance.viewMode = "schematic";')
    mr.eval('mimicInstance.render(1000);')
    rcp0_x = mr.eval('mimicInstance.renderedRcps[0].x')
    rcp0_y = mr.eval('mimicInstance.renderedRcps[0].y')
    mr.eval(f'mockCanvas.on_click({{ clientX: {rcp0_x}, clientY: {rcp0_y} }});')


def test_gost_valves_and_four_loop_hitboxes(mini_racer_mimic):
    """Проверка наличия габаритов w, h у всех 4 петель и ГОСТ арматуры."""
    mr = mini_racer_mimic
    mr.eval('mimicInstance.viewMode = "schematic";')
    mr.eval('mimicInstance.render(1100);')

    # Проверяем 4 петли и их размеры
    rcps_json = mr.eval('JSON.stringify(mimicInstance.renderedRcps);')
    rcps = json.loads(rcps_json)
    assert len(rcps) == 4
    for rcp in rcps:
        assert "w" in rcp and rcp["w"] > 0
        assert "h" in rcp and rcp["h"] > 0

    # Проверяем клик на левом краю карточки петли (в пределах прямоугольника w x h)
    edge_x = rcps[0]["x"] - rcps[0]["w"] / 2 + 2
    edge_y = rcps[0]["y"]
    mr.eval(f'mockCanvas.on_click({{ clientX: {edge_x}, clientY: {edge_y} }});')


def test_enlarged_loop_card_dimensions_and_clicks(mini_racer_mimic):
    """Габариты карточек 4 петель должны быть увеличены на ~40-50% (78-85px ширина, 46-50px высота)."""
    mr = mini_racer_mimic
    mr.eval('mimicInstance.viewMode = "schematic";')
    mr.eval('mimicInstance.render(1200);')

    rcps_json = mr.eval('JSON.stringify(mimicInstance.renderedRcps);')
    rcps = json.loads(rcps_json)
    assert len(rcps) == 4

    for rcp in rcps:
        assert 78 <= rcp["w"] <= 85, f"Expected card width 78-85px, got {rcp['w']}"
        assert 46 <= rcp["h"] <= 50, f"Expected card height 46-50px, got {rcp['h']}"
        assert rcp["r"] >= 24

    # Клик по правому краю карточки 3-й петли
    right_edge_x = rcps[2]["x"] + rcps[2]["w"] / 2 - 2
    right_edge_y = rcps[2]["y"]
    mr.eval(f'mockCanvas.on_click({{ clientX: {right_edge_x}, clientY: {right_edge_y} }});')


def test_loop_cards_spatial_clearance_without_steamline_overlap(mini_racer_mimic):
    """Карточки 4-х петель не должны накладываться на паровую магистраль или выхлоп БРУ-А при разных разрешениях."""
    mr = mini_racer_mimic
    mr.eval('mimicInstance.viewMode = "schematic";')

    for w in [800, 1024, 1280, 1600]:
        mr.eval(f'mockCanvas.parentElement.getBoundingClientRect = () => ({{ width: {w}, height: 700 }});')
        mr.eval(f'mockCanvas.getBoundingClientRect = () => ({{ width: {w}, height: 700, left: 0, top: 0 }});')
        mr.eval(f'mimicInstance.width = {w}; mimicInstance.height = 700;')
        mr.eval('mimicInstance.render(1300);')
        rcps = json.loads(mr.eval('JSON.stringify(mimicInstance.renderedRcps);'))
        assert len(rcps) == 4

        turbx = w * 0.81
        steam_inlet_x = turbx - 52
        sgSteamX = w * 0.56 + 35
        bruAX = sgSteamX + (steam_inlet_x - sgSteamX) * 0.18

        last_card = rcps[3]
        last_card_right = last_card["x"] + last_card["w"] / 2

        # Правый край 4-й карточки не должен пересекать вход паропровода в турбину и выхлопную трубу БРУ-А
        assert last_card_right <= steam_inlet_x, (
            f"At width {w}, loop card right edge ({last_card_right}) overlaps turbine steam line ({steam_inlet_x})"
        )
        assert last_card_right <= bruAX + 1, (
            f"At width {w}, loop card right edge ({last_card_right}) overlaps BRU-A vent ({bruAX})"
        )


def test_schematic_interactive_mouse_hover_cursor(mini_racer_mimic):
    """При наведении мыши в режиме мнемосхемы курсор должен меняться на pointer для интерактивных элементов."""
    mr = mini_racer_mimic
    mr.eval('mimicInstance.viewMode = "schematic";')
    mr.eval('mimicInstance.render(1400);')

    rcps = json.loads(mr.eval('JSON.stringify(mimicInstance.renderedRcps);'))
    card0_x = rcps[0]["x"]
    card0_y = rcps[0]["y"]

    # 1. Наведение на карточку петли
    mr.eval(f'mockCanvas.on_mousemove({{ clientX: {card0_x}, clientY: {card0_y} }});')
    cursor = mr.eval('mockCanvas.style.cursor')
    assert cursor == 'pointer', f"Expected pointer cursor over loop card, got {cursor}"

    # 2. Наведение в пустое место холста
    mr.eval('mockCanvas.on_mousemove({ clientX: 10, clientY: 10 });')
    cursor = mr.eval('mockCanvas.style.cursor')
    assert cursor == 'default', f"Expected default cursor over empty canvas, got {cursor}"





