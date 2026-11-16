import requests

API_KEY = "c65ae6f3d642074247bcd32d4becd5b756446b538b1c2031ef397f0c800614d7"
headers = {"X-API-Key": API_KEY}

# Koordinat kota
kota = {
    "jakarta": (-6.2, 106.85),
    "depok": (-6.4, 106.82),
    "malang": (-7.98, 112.63)
}

for nama, (lat, lon) in kota.items():
    print(f"\n=============================================")
    print(f"🔍 Mencari sensor PM2.5 di {nama.capitalize()}...")
    
    # 1. Cari lokasi dalam radius 25km
    url_loc = f"https://api.openaq.org/v3/locations?coordinates={lat},{lon}&radius=25000&limit=10"
    try:
        r = requests.get(url_loc, headers=headers, timeout=15)
        if r.status_code != 200:
            print(f"❌ Gagal akses API: {r.status_code} - {r.text}")
            continue
            
        results = r.json().get("results", [])
        if not results:
            print("❌ Tidak ada stasiun ditemukan di sekitar area ini.")
            continue
            
        # 2. Cek setiap lokasi, cari sensor PM2.5
        found_sensor = False
        for loc in results:
            loc_id = loc["id"]
            loc_name = loc.get("name", "Tanpa Nama")
            
            # Ambil daftar sensor di lokasi ini
            url_sensor = f"https://api.openaq.org/v3/locations/{loc_id}/sensors"
            r_sensor = requests.get(url_sensor, headers=headers, timeout=15)
            
            if r_sensor.status_code == 200:
                sensors = r_sensor.json().get("results", [])
                for s in sensors:
                    if s.get("parameter", {}).get("name") == "pm25":
                        sensor_id = s["id"]
                        print(f"✅ Ditemukan! Stasiun: '{loc_name}'")
                        print(f"   -> ID Sensor PM2.5: {sensor_id}")
                        
                        # 3. Uji apakah sensor ini punya data terbaru
                        url_data = f"https://api.openaq.org/v3/sensors/{sensor_id}/measurements?limit=1"
                        r_data = requests.get(url_data, headers=headers, timeout=15)
                        if r_data.status_code == 200:
                            data = r_data.json().get("results", [])
                            if data:
                                val = data[0]['value']
                                waktu = data[0]['period']['datetimeFrom']['utc']
                                print(f"   -> 📊 Data terakhir: {val} µg/m³ (Waktu: {waktu})")
                            else:
                                print("   -> ⚠️ Sensor ada, TAPI tidak ada data terbaru (mati/lambat).")
                        else:
                            print("   -> ⚠️ Gagal mengambil data pengukuran.")
                        
                        found_sensor = True
                        break # Hentikan pencarian sensor jika sudah ketemu satu
            if found_sensor:
                break # Lanjut ke kota berikutnya
                
        if not found_sensor:
            print("❌ Stasiun ditemukan, tapi tidak ada yang punya sensor PM2.5.")
            
    except Exception as e:
        print(f"❌ Terjadi error: {e}")