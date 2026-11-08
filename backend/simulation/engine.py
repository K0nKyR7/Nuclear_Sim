import time
import asyncio
from typing import Dict, Any, List, Optional
from ..physics.models import (
    PlantState, KineticsState, PrimaryLoopState, PressurizerState,
    SteamGeneratorState, SecondaryLoopState, ControlsState, TelemetryData,
    AlarmLevel, ShiftMission, FinaleType
)
from ..physics.kinetics import KineticsModel
from ..physics.reactivity import ReactivityModel
from ..physics.thermal_hydraulics import ThermalHydraulicsModel
from .safety_system import SafetySystem


MISSIONS: Dict[str, Dict[str, Any]] = {
    "BASE_LOAD": {
        "id": "BASE_LOAD",
        "title": "НЕСЕНИЕ БАЗОВОЙ НАГРУЗКИ (1000 МВт)",
        "description": "Удержание номинальной мощности 1000 МВт (±25 МВт), контроль ΔTнас > 18°C и P1 (15.7±0.5 МПа).",
        "target_power_mw": 1000.0,
        "target_duration_s": 120.0,
        "objectives": [
            "Удерживать N_эл в диапазоне 975..1025 МВт",
            "Запас до закипания ΔTнас > 18.0 °C",
            "Давление 1К в пределах 15.2 .. 16.2 МПа",
            "Не допустить аварийных срабатываний АЗ-5"
        ]
    },
    "MANEUVER": {
        "id": "MANEUVER",
        "title": "ДИСПЕТЧЕРСКИЙ МАНЕВР (600 МВт)",
        "description": "Снижение электрической мощности до 600 МВт с компенсацией ксенонового отравления.",
        "target_power_mw": 600.0,
        "target_duration_s": 120.0,
        "objectives": [
            "Снизить N_эл до уровня 580..620 МВт",
            "Скомпенсировать ксеноновую яму бором и СУЗ",
            "Удержать уровень КД (5.0..8.5 м) и субкулинг > 15 °C",
            "Стабилизировать энергоблок на пониженной мощности"
        ]
    },
    "COLD_SHUTDOWN": {
        "id": "COLD_SHUTDOWN",
        "title": "РЕГЛАМЕНТ ХОЛОДНОГО ОСТАНОВА",
        "description": "Перевод реактора в подкритическое расхоложенное состояние (T_hot < 100 °C, P1 < 3.5 МПа, бор >= 1800 ppm).",
        "target_power_mw": 0.0,
        "target_duration_s": 120.0,
        "objectives": [
            "Глушение реактора: стержни СУЗ на нижних концевиках (0%)",
            "Ввод бора в 1К: концентрация C_B >= 1800 ppm",
            "Расхолаживание 1К: температура T_hot < 100 °C (БРУ-А)",
            "Сброс давления 1К ниже 3.5 МПа"
        ]
    },
    "CRISIS_LOCA": {
        "id": "CRISIS_LOCA",
        "title": "ЛОКАЛИЗАЦИЯ ТЕЧИ 1К (LOCA)",
        "description": "Крупная течь теплоносителя. Задействовать САОЗ, включить спринклер ГО, удержать ТВЭЛ < 15% повреждений.",
        "target_power_mw": 0.0,
        "target_duration_s": 60.0,
        "objectives": [
            "Аварийный останов АЗ-5 и проверка ввода поглотителей",
            "Обеспечить подачу воды от гидроемкостей САОЗ",
            "Включить спринклерную систему ГО для подавления пара",
            "Не допустить оголения и расплавления зоны (< 15%)"
        ]
    },
    "CRISIS_SBO": {
        "id": "CRISIS_SBO",
        "title": "ПОЛНОЕ ОБЕСТОЧИВАНИЕ (SBO)",
        "description": "Потеря всех насосов. Расхолаживание на естественной циркуляции сбросом пара через БРУ-А в атмосферу.",
        "target_power_mw": 0.0,
        "target_duration_s": 60.0,
        "objectives": [
            "Сброс АЗ-5 и подтверждение остановки цепной реакции",
            "Открыть БРУ-А для аварийного парового расхолаживания",
            "Удержать запас до кипения ΔTнас > 5.0 °C",
            "Предотвратить повреждение топлива при выбеге ГЦН"
        ]
    },
    "SANDBOX": {
        "id": "SANDBOX",
        "title": "СВОБОДНЫЙ РЕЖИМ (ПЕСОЧНИЦА)",
        "description": "Свободные технологические эксперименты, проверка любых защит и аварий без ограничений по времени.",
        "target_power_mw": 1000.0,
        "target_duration_s": 9999.0,
        "objectives": [
            "Исследование динамики реактора ВВЭР-1000",
            "Эксперименты с реактивностью и отравлением ксеноном",
            "Отработка тяжелых аварийных режимов"
        ]
    }
}


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

        # Активные сценарии отказов и тяжелых аварий
        self.active_scenarios: Dict[str, bool] = {
            "rcp1_trip": False,
            "steam_break": False,
            "loca_leak": False,
            "rod_stuck": False,
            "grid_loss": False,
            "prompt_critical": False,
            "guillotine_loca": False,
            "station_blackout": False,
            "core_meltdown": False,
            "bypass_safety": False,
            "nuclear_blast": False
        }

        # Сменные задания, регламенты и оценка оператора
        self.mission_id: str = "BASE_LOAD"
        self.shift_time_s: float = 0.0
        self.operator_score: float = 100.0
        self.operator_grade: str = "A+ (МАСТЕР)"
        self.penalty_points: float = 0.0
        self.violations: List[str] = []
        self.scram_penalized: bool = False
        self.bypass_penalized: bool = False
        self.accident_start_time: Optional[float] = None

        # Финал игры
        self.finale_triggered: bool = False
        self.finale_type: str = ""
        self.finale_data: Dict[str, Any] = {}

    def reset(self) -> None:
        """Сброс к исходному номинальному состоянию 100% мощности."""
        self.__init__()

    def set_mission(self, mission_id: str) -> None:
        if mission_id not in MISSIONS:
            mission_id = "BASE_LOAD"
        self.mission_id = mission_id
        self.shift_time_s = 0.0
        self.penalty_points = 0.0
        self.violations.clear()
        self.scram_penalized = False
        self.bypass_penalized = False
        self.accident_start_time = None
        self.finale_triggered = False
        self.finale_type = ""
        self.finale_data = {}

        # Очистка сценариев предыдущей аварийной миссии при переходе на штатный регламент
        if mission_id != "CRISIS_LOCA" and self.active_scenarios.get("loca_leak"):
            self.trigger_scenario("loca_leak", False)
        if mission_id != "CRISIS_SBO" and self.active_scenarios.get("station_blackout"):
            self.trigger_scenario("station_blackout", False)
            self.primary_state.rcp_status = [True, True, True, True]
            self.secondary_state.feedwater_pumps_on = [True, True, False]
            self.thermal_model.grid_disconnected = False
            self.secondary_state.turbine_trip_valve = True

        if mission_id in ["BASE_LOAD", "MANEUVER", "COLD_SHUTDOWN"]:
            self.thermal_model.containment_spray_active = False
            self.thermal_model.emergency_boron_active = False

        if mission_id == "CRISIS_LOCA":
            self.trigger_scenario("loca_leak", True)
        elif mission_id == "CRISIS_SBO":
            self.trigger_scenario("station_blackout", True)
        elif mission_id == "MANEUVER":
            self.controls_state.target_power_mw = 600.0
        elif mission_id == "BASE_LOAD":
            self.controls_state.target_power_mw = 1000.0

        m_title = MISSIONS[mission_id]["title"]
        self.safety.add_alarm(f"РЕГЛАМЕНТ: Принято сменное задание '{m_title}'", AlarmLevel.INFO, self.sim_time_s)

    def get_mission_objectives_status(self) -> List[Dict[str, Any]]:
        m = MISSIONS.get(self.mission_id, MISSIONS["BASE_LOAD"])
        objs = m["objectives"]
        results = []
        mid = self.mission_id

        if mid == "BASE_LOAD":
            c0 = (975.0 <= self.secondary_state.electric_power_mw <= 1025.0)
            c1 = (self.primary_state.subcooling_margin_c >= 18.0)
            c2 = (15.2 <= self.primary_state.pressure_mpa <= 16.2)
            c3 = (not self.safety.scrammed)
            conds = [c0, c1, c2, c3]
        elif mid == "MANEUVER":
            c0 = (580.0 <= self.secondary_state.electric_power_mw <= 620.0)
            c1 = (self.kinetics_state.xenon_rel < 2.5)
            c2 = (5.0 <= self.pz_state.water_level_m <= 8.5 and self.primary_state.subcooling_margin_c >= 15.0)
            c3 = (not self.safety.scrammed)
            conds = [c0, c1, c2, c3]
        elif mid == "COLD_SHUTDOWN":
            c0 = (self.controls_state.rod_position_pct <= 2.0 and self.kinetics_state.relative_neutron_flux < 0.05)
            c1 = (self.primary_state.boron_ppm >= 1800.0)
            c2 = (self.primary_state.t_hot_c < 100.0)
            c3 = (self.primary_state.pressure_mpa < 3.5)
            conds = [c0, c1, c2, c3]
        elif mid == "CRISIS_LOCA":
            c0 = self.safety.scrammed
            c1 = (self.primary_state.saoz_active or self.primary_state.saoz_accum_level_pct < 99.0)
            c2 = self.thermal_model.containment_spray_active
            c3 = (self.thermal_model.core_damage_pct < 15.0)
            conds = [c0, c1, c2, c3]
        elif mid == "CRISIS_SBO":
            c0 = self.safety.scrammed
            c1 = (self.secondary_state.bru_a_pct > 5.0)
            c2 = (self.primary_state.subcooling_margin_c > 5.0)
            c3 = (self.thermal_model.core_damage_pct < 10.0)
            conds = [c0, c1, c2, c3]
        else: # SANDBOX
            conds = [True for _ in objs]

        for i, text in enumerate(objs):
            done = conds[i] if i < len(conds) else False
            results.append({
                "title": text,
                "text": text,
                "status": "completed" if done else "pending",
                "done": done
            })
        return results

    def build_finale_data(self, finale_type: str) -> Dict[str, Any]:
        core_damage = round(self.thermal_model.core_damage_pct, 1)
        score = round(self.operator_score, 1)
        grade = self.operator_grade
        energy = round(self.thermal_model.total_energy_mwh, 2)
        p1 = round(self.primary_state.pressure_mpa, 2)
        t_hot = round(self.primary_state.t_hot_c, 1)
        boron = round(self.primary_state.boron_ppm, 0)
        cont_p = round(self.thermal_model.containment_pressure_kpa, 1)
        rad = round(self.thermal_model.radiation_level_mr_h, 1)
        h2 = round(self.thermal_model.hydrogen_pct, 1)
        nel = round(self.secondary_state.electric_power_mw, 0)

        if finale_type == FinaleType.PROMPT_CRITICAL.value:
            return {
                "type": finale_type,
                "ines_level": 7,
                "badge_class": "ines-badge-fatal",
                "badge_text": "ГЛОБАЛЬНАЯ ЯДЕРНАЯ АВАРИЯ (INES 7)",
                "super_title": "ГОСКОМИССИЯ ПО ЧРЕЗВЫЧАЙНЫМ СИТУАЦИЯМ СССР • МИНЭНЕРГО",
                "title": "ЭНЕРГОБЛОК №1 ПОЛНОСТЬЮ УНИЧТОЖЕН",
                "subtitle": "СВЕРХКРИТИЧЕСКИЙ РАЗГОН РЕАКТОРА • РАЗРУШЕНИЕ ГЕРМООБОЛОЧКИ И ЭНЕРГОБЛОКА",
                "lead_text": "В результате неуправляемого разгона мощности на мгновенных нейтронах произошла детонация реакторной установки. 200-тонная верхняя крышка реактора сорвана взрывом, корпус разорван, активная зона расплавлена и испарена в атмосферу. Оборудование пульта управления разбито и выведено из строя ударной волной.",
                "cards": [
                    {"lbl": "СОСТОЯНИЕ АКТИВНОЙ ЗОНЫ", "val": "100% РАЗРУШЕНИЕ / ИСПАРЕНИЕ", "sub": "Жерло шахты реактора открыто в небо", "cls": "danger"},
                    {"lbl": "РАДИАЦИОННЫЙ ФОН", "val": "> 50 000 мР/ч", "sub": "Смертельная доза за 30 секунд", "cls": "danger"},
                    {"lbl": "ДАВЛЕНИЕ В 1К / БОКСАХ", "val": "0.00 МПа (РАЗРЫВ)", "sub": "Полная разгерметизация первого контура", "cls": "danger"},
                    {"lbl": "ПУЛЬТ ОПЕРАТОРА (БЩУ)", "val": "ВЫВЕДЕН ИЗ СТРОЯ", "sub": "Кнопки разбиты, монитор разрушен", "cls": "danger"}
                ],
                "resolution": "Дальнейшая эксплуатация энергоблока невозможна. Персонал эвакуирован. Объявлена 30-километровая зона отчуждения.",
                "stamp": "РЕШЕНИЕ:",
                "restart_caption": "ПЕРЕЗАГРУЗИТЬ ЭНЕРГОБЛОК (НАЧАТЬ СНАЧАЛА)"
            }

        elif finale_type == FinaleType.CORE_MELTDOWN.value:
            return {
                "type": finale_type,
                "ines_level": 5,
                "badge_class": "ines-badge-meltdown",
                "badge_text": "ТЯЖЕЛАЯ АВАРИЯ С ПЛАВЛЕНИЕМ ЗОНЫ (INES 5)",
                "super_title": "ГОСАТОМНАДЗОР СССР • ТЕХНИЧЕСКАЯ ИНСПЕКЦИЯ",
                "title": "ТЯЖЕЛАЯ АВАРИЯ: ПЛАВЛЕНИЕ АКТИВНОЙ ЗОНЫ",
                "subtitle": "ОСУШЕНИЕ РЕАКТОРА • ПАРОЦИРКОНИЕВАЯ РЕАКЦИЯ • ОБРАЗОВАНИЕ КОРИЯ",
                "lead_text": f"В результате прекращения отвода тепла оболочки ТВЭЛ перегрелись свыше 1800 °C. Произошла экзотермическая пароциркониевая реакция с образованием {h2}% водорода и разрушением {core_damage}% топлива. Ловушка расплава удержала корий, но реактор выведен из строя навсегда.",
                "cards": [
                    {"lbl": "РАСПЛАВЛЕНИЕ ТОПЛИВА", "val": f"{core_damage}% В КОРИИ", "sub": "Проплавление дистанционирующих решеток", "cls": "danger"},
                    {"lbl": "ВОДОРОД В ГО", "val": f"{h2}% H2", "sub": "Опасность взрыва гремучей смеси", "cls": "danger"},
                    {"lbl": "РАДИАЦИЯ В БОКСАХ", "val": f"{rad:.0f} мР/ч", "sub": "Выход летучих осколков цезия и йода", "cls": "warn"},
                    {"lbl": "РЕЙТИНГ ОПЕРАТОРА", "val": f"{score:.0f} БАЛЛОВ [{grade}]", "sub": "Отстранение от должности и следствие", "cls": "danger"}
                ],
                "resolution": "Энергоблок остановлен. Введен режим консервации аварийного объекта. Материалы переданы для уголовного расследования причин аварии.",
                "stamp": "ЗАКЛЮЧЕНИЕ:",
                "restart_caption": "ПЕРЕЗАГРУЗИТЬ ЭНЕРГОБЛОК (НАЧАТЬ СНАЧАЛА)"
            }

        elif finale_type == FinaleType.CRISIS_CONTAINED.value:
            return {
                "type": finale_type,
                "ines_level": 2,
                "badge_class": "ines-badge-contained",
                "badge_text": "АВАРИЯ УСПЕШНО ЛОКАЛИЗОВАНА (INES 2)",
                "super_title": "ШТАБ ЛИКВИДАЦИИ АВАРИЙ МИНЭНЕРГО • БЛАГОДАРНОСТЬ",
                "title": "ГЕРОИЧЕСКАЯ ЛОКАЛИЗАЦИЯ ТЯЖЕЛОЙ АВАРИИ",
                "subtitle": "СЛАЖЕННЫЕ ДЕЙСТВИЯ СМЕНЫ БЩУ • АКТИВНАЯ ЗОНА СПАСЕНА",
                "lead_text": f"В условиях критического технологического отказа смена операторов проявила высшее мастерство. Своевременным вводом САОЗ, включением спринклерной системы ГО и расхолаживанием через БРУ-А удалось предотвратить расплавление активной зоны (сохранность {100.0 - core_damage:.1f}%).",
                "cards": [
                    {"lbl": "СОХРАННОСТЬ АЗ", "val": f"{100.0 - core_damage:.1f}% ЦЕЛЫХ ТВЭЛ", "sub": "Оплавление зоны остановлено", "cls": "success"},
                    {"lbl": "ДАВЛЕНИЕ В ГО", "val": f"{cont_p:.1f} кПа", "sub": "Спринклеры сконденсировали пар", "cls": "success"},
                    {"lbl": "РАДИАЦИОННЫЙ БАРЬЕР", "val": "УДЕРЖАН В ГО", "sub": "Выбросов во внешнюю среду нет", "cls": "success"},
                    {"lbl": "ИТОГОВЫЙ БАЛЛ", "val": f"{score:.0f} [{grade}]", "sub": "Представление к ведомственной награде", "cls": "gold"}
                ],
                "resolution": "Аварийная ситуация взята под полный контроль. Реактор переведен на плановое расхолаживание. Смена БЩУ представлена к государственной награде за мужество.",
                "stamp": "ПРИКАЗ МИНИСТРА:",
                "restart_caption": "ПРИНЯТЬ НОВУЮ СМЕНУ"
            }

        elif finale_type == FinaleType.COLD_SHUTDOWN_SAFE.value:
            return {
                "type": finale_type,
                "ines_level": 0,
                "badge_class": "ines-badge-safe",
                "badge_text": "ШТАТНЫЙ РЕЖИМ (INES 0 / НОРМА)",
                "super_title": "ГОСАТОМНАДЗОР СССР • АКТ ПРИЕМКИ ОСТАНОВА",
                "title": "БЕЗОПАСНЫЙ ХОЛОДНЫЙ ОСТАНОВ ВЫПОЛНЕН",
                "subtitle": "РЕГЛАМЕНТ РАСХОЛАЖИВАНИЯ БЛОКА ВВЭР-1000 ЗАВЕРШЕН ПО ГОСТ",
                "lead_text": f"Энергоблок №1 успешно расхоложен до температуры {t_hot:.1f} °C и давления {p1:.2f} МПа при концентрации бора {boron:.0f} ppm. Реактор находится в глубоко подкритическом безопасном состоянии. Все барьеры безопасности полностью герметичны.",
                "cards": [
                    {"lbl": "ТЕМПЕРАТУРА 1К", "val": f"{t_hot:.1f} °C (< 100 °C)", "sub": "Глубокое расхолаживание достигнуто", "cls": "cyan"},
                    {"lbl": "ДАВЛЕНИЕ 1К", "val": f"{p1:.2f} МПа (< 3.5 МПа)", "sub": "Трубопроводы разгружены от давления", "cls": "cyan"},
                    {"lbl": "КОНЦЕНТРАЦИЯ БОРА", "val": f"{boron:.0f} ppm", "sub": "Гарантия ядерной подкритичности", "cls": "success"},
                    {"lbl": "ОЦЕНКА ОПЕРАТОРА", "val": f"{score:.0f} [{grade}]", "sub": "Регламент выполнен безукоризненно", "cls": "gold"}
                ],
                "resolution": "Акт приема-сдачи подписан главным инженером АЭС. Оборудование блока передано цеху централизованного ремонта для плановой перегрузки топлива.",
                "stamp": "РЕШЕНИЕ:",
                "restart_caption": "НАЧАТЬ НОВУЮ СМЕНУ"
            }

        elif finale_type == FinaleType.UNPLANNED_SCRAM.value:
            return {
                "type": finale_type,
                "ines_level": 1,
                "badge_class": "ines-badge-scram",
                "badge_text": "ВНЕПЛАНОВЫЙ АВАРИЙНЫЙ ОСТАНОВ (INES 1)",
                "super_title": "ГОСАТОМЭНЕРГОНАДЗОР СССР • ДИРЕКЦИЯ СТАНЦИИ",
                "title": "ВНЕПЛАНОВЫЙ СБРОС АВАРИЙНОЙ ЗАЩИТЫ АЗ-5",
                "subtitle": "СРАБАТЫВАНИЕ ЗАЩИТ • РАЗГРУЗКА ЭНЕРГОСИСТЕМЫ • ТОПЛИВО НЕ ПОВРЕЖДЕНО",
                "lead_text": f"В ходе смены произошло аварийное срабатывание защиты АЗ-5. Все поглощающие стержни штатно введены в активную зону. Цепная реакция остановлена, ядерная безопасность энергоблока обеспечена, разрушения ТВЭЛ нет (сохранность {100.0 - core_damage:.1f}%). Однако энергоблок аварийно отключен от Единой энергосистемы СССР с недоотпуском электрической мощности.",
                "cards": [
                    {"lbl": "СОСТОЯНИЕ ТОПЛИВА", "val": f"{100.0 - core_damage:.1f}% ЦЕЛЫХ ТВЭЛ", "sub": "Опасного плавления не произошло", "cls": "success"},
                    {"lbl": "ЭЛЕКТРОСЕТЬ", "val": f"{nel:.0f} МВт (СБРОС ДО 0)", "sub": "Турбогенератор остановлен защитой", "cls": "warn"},
                    {"lbl": "ВЫРАБОТКА ЭНЕРГИИ", "val": f"{energy:.1f} МВт·ч", "sub": "Срыв диспетчерского графика", "cls": "warn"},
                    {"lbl": "АТТЕСТАЦИЯ ОПЕРАТОРА", "val": f"{score:.0f} БАЛЛОВ [{grade}]", "sub": "Внеочередная аттестационная комиссия", "cls": "danger" if score < 50 else "warn"}
                ],
                "resolution": "Назначено служебное расследование причин срабатывания защит. Дежурный персонал направлен на внеочередную проверку знаний правил ядерной безопасности.",
                "stamp": "ПРИКАЗ ДИРЕКТОРА:",
                "restart_caption": "ПОВТОРИТЬ СМЕНУ"
            }

        else: # TRIUMPH_SHIFT
            if score >= 80.0:
                title = "ТРИУМФ ОПЕРАТОРА: СМЕНА СДАНА НА «ОТЛИЧНО»"
                subtitle = "ЭНЕРГОБЛОК №1 ВВЭР-1000 РАБОТАЕТ В ИДЕАЛЬНОМ РЕЖИМЕ"
                badge_text = "ОБРАЗЦОВОЕ ДЕЖУРСТВО (INES 0 / ЗОЛОТОЙ СТАНДАРТ)"
                badge_class = "ines-badge-triumph"
                lead = f"Смена БЩУ-1 завершила дежурство с блестящими показателями. Выработано {energy:.1f} МВт·ч чистой электроэнергии. Параметры активной зоны, давления и температуры удерживались с идеальной прецизионностью. Нарушений регламента не зафиксировано."
                resolution = "Комиссией утверждено начисление повышенной премии персоналу смены. Оператор рекомендован на должность начальника смены станции."
                res_stamp = "ПОСТАНОВЛЕНИЕ:"
                restart_cap = "ПРИНЯТЬ СЛЕДУЮЩУЮ СМЕНУ"
            elif score >= 50.0:
                title = "СМЕНА СДАНА С ПРЕДУПРЕЖДЕНИЕМ"
                subtitle = "ПЛАН ВЫПОЛНЕН • ЗАФИКСИРОВАНЫ НАРУШЕНИЯ РЕГЛАМЕНТА"
                badge_text = "ДЕЖУРСТВО С ЗАМЕЧАНИЯМИ (INES 0)"
                badge_class = "ines-badge-warn"
                lead = f"Смена сдана, энергоблок удерживается в работе. Выработано {energy:.1f} МВт·ч. Однако в ходе дежурства оператором допущен ряд отклонений от технологической карты, приведших к начислению штрафных баллов."
                resolution = "Смена принята с замечаниями. Оператору вынесено строгое предупреждение с внесением записи в оперативный журнал."
                res_stamp = "РЕЗОЛЮЦИЯ:"
                restart_cap = "ПРИНЯТЬ СЛЕДУЮЩУЮ СМЕНУ"
            else:
                title = "СМЕНА ПРОВАЛЕНА: ДИСЦИПЛИНАРНОЕ ВЗЫСКАНИЕ"
                subtitle = "СИСТЕМАТИЧЕСКИЕ НАРУШЕНИЯ ПРАВИЛ ЯДЕРНОЙ БЕЗОПАСНОСТИ"
                badge_text = "ГРУБЫЕ НАРУШЕНИЯ РЕГЛАМЕНТА (INES 0/1)"
                badge_class = "ines-badge-scram"
                lead = f"В ходе дежурства допущены многочисленные грубые нарушения ядерной безопасности и технологических инструкций. Итоговый рейтинг смены упал до {score:.0f} баллов ({grade})."
                resolution = "Оператор отстранен от оперативного управления БЩУ. Дело передано в Государственную инспекцию по ядерной безопасности (трибунал)."
                res_stamp = "ПРИКАЗ НАЧАЛЬНИКА СТАНЦИИ:"
                restart_cap = "ПЕРЕСДАТЬ СМЕНУ"

            return {
                "type": FinaleType.TRIUMPH_SHIFT.value,
                "ines_level": 0 if score >= 50.0 else 1,
                "badge_class": badge_class,
                "badge_text": badge_text,
                "super_title": "ГОСУДАРСТВЕННАЯ ЭНЕРГЕТИЧЕСКАЯ КОМИССИЯ СССР",
                "title": title,
                "subtitle": subtitle,
                "lead_text": lead,
                "cards": [
                    {"lbl": "ВЫРАБОТКА ЭНЕРГИИ", "val": f"{energy:.1f} МВт·ч", "sub": "100% выполнения плана диспетчера" if score >= 80 else "План энергосистемы выполнен с замечаниями", "cls": "gold" if score >= 80 else "warn"},
                    {"lbl": "СТАБИЛЬНОСТЬ МОЩНОСТИ", "val": f"{nel:.0f} МВт", "sub": "Отклонения в пределах допуска" if score >= 80 else "Нестабильность мощности", "cls": "success" if score >= 80 else "warn"},
                    {"lbl": "БАРЬЕРЫ БЕЗОПАСНОСТИ", "val": "100% ЦЕЛОСТНОСТЬ", "sub": "Нулевая деградация ТВЭЛ", "cls": "success"},
                    {"lbl": "КВАЛИФИКАЦИЯ ОПЕРАТОРА", "val": f"{score:.0f} [{grade}]", "sub": "Присвоение высшей категории" if score >= 80 else ("Предупреждение" if score >= 50 else "Отстранение"), "cls": "gold" if score >= 80 else ("warn" if score >= 50 else "danger")}
                ],
                "resolution": resolution,
                "stamp": res_stamp,
                "restart_caption": restart_cap
            }

    def evaluate_shift_and_trigger_finale(self, forced_type: Optional[str] = None, manual: bool = False) -> None:
        if forced_type:
            ft = forced_type
        # 1. Сверхкритический ядерный взгон / детонация (INES 7)
        elif self.thermal_model.nuclear_detonation or self.thermal_model.explosion_type == "nuclear":
            ft = FinaleType.PROMPT_CRITICAL.value
        # 2. Плавление активной зоны (INES 5)
        elif self.thermal_model.core_damage_pct >= 35.0 or self.plant_state == PlantState.MELTDOWN:
            ft = FinaleType.CORE_MELTDOWN.value
        # 3. Безопасный регламентный холодный останов (INES 0)
        elif self.plant_state == PlantState.COLD_SHUTDOWN or (
            self.primary_state.t_hot_c < 105.0 and 
            self.primary_state.boron_ppm >= 1750.0 and 
            self.controls_state.rod_position_pct <= 5.0 and
            self.primary_state.pressure_mpa < 4.0
        ):
            ft = FinaleType.COLD_SHUTDOWN_SAFE.value
        # 4. Локализация аварийной ситуации (LOCA/SBO) (INES 2)
        elif (
            (self.mission_id in ["CRISIS_LOCA", "CRISIS_SBO"] or self.active_scenarios.get("loca_leak") or self.active_scenarios.get("station_blackout") or self.thermal_model.primary_rupture)
            and self.thermal_model.core_damage_pct < 20.0 
            and self.thermal_model.containment_pressure_kpa <= 260.0
        ):
            ft = FinaleType.CRISIS_CONTAINED.value
        # 5. Аварийный останов АЗ-5 или повреждение топлива без плавления (INES 1)
        elif self.safety.scrammed or self.thermal_model.core_damage_pct >= 5.0:
            if self.thermal_model.core_damage_pct >= 25.0:
                ft = FinaleType.CORE_MELTDOWN.value
            else:
                ft = FinaleType.UNPLANNED_SCRAM.value
        # 6. Штатное завершение смены на мощности
        else:
            ft = FinaleType.TRIUMPH_SHIFT.value

        self.finale_triggered = True
        self.finale_type = ft
        self.finale_data = self.build_finale_data(ft)
        is_crit = ("АВАРИЯ" in self.finale_data['badge_text'] or "КАТАСТРОФА" in self.finale_data['badge_text'])
        self.safety.add_alarm(f"ФИНАЛ: {self.finale_data['title']} ({self.finale_data['badge_text']})", AlarmLevel.CRITICAL if is_crit else AlarmLevel.INFO, self.sim_time_s)

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
        elif command == "toggle_bypass_safety":
            self.controls_state.safety_system_bypassed = not self.controls_state.safety_system_bypassed
            val = self.controls_state.safety_system_bypassed
            self.active_scenarios["bypass_safety"] = val
            if val:
                self.safety.add_alarm("ОПАСНОСТЬ: Автоматические защиты АЗ-5 заблокированы оператором!", AlarmLevel.CRITICAL, self.sim_time_s)
            else:
                self.safety.add_alarm("СУЗ: Автоматические защиты АЗ-5 введены в штатный режим", AlarmLevel.INFO, self.sim_time_s)
        elif command == "add_boron":
            # Ввод концентрированной борной кислоты (+50 ppm)
            self.primary_state.boron_ppm = min(3000.0, self.primary_state.boron_ppm + float(value or 50.0))
        elif command == "dilute_boron":
            # Разбавление дистиллятом (-50 ppm)
            self.primary_state.boron_ppm = max(0.0, self.primary_state.boron_ppm - float(value or 50.0))
        elif command == "set_bru_k":
            self.secondary_state.bru_k_pct = max(0.0, min(100.0, float(value)))
        elif command == "set_bru_a":
            val = max(0.0, min(100.0, float(value)))
            self.secondary_state.manual_bru_a_pct = val
            self.secondary_state.bru_a_pct = val
        elif command == "toggle_containment_spray":
            self.thermal_model.containment_spray_active = not self.thermal_model.containment_spray_active
            is_on = self.thermal_model.containment_spray_active
            self.safety.add_alarm("СПРИНКЛЕРНАЯ СИСТЕМА ГО: Спринклерные насосы ВКЛЮЧЕНЫ (подавление пара и дезактивация)" if is_on else "СПРИНКЛЕРНАЯ СИСТЕМА ГО: Насосы отключены", AlarmLevel.WARNING if is_on else AlarmLevel.INFO, self.sim_time_s)
        elif command == "toggle_emergency_boron":
            self.thermal_model.emergency_boron_active = not self.thermal_model.emergency_boron_active
            is_on = self.thermal_model.emergency_boron_active
            self.safety.add_alarm("СИСТЕМА БОРА: Аварийный впрыск бора высокого давления ВКЛЮЧЕН" if is_on else "СИСТЕМА БОРА: Насосы аварийного впрыска отключены", AlarmLevel.CRITICAL if is_on else AlarmLevel.INFO, self.sim_time_s)
        elif command == "set_mission":
            self.set_mission(str(value))
        elif command == "end_shift":
            self.evaluate_shift_and_trigger_finale(manual=True)

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

        elif scenario_id in ("prompt_critical", "nuclear_blast"):
            if activate:
                self.controls_state.auto_power_controller = False
                self.controls_state.rod_manual_speed_pct_s = 0.0
                self.controls_state.rod_position_pct = 100.0
                self.thermal_model.trigger_nuclear_explosion()
                self.plant_state = PlantState.EXPLOSION
                self.safety.add_alarm("КАТАСТРОФА: ЯДЕРНЫЙ ВЗРЫВ РЕАКТОРА! СВЕРХКРИТИЧНОСТЬ НА МГНОВЕННЫХ НЕЙТРОНАХ! СРЫВ КРЫШКИ!", AlarmLevel.CRITICAL, self.sim_time_s)

        elif scenario_id == "guillotine_loca":
            self.thermal_model.guillotine_loca = activate
            if activate:
                self.safety.add_alarm("КАТАСТРОФА: Мгновенный гильотинный разрыв петли ГЦТ Ду-850!", AlarmLevel.CRITICAL, self.sim_time_s)

        elif scenario_id == "station_blackout":
            if activate:
                self.primary_state.rcp_status = [False, False, False, False]
                self.secondary_state.feedwater_pumps_on = [False, False, False]
                self.secondary_state.turbine_trip_valve = False
                self.thermal_model.grid_disconnected = True
                self.safety.add_alarm("КАТАСТРОФА: Полное обесточивание энергоблока (SBO)! Потеря всех насосов!", AlarmLevel.CRITICAL, self.sim_time_s)

        elif scenario_id == "core_meltdown":
            if activate:
                self.thermal_model.loca_leak_rate_kg_s = 2200.0
                self.primary_state.saoz_accum_level_pct = 0.0
                self.primary_state.saoz_active = False
                self.primary_state.rcp_status = [False, False, False, False]
                self.primary_state.t_fuel_c = max(self.primary_state.t_fuel_c, 1450.0)
                self.safety.add_alarm("ТЯЖЕЛАЯ АВАРИЯ: Осушение активной зоны, начало плавления ТВЭЛ!", AlarmLevel.CRITICAL, self.sim_time_s)

        elif scenario_id == "bypass_safety":
            self.controls_state.safety_system_bypassed = activate
            if activate:
                self.safety.add_alarm("ВНИМАНИЕ: Автоматические защиты АЗ-5 заблокированы! Защиты отключены!", AlarmLevel.CRITICAL, self.sim_time_s)
            else:
                self.safety.add_alarm("СУЗ: Защиты АЗ-5 введены в автоматический режим", AlarmLevel.INFO, self.sim_time_s)

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

        # Всплеск реактивности при сценарии разгона на мгновенных нейтронах
        prompt_spike = 920.0 if self.active_scenarios.get("prompt_critical") else 0.0
        total_rho_pcm = rho_rod + rho_dop + rho_cool + rho_bor + rho_xe + prompt_spike

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
            controls=self.controls_state,
            thermal_model=self.thermal_model
        )

        self.sim_time_s += dt

        # 6. Прогресс смены, оценка нарушений регламента и финал
        self.shift_time_s += dt

        # Регистрация штрафных баллов за выход за пределы регламента
        if self.kinetics_state.relative_neutron_flux > 1.03:
            self.penalty_points += 0.25 * dt
        if 0 < self.kinetics_state.period < 20.0:
            self.penalty_points += 0.20 * dt
        if self.primary_state.subcooling_margin_c < 10.0:
            self.penalty_points += 0.35 * dt
        if self.thermal_model.core_damage_pct > 0:
            self.penalty_points += 1.2 * self.thermal_model.core_damage_pct * dt / 5.0
        if self.safety.scrammed and not self.scram_penalized and self.mission_id in ["BASE_LOAD", "MANEUVER"]:
            self.penalty_points += 25.0
            self.scram_penalized = True
            self.violations.append(f"Аварийный останов АЗ-5 ({self.sim_time_s:.1f} с)")
        if self.controls_state.safety_system_bypassed and not self.bypass_penalized:
            self.penalty_points += 30.0
            self.bypass_penalized = True
            self.violations.append(f"Несанкционированная блокировка защит АЗ-5 ({self.sim_time_s:.1f} с)")

        self.operator_score = max(0.0, min(100.0, 100.0 - self.penalty_points))
        if self.operator_score >= 90:
            self.operator_grade = "A+ (МАСТЕР)"
        elif self.operator_score >= 75:
            self.operator_grade = "B (ШТАТНЫЙ ОПЕРАТОР)"
        elif self.operator_score >= 50:
            self.operator_grade = "C (ПРЕДУПРЕЖДЕНИЕ)"
        elif self.operator_score >= 25:
            self.operator_grade = "D (СНЯТИЕ С ДЕЖУРСТВА)"
        else:
            self.operator_grade = "F (ТРИБУНАЛ)"

        # Автоматическая проверка наступления финала
        if not self.finale_triggered:
            m_info = MISSIONS.get(self.mission_id, MISSIONS["BASE_LOAD"])
            target_dur = m_info.get("target_duration_s", 120.0)

            if self.thermal_model.nuclear_detonation:
                self.evaluate_shift_and_trigger_finale(forced_type=FinaleType.PROMPT_CRITICAL.value)
            elif self.thermal_model.core_damage_pct >= 35.0:
                self.evaluate_shift_and_trigger_finale(forced_type=FinaleType.CORE_MELTDOWN.value)
            elif self.mission_id == "COLD_SHUTDOWN" and self.plant_state == PlantState.COLD_SHUTDOWN:
                self.evaluate_shift_and_trigger_finale(forced_type=FinaleType.COLD_SHUTDOWN_SAFE.value)
            elif self.mission_id != "SANDBOX" and self.shift_time_s >= target_dur:
                self.evaluate_shift_and_trigger_finale()

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

        m_info = MISSIONS.get(self.mission_id, MISSIONS["BASE_LOAD"])

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
            core_damage_pct=round(self.thermal_model.core_damage_pct, 1),
            containment_pressure_kpa=round(self.thermal_model.containment_pressure_kpa, 1),
            radiation_level_mr_h=round(self.thermal_model.radiation_level_mr_h, 1),
            hydrogen_pct=round(self.thermal_model.hydrogen_pct, 2),
            primary_rupture=self.thermal_model.primary_rupture,
            steam_pipe_ruptured=self.thermal_model.steam_pipe_ruptured,
            explosion_active=self.thermal_model.explosion_active,
            explosion_type=self.thermal_model.explosion_type,
            nuclear_detonation=self.thermal_model.nuclear_detonation,
            reactor_head_blown=self.thermal_model.reactor_head_blown,
            safety_system_bypassed=self.controls_state.safety_system_bypassed,
            containment_spray_active=self.thermal_model.containment_spray_active,
            emergency_boron_active=self.thermal_model.emergency_boron_active,
            mission_id=self.mission_id,
            mission_title=m_info["title"],
            shift_time_s=round(self.shift_time_s, 1),
            shift_target_duration_s=m_info["target_duration_s"],
            operator_score=round(self.operator_score, 1),
            operator_grade=self.operator_grade,
            violations_count=len(self.violations),
            total_energy_mwh=round(self.thermal_model.total_energy_mwh, 2),
            mission_objectives=self.get_mission_objectives_status(),
            finale_triggered=self.finale_triggered,
            finale_type=self.finale_type,
            finale_data=self.finale_data,
            alarms=alarm_dicts
        )

