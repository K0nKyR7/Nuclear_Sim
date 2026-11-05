import pytest
from backend.physics.models import (
    PrimaryLoopState, PressurizerState, SteamGeneratorState,
    SecondaryLoopState, ControlsState
)
from backend.physics.thermal_hydraulics import ThermalHydraulicsModel


def test_thermal_hydraulics_steady_state():
    """Проверка стационарного теплового баланса на 100% мощности."""
    th = ThermalHydraulicsModel()
    primary = PrimaryLoopState()
    pz = PressurizerState()
    sg = SteamGeneratorState()
    secondary = SecondaryLoopState()
    controls = ControlsState()

    # Шагаем 10 секунд
    for _ in range(200):
        th.step(
            thermal_power_rel=1.0,
            dt=0.05,
            primary=primary,
            pz=pz,
            sg=sg,
            secondary=secondary,
            controls=controls
        )

    # Проверяем, что температуры остаются около номинальных значений ВВЭР-1000
    assert 315.0 < primary.t_hot_c < 325.0, f"T_hot вне диапазона: {primary.t_hot_c}"
    assert 285.0 < primary.t_cold_c < 295.0, f"T_cold вне диапазона: {primary.t_cold_c}"
    assert 15.0 < primary.pressure_mpa < 16.5, f"Давление 1К вне диапазона: {primary.pressure_mpa}"
    assert 6.0 < sg.steam_pressure_mpa < 6.8, f"Давление 2К вне диапазона: {sg.steam_pressure_mpa}"
    assert 950.0 < secondary.electric_power_mw < 1050.0, f"Электрическая мощность вне диапазона: {secondary.electric_power_mw}"


def test_rcp_trip_flow_reduction():
    """Проверка снижения расхода при отключении одного ГЦН."""
    th = ThermalHydraulicsModel()
    primary = PrimaryLoopState()
    pz = PressurizerState()
    sg = SteamGeneratorState()
    secondary = SecondaryLoopState()
    controls = ControlsState()

    # Отключаем ГЦН-1
    primary.rcp_status[0] = False

    for _ in range(600):  # 30 секунд для полного завершения выбега ГЦН
        th.step(1.0, 0.05, primary, pz, sg, secondary, controls)

    # Расход при 3 ГЦН должен установиться на уровне 77%
    assert 0.75 < primary.relative_flow < 0.79, f"Относительный расход {primary.relative_flow} не соответствует 3 ГЦН"


def test_subcooling_and_saoz_physics():
    """Проверка расчета температуры насыщения, запаса до кипения и срабатывания гидроемкостей САОЗ."""
    th = ThermalHydraulicsModel()
    primary = PrimaryLoopState()
    pz = PressurizerState()
    sg = SteamGeneratorState()
    secondary = SecondaryLoopState()
    controls = ControlsState()

    # В номинале: P1 = 15.7 МПа, T_sat ~ 346.8°C, T_hot ~ 320°C -> subcool ~ 26.8°C
    th.step(1.0, 0.05, primary, pz, sg, secondary, controls)
    assert 340.0 < primary.t_sat_1k_c < 355.0
    assert primary.subcooling_margin_c > 20.0
    assert primary.saoz_active is False
    assert primary.saoz_flow_kg_s == 0.0

    # Снижаем давление первого контура ниже 6.0 МПа (уставка пассивных гидроемкостей САОЗ)
    primary.pressure_mpa = 5.0
    initial_boron = primary.boron_ppm
    initial_level = primary.saoz_accum_level_pct

    th.step(1.0, 0.05, primary, pz, sg, secondary, controls)
    assert primary.saoz_active is True
    assert primary.saoz_flow_kg_s > 100.0, "Должен начаться пассивный впрыск из гидроемкостей"
    assert primary.boron_ppm > initial_boron, "Концентрация бора должна увеличиваться за счет впрыска раствора 2800 ppm"
    assert primary.saoz_accum_level_pct < initial_level, "Уровень в гидроемкостях должен снижаться"


def test_bru_k_and_bru_a_proportional_dynamics():
    """Проверка пропорционального открытия БРУ-К (> 6.7 МПа) и БРУ-А (> 7.1 МПа)."""
    th = ThermalHydraulicsModel()
    primary = PrimaryLoopState()
    pz = PressurizerState()
    sg = SteamGeneratorState()
    secondary = SecondaryLoopState()
    controls = ControlsState()

    # Давление 2К нормальное: 6.27 МПа -> БРУ закрыты
    sg.steam_pressure_mpa = 6.27
    th.step(1.0, 0.05, primary, pz, sg, secondary, controls)
    assert secondary.bru_k_pct == 0.0
    assert secondary.bru_a_pct == 0.0

    # Повышаем давление до 6.95 МПа -> БРУ-К должна приоткрываться
    for _ in range(40):  # 2 секунды
        sg.steam_pressure_mpa = 6.95
        th.step(1.0, 0.05, primary, pz, sg, secondary, controls)
    assert secondary.bru_k_pct > 20.0, "БРУ-К должна открыться при давлении выше 6.7 МПа"
    assert secondary.bru_a_pct == 0.0, "БРУ-А не должна открываться при давлении ниже 7.1 МПа"

    # Повышаем давление до 7.35 МПа -> БРУ-А тоже начинает открываться
    for _ in range(40):
        sg.steam_pressure_mpa = 7.35
        th.step(1.0, 0.05, primary, pz, sg, secondary, controls)
    assert secondary.bru_a_pct > 20.0, "БРУ-А должна открыться при давлении выше 7.1 МПа"


def test_saoz_nitrogen_depletion_and_isolation():
    """Проверка политропического спада давления азотной подушки САОЗ и отсечения при истощении."""
    th = ThermalHydraulicsModel()
    primary = PrimaryLoopState()
    pz = PressurizerState()
    sg = SteamGeneratorState()
    secondary = SecondaryLoopState()
    controls = ControlsState()

    primary.pressure_mpa = 4.0
    primary.saoz_accum_level_pct = 50.0  # Бак наполовину опустошен

    th.step(1.0, 0.05, primary, pz, sg, secondary, controls)
    # При 50% запаса давление азотной подушки должно упасть между 1.5 и 6.0 МПа (~3.75 МПа)
    assert 3.5 < primary.saoz_accum_pressure_mpa < 4.0

    # При полном опустошении бака САОЗ (0%) впрыск должен прекратиться
    primary.saoz_accum_level_pct = 0.0
    th.step(1.0, 0.05, primary, pz, sg, secondary, controls)
    assert primary.saoz_active is False
    assert primary.saoz_flow_kg_s == 0.0
    assert primary.saoz_accum_pressure_mpa == 1.5


def test_bru_k_vacuum_interlock():
    """Проверка блокировки БРУ-К при срыве вакуума в конденсаторе (> 15 кПа)."""
    th = ThermalHydraulicsModel()
    primary = PrimaryLoopState()
    pz = PressurizerState()
    sg = SteamGeneratorState()
    secondary = SecondaryLoopState()
    controls = ControlsState()

    # Давление в ПГ высокое: 6.95 МПа, но вакуум сорван (25 кПа)
    sg.steam_pressure_mpa = 6.95
    secondary.condenser_pressure_kpa = 25.0

    for _ in range(40):
        th.step(1.0, 0.05, primary, pz, sg, secondary, controls)

    # БРУ-К должна оставаться закрытой из-за блокировки по срыву вакуума
    assert secondary.bru_k_pct == 0.0


