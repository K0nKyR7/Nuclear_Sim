from dataclasses import dataclass, field
from typing import List, Dict, Any
from enum import Enum


class PlantState(str, Enum):
    POWER_OPERATION = "POWER_OPERATION"     # Штатная работа на мощности
    HOT_STANDBY = "HOT_STANDBY"             # Горячий останов
    SCRAMMED = "SCRAMMED"                   # Аварийная защита (АЗ-5)
    TRIPPED = "TRIPPED"                     # Автоматический останов защитами
    ACCIDENT = "ACCIDENT"                   # Аварийный режим
    EXPLOSION = "EXPLOSION"                 # Взрыв оборудования / гидроудар
    MELTDOWN = "MELTDOWN"                   # Плавление активной зоны


class AlarmLevel(str, Enum):
    INFO = "INFO"
    WARNING = "WARNING"
    CRITICAL = "CRITICAL"


@dataclass
class AlarmEvent:
    id: str
    message: str
    level: AlarmLevel
    timestamp: float
    acknowledged: bool = False
    active: bool = True


@dataclass
class KineticsState:
    # Относительная нейтронная мощность (1.0 = 100% Nном = 3000 МВт_тепл)
    relative_neutron_flux: float = 1.0
    # Концентрации 6 групп ядер-предшественников запаздывающих нейтронов (нормированы)
    precursor_conc: List[float] = field(default_factory=lambda: [
        0.033, 0.219, 0.196, 0.395, 0.115, 0.042
    ])
    # Период реактора (сек)
    period: float = 999.0
    # Суммарная реактивность (в единицах beta_eff или pcm)
    total_reactivity_pcm: float = 0.0
    rod_reactivity_pcm: float = 0.0
    doppler_reactivity_pcm: float = 0.0
    coolant_temp_reactivity_pcm: float = 0.0
    boron_reactivity_pcm: float = 0.0
    xenon_reactivity_pcm: float = 0.0

    # Концентрация ксенона Xe-135 и йода I-135 (отн. ед.)
    xenon_rel: float = 1.0
    iodine_rel: float = 1.0


@dataclass
class PrimaryLoopState:
    # Давление в 1 контуре (МПа), номинал 15.7 МПа
    pressure_mpa: float = 15.7
    # Температура горячей нити (выход из АЗ) (°C), номинал 320 °C
    t_hot_c: float = 320.0
    # Температура холодной нити (вход в АЗ) (°C), номинал 290 °C
    t_cold_c: float = 290.0
    # Средняя температура теплоносителя в активной зоне (°C)
    t_coolant_avg_c: float = 305.0
    # Средняя температура топлива (ТВЭЛ) (°C)
    t_fuel_c: float = 680.0
    # Массовый расход теплоносителя (кг/с), номинал ~18800 кг/с
    mass_flow_kg_s: float = 18800.0
    # Относительный расход через петли (1.0 = 100%)
    relative_flow: float = 1.0
    # Состояние ГЦН-1, 2, 3, 4 (True = включен)
    rcp_status: List[bool] = field(default_factory=lambda: [True, True, True, True])
    # Концентрация борной кислоты (г/кг или ppm), номинал ~500 ppm
    boron_ppm: float = 500.0
    # Температура насыщения теплоносителя 1К при давлении P_1 (°C)
    t_sat_1k_c: float = 345.8
    # Запас теплоносителя до закипания / насыщения (°C): Delta T_subcool = T_sat(P_1) - T_hot
    subcooling_margin_c: float = 25.8
    # Пассивная система аварийного охлаждения зоны (САОЗ ГЕ-1..4, P_азота = 6.0 МПа)
    saoz_active: bool = False
    saoz_flow_kg_s: float = 0.0
    saoz_accum_pressure_mpa: float = 6.0
    saoz_accum_level_pct: float = 100.0



@dataclass
class PressurizerState:
    # Уровень теплоносителя в КД (м), номинал ~7.0 м (диапазон 0..12 м)
    water_level_m: float = 7.0
    # Статус групп ТЭН КД (электронагреватели, 4 группы: 0..100% мощности)
    heaters_power_kw: float = 800.0
    heaters_auto: bool = True
    # Клапан впрыска из холодной нити (0.0..1.0)
    spray_valve_pos: float = 0.0
    spray_auto: bool = True
    # Предохранительный клапан КД (ИМРУ / ИПУ КД)
    relief_valve_open: bool = False


@dataclass
class SteamGeneratorState:
    # Давление пара во 2 контуре (МПа), номинал 6.4 МПа
    steam_pressure_mpa: float = 6.4
    # Температура насыщения пара во 2 контуре (°C)
    t_steam_sat_c: float = 279.8
    # Уровень воды в ПГ (м), номинал ~2.4 м (диапазон 0..3.5 м)
    water_level_m: float = 2.4
    # Паропроизводительность (т/ч или кг/с), номинал ~1600 кг/с суммарно (~5800 т/ч)
    steam_flow_kg_s: float = 1620.0
    # Расход питательной воды (кг/с)
    feedwater_flow_kg_s: float = 1620.0
    # Температура питательной воды (°C), номинал 220 °C
    t_feedwater_c: float = 220.0


@dataclass
class SecondaryLoopState:
    # Частота вращения вала турбины (об/мин), номинал 3000 об/мин (или 1500 для тихоходных)
    turbine_rpm: float = 3000.0
    # Положение регулирующих клапанов турбины (0..100%)
    turbine_valves_pct: float = 85.0
    # Стопорные клапаны турбины (открыты/закрыты)
    turbine_trip_valve: bool = True
    # Электрическая мощность генератора (МВт эл.), номинал 1000 МВт
    electric_power_mw: float = 1000.0
    # Давление в конденсаторе (кПа), номинал ~4.0 кПа (глубокий вакуум)
    condenser_pressure_kpa: float = 4.5
    # Быстродействующая редукционная установка со сбросом пара в конденсатор (БРУ-К, 0..100%)
    bru_k_pct: float = 0.0
    # Сброс в атмосферу (БРУ-А, 0..100%)
    bru_a_pct: float = 0.0
    # Питательные электронасосы (ПЭН, 2 рабочих, 1 резервный)
    feedwater_pumps_on: List[bool] = field(default_factory=lambda: [True, True, False])


@dataclass
class ControlsState:
    # Положение регулирующей группы стержней СУЗ (10-я группа): 0% (внизу) .. 100% (вверху)
    rod_position_pct: float = 80.0
    # Скорость перемещения стержней СУЗ (%/с) при ручном управлении (+1.0 вверх, -1.0 вниз, 0 стоп)
    rod_manual_speed_pct_s: float = 0.0
    # Режим автоматического регулятора мощности (АРМ)
    auto_power_controller: bool = True
    # Уставка целевой электрической мощности (МВт)
    target_power_mw: float = 1000.0
    # Кнопка АЗ-5 нажата
    az5_button_pressed: bool = False
    # Блокировка автоматических защит АЗ-5 (испытательный/аварийный режим оператора)
    safety_system_bypassed: bool = False


@dataclass
class TelemetryData:
    timestamp: float
    sim_time_s: float
    state: PlantState
    # Мощности
    thermal_power_mw: float
    relative_power_pct: float
    electric_power_mw: float
    residual_heat_mw: float
    # Реактор и 1 контур
    reactivity_pcm: float
    period_s: float
    pressure_1k_mpa: float
    t_hot_c: float
    t_cold_c: float
    t_fuel_c: float
    flow_1k_kg_s: float
    # Запас до закипания и водно-химический режим
    t_sat_1k_c: float
    subcooling_margin_c: float
    boron_ppm: float
    # САОЗ пассивные гидроемкости
    saoz_active: bool
    saoz_flow_kg_s: float
    saoz_accum_pressure_mpa: float
    saoz_accum_level_pct: float
    # Компенсатор давления
    pz_level_m: float
    pz_heaters_kw: float
    pz_spray_active: bool
    # Парогенератор и 2 контур
    pressure_2k_mpa: float
    sg_level_m: float
    steam_flow_kg_s: float
    feedwater_flow_kg_s: float
    turbine_rpm: float
    condenser_vacuum_kpa: float
    rod_position_pct: float
    bru_k_pct: float
    bru_a_pct: float
    # Состояния оборудования
    rcp_active_count: int
    # Аварийные последствия и целостность конструкций
    core_damage_pct: float = 0.0
    containment_pressure_kpa: float = 101.3
    radiation_level_mr_h: float = 12.0
    hydrogen_pct: float = 0.0
    primary_rupture: bool = False
    steam_pipe_ruptured: bool = False
    explosion_active: bool = False
    explosion_type: str = ""
    nuclear_detonation: bool = False
    reactor_head_blown: bool = False
    safety_system_bypassed: bool = False
    alarms: List[Dict[str, Any]] = field(default_factory=list)
