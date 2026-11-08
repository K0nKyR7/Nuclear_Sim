import os
import pytest
from py_mini_racer import MiniRacer


def test_html_and_css_game_over_elements():
    """Проверка наличия слоя разбитого стекла, стилей повреждения кнопок и модального окна GameOver."""
    base_dir = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
    html_path = os.path.join(base_dir, "frontend", "index.html")
    css_path = os.path.join(base_dir, "frontend", "css", "style.css")

    with open(html_path, "r", encoding="utf-8") as f:
        html = f.read()

    with open(css_path, "r", encoding="utf-8") as f:
        css = f.read()

    # Проверка разбитого стекла
    assert "crtShatteredGlass" in html
    assert "cracks-svg" in html
    assert "crack-core" in html
    assert "crack-major" in html
    assert "crack-hole" in html

    # Проверка модального окна окончания игры
    assert "gameOverModal" in html
    assert "btnRestartGame" in html
    assert "ЭНЕРГОБЛОК №1 ПОЛНОСТЬЮ УНИЧТОЖЕН" in html
    assert "postmortem-metrics-grid" in html

    # Проверка CSS правил
    assert ".crt-shattered-glass.active" in css
    assert "body.catastrophe-destroyed" in css
    assert ".game-over-modal-overlay.visible" in css
    assert ".btn-restart-game" in css


def test_audio_glass_shatter_and_sparks():
    """Проверка методов процедурного звука разбитого стекла и короткого замыкания."""
    base_dir = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
    audio_path = os.path.join(base_dir, "frontend", "js", "audio.js")

    with open(audio_path, "r", encoding="utf-8") as f:
        audio_code = f.read()

    assert "playGlassShatter()" in audio_code
    assert "playShortCircuitSpark()" in audio_code

    mr = MiniRacer()
    mr.eval("globalThis.window = { addEventListener: () => {} };")
    mr.eval(audio_code)
    # Проверяем наличие методов на window.plantAudio
    has_shatter = mr.eval("typeof window.plantAudio.playGlassShatter === 'function'")
    has_spark = mr.eval("typeof window.plantAudio.playShortCircuitSpark === 'function'")
    assert has_shatter is True
    assert has_spark is True


def test_app_game_over_controller_logic():
    """Проверка логики блокировки кнопок и завершения игры в PlantApp."""
    base_dir = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
    app_path = os.path.join(base_dir, "frontend", "js", "app.js")

    with open(app_path, "r", encoding="utf-8") as f:
        app_code = f.read()

    assert "triggerNuclearCatastropheGameOver" in app_code
    assert "resetPlantFromGameOver" in app_code
    assert "catastrophe-destroyed" in app_code
    assert "crtShatteredGlass" in app_code

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
    has_trigger = mr.eval("typeof ScadaApp.prototype.triggerNuclearCatastropheGameOver === 'function'")
    has_reset = mr.eval("typeof ScadaApp.prototype.resetPlantFromGameOver === 'function'")
    assert has_trigger is True
    assert has_reset is True
