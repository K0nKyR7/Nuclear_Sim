import time
from typing import List, Tuple
from ..physics.models import (
    PlantState, AlarmEvent, AlarmLevel,
    KineticsState, PrimaryLoopState, PressurizerState,
    SteamGeneratorState, SecondaryLoopState, ControlsState
)


class SafetySystem:
    """
    Система управления и защиты реактора (СУЗ: АЗ / ПЗ).
    Формирует аварийные и предупредительные сигналы, инициирует сброс стержней АЗ-5.
    """

    def __init__(self):
        self.scrammed = False
        self.scram_factor = 0.0  # 0.0 (не сработала) .. 1.0 (полный ввод стержней АЗ)
        self.trip_reasons: List[str] = []
        self.alarms: List[AlarmEvent] = []
        self._alarm_counter = 0

    def trigger_scram(self, reason: str, sim_time: float) -> None:
        """
        Инициация аварийной защиты АЗ-5.
        """
        if not self.scrammed:
            self.scrammed = True
            self.trip_reasons.append(reason)
            self.add_alarm(
                msg=f"СРАБАТЫВАНИЕ АЗ-5! Причина: {reason}",
                level=AlarmLevel.CRITICAL,
                sim_time=sim_time
            )

    def add_alarm(self, msg: str, level: AlarmLevel, sim_time: float) -> None:
        self._alarm_counter += 1
        alarm = AlarmEvent(
            id=f"alarm_{self._alarm_counter}_{int(sim_time * 10)}",
            message=msg,
            level=level,
            timestamp=sim_time
        )
        # Храним последние 50 записей
        self.alarms.insert(0, alarm)
        if len(self.alarms) > 50:
            self.alarms.pop()

    def check_protections(
        self,
        dt: float,
        sim_time: float,
        kinetics: KineticsState,
        primary: PrimaryLoopState,
        pz: PressurizerState,
        sg: SteamGeneratorState,
        secondary: SecondaryLoopState,
        controls: ControlsState
    ) -> PlantState:
        """
        Проверка уставок технологических защит энергоблока.
        """
        # 1. Ручной ввод АЗ-5 оператором
        if controls.az5_button_pressed:
            self.trigger_scram("Ручной сброс оператором (кнопка АЗ-5)", sim_time)

        # 2. Защита по нейтронной мощности (уставка 107%)
        if kinetics.relative_neutron_flux > 1.07:
            self.trigger_scram(f"Превышение мощности N > 107% ({kinetics.relative_neutron_flux * 100:.1f}%)", sim_time)
        elif kinetics.relative_neutron_flux > 1.03:
            if not any(a.message.startswith("ПЗ: Превышение мощности") and a.active for a in self.alarms):
                self.add_alarm("ПЗ: Превышение мощности N > 103%", AlarmLevel.WARNING, sim_time)

        # 3. Защита по периоду разгона реактора (уставка < 10 с)
        if 0 < kinetics.period < 10.0:
            self.trigger_scram(f"Опасный разгон реактора: период {kinetics.period:.1f} с (< 10 с)", sim_time)
        elif 0 < kinetics.period < 20.0:
            if not any(a.message.startswith("ПЗ: Малый период") and a.active for a in self.alarms):
                self.add_alarm(f"ПЗ: Малый период разгона T = {kinetics.period:.1f} с", AlarmLevel.WARNING, sim_time)

        # 4. Защита по первому контуру
        if primary.pressure_mpa > 17.6:
            self.trigger_scram(f"Аварийное давление 1К: {primary.pressure_mpa:.2f} МПа (> 17.6 МПа)", sim_time)
        elif primary.pressure_mpa < 14.0:
            self.trigger_scram(f"Падение давления 1К: {primary.pressure_mpa:.2f} МПа (< 14.0 МПа)", sim_time)

        # Температура на выходе из АЗ и запас до закипания
        if primary.t_hot_c > 330.0:
            self.trigger_scram(f"Перегрев теплоносителя: Tвых = {primary.t_hot_c:.1f} °C (> 330 °C)", sim_time)

        # Контроль запаса до закипания теплоносителя на выходе из активной зоны (ΔTнас)
        if primary.subcooling_margin_c < 4.0:
            self.trigger_scram(f"Опасность объемного кипения в АЗ: запас до насыщения ΔTнас = {primary.subcooling_margin_c:.1f} °C (< 4 °C)", sim_time)
        elif primary.subcooling_margin_c < 10.0:
            if not any(a.message.startswith("ПЗ: Малый запас до насыщения") and a.active for a in self.alarms):
                self.add_alarm(f"ПЗ: Малый запас до насыщения ΔTнас = {primary.subcooling_margin_c:.1f} °C (< 10 °C)", AlarmLevel.WARNING, sim_time)

        # Сигнализация срабатывания пассивных гидроемкостей САОЗ
        if primary.saoz_active:
            if not any("САОЗ" in a.message and a.active for a in self.alarms):
                self.add_alarm(f"САОЗ: Срабатывание пассивной части гидроемкостей ГЕ-1..4 (P1 = {primary.pressure_mpa:.2f} МПа < 6.0 МПа)", AlarmLevel.CRITICAL, sim_time)

        # Отключение ГЦН
        active_rcps = sum(1 for s in primary.rcp_status if s)
        if active_rcps <= 1:
            self.trigger_scram(f"Массовое отключение ГЦН (работает {active_rcps} из 4)", sim_time)

        # 5. Защита по второму контуру и ПГ
        if sg.water_level_m < 1.6:
            self.trigger_scram(f"Аварийно низкий уровень в ПГ: {sg.water_level_m:.2f} м (< 1.6 м)", sim_time)
        elif sg.water_level_m < 2.0:
            if not any(a.message.startswith("ПЗ: Низкий уровень") and a.active for a in self.alarms):
                self.add_alarm(f"ПЗ: Низкий уровень в парогенераторе ({sg.water_level_m:.2f} м)", AlarmLevel.WARNING, sim_time)

        if sg.steam_pressure_mpa > 7.8:
            self.trigger_scram(f"Превышение давления пара 2К: {sg.steam_pressure_mpa:.2f} МПа (> 7.8 МПа)", sim_time)

        # -------------------------------------------------------------
        # Динамика движения стержней при сработавшей АЗ
        # -------------------------------------------------------------
        if self.scrammed:
            # Стержни падают в активную зону под действием гравитации со скоростью ~25%/с
            self.scram_factor = min(1.0, self.scram_factor + 0.25 * dt)
            controls.rod_position_pct = max(0.0, controls.rod_position_pct - 25.0 * dt)
            # Отключение турбины при срабатывании АЗ-5
            secondary.turbine_trip_valve = False
            return PlantState.SCRAMMED

        return PlantState.POWER_OPERATION
