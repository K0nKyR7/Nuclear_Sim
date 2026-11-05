import uvicorn

if __name__ == "__main__":
    print("=" * 70)
    print("  АСУ ТП И ТРЕНАЖЕР ЭНЕРГОБЛОКА ВВЭР-1000")
    print("  Сервер симуляции запускается на http://localhost:8000")
    print("=" * 70)
    uvicorn.run("backend.api.main:app", host="0.0.0.0", port=8000, reload=False)
