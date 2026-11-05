import pytest
from fastapi.testclient import TestClient
from backend.api.main import app


def test_api_state():
    client = TestClient(app)
    response = client.get("/api/state")
    assert response.status_code == 200
    data = response.json()
    assert "thermal_power_mw" in data
    assert "pressure_1k_mpa" in data
    assert "state" in data
    assert data["state"] == "POWER_OPERATION"


def test_api_control_and_reset():
    client = TestClient(app)
    # Ручное перемещение стержней
    ctrl_resp = client.post("/api/control", json={"command": "set_rod_speed", "value": -1.0})
    assert ctrl_resp.status_code == 200

    # Сброс
    reset_resp = client.post("/api/reset")
    assert reset_resp.status_code == 200


def test_api_scenarios():
    client = TestClient(app)
    sc_resp = client.post("/api/scenarios/rcp1_trip", json={"active": True})
    assert sc_resp.status_code == 200
    assert sc_resp.json()["active"] is True

    # Отключение сценария
    sc_off = client.post("/api/scenarios/rcp1_trip", json={"active": False})
    assert sc_off.status_code == 200


def test_frontend_serving():
    client = TestClient(app)
    index_resp = client.get("/")
    assert index_resp.status_code == 200
    html = index_resp.text
    assert "operator-desk-apron" in html
    assert "btnAz5" in html
    assert "az5Cover" in html
    assert "tab_controls" in html
    assert "tab_trends" in html
    assert "tab_alarms" in html
    assert "tab_scenarios" in html
    assert "val_t_hot" in html

    css_resp = client.get("/static/css/style.css")
    assert css_resp.status_code == 200
    assert "operator-desk-apron" in css_resp.text

    mimic_resp = client.get("/static/js/mimic.js")
    assert mimic_resp.status_code == 200
    assert "drawRealisticReactor" in mimic_resp.text
    assert "drawRealisticSteamGenerator" in mimic_resp.text

