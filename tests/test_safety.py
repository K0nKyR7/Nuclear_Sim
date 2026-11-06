import pytest
from backend.physics.models import (
    PlantState, KineticsState, PrimaryLoopState, PressurizerState,
    SteamGeneratorState, SecondaryLoopState, ControlsState
)
from backend.simulation.safety_system import SafetySystem
from backend.simulation.engine import SimulationEngine


def test_safety_manual_az5():
    """Проверка ручного нажатия кнопки АЗ-5."""
    safety = SafetySystem()
    kinetics = KineticsState()
    primary = PrimaryLoopState()
    pz = PressurizerState()
    sg = SteamGeneratorState()
    secondary = SecondaryLoopState()
    controls = ControlsState(az5_button_pressed=True)

    state = safety.check_protections(0.05, 1.0, kinetics, primary, pz, sg, secondary, controls)
    assert state == PlantState.SCRAMMED
    assert safety.scrammed is True
    assert any("АЗ-5" in a.message for a in safety.alarms)


def test_safety_overpower_trip():
    """Проверка автоматического срабатывания АЗ при мощности > 107%."""
    safety = SafetySystem()
    kinetics = KineticsState(relative_neutron_flux=1.09)
    primary = PrimaryLoopState()
    pz = PressurizerState()
    sg = SteamGeneratorState()
    secondary = SecondaryLoopState()
    controls = ControlsState()

    state = safety.check_protections(0.05, 1.0, kinetics, primary, pz, sg, secondary, controls)
    assert state == PlantState.SCRAMMED
    assert any("Превышение мощности" in reason for reason in safety.trip_reasons)


def test_engine_scram_sequence():
    """Проверка полной последовательности сброса стержней в SimulationEngine."""
    engine = SimulationEngine()
    # Запускаем штатно
    for _ in range(20):
        engine.step()
    assert engine.plant_state == PlantState.POWER_OPERATION

    # Нажимаем АЗ-5
    engine.apply_control("az5")
    for _ in range(100):  # 5 секунд
        engine.step()

    assert engine.plant_state == PlantState.SCRAMMED
    assert engine.controls_state.rod_position_pct == 0.0, "Стержни должны упасть на концевики (0%)"
    assert engine.kinetics_state.relative_neutron_flux < 0.1, "Мощность деления должна быть сброшена"


def test_subcooling_margin_warning_and_scram():
    """Проверка предупреждения при запасе до кипения < 10°C и АЗ-5 при запасе < 4°C."""
    safety = SafetySystem()
    kinetics = KineticsState()
    primary = PrimaryLoopState()
    pz = PressurizerState()
    sg = SteamGeneratorState()
    secondary = SecondaryLoopState()
    controls = ControlsState()

    # Запас 8°C -> предупреждение
    primary.subcooling_margin_c = 8.0
    state = safety.check_protections(0.05, 1.0, kinetics, primary, pz, sg, secondary, controls)
    assert state != PlantState.SCRAMMED
    assert any("запас до насыщения" in a.message.lower() for a in safety.alarms)

    # Запас 3.5°C -> аварийная защита АЗ-5 (кипение теплоносителя в активной зоне)
    primary.subcooling_margin_c = 3.5
    state = safety.check_protections(0.05, 1.0, kinetics, primary, pz, sg, secondary, controls)
    assert state == PlantState.SCRAMMED
    assert safety.scrammed is True
    assert any("кипения" in r.lower() for r in safety.trip_reasons)


def test_saoz_alarm_on_injection():
    """Проверка фиксации тревоги при срабатывании пассивного гидроаккумулятора САОЗ."""
    safety = SafetySystem()
    kinetics = KineticsState()
    primary = PrimaryLoopState()
    pz = PressurizerState()
    sg = SteamGeneratorState()
    secondary = SecondaryLoopState()
    controls = ControlsState()

    primary.saoz_active = True
    primary.saoz_flow_kg_s = 420.0
    safety.check_protections(0.05, 1.0, kinetics, primary, pz, sg, secondary, controls)
    assert any("САОЗ" in a.message for a in safety.alarms)



def test_safety_system_bypassed_allows_overpower():
    """Проверка режима испытаний: блокировка АЗ-5 предотвращает автоматический останов, но фиксирует критическую тревогу."""
    safety = SafetySystem()
    kinetics = KineticsState(relative_neutron_flux=1.15)
    primary = PrimaryLoopState()
    pz = PressurizerState()
    sg = SteamGeneratorState()
    secondary = SecondaryLoopState()
    controls = ControlsState(safety_system_bypassed=True)

    state = safety.check_protections(0.05, 1.0, kinetics, primary, pz, sg, secondary, controls)
    assert state != PlantState.SCRAMMED, "При блокировке АЗ-5 автоматический останов не должен сработать"
    assert safety.scrammed is False
    assert any("БЛОКИРОВКА АЗ" in a.message for a in safety.alarms)

    # При этом ручной сброс оператором кнопки АЗ-5 обязан сработать всегда
    controls.az5_button_pressed = True
    state2 = safety.check_protections(0.05, 1.0, kinetics, primary, pz, sg, secondary, controls)
    assert state2 == PlantState.SCRAMMED
    assert safety.scrammed is True


def test_catastrophic_accidents_and_meltdown_states():
    """Проверка перехода состояний энергоблока в EXPLOSION и MELTDOWN."""
    engine = SimulationEngine()
    
    # 1. Сценарий гильотинного разрыва
    engine.trigger_scenario("guillotine_loca", True)
    engine.step()
    assert engine.thermal_model.primary_rupture is True
    assert engine.thermal_model.explosion_active is True
    assert engine.plant_state == PlantState.EXPLOSION
    assert engine.thermal_model.containment_pressure_kpa > 101.3

    # 2. Сценарий расплавления активной зоны
    engine.thermal_model.core_damage_pct = 65.0
    engine.step()
    assert engine.plant_state == PlantState.MELTDOWN
    assert engine.thermal_model.radiation_level_mr_h > 100.0
