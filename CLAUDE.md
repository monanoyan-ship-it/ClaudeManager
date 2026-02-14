# ClaudeManager - AI Asistan Hafiza ve Yonlendirme Sistemi

## Bu Proje Neden Var?

Claude Code her session'da sifirdan basliyor. KURALLAR.md ve memory dosyalari var ama bunlar statik metin - gercek deneyim yok. Sorunlar:

1. **Hafiza yok** - Kullanici daha once "bunu boyle yap" demis, Claude hatirlamiyor, ayni hatayi tekrar yapiyor
2. **Bilmedigini salliyor** - Emin olmadigi yerde tahminle kod yaziyor, bug uretiyor
3. **Ayni hatalari tekrarliyor** - KnockoutJS wrapper pattern, filtre tekil/cogul sorunu, Edit tool unique match sorunu gibi seyler her seferinde ogretiliyor
4. **Context kaybi** - Gecmis session'larda ne yapildi, hangi kararlar alindi, nerede kalindi bilgisi yok
5. **Kullanici kizginligi algilanmiyor** - Kullanici "yanlis yaptin" dediginde onceki aksiyonda ne hata yapildigi analiz edilmiyor

**Cozum:** Her etkilesimi logla, pattern'leri ogren, gecmise bakabilme imkani sun. Iki katmanli entegrasyon:
- **Hook'lar (pasif)** - Otomatik loglama, Claude'u bloklamadan
- **MCP Server (aktif)** - Claude'un kendisi sorgulayabilir: "bu proje icin kurallar ne?", "daha once bunu nasil yapmistim?"

## Amac

ClaudeManager **proje-agnostik** bir sistemdir. Tum projelerde Claude Code kullanirken merkezi bir rehber ve hafiza gorevi gorur. Hangi projeden hangi prompt geldi, hangi hatalar yapildi, hangi pattern'ler ogrenildi — hepsini proje bazli ama tek bir merkezden takip eder.

- Her proje `cwd` (calisma dizini) uzerinden otomatik tespit edilir ve ayri ayri loglanir
- Pattern'ler ve kurallar proje bazli tutulur, projeler arasi da paylasilabilir
- Ilk ve en buyuk kullanim alani `SecretCustomer` projesi olsa da, sistem herhangi bir projeyle calisacak sekilde tasarlandi

## Mimari

```
Claude Code Session
    |
    |-- Hook'lar (otomatik tetiklenir)
    |   |-- SessionStart -> API'ye POST -> Proje context'i doner
    |   |-- UserPromptSubmit -> API'ye POST -> Prompt loglanir + analiz
    |   |-- PostToolUse -> API'ye POST -> Tool kullanimi loglanir
    |   +-- SessionEnd -> API'ye POST -> Session kapatilir
    |
    +-- MCP Tools (Claude aktif olarak cagirir)
        |-- log_prompt -> Manuel loglama
        |-- get_patterns -> Ogrenilen pattern'ler (progressive disclosure)
        |-- add_pattern -> Yeni pattern/kural/hata kaydet
        |-- check_rules -> Aksiyon kural kontrolu
        |-- get_history -> Gecmis arama (progressive disclosure)
        |-- search_logs -> Full-text arama (progressive disclosure)
        +-- get_context -> Zengin proje context'i
            |
            v
    ClaudeManager API (Express, port 41847)
        |-- REST API (/api/projects, /api/patterns, /api/search)
        +-- Web Dashboard (http://127.0.0.1:41847/)
            |
            v
    SQLite DB (data/claude_manager.db)
        |-- projects - Proje bilgileri
        |-- sessions - Session loglari
        |-- prompts - Tum prompt'lar (FTS5 index'li)
        |-- tool_uses - Tool cagrilari
        |-- patterns - Ogrenilen kurallar/pattern'ler/hatalar
        |-- phases - Yol haritasi fazlari
        +-- tasks - Faz altindaki gorevler
```

## Teknoloji Secimleri

- **sql.js** (pure-JS SQLite) - `better-sqlite3` Windows'ta native derleme sorunu cikardi (VS 18 Insiders uyumsuzlugu), sql.js sifir native dependency
- **Express** - Hook'lar HTTP POST yapiyor, basit ve guvenilir
- **MCP SDK** (`@modelcontextprotocol/sdk`) - Claude Code'un native MCP destegi, stdio transport
- **Node.js** - Hook script'leri de Node.js, tek runtime
- **Chart.js** - Dashboard analitik grafikleri (CDN)
- **Vanilla JS** - Dashboard icin framework gereksiz, sade ve hizli

## Dosya Yapisi ve Sorumluluklar

```
ClaudeManager/
|-- src/
|   |-- index.js              # Express API entry point (port 41847)
|   |                           GET /health, static serve, API routes
|   |
|   |-- mcp-server.js         # MCP Server (stdio transport)
|   |                           7 tool tanimi, progressive disclosure
|   |
|   |-- hook-handler.js       # Express router - 4 POST endpoint
|   |                           /api/hooks/prompt, tool-use, session-start, session-end
|   |
|   |-- routes/
|   |   +-- api-routes.js     # REST API - CRUD endpoints
|   |                           /api/projects, /api/patterns, /api/search
|   |                           Sayfalama, filtreleme, analitik, yol haritasi
|   |
|   |-- middleware/
|   |   +-- error-handler.js  # Global Express error handler
|   |
|   |-- db/
|   |   |-- schema.sql        # 7 tablo + FTS5 + index tanimlari
|   |   +-- init.js           # sql.js DB baglantisi, auto-save (5sn)
|   |
|   |-- services/
|   |   |-- log-service.js    # Proje/session/prompt/tool CRUD + sayfalama
|   |   |-- pattern-service.js # Pattern CRUD + FTS arama + update
|   |   |-- context-service.js # Zengin context olusturma
|   |   |-- search-service.js  # Full-text + tarih bazli arama
|   |   |-- analytics-service.js # Analitik sorgulari (frustration, tool, kategori)
|   |   +-- plan-service.js    # Yol haritasi CRUD + XML import
|   |
|   +-- utils/
|       |-- analyzer.js       # Prompt analiz araclari
|       +-- path-normalizer.js # Path normalizasyonu (duplicate onleme)
|
|-- hooks/                    # Claude Code hook script'leri
|   |-- on-prompt.js          # stdin JSON -> HTTP POST -> stdout JSON
|   |-- on-tool-use.js
|   |-- on-session-start.js
|   +-- on-session-end.js
|
|-- public/                   # Web Dashboard
|   |-- index.html            # Tek sayfa dashboard (Turkce)
|   |-- styles.css            # Dark/light mode, responsive
|   +-- app.js                # Vanilla JS + fetch API + Chart.js
|
|-- data/                     # SQLite DB dosyasi (gitignore'd)
|-- setup-hooks.json          # Hook konfigurasyonu
|-- Dockerfile                # node:20-slim + HEALTHCHECK
+-- docker-compose.yml        # Port 41847, volume for DB
```

## REST API Endpoint'leri

| Method | Endpoint | Aciklama |
|--------|----------|----------|
| GET | /api/projects | Tum projeler + istatistik |
| GET | /api/projects/:id | Proje detayi |
| GET | /api/projects/:id/sessions | Session listesi (sayfalama) |
| GET | /api/projects/:id/prompts | Prompt listesi (sayfalama, filtre) |
| GET | /api/projects/:id/patterns | Pattern listesi |
| GET | /api/projects/:id/tool-uses | Tool kullanim listesi |
| GET | /api/projects/:id/analytics | Analitik veriler (grafik icin) |
| POST | /api/patterns | Yeni pattern olustur |
| PUT | /api/patterns/:id | Pattern guncelle |
| DELETE | /api/patterns/:id | Pattern deaktif et |
| GET | /api/search?q=... | Full-text arama |
| GET | /api/projects/:id/roadmap | Tam yol haritasi (fazlar + gorevler) |
| GET | /api/projects/:id/roadmap/stats | Yol haritasi istatistikleri |
| POST | /api/projects/:id/phases | Yeni faz olustur |
| PUT | /api/phases/:id | Faz guncelle |
| DELETE | /api/phases/:id | Faz sil (gorevleri ile birlikte) |
| POST | /api/phases/:id/tasks | Yeni gorev olustur |
| PUT | /api/tasks/:id | Gorev guncelle |
| DELETE | /api/tasks/:id | Gorev sil |
| POST | /api/projects/:id/roadmap/import | XML'den yol haritasi import |

Sayfalama: `?page=1&limit=20`, response: `{ data: [...], total, page, limit }`

## Web Dashboard

Dashboard: `http://127.0.0.1:41847/`

**Ozellikler:**
- Proje kartlari ile ana sayfa (session/prompt/pattern sayilari)
- Proje detay sayfasi (tabli gorunum):
  - Genel Bakis: kurallar, hatalar, tercihler, son aktivite
  - Session'lar: tarih, sure, prompt sayisi
  - Prompt'lar: tablo + filtreler (kategori, arama). Frustration skoru renk koduyla
  - Pattern'ler: tip bazli gruplama + CRUD (ekle/duzenle/sil modal)
  - Yol Haritasi: faz/gorev yonetimi, ilerleme cubugu, XML import, durum dongusu
  - Tool Kullanimi: tool adi, dosya, basari durumu
  - Analitik: 4 grafik (frustration trend, tool dagilimi, kategori, aktivite)
- Global arama
- Dark/light mode (sistem tercihine gore + toggle)
- Responsive tasarim

## Yol Haritasi (Plan/Roadmap) Sistemi

ClaudeManager projelerin yol haritalarini Faz > Gorev hiyerarsisi ile takip eder. Claude Code session basinda guide endpoint'inden mevcut faz ve acik gorevleri gorur, nerede kaldigini bilir.

**Veri yapisi:** `phases` (fazlar) ve `tasks` (gorevler) tablolari. Her faz bir projeye, her gorev bir faza bagli.

**Durum degerleri:**
- `planned` — Planli (varsayilan)
- `in_progress` — Devam ediyor
- `completed` — Tamamlandi
- `cancelled` — Iptal (sadece gorevlerde)

**Ornek API kullanimi:**
```bash
# Yol haritasini oku
curl -s http://127.0.0.1:41847/api/projects/PROJE_ID/roadmap

# Yeni faz olustur
curl -X POST http://127.0.0.1:41847/api/projects/PROJE_ID/phases \
  -H "Content-Type: application/json" \
  -d '{"phase_no":"1","title":"Temel Altyapi"}'

# Faza gorev ekle
curl -X POST http://127.0.0.1:41847/api/phases/FAZ_ID/tasks \
  -H "Content-Type: application/json" \
  -d '{"task_no":"1.1","title":"Solution yapisini olustur","detail":"...","risks":"..."}'

# Gorev durumunu guncelle
curl -X PUT http://127.0.0.1:41847/api/tasks/GOREV_ID \
  -H "Content-Type: application/json" \
  -d '{"status":"completed"}'

# XML'den import (callcenter yol_haritasi.xml formati)
curl -X POST http://127.0.0.1:41847/api/projects/PROJE_ID/roadmap/import \
  -H "Content-Type: application/json" \
  -d '{"xml":"<Faz no=\"1\" ad=\"...\">...</Faz>"}'
```

**XML import formati:**
```xml
<Faz no="1" ad="Temel Altyapi" durum="tamamlandi">
  <Gorev no="1.1" durum="tamamlandi">
    <Ad>Solution yapisini olustur</Ad>
    <Detay>- detay satirlari</Detay>
    <Riskler>- risk satirlari</Riskler>
  </Gorev>
</Faz>
```

**Guide entegrasyonu:** `/api/guide?cwd=...` endpoint'i yol haritasi varsa otomatik olarak mevcut faz, ilerleme yuzdesi ve acik gorevleri gosterir.

**Dashboard:** Proje detay sayfasinda "Yol Haritasi" tab'i ile gorev yonetimi, durum degistirme, faz/gorev ekleme ve XML import yapilabilir.

## Hook Formati (Claude Code Spesifikasyonu)

Hook'lar stdin'den JSON alir, stdout'a JSON yazar.

**Stdin (ortak alanlar):**
```json
{
  "session_id": "uuid",
  "cwd": "C:/Users/Ahmet/source/repos/...",
  "hook_event_name": "UserPromptSubmit|PostToolUse|SessionStart|SessionEnd"
}
```

**Stdout format:**
```json
{
  "continue": true,
  "hookSpecificOutput": {
    "hookEventName": "EventName",
    "additionalContext": "Claude'un gorecegi ek bilgi"
  }
}
```

- `continue: true` -> Claude devam eder
- `additionalContext` -> Claude'un system context'ine eklenir
- Hata durumunda `{}` dondur, ASLA Claude'u bloklama

## Kurulum

### 1. API Baslat
```bash
cd C:\Users\Ahmet\source\repos\monanoyan-ship-it\ClaudeManager
npm start
# veya: docker-compose up -d
```

### 2. MCP Server Kaydet
```bash
claude mcp add --transport stdio claude-manager -- node C:/Users/Ahmet/source/repos/monanoyan-ship-it/ClaudeManager/src/mcp-server.js
```

### 3. Hook'lari Ekle
`setup-hooks.json` icerigini `~/.claude/settings.json` dosyasina kopyala.

### 4. Dogrula
```bash
curl http://127.0.0.1:41847/health
# {"status":"ok","service":"claude-manager","version":"2.0.0"}

# Dashboard
# http://127.0.0.1:41847/
```

## Mevcut Durum

- [x] Proje altyapisi (package.json, Docker, gitignore)
- [x] SQLite veritabani (7 tablo + FTS5 + indexler)
- [x] Servis katmani (log, pattern, context, search, analyzer, analytics, plan)
- [x] Hook Handler (4 endpoint)
- [x] MCP Server (7 tool, progressive disclosure)
- [x] Hook script'leri (4 adet, Node.js, Windows uyumlu)
- [x] REST API (21 endpoint, sayfalama, filtreleme, yol haritasi)
- [x] Web Dashboard (Turkce, dark/light mode, Chart.js, yol haritasi)
- [x] Yol Haritasi sistemi (Faz > Gorev, XML import, guide entegrasyonu)
- [x] Path normalizasyonu (duplicate proje onleme)
- [x] Error handler middleware
- [x] Git repo + GitHub push
- [ ] **API'nin baslatilmasi** (npm start veya docker-compose up)
- [ ] **MCP server kaydi** (claude mcp add)
- [ ] **Hook konfigurasyonu** (~/.claude/settings.json)
- [ ] **End-to-end test** (gercek Claude Code session'inda)

## Gelecek Planlari (v3)

- Claude API ile otomatik pattern cikarma (prompt analizi)
- Proje arasi pattern paylasimi
- Bildirim sistemi (onemli pattern tespit edildiginde)
- Session replay (gecmis session'lari adim adim goruntuleme)

## Gelistirme Notlari

- `npm start` -> Express API (port 41847) + Dashboard
- `npm run mcp` -> MCP Server (stdio, test icin)
- `npm run dev` -> Express API with --watch
- DB dosyasi: `data/claude_manager.db` (gitignore'd, auto-save 5sn)
- Test: `node -e "require('./src/db/init').getDb().then(() => console.log('OK'))"` ile DB testi

## Korunan Benzersiz Ozellikler

1. **Frustration detection** (`analyzer.js:detectFrustration`) - Dashboard'da gorsellestirilir
2. **Rule compliance** (`check_rules` MCP tool) - Aksiyon->kural eslestirme
3. **Mistake pattern tipi** - Dashboard'da kirmizi ile vurgulanir
4. **User preference tipi** - Dashboard'da yesil ile gosterilir
5. **Proje bazli ogrenme** - Tum sorgular project_id filtreli
6. **Dual entegrasyon** (hook + MCP) - Hook'lar non-blocking kalir
7. **Yol Haritasi** (`plan-service.js`) - Faz/Gorev hiyerarsisi, XML import, guide'da otomatik gosterim
