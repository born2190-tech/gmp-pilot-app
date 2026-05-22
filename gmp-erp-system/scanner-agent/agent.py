"""B21 Scanner Agent — локальный мост между браузером и сканером Windows.

Запускается на рабочей станции (АРМ) оператора. Поднимает локальный
HTTP-сервер на 127.0.0.1:8765. Веб-приложение B21 опрашивает его и, если
агент доступен, показывает кнопку «Сканировать». По нажатию агент через
WIA (Windows Image Acquisition) открывает родное окно сканирования
Windows, получает изображение и возвращает его в браузер (JPEG, base64).

Браузер затем загружает результат на сервер B21 — на тот же endpoint,
что и обычная загрузка файла, поэтому серверная часть не меняется.

Зависимости: fastapi, uvicorn, pywin32, pillow
Запуск:       python agent.py
Сборка .exe:  pyinstaller --onefile --name b21-scanner-agent agent.py
"""
from __future__ import annotations

import base64
import io
import sys
import tempfile
from pathlib import Path

import uvicorn
from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel

AGENT_VERSION = "0.1.0"
AGENT_PORT = 8765

# WIA format GUID для JPEG.
WIA_FORMAT_JPEG = "{B96B3CAE-0728-11D3-9D7B-0000F81EF32E}"
# WIA device type: 1 = Scanner.
WIA_DEVICE_TYPE_SCANNER = 1

app = FastAPI(title="B21 Scanner Agent", version=AGENT_VERSION)

# Браузер обращается с http://127.0.0.1:5173 (dev) или с домена прод-сервера.
# 127.0.0.1 считается «безопасным» origin, поэтому достаточно разрешить всё
# локальное. Для прод-домена добавьте его в список ниже.
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)


class ScanResult(BaseModel):
    filename: str
    mime_type: str
    data_base64: str
    size: int


class ScannerInfo(BaseModel):
    id: str
    name: str


def _wia_scan_to_jpeg_bytes(show_ui: bool = True) -> bytes:
    """Сканирует одну страницу через WIA, возвращает JPEG-байты.

    show_ui=True открывает родное окно сканирования Windows (выбор сканера,
    разрешение, цветность). Это и есть «окно сканирования» для оператора.
    """
    import pythoncom
    import win32com.client

    pythoncom.CoInitialize()
    try:
        wia = win32com.client.Dispatch("WIA.CommonDialog")
        # ShowAcquireImage(DeviceType, Intent, Bias, FormatID, AlwaysSelectDevice,
        #                  UseCommonUI, CancelError)
        image = wia.ShowAcquireImage(
            WIA_DEVICE_TYPE_SCANNER,
            0,            # Intent: unspecified
            0,            # Bias: unspecified
            WIA_FORMAT_JPEG,
            False,        # AlwaysSelectDevice — не навязывать выбор каждый раз
            show_ui,      # UseCommonUI — показать стандартный диалог
            False,        # CancelError — вернуть None при отмене вместо исключения
        )
        if image is None:
            raise HTTPException(status_code=499, detail="Сканирование отменено оператором")

        tmp = Path(tempfile.gettempdir()) / "b21_scan.jpg"
        if tmp.exists():
            tmp.unlink()
        image.SaveFile(str(tmp))
        data = tmp.read_bytes()
        try:
            tmp.unlink()
        except OSError:
            pass
        return data
    finally:
        pythoncom.CoUninitialize()


def _wia_scan_pages_to_pdf_bytes() -> bytes:
    """Многостраничное сканирование в один PDF.

    Окно сканирования Windows показывается на каждую страницу. Оператор
    сканирует страницу за страницей; когда страниц больше нет — нажимает
    «Отмена» в окне сканера, и собранные страницы объединяются в один PDF.
    Требуется хотя бы одна страница.
    """
    import pythoncom
    import win32com.client
    from PIL import Image

    pythoncom.CoInitialize()
    pages: list[bytes] = []
    try:
        wia = win32com.client.Dispatch("WIA.CommonDialog")
        while True:
            image = wia.ShowAcquireImage(
                WIA_DEVICE_TYPE_SCANNER,
                0,
                0,
                WIA_FORMAT_JPEG,
                False,
                True,   # показать стандартное окно сканирования
                False,  # отмена → None (не исключение)
            )
            if image is None:
                # Оператор закрыл окно — завершаем набор страниц.
                break
            tmp = Path(tempfile.gettempdir()) / "b21_scan_page.jpg"
            if tmp.exists():
                tmp.unlink()
            image.SaveFile(str(tmp))
            pages.append(tmp.read_bytes())
            try:
                tmp.unlink()
            except OSError:
                pass

        if not pages:
            raise HTTPException(status_code=499, detail="Сканирование отменено — нет ни одной страницы")

        imgs = [Image.open(io.BytesIO(p)).convert("RGB") for p in pages]
        buf = io.BytesIO()
        imgs[0].save(buf, format="PDF", save_all=True, append_images=imgs[1:], resolution=200.0)
        return buf.getvalue()
    finally:
        pythoncom.CoUninitialize()


def _list_wia_scanners() -> list[ScannerInfo]:
    import pythoncom
    import win32com.client

    pythoncom.CoInitialize()
    try:
        manager = win32com.client.Dispatch("WIA.DeviceManager")
        result: list[ScannerInfo] = []
        for info in manager.DeviceInfos:
            try:
                if int(info.Type) != WIA_DEVICE_TYPE_SCANNER:
                    continue
            except Exception:
                pass
            name = info.DeviceID
            try:
                # Property "Name" если доступно.
                for prop in info.Properties:
                    if prop.Name == "Name":
                        name = str(prop.Value)
                        break
            except Exception:
                pass
            result.append(ScannerInfo(id=str(info.DeviceID), name=name))
        return result
    finally:
        pythoncom.CoUninitialize()


@app.get("/status")
def status() -> dict:
    return {"agent": "b21-scanner-agent", "version": AGENT_VERSION, "platform": sys.platform}


@app.get("/scanners")
def scanners() -> dict:
    try:
        items = _list_wia_scanners()
    except Exception as exc:  # pragma: no cover — зависит от окружения
        raise HTTPException(status_code=500, detail=f"WIA error: {exc}") from exc
    return {"scanners": [s.model_dump() for s in items]}


@app.post("/scan", response_model=ScanResult)
def scan() -> ScanResult:
    """Сканирует одну страницу и возвращает JPEG (base64)."""
    try:
        raw = _wia_scan_to_jpeg_bytes(show_ui=True)
    except HTTPException:
        raise
    except Exception as exc:  # pragma: no cover
        raise HTTPException(status_code=500, detail=f"Ошибка сканирования: {exc}") from exc

    # При желании можно ужать/перекодировать через Pillow для единообразия.
    try:
        from PIL import Image

        img = Image.open(io.BytesIO(raw)).convert("RGB")
        buf = io.BytesIO()
        img.save(buf, format="JPEG", quality=85)
        raw = buf.getvalue()
    except Exception:
        # Если Pillow недоступен — отдаём как есть.
        pass

    return ScanResult(
        filename="scan.jpg",
        mime_type="image/jpeg",
        data_base64=base64.b64encode(raw).decode("ascii"),
        size=len(raw),
    )


@app.post("/scan-pdf", response_model=ScanResult)
def scan_pdf() -> ScanResult:
    """Сканирует одну или несколько страниц и возвращает единый PDF (base64).

    Окно сканера появляется на каждую страницу; «Отмена» завершает набор.
    """
    try:
        raw = _wia_scan_pages_to_pdf_bytes()
    except HTTPException:
        raise
    except Exception as exc:  # pragma: no cover
        raise HTTPException(status_code=500, detail=f"Ошибка сканирования: {exc}") from exc

    return ScanResult(
        filename="scan.pdf",
        mime_type="application/pdf",
        data_base64=base64.b64encode(raw).decode("ascii"),
        size=len(raw),
    )


if __name__ == "__main__":
    print(f"B21 Scanner Agent v{AGENT_VERSION} → http://127.0.0.1:{AGENT_PORT}")
    uvicorn.run(app, host="127.0.0.1", port=AGENT_PORT, log_level="info")
