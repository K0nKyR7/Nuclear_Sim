import time
import asyncio
from typing import Dict, Any, List, Optional
from ..physics.models import (
    PlantState, KineticsState, PrimaryLoopState, PressurizerState,
    SteamGeneratorState, SecondaryLoopState, ControlsState, TelemetryData,
    AlarmLevel
)
from ..physics.kinetics import KineticsModel
from ..physics.reactivity import ReactivityModel
from ..physics.thermal_hydraulics import ThermalHydraulicsModel
from .safety_system import SafetySystem


class SimulationEngine:
    """
    Главный координатор моделирования энергоблока ВВЭР-1000 в реальном времени.
    """

    def __init__(self):
        self.kinetics_model = KineticsModel()
        self.reactivity_model = ReactivityModel()
        self.thermal_model = ThermalHydraulicsModel()
        self.safety = SafetySystem()

        # Состояния систем
        self.kinetics_state = KineticsState()
        self.primary_state = PrimaryLoopState()
        self.pz_state = PressurizerState()
        self.sg_state = SteamGeneratorState()
        self.secondary_state = SecondaryLoopState()
        self.controls_state = ControlsState()
        self.plant_state = PlantState.POWER_OPERATION

        # Контроль времени симуляции
        self.sim_time_s: float = 0.0
        self.wall_time_start: float = time.time()
        self.time_scale: float = 1.0  # 1x, 2x, 5x, 10x
        self.is_paused: bool = False
        self.base_dt: float = 0.05    # 20 Гц (50 мс)

        # Активные сценарии отказов
        self.active_scenarios: Dict[str, bool] = {
            "rcp1_trip": False,
            "steam_break": False,
            "loca_leak": False,
            "rod_stuck": False,
            "grid_loss": False
        }

    def reset(self) -> None:
        """Сброс к исходному номинальному состоянию 100% мощности."""
        self.__init__()

    def apply_control(self, command: str, value: Any = None) -> None:
        """
        Обработка команд оператора.
        """
        if command == "az5":
            self.controls_state.az5_button_pressed = True
        elif command == "set_rod_speed":
            # value: -1.0 (вниз), 0.0 (стоп), +1.0 (вверх)
            if not self.active_scenarios["rod_stuck"]:
                self.controls_state.rod_manual_speed_pct_s = float(value)
        elif command == "set_rod_position":
            if not self.active_scenarios["rod_stuck"]:
                self.controls_state.rod_position_pct = max(0.0, min(100.0, float(value)))
        elif command == "toggle_auto_power":
            self.controls_state.auto_power_controller = bool(value)
        elif command == "set_target_power":
            self.controls_state.target_power_mw = max(0.0, min(1200.0, float(value)))
        elif command == "toggle_rcp":
            # value: index (0..3)
            idx = int(value)
            if 0 <= idx < 4:
                self.primary_state.rcp_status[idx] = not self.primary_state.rcp_status[idx]
        elif command == "toggle_feedwater_pump":
            idx = int(value)
            if 0 <= idx < len(self.secondary_state.feedwater_pumps_on):
                self.secondary_state.feedwater_pumps_on[idx] = not self.secondary_state.feedwater_pumps_on[idx]
        elif command == "toggle_pz_heaters":
            self.pz_state.heaters_auto = not self.pz_state.heaters_auto
        elif command == "toggle_pz_spray":
            self.pz_state.spray_auto = not self.pz_state.spray_auto
        elif command == "turbine_trip":
            self.secondary_state.turbine_trip_valve = False
        elif command == "turbine_reset":
            self.secondary_state.turbine_trip_valve = True
        elif command == "set_time_scale":
            self.time_scale = max(0.1, min(10.0, float(value)))
        elif command == "set_pause":
            self.is_paused = bool(value)
        elif command == "ack_alarms":
            for a in self.safety.alarms:
                a.acknowledged = True

    def trigger_scenario(self, scenario_id: str, activate: bool) -> None:
        """
        Включение или отключение аварийных сценариев инструктора.
        """
        self.active_scenarios[scenario_id] = activate

        if scenario_id == "rcp1_trip":
            self.primary_state.rcp_status[0] = not activate
            if activate:
                self.safety.add_alarm("ОТКАЗ: Аварийное отключение ГЦН-1!", AlarmLevel.WARNING, self.sim_time_s)

        elif scenario_id == "steam_break":
            self.thermal_model.steam_leak_fraction = 0.35 if activate else 0.0
            if activate:
                self.safety.add_alarm("АВАРИЯ: Разрыв главного паропровода 2 контура!", AlarmLevel.CRITICAL, self.sim_time_s)

        elif scenario_id == "loca_leak":
            self.thermal_model.loca_leak_rate_kg_s = 350.0 if activate else 0.0
            if activate:
                self.safety.add_alarm("АВАРИЯ: Течь теплоносителя 1 контура (LOCA)!", AlarmLevel.CRITICAL, self.sim_time_s)

        elif scenario_id == "rod_stuck":
            if activate:
                self.controls_state.rod_manual_speed_pct_s = 0.0
                self.safety.add_alarm("ОТКАЗ: Механическое заклинивание приводов СУЗ!", AlarmLevel.WARNING, self.sim_time_s)

        elif scenario_id == "grid_loss":
            self.thermal_model.grid_disconnected = activate
            if activate:
                self.secondary_state.turbine_trip_valve = False
                self.safety.add_alarm("СЕТЬ: Отключение от энергосистемы, сброс электрической нагрузки!", AlarmLevel.CRITICAL, self.sim_time_s)

    def step(self) -> None:
        """
        Один тактовый шаг моделирования.
        """
        if self.is_paused:
            return

        dt = self.base_dt * self.time_scale

        # 1. Ручное или автоматическое движение стержней СУЗ
        if not self.safety.scrammed and not self.active_scenarios["rod_stuck"]:
            if self.controls_state.auto_power_controller:
                # АРМ поддерживает заданную мощность
                error_p = (self.controls_state.target_power_mw - self.secondary_state.electric_power_mw) / 1000.0
                if abs(error_p) > 0.01:
                    move = 1.0 if error_p > 0 else -1.0
                    self.controls_state.rod_position_pct += move * 0.4 * dt
            else:
                self.controls_state.rod_position_pct += self.controls_state.rod_manual_speed_pct_s * dt

            self.controls_state.rod_position_pct = max(0.0, min(100.0, self.controls_state.rod_position_pct))

        # 2. Расчет составляющих реактивности
        rho_rod = self.reactivity_model.calculate_rod_reactivity(
            self.controls_state.rod_position_pct,
            self.safety.scrammed,
            self.safety.scram_factor
        )

        rho_dop, rho_cool, rho_bor, rho_xe = self.reactivity_model.calculate_feedbacks(
            self.primary_state.t_fuel_c,
            self.primary_state.t_coolant_avg_c,
            self.primary_state.boron_ppm,
            self.kinetics_state.xenon_rel
        )

        total_rho_pcm = rho_rod + rho_dop + rho_cool + rho_bor + rho_xe

        self.kinetics_state.rod_reactivity_pcm = rho_rod
        self.kinetics_state.doppler_reactivity_pcm = rho_dop
        self.kinetics_state.coolant_temp_reactivity_pcm = rho_cool
        self.kinetics_state.boron_reactivity_pcm = rho_bor
        self.kinetics_state.xenon_reactivity_pcm = rho_xe
        self.kinetics_state.total_reactivity_pcm = total_rho_pcm

        # 3. Интегрирование нейтронной кинетики и остаточного тепла
        thermal_rel, decay_rel, period = self.kinetics_model.step(total_rho_pcm, dt)
        self.kinetics_state.relative_neutron_flux = self.kinetics_model.n
        self.kinetics_state.period = period

        # Интегрирование отравления ксеноном
        i_new, xe_new = self.reactivity_model.step_xenon_iodine(
            self.kinetics_state.relative_neutron_flux,
            self.kinetics_state.iodine_rel,
            self.kinetics_state.xenon_rel,
            dt
        )
        self.kinetics_state.iodine_rel = i_new
        self.kinetics_state.xenon_rel = xe_new

        # 4. Интегрирование теплогидравлики 1 и 2 контуров
        self.thermal_model.step(
            thermal_power_rel=thermal_rel,
            dt=dt,
            primary=self.primary_state,
            pz=self.pz_state,
            sg=self.sg_state,
            secondary=self.secondary_state,
            controls=self.controls_state
        )

        # 5. Проверка срабатывания технологических защит энергоблока
        self.plant_state = self.safety.check_protections(
            dt=dt,
            sim_time=self.sim_time_s,
            kinetics=self.kinetics_state,
            primary=self.primary_state,
            pz=self.pz_state,
            sg=self.sg_state,
            secondary=self.secondary_state,
            controls=self.controls_state
        )

        self.sim_time_s += dt

    def get_telemetry(self) -> TelemetryData:
        """
        Формирование пакета телеметрии для клиентских терминалов.
        """
        thermal_mw = self.kinetics_state.relative_neutron_flux * 3000.0 * 0.935 + (float(sum(self.kinetics_model.decay_heat_accum)) * 3000.0)
        rel_pct = (thermal_mw / 3000.0) * 100.0

        alarm_dicts = [
            {
                "id": a.id,
                "msg": a.message,
                "level": a.level.value,
                "time": round(a.timestamp, 1),
                "ack": a.acknowledged
            }
            for a in self.safety.alarms[:15]
        ]

        return TelemetryData(
            timestamp=time.time(),
            sim_time_s=round(self.sim_time_s, 2),
            state=self.plant_state,
            thermal_power_mw=round(thermal_mw, 1),
            relative_power_pct=round(rel_pct, 2),
            electric_power_mw=round(self.secondary_state.electric_power_mw, 1),
            residual_heat_mw=round(float(sum(self.kinetics_model.decay_heat_accum)) * 3000.0, 1),
            reactivity_pcm=round(self.kinetics_state.total_reactivity_pcm, 1),
            period_s=round(self.kinetics_state.period, 1),
            pressure_1k_mpa=round(self.primary_state.pressure_mpa, 2),
            t_hot_c=round(self.primary_state.t_hot_c, 1),
            t_cold_c=round(self.primary_state.t_cold_c, 1),
            t_fuel_c=round(self.primary_state.t_fuel_c, 1),
            flow_1k_kg_s=round(self.primary_state.mass_flow_kg_s, 0),
            t_sat_1k_c=round(self.primary_state.t_sat_1k_c, 1),
            subcooling_margin_c=round(self.primary_state.subcooling_margin_c, 1),
            boron_ppm=round(self.primary_state.boron_ppm, 1),
            saoz_active=self.primary_state.saoz_active,
            saoz_flow_kg_s=round(self.primary_state.saoz_flow_kg_s, 1),
            saoz_accum_pressure_mpa=round(self.primary_state.saoz_accum_pressure_mpa, 2),
            saoz_accum_level_pct=round(self.primary_state.saoz_accum_level_pct, 1),
            pz_level_m=round(self.pz_state.water_level_m, 2),
            pz_heaters_kw=round(self.pz_state.heaters_power_kw, 0),
            pz_spray_active=(self.pz_state.spray_valve_pos > 0.05),
            pressure_2k_mpa=round(self.sg_state.steam_pressure_mpa, 2),
            sg_level_m=round(self.sg_state.water_level_m, 2),
            steam_flow_kg_s=round(self.sg_state.steam_flow_kg_s, 0),
            feedwater_flow_kg_s=round(self.sg_state.feedwater_flow_kg_s, 0),
            turbine_rpm=round(self.secondary_state.turbine_rpm, 0),
            condenser_vacuum_kpa=round(self.secondary_state.condenser_pressure_kpa, 2),
            rod_position_pct=round(self.controls_state.rod_position_pct, 1),
            bru_k_pct=round(self.secondary_state.bru_k_pct, 1),
            bru_a_pct=round(self.secondary_state.bru_a_pct, 1),
            rcp_active_count=sum(1 for s in self.primary_state.rcp_status if s),
            alarms=alarm_dicts
        )

