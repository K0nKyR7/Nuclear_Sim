import os
import re
import pytest


@pytest.fixture
def frontend_files():
    base = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
    with open(os.path.join(base, "frontend", "index.html"), encoding="utf-8") as f:
        html = f.read()
    with open(os.path.join(base, "frontend", "css", "style.css"), encoding="utf-8") as f:
        css = f.read()
    with open(os.path.join(base, "frontend", "js", "mimic.js"), encoding="utf-8") as f:
        mimic_js = f.read()
    with open(os.path.join(base, "frontend", "js", "app.js"), encoding="utf-8") as f:
        app_js = f.read()
    return {"html": html, "css": css, "mimic_js": mimic_js, "app_js": app_js}


def test_dom_ids_exist(frontend_files):
    """Все ID, используемые в app.js, должны существовать в index.html."""
    html = frontend_files["html"]
    app_js = frontend_files["app_js"]

    # Ищем getElementById
    raw_ids = re.findall(r"getElementById\(['\"]([^'\"]+)['\"]\)", app_js)
    static_ids = [i for i in raw_ids if "${" not in i]

    for id_name in static_ids:
        assert f'id="{id_name}"' in html or f"id='{id_name}'" in html, f"ID '{id_name}' missing from index.html"

    # Динамические ID: pmo_knob_0..3, lamp_on_0..3, lamp_off_0..3, rcp_badge_0..3, rcp_row_0..3
    for i in range(4):
        for prefix in ["pmo_knob_", "lamp_on_", "lamp_off_", "rcp_badge_", "rcp_row_"]:
            dyn_id = f"{prefix}{i}"
            assert f'id="{dyn_id}"' in html, f"Dynamic ID '{dyn_id}' missing from index.html"

    # Защитные металлические скобы тумблеров должны непосредственно фланкировать втулку тумблера
    assert '<span class="toggle-guard guard-left"></span>\n              <div class="tumbler-bushing">' in html
    assert '</div>\n              <span class="toggle-guard guard-right"></span>' in html


def test_zero_scrollbars_layout(frontend_files):
    """Layout должен быть зафиксирован в 100vh с запретом прокрутки body и консоли."""
    css = frontend_files["css"]
    html = frontend_files["html"]
    # Проверка body
    assert "height: 100vh" in css
    # Проверка main-viewport
    assert "overflow: hidden" in css
    # Проверка operator-desk-apron
    assert "operator-desk-apron" in css
    # Проверка контейнера скролла телетайпа
    assert "teletype-scroll-box" in html
    assert "teletype-scroll-box" in css


def test_button_opacity_and_realism(frontend_files):
    """Кнопки должны быть 100% непрозрачными, без полупрозрачности и мутных оверлеев."""
    css = frontend_files["css"]
    # Проверяем, что нет полупрозрачной дымки над кнопками
    assert ".desk-patina-layer {\n  display: none;\n}" in css

    # Кнопки КМЕ, КЕ, АЗ-5 должны быть твердыми
    assert "--btn-solid-dark:" in css
    assert "--btn-solid-red:" in css
    assert "--btn-solid-green:" in css
    assert "--btn-solid-amber:" in css
    assert "--btn-solid-blue:" in css
    assert "--btn-solid-white:" in css
    assert ".btn-az5" in css
    assert ".btn-kme" in css
    assert ".tab-btn" in css
    assert ".industrial-toggle-card" in css

    # Кнопки не должны использовать blend-mode overlay, делающий их полупрозрачными
    assert "background-blend-mode: overlay" not in css.split(".btn-ctrl")[1].split("}")[0]
    assert "background-blend-mode: overlay" not in css.split(".tab-btn")[1].split("}")[0]

    # Литые металлические ободки, шестигранные гайки и тактильный ход
    assert "0 0 0 1.5px #18222d" in css
    assert "0 0 0 3px #4a5c72" in css
    assert "translateY(2.5px)" in css
    assert "clip-path: polygon" in css
    assert ".tumbler-bat" in css
    assert ".az5-mushroom-rim" in css
    assert ".az5-safety-collar" in css
    assert ".status-lamp-socket .status-badge::before" in css


def test_mimic_gcn_alignment(frontend_files):
    """Насос ГЦН должен быть точно выровнен по оси холодной нити, а не иметь рассинхрона."""
    mimic = frontend_files["mimic_js"]
    # Не должно быть рассинхрона между отрисовкой насоса и осью coldY
    assert "Math.min(300, this.height * 0.68) * 0.16" not in mimic
    assert "const gcnY = ry + rh * 0.16;" in mimic


def test_mimic_feedwater_particles_animated(frontend_files):
    """Частицы питательной воды ('feedwater') должны анимироваться и отрисовываться на схеме."""
    mimic = frontend_files["mimic_js"]
    # Должен быть блок фильтрации и отрисовки частиц feedwater
    assert "loop === 'feedwater'" in mimic


def test_mimic_coolant_flow_animation(frontend_files):
    """Опускной зазор реактора (downcomer) и активная зона (core_flow) должны иметь анимированные потоки."""
    mimic = frontend_files["mimic_js"]
    assert "loop === 'downcomer'" in mimic
    assert "loop === 'core_flow'" in mimic


def test_mimic_control_rod_rigid_translation(frontend_files):
    """Стержни СУЗ должны физически перемещаться по вертикали (трансляция), а не растягиваться как резина от фиксированного верха."""
    mimic = frontend_files["mimic_js"]
    # Не должно быть резинового растяжения от фиксированного flangeY+8
    assert "ctx.rect(rxPin - 2.5, rodTop, 5, Math.max(6, rodBottom - rodTop))" not in mimic
    # Должно быть жесткое вертикальное перемещение с постоянной длиной поглотителя
    assert "rodLength" in mimic
    assert "traverseY" in mimic


def test_mimic_vver1000_components(frontend_files):
    """Мнемосхема должна содержать ключевые технические элементы ВВЭР-1000."""
    mimic = frontend_files["mimic_js"]
    assert "15Х2НМФА" in mimic
    assert "08Х18Н10Т" in mimic
    assert "ШЭМ-3" in mimic
    assert "ПГВ-1000М" in mimic
    assert "ГЦН-195М" in mimic
    assert "ТВВ-1000" in mimic


def test_nixie_period_and_m1690_setpoints(frontend_files):
    """Газоразрядный индикатор периода и шкала прибора М1690 должны соответствовать уставкам безопасности."""
    html = frontend_files["html"]
    # Газоразрядный индикатор периода ИН-14 в верхней стойке
    assert 'id="m_period"' in html
    assert "ПЕРИОД Т [ИН-14]" in html

    # Уставки М1690 (ПЗ 10°C, АЗ 4°C)
    assert 'title="Уставка ПЗ (10°C)"' in html
    assert 'title="Уставка АЗ (4°C)"' in html
    assert 'style="top: 92%; height: 8%;"' in html  # Danger zone 0..4°C


def test_annunciator_tungsten_filaments_and_crt_bloom(frontend_files):
    """Табло ТСБ должны иметь вольфрамовые нити накала, а ЭЛТ монитор - кривизну и bloom."""
    css = frontend_files["css"]
    # Вольфрамовые нити накала
    assert ".annunciator-tile::before" in css
    assert "radial-gradient(ellipse at 30% 50%" in css

    # Кривизна и bloom кинескопа ЭЛТ
    assert ".crt-p31 .mimic-canvas-wrapper" in css
    assert "radial-gradient(circle at 50% 50%" in css


def test_enlarged_controls_and_loop_cards(frontend_files):
    """Проверка увеличенных кнопок режимов ЭЛТ, индикаторов шапки и карточек петель мнемосхемы."""
    html = frontend_files["html"]
    css = frontend_files["css"]
    mimic_js = frontend_files["mimic_js"]

    # Кнопки режимов ЭЛТ монитора
    assert "crt-mode-toggle" in html
    assert "crt-view-toggle" in html
    assert ".crt-mode-toggle" in css
    assert ".crt-view-toggle" in css
    assert "13.5px" in css
    assert "8px 16px" in css
    assert ".crt-indicator-dot" in css

    # Увеличенная телеметрия шапки
    assert "height: 38px;" in css
    assert "font-size: 8.5px;" in css
    assert "font-size: 12px" in css

    # Увеличенные карточки 4-х петель на мнемосхеме
    assert "const loopW = 82;" in mimic_js or "const loopW = 84;" in mimic_js
    assert "const loopH = 48;" in mimic_js or "const loopH = 50;" in mimic_js
    assert "bold 11px Consolas, monospace" in mimic_js
    assert "10px Consolas, monospace" in mimic_js


def test_crt_button_aliases_active_states_and_jewels(frontend_files):
    """Проверка псевдонимов ID кнопок ЭЛТ, индикаторных драгоценных линз и активных стилей."""
    html = frontend_files["html"]
    css = frontend_files["css"]
    app_js = frontend_files["app_js"]

    # Наличие псевдонимов в HTML и JS
    assert 'btnTogglePhosphor' in html
    assert 'btnToggleCoreView' in html
    assert 'btnTogglePhosphor' in app_js
    assert 'btnToggleCoreView' in app_js

    # Стили активного режима картограммы и светодиодов
    assert '.active-core' in css
    assert '.btn-indicator-jewel' in css
    assert '.crt-header-spec' in css



