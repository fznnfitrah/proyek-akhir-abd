"""Server prediksi kualitas udara.
Memuat model .pkl, mengambil cuaca dari Open-Meteo, lalu menyajikan hasilnya ke website.

Jalankan di folder server/:
    uvicorn app:app --reload
Buka http://127.0.0.1:8000
"""
import os
import time
from pathlib import Path

import joblib
import pandas as pd
import requests
from dotenv import load_dotenv
from fastapi import FastAPI, HTTPException
from fastapi.staticfiles import StaticFiles
from sklearn.base import is_classifier

BASE = Path(__file__).parent
FRONTEND = BASE.parent / "prediksi-udara"   # hanya berisi index.html, style.css, script.js
load_dotenv(BASE / ".env")
OPENMETEO_KEY = os.getenv("OPENMETEO_KEY")   # kosong = pakai versi gratis (non-komersial)

# ===================== PENGATURAN =====================
MODEL_FILES = {                       # id daerah -> file model di folder server/
    "jakarta": "models/model_pm25_jakarta.pkl",
    "depok":   "models/model_pm25_depok.pkl",
    "malang":  "models/model_pm25_malang.pkl",
}
DAERAH = {                            # id daerah -> (lintang, bujur)
    "jakarta": (-6.2, 106.85),
    "depok":   (-6.4, 106.82),
    "malang":  (-7.98, 112.63),
}
# Dipakai hanya jika model tidak menyimpan nama kolom (feature_names_in_). Urutan = urutan training.
FITUR_CADANGAN = ["temperature_2m", "relative_humidity_2m", "precipitation", "wind_speed_10m", "surface_pressure"]
# Jika nama kolom di model berbeda dengan nama variabel Open-Meteo, mis. {"suhu": "temperature_2m"}
ALIAS = {
    "temperature": "temperature_2m",
    "humidity": "relative_humidity_2m",
    "wind_speed": "wind_speed_10m",
    "wind_direction": "wind_direction_10m",
}
# Model regresi (nilai PM2.5): batas kelas dalam µg/m³ (samakan dengan CONFIG.AMBANG di script.js)
AMBANG = {"sedang": 35.5, "berat": 75}
# Model klasifikasi: label keluaran model -> "ringan" / "sedang" / "berat", mis. {0: "ringan", 1: "sedang", 2: "berat"}
KELAS_MAP = {}
CACHE_DETIK = 600                     # hasil disimpan 10 menit agar tidak boros panggilan API
# Kolom model yang BUKAN variabel Open-Meteo, jadi dihitung sendiri di server
TURUNAN_WAKTU = {"hour", "dayofweek", "month"}   # diambil dari waktu data cuaca (zona Asia/Jakarta)
KOLOM_LAG = "pm2_5_lag1"                          # PM2.5 satu jam sebelumnya: diambil dari OpenAQ
OPENAQ_KEY = os.getenv("OPENAQ_KEY")              # kunci API OpenAQ (gratis), isi di file .env
SENSOR_PM25 = {                                   # id SENSOR PM2.5 di OpenAQ; samakan dengan stasiun data training
    "jakarta": 5047,
    "depok":   5047,
    "malang":  14739443,
}
MAKS_UMUR_LAG_JAM = 3                             # tolak jika pembacaan terbaru sensor lebih tua dari ini

# ---- SEMENTARA (untuk presentasi): isi pm2_5_lag1 dengan rata-rata tetap ----
MODE_LAG = "rata2"        # "rata2" = nilai tetap di bawah; "openaq" = ambil dari sensor OpenAQ
LAG_RATA2 = {             # GANTI dengan rata-rata kolom pm2_5 pada data latih tiap daerah
    "jakarta": 68.99,
    "depok":   31.3,
    "malang":  22.78,
}
# ======================================================

hilang = [f for f in MODEL_FILES.values() if not (BASE / f).exists()]
if hilang:
    raise RuntimeError("File model tidak ditemukan di folder server/: " + ", ".join(hilang))
MODELS = {k: joblib.load(BASE / v) for k, v in MODEL_FILES.items()}   # joblib juga bisa membaca pickle biasa
_cache = {}


def ambil_cuaca(lat, lon, variabel):
    host = "https://customer-api.open-meteo.com" if OPENMETEO_KEY else "https://api.open-meteo.com"
    params = {"latitude": lat, "longitude": lon, "current": ",".join(variabel), "timezone": "Asia/Jakarta"}
    if OPENMETEO_KEY:
        params["apikey"] = OPENMETEO_KEY
    r = requests.get(f"{host}/v1/forecast", params=params, timeout=15)
    r.raise_for_status()
    return r.json()["current"]


def ambil_lag(daerah, cuaca):
    """PM2.5 terbaru dari sensor OpenAQ untuk daerah ini (µg/m³), dipakai sebagai pm2_5_lag1.
    Mengembalikan (nilai, info). Memakai pembacaan 'latest' sensor, bukan rata-rata jam sebelumnya."""
    if MODE_LAG == "rata2":
        nilai = LAG_RATA2.get(daerah)
        if nilai is None:
            raise HTTPException(501, f"MODE_LAG = 'rata2' tetapi LAG_RATA2['{daerah}'] belum diisi di app.py")
        return float(nilai), {"sumber": "rata-rata data latih (sementara)", "sementara": True}
    sid = SENSOR_PM25.get(daerah)
    if not OPENAQ_KEY or not sid:
        raise HTTPException(501, f"Fitur '{KOLOM_LAG}' belum disambungkan: isi OPENAQ_KEY di .env dan SENSOR_PM25['{daerah}'] di app.py")
    try:
        r = requests.get(f"https://api.openaq.org/v3/sensors/{sid}", headers={"X-API-Key": OPENAQ_KEY}, timeout=15)
        r.raise_for_status()
        hasil = r.json()["results"]
        item = hasil[0] if isinstance(hasil, list) else hasil
        latest = item["latest"]
        nilai = float(latest["value"])
        waktu = pd.Timestamp(latest["datetime"]["utc"])
    except (requests.RequestException, KeyError, IndexError, TypeError, ValueError) as e:
        raise HTTPException(502, f"OpenAQ gagal untuk sensor {sid}: {e}")
    umur = (pd.Timestamp.now(tz="UTC") - waktu).total_seconds() / 3600
    if umur > MAKS_UMUR_LAG_JAM:
        raise HTTPException(503, f"Pembacaan PM2.5 terbaru sensor {sid} sudah {umur:.1f} jam lalu (batas {MAKS_UMUR_LAG_JAM} jam)")
    return nilai, {"sensor": sid, "waktu_utc": waktu.isoformat(), "umur_jam": round(umur, 1)}


app = FastAPI(title="Prediksi kualitas udara")


@app.get("/api/prediksi/{daerah}")
def prediksi(daerah: str):
    if daerah not in MODELS:
        raise HTTPException(404, "Daerah tidak dikenal")
    hit = _cache.get(daerah)
    if hit and time.time() - hit[0] < CACHE_DETIK:
        return hit[1]

    model = MODELS[daerah]
    names = getattr(model, "feature_names_in_", None)
    kolom = list(names) if names is not None else FITUR_CADANGAN      # urutan fitur otomatis dari model
    # hanya kolom cuaca yang diminta ke Open-Meteo; kolom waktu dan lag dihitung di bawah
    var_om = [ALIAS.get(k, k) for k in kolom if k not in TURUNAN_WAKTU and k != KOLOM_LAG]
    tampil = ["temperature_2m", "relative_humidity_2m", "wind_speed_10m", "precipitation"]
    lat, lon = DAERAH[daerah]
    try:
        cuaca = ambil_cuaca(lat, lon, list(dict.fromkeys(var_om + tampil)))
    except requests.RequestException as e:
        raise HTTPException(502, f"Open-Meteo gagal: {e}")

    waktu = pd.Timestamp(cuaca["time"])
    baris, lag_info = {}, None
    for k in kolom:
        if k == "hour":
            baris[k] = waktu.hour
        elif k == "dayofweek":
            baris[k] = waktu.dayofweek            # Senin = 0 (sama seperti pandas)
        elif k == "month":
            baris[k] = waktu.month
        elif k == KOLOM_LAG:
            baris[k], lag_info = ambil_lag(daerah, cuaca)
        else:
            baris[k] = cuaca[ALIAS.get(k, k)]
    X = pd.DataFrame([baris], columns=kolom)
    y = model.predict(X)[0]
    if is_classifier(model):
        label = KELAS_MAP.get(y, str(y).lower())
        if label not in ("ringan", "sedang", "berat"):
            raise HTTPException(500, f"Label model '{y}' belum dipetakan: isi KELAS_MAP di app.py")
        hasil = {"nilai": None, "kelas": label, "cuaca": cuaca, "lag": lag_info}
    else:
        nilai = float(y)
        kelas = "ringan" if nilai < AMBANG["sedang"] else "sedang" if nilai < AMBANG["berat"] else "berat"
        hasil = {"nilai": nilai, "kelas": kelas, "cuaca": cuaca, "lag": lag_info}
    _cache[daerah] = (time.time(), hasil)
    return hasil


# Website (harus terakhir). Hanya folder prediksi-udara yang dibuka ke publik, bukan folder server.
app.mount("/", StaticFiles(directory=FRONTEND, html=True), name="web")
