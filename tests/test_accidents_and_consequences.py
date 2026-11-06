import pytest
from backend.physics.models import PlantState
from backend.simulation.engine import SimulationEngine


def test_prompt_criticality_explosion():
    """Тест теплового взрыва активной зоны при разгоне на мгновенных нейтронах."""
    engine = SimulationEngine()
    engine.trigger_scenario("prompt_critical", True)
    
    max_flux = 0.0
    # Шагаем несколько шагов
    for _ in range(30):
        engine.step()
        max_flux = max(max_flux, engine.kinetics_state.relative_neutron_flux)

    # Проверяем, что зафиксирован взрыв и повреждение активной зоны
    assert engine.thermal_model.explosion_active or engine.thermal_model.core_damage_pct > 0
    assert max_flux > 1.5, "Мощность должна резко подскочить"
    assert engine.plant_state in [PlantState.EXPLOSION, PlantState.MELTDOWN, PlantState.SCRAMMED, PlantState.ACCIDENT]


def test_guillotine_break_loca_consequences():
    """Тест последствий гильотинного разрыва ГЦТ: падение давления 1К, рост давления в гермооболочке."""
    engine = SimulationEngine()
    engine.trigger_scenario("guillotine_loca", True)

    for _ in range(40):
        engine.step()

    assert engine.thermal_model.primary_rupture is True
    assert engine.thermal_model.loca_leak_rate_kg_s > 2000.0
    assert engine.thermal_model.containment_pressure_kpa > 110.0, "Давление в ГО должно расти при сбросе пара"
    assert engine.primary_state.pressure_mpa < 15.0, "Давление в 1К должно упасть"


def test_core_meltdown_and_hydrogen_generation():
    """Тест аварии с расплавлением активной зоны и генерацией водорода H2."""
    engine = SimulationEngine()
    engine.trigger_scenario("core_meltdown", True)

    # Шагаем 25 секунд виртуального времени
    for _ in range(500):
        engine.step()

    assert engine.thermal_model.core_damage_pct > 20.0
    assert engine.thermal_model.radiation_level_mr_h > 100.0
    assert engine.plant_state in [PlantState.MELTDOWN, PlantState.ACCIDENT, PlantState.SCRAMMED]


def test_safety_bypass_toggle_command():
    """Тест тумблера блокировки защит через команды оператора."""
    engine = SimulationEngine()
    assert engine.controls_state.safety_system_bypassed is False

    engine.apply_control("toggle_bypass_safety")
    assert engine.controls_state.safety_system_bypassed is True
    assert engine.active_scenarios["bypass_safety"] is True

    # Проверяем команды борного регулирования
    init_boron = engine.primary_state.boron_ppm
    engine.apply_control("add_boron", 50)
    assert engine.primary_state.boron_ppm == init_boron + 50

    engine.apply_control("dilute_boron", 30)
    assert engine.primary_state.boron_ppm == init_boron + 20
