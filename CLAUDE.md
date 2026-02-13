# ClaudeManager - AI Asistan Hafıza ve Yönlendirme Sistemi

## Bu Proje Neden Var?

Claude Code her session'da sıfırdan başlıyor. KURALLAR.md ve memory dosyaları var ama bunlar statik metin - gerçek deneyim yok. Sorunlar:

1. **Hafıza yok** - Kullanıcı daha önce "bunu böyle yap" demiş, Claude hatırlamıyor, aynı hatayı tekrar yapıyor
2. **Bilmediğini sallıyor** - Emin olmadığı yerde tahminle kod yazıyor, bug üretiyor
3. **Aynı hataları tekrarlıyor** - KnockoutJS wrapper pattern, filtre tekil/çoğul sorunu, Edit tool unique match sorunu gibi şeyler her seferinde öğretiliyor
4. **Context kaybı** - Geçmiş session'larda ne yapıldı, hangi kararlar alındı, nerede kalındı bilgisi yok
5. **Kullanıcı kızgınlığı algılanmıyor** - Kullanıcı "yanlış yaptın" dediğinde önceki aksiyonda ne hata yapıldığı analiz edilmiyor

**Çözüm:** Her etkileşimi logla, pattern'leri öğren, geçmişe bakabilme imkanı sun. İki katmanlı entegrasyon:
- **Hook'lar (pasif)** - Otomatik loglama, Claude'u bloklamadan
- **MCP Server (aktif)** - Claude'un kendisi sorgulayabilir: "bu proje için kurallar ne?", "daha önce bunu nasıl yapmıştım?"

## Ana Proje: SecretCustomer

Bu araç öncelikle `SecretCustomer` projesi için oluşturuldu:
- **Repo:** `C:\Users\Ahmet\source\repos\monanoyan-ship-it\ScretCustomer`
- **Stack:** ASP.NET Core 9.0 + EF Core + PostgreSQL + KnockoutJS
- **Özellikler:** Gizli müşteri değerlendirme sistemi, raporlama, bildirimler, PDF export
- SecretCustomer projesi büyük ve kuralları çok - KURALLAR.md 30+ bölüm, MEMORY.md 200+ satır
- Bu kuralların hepsini her session okumak yetmiyor, geçmiş deneyim de lazım

## Mimari

```
Claude Code Session
    │
    ├── Hook'lar (otomatik tetiklenir)
    │   ├── SessionStart → API'ye POST → Proje context'i döner
    │   ├── UserPromptSubmit → API'ye POST → Prompt loglanır + analiz
    │   ├── PostToolUse → API'ye POST → Tool kullanımı loglanır
    │   └── SessionEnd → API'ye POST → Session kapatılır
    │
    └── MCP Tools (Claude aktif olarak çağırır)
        ├── log_prompt → Manuel loglama
        ├── get_patterns → Öğrenilen pattern'ler
        ├── add_pattern → Yeni pattern/kural/hata kaydet
        ├── check_rules → Aksiyon kural kontrolü
        ├── get_history → Geçmiş arama
        ├── search_logs → Full-text arama
        └── get_context → Zengin proje context'i
            │
            ▼
    ClaudeManager API (Express, port 3847)
            │
            ▼
    SQLite DB (data/claude_manager.db)
        ├── projects - Proje bilgileri
        ├── sessions - Session logları
        ├── prompts - Tüm prompt'lar (FTS5 index'li)
        ├── tool_uses - Tool çağrıları
        └── patterns - Öğrenilen kurallar/pattern'ler/hatalar
```

## Teknoloji Seçimleri

- **sql.js** (pure-JS SQLite) - `better-sqlite3` Windows'ta native derleme sorunu çıkardı (VS 18 Insiders uyumsuzluğu), sql.js sıfır native dependency
- **Express** - Hook'lar HTTP POST yapıyor, basit ve güvenilir
- **MCP SDK** (`@modelcontextprotocol/sdk`) - Claude Code'un native MCP desteği, stdio transport
- **Node.js** - Hook script'leri de Node.js, tek runtime

## Dosya Yapısı ve Sorumluluklar

```
ClaudeManager/
├── src/
│   ├── index.js              # Express API entry point (port 3847)
│   │                           GET /health, GET /api/stats, /api/hooks/*
│   │
│   ├── mcp-server.js         # MCP Server (stdio transport)
│   │                           7 tool tanımı, zod schema validation
│   │                           Bağımsız process olarak çalışır
│   │
│   ├── hook-handler.js       # Express router - 4 POST endpoint
│   │                           /api/hooks/prompt - UserPromptSubmit
│   │                           /api/hooks/tool-use - PostToolUse
│   │                           /api/hooks/session-start - SessionStart
│   │                           /api/hooks/session-end - SessionEnd
│   │
│   ├── db/
│   │   ├── schema.sql        # 5 tablo + FTS5 + index tanımları
│   │   └── init.js           # sql.js DB bağlantısı, auto-save (5sn)
│   │                           DB dosyası: data/claude_manager.db
│   │
│   ├── services/
│   │   ├── log-service.js    # Proje/session/prompt/tool CRUD
│   │   │                       ensureProject, logPrompt, logToolUse, endSession
│   │   │
│   │   ├── pattern-service.js # Pattern CRUD + FTS arama
│   │   │                       addPattern (duplicate check), getPatterns, searchPatterns
│   │   │                       Pattern tipleri: rule, pattern, preference, mistake
│   │   │
│   │   ├── context-service.js # Zengin context oluşturma
│   │   │                       getProjectContext - stats + patterns + history
│   │   │                       analyzePrompt - frustration + ilgili pattern'ler
│   │   │                       checkRules - aksiyon→kural eşleştirme
│   │   │                       formatContextForClaude - additionalContext string
│   │   │
│   │   └── search-service.js  # Full-text + tarih bazlı arama
│   │                           FTS5 öncelikli, LIKE fallback
│   │                           getFrequentTopics - tag analizi
│   │
│   └── utils/
│       └── analyzer.js       # Prompt analiz araçları
│                               categorizePrompt - feature_request/bug_fix/question/...
│                               extractTags - dosya adı, tech term, PascalCase çıkarma
│                               detectFrustration - kızgınlık skoru (0-1)
│
├── hooks/                    # Claude Code hook script'leri
│   ├── on-prompt.js          # stdin JSON → HTTP POST → stdout JSON
│   ├── on-tool-use.js        # Aynı pattern, async olabilir
│   ├── on-session-start.js   # Context döndürür (additionalContext)
│   └── on-session-end.js     # Session'ı kapatır
│   │
│   └── Hepsi aynı pattern: readStdin() → postJSON(API_URL) → stdout.write()
│       Timeout koruması var, API'ye ulaşamazsa sessizce {} döner
│       Claude'u ASLA bloklamamak kritik
│
├── data/                     # SQLite DB dosyası burada oluşur (gitignore'd)
├── setup-hooks.json          # ~/.claude/settings.json'a kopyalanacak hook config
├── Dockerfile                # node:20-slim based
├── docker-compose.yml        # Port 3847, volume for DB
└── SETUP.md                  # Kurulum adımları
```

## Hook Formatı (Claude Code Spesifikasyonu)

Hook'lar stdin'den JSON alır, stdout'a JSON yazar.

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
    "additionalContext": "Claude'un göreceği ek bilgi"
  }
}
```

- `continue: true` → Claude devam eder
- `additionalContext` → Claude'un system context'ine eklenir
- Hata durumunda `{}` döndür, ASLA Claude'u bloklama

## Kurulum (Henüz Yapılmadı!)

Proje kodu hazır ve test edildi ama kurulum adımları henüz uygulanmadı:

### 1. API Başlat
```bash
cd C:\Users\Ahmet\source\repos\monanoyan-ship-it\ClaudeManager
npm start
# veya: docker-compose up -d
```

### 2. MCP Server Kaydet
```bash
claude mcp add --transport stdio claude-manager -- node C:/Users/Ahmet/source/repos/monanoyan-ship-it/ClaudeManager/src/mcp-server.js
```

### 3. Hook'ları Ekle
`setup-hooks.json` içeriğini `~/.claude/settings.json` dosyasına kopyala.

### 4. Doğrula
```bash
curl http://127.0.0.1:3847/health
# {"status":"ok","service":"claude-manager","version":"1.0.0"}
```

## Mevcut Durum

- [x] Proje altyapısı (package.json, Docker, gitignore)
- [x] SQLite veritabanı (5 tablo + FTS5 + indexler)
- [x] Servis katmanı (log, pattern, context, search, analyzer)
- [x] Hook Handler (4 endpoint, test edildi)
- [x] MCP Server (7 tool, SDK doğrulandı)
- [x] Hook script'leri (4 adet, Node.js, Windows uyumlu)
- [x] Git repo + GitHub push
- [ ] **API'nin başlatılması** (npm start veya docker-compose up)
- [ ] **MCP server kaydı** (claude mcp add)
- [ ] **Hook konfigürasyonu** (~/.claude/settings.json)
- [ ] **End-to-end test** (gerçek Claude Code session'ında)

## Gelecek Planları (v2)

- Web UI (logları görüntüleme, pattern yönetimi)
- Claude API ile otomatik pattern çıkarma (prompt analizi)
- Proje arası pattern paylaşımı
- Dashboard (hangi projede ne kadar çalışıldı, hata oranları)
- Bildirim sistemi (önemli pattern tespit edildiğinde)

## Geliştirme Notları

- `npm start` → Express API (port 3847)
- `npm run mcp` → MCP Server (stdio, test için)
- `npm run dev` → Express API with --watch
- DB dosyası: `data/claude_manager.db` (gitignore'd, auto-save 5sn)
- Test: `node -e "require('./src/db/init').getDb().then(() => console.log('OK'))"` ile DB testi
