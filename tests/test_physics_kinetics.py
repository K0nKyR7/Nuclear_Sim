import pytest
from backend.physics.kinetics import KineticsModel
from backend.physics.reactivity import ReactivityModel


def test_kinetics_steady_state():
    """Проверка стабильности точечной кинетики при нулевой реактивности."""
    model = KineticsModel()
    initial_n = model.n

    # Интегрируем 100 шагов по 0.05 сек (5 секунд) без введения реактивности
    for _ in range(100):
        total_p, decay_p, period = model.step(total_reactivity_pcm=0.0, dt=0.05)

    assert abs(model.n - initial_n) < 1e-4, f"Мощность дрейфует: {model.n} != {initial_n}"
    assert period > 900.0 or period < -900.0


def test_positive_reactivity_insertion():
    """Проверка роста мощности при положительной реактивности."""
    model = KineticsModel()
    initial_n = model.n

    # Вводим +50 pcm
    for _ in range(40):  # 2 секунды
        model.step(total_reactivity_pcm=50.0, dt=0.05)

    assert model.n > initial_n, "Мощность должна расти при положительной реактивности"
    assert model.period > 0.0, "Период реактора должен быть положительным при разгоне"


def test_scram_reactivity_drop():
    """Проверка аварийного падения мощности при вводе отрицательной реактивности АЗ."""
    model = KineticsModel()
    # Вводим глубокую подкритичность АЗ-5 (-8000 pcm)
    for _ in range(100):  # 5 секунд
        total_p, decay_p, period = model.step(total_reactivity_pcm=-8000.0, dt=0.05)

    # Мощность мгновенных нейтронов должна резко упасть к долям процента
    assert model.n < 0.05, f"Нейтронная мощность не упала: {model.n}"
    # Но остаточное энерговыделение (decay heat) должно сохраняться на уровне 5-6%
    assert decay_p > 0.03, f"Остаточное энерговыделение должно присутствовать: {decay_p}"


def test_reactivity_feedbacks():
    """Проверка отрицательных обратных связей (саморегулирование)."""
    react = ReactivityModel()

    # Повышение температуры топлива должно давать отрицательную реактивность (Доплер)
    dop, cool, bor, xe = react.calculate_feedbacks(t_fuel=780.0, t_coolant_avg=305.0, boron_ppm=500.0, xenon_rel=1.0)
    assert dop < 0.0, f"Доплеровский коэффициент должен быть отрицательным: {dop}"

    # Повышение температуры теплоносителя должно давать отрицательную реактивность
    dop2, cool2, bor2, xe2 = react.calculate_feedbacks(t_fuel=680.0, t_coolant_avg=315.0, boron_ppm=500.0, xenon_rel=1.0)
    assert cool2 < 0.0, f"Коэффициент теплоносителя должен быть отрицательным: {cool2}"
