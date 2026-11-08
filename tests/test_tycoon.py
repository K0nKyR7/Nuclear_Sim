import os
import re
import pytest
from fastapi.testclient import TestClient
from py_mini_racer import MiniRacer

from backend.api.main import app
from backend.simulation.engine import SimulationEngine


def test_tycoon_api_endpoints():
    """Тестирование REST-эндпоинтов тайкуна: прокачка, буст и получение данных."""
    client = TestClient(app)

    # 1. Прокачка турбины
    resp = client.post("/api/tycoon/upgrade", json={"upgrade": "turbine_generator", "level": 3})
    assert resp.status_code == 200
    data = resp.json()
    assert data["status"] == "ok"
    assert data["upgrades"]["turbine_generator"] == 3

    # 2. Активация буста
    resp_boost = client.post("/api/tycoon/boost?active=true")
    assert resp_boost.status_code == 200
    assert resp_boost.json()["boost_active"] is True

    # 3. Инфо о тайкуне
    resp_info = client.get("/api/tycoon/info")
    assert resp_info.status_code == 200
    info = resp_info.json()
    assert "upgrades" in info
    assert info["upgrades"]["turbine_generator"] == 3
    assert info["boost_active"] is True
    assert "total_energy_mwh" in info

    # 4. Телеметрия содержит информацию о тайкуне
    resp_state = client.get("/api/state")
    assert resp_state.status_code == 200
    state = resp_state.json()
    assert "tycoon_upgrades" in state
    assert state["tycoon_upgrades"]["turbine_generator"] == 3
    assert state["tycoon_boost_active"] is True


def test_tycoon_physics_turbine_upgrade():
    """Проверка реального влияния прокачки турбогенератора на выработку МВт."""
    eng = SimulationEngine()
    eng.reset()
    # Базовый шаг
    eng.step()
    base_mw = eng.secondary_state.electric_power_mw

    # Прокачиваем турбину до 5 уровня
    eng.apply_control("tycoon_upgrade", {"upgrade": "turbine_generator", "level": 5})
    eng.step()
    upgraded_mw = eng.secondary_state.electric_power_mw

    assert upgraded_mw > base_mw
    # +12% прибавка (4 шага по 3%)
    assert upgraded_mw >= base_mw * 1.10


def test_broken_glass_fullscreen_and_no_black_squares():
    """
    Проверка исправления:
    - Нет черных квадратов (.crack-hole не имеет fill: #050508)
    - Трещины растянуты на весь экран (viewBox 0 0 1920 1080, position: fixed, width: 100vw, height: 100vh)
    - crtShatteredGlass вынесен на верхний уровень body
    """
    base = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
    with open(os.path.join(base, "frontend", "index.html"), encoding="utf-8") as f:
        html = f.read()
    with open(os.path.join(base, "frontend", "css", "style.css"), encoding="utf-8") as f:
        css = f.read()

    # crtShatteredGlass больше не заперт внутри mimic-canvas-wrapper
    mimic_wrapper_content = html.split('id="mimicWrapper"')[1].split('</section>')[0]
    assert "crtShatteredGlass" not in mimic_wrapper_content

    # crtShatteredGlass размещен на верхнем уровне
    assert '<div id="crtShatteredGlass" class="crt-shattered-glass">' in html
    # SVG растянут на 1920x1080
    assert 'viewBox="0 0 1920 1080"' in html

    # В CSS: фиксированный оверлей на весь экран
    assert "position: fixed;" in css.split(".crt-shattered-glass {")[1].split("}")[0]
    assert "width: 100vw;" in css.split(".crt-shattered-glass {")[1].split("}")[0]
    assert "height: 100vh;" in css.split(".crt-shattered-glass {")[1].split("}")[0]
    assert "z-index: 10050;" in css.split(".crt-shattered-glass {")[1].split("}")[0]

    # Черные квадраты УДАЛЕНЫ: .crack-hole больше не заливается #050508
    crack_hole_css = css.split(".crack-hole {")[1].split("}")[0]
    assert "#050508" not in crack_hole_css
    assert "fill: rgba(255, 255, 255, 0.05);" in crack_hole_css or "fill: none;" in crack_hole_css


def test_tycoon_frontend_elements_and_miniracer():
    """Проверка наличия всех DOM-элементов тайкуна и корректности выполнения в JS движке."""
    base = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
    with open(os.path.join(base, "frontend", "index.html"), encoding="utf-8") as f:
        html = f.read()
    with open(os.path.join(base, "frontend", "js", "app.js"), encoding="utf-8") as f:
        app_js = f.read()
    with open(os.path.join(base, "frontend", "js", "audio.js"), encoding="utf-8") as f:
        audio_js = f.read()

    # Проверка ключевых элементов тайкуна в HTML
    assert 'id="tycoonMoney"' in html
    assert 'id="tycoonIncome"' in html
    assert 'id="btnHeaderBoost"' in html
    assert 'id="btnTabTycoon"' in html
    assert 'id="tab_tycoon"' in html
    assert 'id="btnTycoonClick"' in html
    assert 'id="btnActivateBoost"' in html
    assert 'id="boostMeterFill"' in html
    assert 'id="batteryStorageVal"' in html
    assert 'id="marketTariffVal"' in html
    assert 'id="btnTycoonPrestige"' in html

    # Аудио движок имеет методы кассового аппарата и буста
    assert "playCashChime()" in audio_js
    assert "playBoostActivate()" in audio_js
    assert "playUpgradePurchased()" in audio_js
    assert "playClickPulse()" in audio_js

    mr = MiniRacer()
    mr.eval("globalThis.window = { addEventListener: () => {} };")
    mr.eval(audio_js)
    assert mr.eval("typeof window.plantAudio.playCashChime === 'function'") is True
    assert mr.eval("typeof window.plantAudio.playBoostActivate === 'function'") is True

    # Проверка класса PlantTycoon в app.js
    assert "class PlantTycoon" in app_js
    assert "window.boost" in app_js
    assert "window['/boost']" in app_js
    assert 'id="tycoonCmdInput"' in html
    assert 'id="btnTycoonCmdExec"' in html

    mr2 = MiniRacer()
    mock_env = """
    globalThis.window = {
        addEventListener: () => {},
        location: { protocol: 'http:', host: 'localhost:8000', search: '', hash: '' }
    };
    globalThis.document = {
        getElementById: () => ({ addEventListener: () => {}, classList: { add: () => {}, remove: () => {} } }),
        addEventListener: () => {},
        querySelectorAll: () => [],
        createElement: () => ({ style: {}, classList: { add: () => {} } }),
        body: { classList: { add: () => {}, remove: () => {} }, appendChild: () => {} }
    };
    globalThis.WebSocket = function() {};
    globalThis.PlantMimic = function() {};
    globalThis.TelemetryChart = function() {};
    """
    mr2.eval(mock_env)
    mr2.eval(app_js)
    assert mr2.eval("typeof PlantTycoon === 'function'") is True
    assert mr2.eval("typeof window.boost === 'function'") is True
    assert mr2.eval("typeof window['/boost'] === 'function'") is True


def test_boost_routes_and_redirects():
    """Проверка доступности прямых маршрутов /boost (GET/POST) и редиректа браузера."""
    client = TestClient(app)

    # 1. POST /boost включает буст
    post_resp = client.post("/boost")
    assert post_resp.status_code == 200
    assert post_resp.json()["boost_active"] is True

    # 2. GET /boost с JSON клиентом
    get_resp = client.get("/boost", headers={"accept": "application/json"})
    assert get_resp.status_code == 200
    assert get_resp.json()["boost_active"] is True

    # 3. GET /boost из браузера (Accept: text/html) перенаправляет на /?boost=active
    html_resp = client.get("/boost", headers={"accept": "text/html,application/xhtml+xml"}, follow_redirects=False)
    assert html_resp.status_code == 303
    assert "/?boost=active" in html_resp.headers["location"]


def test_tycoon_physics_long_term_stability():
    """
    Критическая проверка против бага экспоненциального взрыва:
    При прокачке турбины мощность НЕ должна улетать в 18 000+ МВт и вызывать ложное срабатывание АЗ-5.
    """
    eng = SimulationEngine()
    eng.reset()
    eng.step()
    base_mw = eng.secondary_state.electric_power_mw

    # 5-й уровень турбины (+12% КПД)
    eng.apply_control("tycoon_upgrade", {"upgrade": "turbine_generator", "level": 5})

    # Симулируем 200 шагов (20 секунд работы станции)
    for _ in range(200):
        eng.step()

    stable_mw = eng.secondary_state.electric_power_mw
    # Мощность стабильна и превышает базовую без взрывного роста
    assert stable_mw > base_mw
    assert stable_mw >= base_mw * 1.05
    assert stable_mw < 1400.0  # не улетает в стратосферу
    assert eng.safety.scrammed is False  # энергоблок НЕ аварийно остановлен!


def test_tycoon_console_commands_and_floater_cap():
    """Проверка выполнения текстовых команд /boost, /money, /help и ограничения DOM-элементов."""
    base = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
    with open(os.path.join(base, "frontend", "js", "app.js"), encoding="utf-8") as f:
        app_js = f.read()

    mr = MiniRacer()
    dom_mock = """
    let floaters = [];
    globalThis.window = {
        addEventListener: () => {},
        location: { protocol: 'http:', host: 'localhost:8000', search: '', hash: '' },
        innerWidth: 1920,
        innerHeight: 1080
    };
    globalThis.document = {
        getElementById: () => ({ style: {}, addEventListener: () => {}, classList: { add: () => {}, remove: () => {} }, value: '' }),
        querySelectorAll: (sel) => sel === '.tycoon-floating-text' ? floaters : [],
        createElement: () => {
            const el = {
                className: '',
                style: {},
                parentNode: {
                    removeChild: (c) => {
                        const idx = floaters.indexOf(c);
                        if (idx >= 0) floaters.splice(idx, 1);
                    }
                },
                remove: function() {
                    if (this.parentNode) this.parentNode.removeChild(this);
                }
            };
            return el;
        },
        body: {
            classList: { add: () => {}, remove: () => {} },
            appendChild: (c) => { floaters.push(c); }
        }
    };
    globalThis.WebSocket = function() {};
    globalThis.PlantMimic = function() {};
    globalThis.TelemetryChart = function() {};
    """
    mr.eval(dom_mock)
    mr.eval(app_js)

    # Создаем экземпляр PlantTycoon
    mr.eval("const tycoon = new PlantTycoon({});")

    # 1. Проверяем /boost
    res_boost = mr.eval("tycoon.executeCommand('/boost')")
    assert "ТУРБО-БУСТ" in res_boost
    assert mr.eval("tycoon.boostActive") is True

    # 2. Проверяем /money (+1 000 000 ₽)
    pre_money = mr.eval("tycoon.money")
    res_money = mr.eval("tycoon.executeCommand('/money')")
    assert "субсидия" in res_money.lower()
    assert mr.eval("tycoon.money") == pre_money + 1000000.0

    # 3. Спам кликов для проверки ограничения пула floating elements (<= 16)
    mr.eval("for (let i = 0; i < 40; i++) tycoon.createFloatingText('+100 ₽', 100, 100);")
    assert mr.eval("floaters.length") <= 16

