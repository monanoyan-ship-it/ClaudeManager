# ClaudeManager Kurulum

## 1. API Sunucusunu Başlat

```bash
cd C:\Users\Ahmet\source\repos\monanoyan-ship-it\ClaudeManager
npm start
```

Veya Docker ile:
```bash
docker-compose up -d
```

API http://127.0.0.1:3847 adresinde çalışacak.

## 2. MCP Server Kaydet

```bash
claude mcp add --transport stdio claude-manager -- node C:/Users/Ahmet/source/repos/monanoyan-ship-it/ClaudeManager/src/mcp-server.js
```

## 3. Hook'ları Konfigüre Et

`setup-hooks.json` dosyasının içeriğini `~/.claude/settings.json` dosyasına kopyala:

```bash
# settings.json yoksa oluştur
copy setup-hooks.json %USERPROFILE%\.claude\settings.json
```

Veya mevcut settings.json'a "hooks" anahtarını ekle.

## 4. Doğrulama

1. API çalışıyor mu?
   ```bash
   curl http://127.0.0.1:3847/health
   ```

2. Claude Code'u aç → SessionStart hook tetiklenmeli
3. Bir mesaj yaz → UserPromptSubmit hook loglamalı
4. MCP tool test:
   - Claude'a "get_context SecretCustomer" de

## Notlar

- API'nin Claude Code'dan ÖNCE başlatılması gerekir
- Hook'lar API'ye ulaşamazsa sessizce başarısız olur (Claude'u bloklamaz)
- DB dosyası: `data/claude_manager.db`
