import math
from typing import Dict, Any
from .models import (
    PrimaryLoopState, PressurizerState, SteamGeneratorState,
    SecondaryLoopState, ControlsState
)


class ThermalHydraulicsModel:
    """
    Модель узловой теплогидравлики 1-го и 2-го контуров энергоблока ВВЭР-1000.
    """

    def __init__(self):
        # Опорные теплофизические характеристики
        self.nominal_thermal_mw = 3000.0
        self.nominal_electric_mw = 1000.0
        self.cp_coolant_kj = 5.3  # кДж/(кг·°C)
        self.nominal_flow_kg_s = 18800.0

        # Теплоемкость и постоянные времени
        self.fuel_heat_capacity_mw_s_c = 16.5  # МВт·с/°C
        self.k_fuel_coolant = 8.0               # МВт/°C теплопередача ТВЭЛ -> теплоноситель
        self.coolant_mass_core_kg = 25000.0    # масса теплоносителя в АЗ
        self.k_sg_tubes = 75.0                 # МВт/°C теплопередача ПГ

        # Параметры КД
        self.pz_total_volume_m3 = 79.0
        self.pz_water_volume_m3 = 45.0
        self.nominal_pz_level_m = 7.0
        self.nominal_p1_mpa = 15.7

        # Параметры 2 контура
        self.nominal_p2_mpa = 6.4
        self.nominal_sg_level_m = 2.4
        self.nominal_steam_flow = 1620.0  # кг/с (~5830 т/ч)

        # Флаги аварийных сценариев
        self.steam_leak_fraction = 0.0     # Разрыв паропровода (0..1)
        self.loca_leak_rate_kg_s = 0.0     # Течь теплоносителя 1 контура (кг/с)
        self.grid_disconnected = False     # Сброс нагрузки сети

    def step(
        self,
        thermal_power_rel: float,
        dt: float,
        primary: PrimaryLoopState,
        pz: PressurizerState,
        sg: SteamGeneratorState,
        secondary: SecondaryLoopState,
        controls: ControlsState
    ) -> None:
        """
        Интегрирование теплогидравлических параметров за шаг dt.
        """
        dt = max(0.001, dt)

        # -------------------------------------------------------------
        # 1. Циркуляция 1 контура и расход ГЦН
        # -------------------------------------------------------------
        active_rcps = sum(1 for s in primary.rcp_status if s)
        # Напорно-расходная характеристика ГЦН:
        # 4 ГЦН -> 1.0, 3 ГЦН -> 0.77, 2 ГЦН -> 0.53, 1 ГЦН -> 0.28, 0 -> 0.06 (естественная циркуляция)
        rcp_flow_map = {4: 1.0, 3: 0.77, 2: 0.53, 1: 0.28, 0: 0.06}
        target_flow_rel = rcp_flow_map.get(active_rcps, 0.06)

        # Инерция выбега ГЦН (~10-15 с)
        primary.relative_flow += (target_flow_rel - primary.relative_flow) * (dt / 8.0)
        primary.relative_flow = max(0.05, min(1.05, primary.relative_flow))
        primary.mass_flow_kg_s = self.nominal_flow_kg_s * primary.relative_flow

        # -------------------------------------------------------------
        # 2. Тепловыделение в топливе и передача теплу
        # -------------------------------------------------------------
        current_heat_mw = thermal_power_rel * self.nominal_thermal_mw
        # Теплопередача от топлива к замедлителю: Q_fuel_cool = K * (T_fuel - T_cool_avg)
        q_fuel_to_cool = self.k_fuel_coolant * (primary.t_fuel_c - primary.t_coolant_avg_c)
        
        # d(T_fuel)/dt = (Q_fission - Q_transferred) / C_fuel
        d_t_fuel = (current_heat_mw - q_fuel_to_cool) / self.fuel_heat_capacity_mw_s_c
        primary.t_fuel_c += d_t_fuel * dt
        primary.t_fuel_c = max(100.0, min(2200.0, primary.t_fuel_c))

        # -------------------------------------------------------------
        # 3. Баланс тепла теплоносителя активной зоны
        # -------------------------------------------------------------
        # Нагрев теплоносителя в активной зоне: delta_T = Q_transferred / (G * cp)
        heat_cap_flow_mw_c = (primary.mass_flow_kg_s * self.cp_coolant_kj) / 1000.0
        delta_t_core = q_fuel_to_cool / max(0.1, heat_cap_flow_mw_c)
        delta_t_core = max(0.5, min(150.0, delta_t_core))

        # Целевая температура выхода из АЗ (Т горячей нити)
        t_hot_target = primary.t_cold_c + delta_t_core
        # Инерция прогрева петли
        primary.t_hot_c += (t_hot_target - primary.t_hot_c) * (dt / 3.0)
        primary.t_coolant_avg_c = 0.5 * (primary.t_hot_c + primary.t_cold_c)

        # -------------------------------------------------------------
        # 4. Парогенератор (ПГ) и теплоотвод во 2 контур
        # -------------------------------------------------------------
        # Температура насыщения пара во 2 контуре при давлении P_2:
        # Аппроксимация линии насыщения воды: T_sat(P) ~ 179.9 * P^0.239
        sg.t_steam_sat_c = 179.9 * (max(0.1, sg.steam_pressure_mpa) ** 0.239)

        # Теплопередача через трубки ПГ во 2 контур:
        q_sg_transferred = self.k_sg_tubes * max(0.0, (primary.t_hot_c - sg.t_steam_sat_c))
        
        # Температура холодной нити после ПГ
        t_cold_target = primary.t_hot_c - (q_sg_transferred / max(0.1, heat_cap_flow_mw_c))
        t_cold_target = max(100.0, min(330.0, t_cold_target))
        primary.t_cold_c += (t_cold_target - primary.t_cold_c) * (dt / 4.0)

        # -------------------------------------------------------------
        # 5. Парообразование и давление во 2 контуре
        # -------------------------------------------------------------
        # Энтальпия парообразования ~1850 кДж/кг
        sg.steam_flow_kg_s = (q_sg_transferred * 1000.0) / 1850.0
        sg.steam_flow_kg_s = max(0.0, sg.steam_flow_kg_s)

        # Потребление пара турбиной:
        # Клапаны турбины управляются АРМ или вручную
        if not secondary.turbine_trip_valve or self.grid_disconnected:
            # Турбина отключена
            secondary.turbine_valves_pct = 0.0
            turbine_flow = 0.0
            secondary.electric_power_mw += (0.0 - secondary.electric_power_mw) * (dt / 1.5)
            secondary.turbine_rpm += (0.0 - secondary.turbine_rpm) * (dt / 30.0)
        else:
            # Нормальная работа турбины
            if controls.auto_power_controller:
                # Регулятор мощности поддерживает target_power_mw
                power_err = controls.target_power_mw - secondary.electric_power_mw
                secondary.turbine_valves_pct += power_err * 0.02 * dt
                secondary.turbine_valves_pct = max(0.0, min(100.0, secondary.turbine_valves_pct))

            turbine_flow = (secondary.turbine_valves_pct / 100.0) * self.nominal_steam_flow * (sg.steam_pressure_mpa / self.nominal_p2_mpa)
            secondary.electric_power_mw += ((turbine_flow / self.nominal_steam_flow) * self.nominal_electric_mw - secondary.electric_power_mw) * (dt / 2.0)
            secondary.turbine_rpm = 3000.0

        # Сбросные клапаны БРУ-К (в конденсатор) и БРУ-А (в атмосферу)
        # Пропорциональные регуляторы давления пара 2-го контура с динамикой хода
        # БРУ-К: уставка 6.7 МПа, пропорциональный диапазон 6.7 .. 7.2 МПа (блокировка при потере вакуума > 15 кПа)
        condenser_vacuum_ok = (secondary.condenser_pressure_kpa <= 15.0)
        if sg.steam_pressure_mpa > 6.7 and condenser_vacuum_ok:
            target_bru_k = min(100.0, (sg.steam_pressure_mpa - 6.7) / (7.2 - 6.7) * 100.0)
        else:
            target_bru_k = 0.0
        # Динамика скорости перемещения штока регулирующих клапанов БРУ-К
        d_k = target_bru_k - secondary.bru_k_pct
        secondary.bru_k_pct += math.copysign(min(abs(d_k), 25.0 * dt), d_k)
        secondary.bru_k_pct = max(0.0, min(100.0, secondary.bru_k_pct))

        # БРУ-А: уставка 7.1 МПа, сброс в атмосферу при превышении 7.1 .. 7.6 МПа
        if sg.steam_pressure_mpa > 7.1:
            target_bru_a = min(100.0, (sg.steam_pressure_mpa - 7.1) / (7.6 - 7.1) * 100.0)
        else:
            target_bru_a = 0.0
        d_a = target_bru_a - secondary.bru_a_pct
        secondary.bru_a_pct += math.copysign(min(abs(d_a), 30.0 * dt), d_a)
        secondary.bru_a_pct = max(0.0, min(100.0, secondary.bru_a_pct))

        bru_k_flow = (secondary.bru_k_pct / 100.0) * (self.nominal_steam_flow * 0.6)
        bru_a_flow = (secondary.bru_a_pct / 100.0) * (self.nominal_steam_flow * 0.4)
        leak_flow = self.steam_leak_fraction * (self.nominal_steam_flow * 1.5)

        total_steam_out = turbine_flow + bru_k_flow + bru_a_flow + leak_flow

        # Баланс давления в паропроводах 2 контура
        # dP2/dt = k_p2 * (G_steam_gen - G_steam_out)
        dp2 = 0.0018 * (sg.steam_flow_kg_s - total_steam_out) * dt
        sg.steam_pressure_mpa += dp2
        sg.steam_pressure_mpa = max(0.1, min(10.0, sg.steam_pressure_mpa))

        # Уровень в парогенераторе:
        # Питательные насосы (ПЭН) работают по автоматическому поддержанию уровня 2.4 м
        feedwater_pumps_active = sum(1 for p in secondary.feedwater_pumps_on if p)
        max_feed_capacity = (feedwater_pumps_active / 2.0) * self.nominal_steam_flow * 1.2
        
        # Регулятор питания ПГ (трехимпульсный регулятор уровня)
        level_error = self.nominal_sg_level_m - sg.water_level_m
        target_feed = sg.steam_flow_kg_s + level_error * 350.0
        sg.feedwater_flow_kg_s = max(0.0, min(max_feed_capacity, target_feed))

        # Изменение уровня воды в ПГ:
        # Площадь зеркала испарения 4 ПГ ~250 м2, плотность воды при 280°C ~750 кг/м3
        d_sg_level = ((sg.feedwater_flow_kg_s - sg.steam_flow_kg_s) / (250.0 * 750.0)) * dt
        sg.water_level_m += d_sg_level
        sg.water_level_m = max(0.1, min(3.5, sg.water_level_m))

        # -------------------------------------------------------------
        # 6. Компенсатор давления (КД) и давление 1 контура
        # -------------------------------------------------------------
        # Тепловое расширение/сжатие теплоносителя 1 контура:
        # Коэффициент объемного расширения воды при 300°C: beta_v ~ 2.5e-3 1/°C
        # Объем 1 контура ~350 м3. Изменение объема на градус ~0.87 м3/°C.
        d_t_cool = (primary.t_coolant_avg_c - 305.0)
        thermal_expansion_vol = d_t_cool * 0.45

        # Уровень в КД зависит от теплового расширения и течей:
        pz.water_level_m = self.nominal_pz_level_m + thermal_expansion_vol
        if self.loca_leak_rate_kg_s > 0:
            # Убыль теплоносителя при течи
            pz.water_level_m -= (self.loca_leak_rate_kg_s / 750.0 / 6.0) * dt

        # Пассивная система аварийного охлаждения зоны (САОЗ ГЕ-1..4):
        # 4 гидроемкости под давлением азота 6.0 МПа с раствором бора 16 г/кг (~2800 ppm)
        # При снижении запаса воды давление азотной подушки снижается по политропе (6.0 -> 1.5 МПа)
        if primary.saoz_accum_level_pct > 0.0:
            primary.saoz_accum_pressure_mpa = 1.5 + (6.0 - 1.5) * (primary.saoz_accum_level_pct / 100.0)
        else:
            primary.saoz_accum_pressure_mpa = 1.5

        # При снижении давления в 1 контуре ниже давления гидроемкостей обратные клапаны открываются
        if primary.pressure_mpa < primary.saoz_accum_pressure_mpa and primary.saoz_accum_level_pct > 0.1:
            delta_p_saoz = primary.saoz_accum_pressure_mpa - primary.pressure_mpa
            saoz_flow = 4.0 * 125.0 * math.sqrt(max(0.0, delta_p_saoz) / 6.0)
            primary.saoz_active = True
            primary.saoz_flow_kg_s = saoz_flow

            # Убыль запаса борированной воды в 4 емкостях (4 x 60 м3 = 240 м3)
            primary.saoz_accum_level_pct = max(0.0, primary.saoz_accum_level_pct - (saoz_flow * dt / 2400.0))

            # Подача холодной воды САОЗ (60 °C) охлаждает холодную нить
            primary.t_cold_c += -((saoz_flow / max(100.0, primary.mass_flow_kg_s)) * (primary.t_cold_c - 60.0)) * dt * 0.4

            # Ввод бора (2800 ppm) для надежного глушения цепной реакции
            d_boron = ((2800.0 - primary.boron_ppm) * (saoz_flow / max(100.0, primary.mass_flow_kg_s))) * dt * 0.6
            primary.boron_ppm = min(2800.0, primary.boron_ppm + d_boron)

            # Восполнение уровня теплоносителя и торможение падения давления
            pz.water_level_m += (saoz_flow / 750.0 / 6.0) * dt * 0.5
            dp_saoz = (saoz_flow / 500.0) * 0.22 * dt
        else:
            primary.saoz_active = False
            primary.saoz_flow_kg_s = 0.0
            dp_saoz = 0.0

        pz.water_level_m = max(0.2, min(12.0, pz.water_level_m))

        # Автоматика КД:
        # ТЭНы включаются при снижении давления ниже 15.6 МПа
        if pz.heaters_auto:
            if primary.pressure_mpa < 15.65:
                pz.heaters_power_kw = min(2520.0, pz.heaters_power_kw + 500.0 * dt)
            elif primary.pressure_mpa > 15.75:
                pz.heaters_power_kw = max(200.0, pz.heaters_power_kw - 300.0 * dt)

        # Впрыск холодной воды в паровую подушку КД включается при давлении выше 15.8 МПа
        if pz.spray_auto:
            if primary.pressure_mpa > 15.8:
                pz.spray_valve_pos = min(1.0, (primary.pressure_mpa - 15.8) * 2.5)
            else:
                pz.spray_valve_pos = max(0.0, pz.spray_valve_pos - 0.5 * dt)

        # Предохранительный клапан КД (ИМРУ):
        if primary.pressure_mpa > 17.6:
            pz.relief_valve_open = True
        elif primary.pressure_mpa < 16.5:
            pz.relief_valve_open = False

        # Динамика давления 1 контура:
        # Сжатие паровой подушки из-за колебаний средней температуры:
        dp_temp = 0.045 * (primary.t_coolant_avg_c - 305.0)
        # Действие ТЭНов (добавляет давление):
        dp_heaters = (pz.heaters_power_kw / 2520.0) * 0.05 * dt
        # Действие впрыска (конденсирует пар, снижает давление):
        dp_spray = -pz.spray_valve_pos * 0.18 * dt
        # Сброс через предохранительный клапан:
        dp_relief = -0.4 * dt if pz.relief_valve_open else 0.0
        # Течь 1 контура (LOCA):
        dp_loca = -(self.loca_leak_rate_kg_s / 500.0) * 0.3 * dt

        primary.pressure_mpa += dp_heaters + dp_spray + dp_relief + dp_loca + dp_saoz + (self.nominal_p1_mpa + dp_temp - primary.pressure_mpa) * (dt / 12.0)
        primary.pressure_mpa = max(0.1, min(25.0, primary.pressure_mpa))

        # Расчет температуры насыщения 1 контура и запаса до закипания (субкулинга)
        primary.t_sat_1k_c = 179.9 * (max(0.1, primary.pressure_mpa) ** 0.239)
        primary.subcooling_margin_c = max(0.0, primary.t_sat_1k_c - primary.t_hot_c)
