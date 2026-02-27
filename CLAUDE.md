# ClaudeManager

AI Asistan Hafiza ve Yonlendirme Sistemi. Claude Code session'larini loglar, pattern'leri ogrenir, projelere rehberlik eder.

## API

- Base: `http://127.0.0.1:41847`
- Health: `curl -s http://127.0.0.1:41847/health`
- Dashboard: `http://127.0.0.1:41847/`
- Bu projenin ID'si: **13**

## Bilgi Kaynaklari

Tum detayli dokumantasyon ClaudeManager'in kendi notlarinda tutuluyor. Session basinda hook'lar pattern ve kurallari otomatik enjekte eder.

Detayli bilgi icin:
```bash
# Proje rehberi (API kullanimi, kurallar, yol haritasi)
curl -s "http://127.0.0.1:41847/api/guide?cwd=$(pwd)"

# Proje notlari (mimari, dosya yapisi, endpoint referansi, kurulum, korunan ozellikler)
curl -s http://127.0.0.1:41847/api/projects/13/notes

# Pattern'ler (kurallar, hatalar, tercihler)
curl -s http://127.0.0.1:41847/api/projects/13/patterns

# Gunluk (teknik kararlar, degisiklik loglari)
curl -s http://127.0.0.1:41847/api/projects/13/journal
```

## Temel Kurallar

- Pattern tipleri: sadece `rule`, `mistake`, `preference`
- Hook'lar ASLA Claude'u bloklamaz — hata durumunda `{}` dondur
- Korunan ozellikleri bozmadan gelistir (notlarda "Korunan Benzersiz Ozellikler" basligi)
