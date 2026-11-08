# Music Export Stats

Spotify dinleme istatistikleri — **hibrit**:

| Katman | Ne işe yarar | Nasıl |
|--------|--------------|--------|
| **Privacy export** | Ömür boyu süre, sanatçı/şarkı/albüm, ilk dinleme | Zip/JSON yükle |
| **Hesap bağlama (canlı)** | Güncel top listeler + son çalınanlar | Spotify OAuth PKCE |

Veriler tarayıcıda işlenir. OAuth token’lar `localStorage`’da tutulur; **client secret kullanılmaz** (PKCE public client).  
Client ID UI’da sorulmaz — site sahibi bir kez `js/config.js` içine yazar.

## Hızlı çalıştırma

Node gerekmez:

```bash
cd music-export-stats
python -m http.server 8765
```

Aç: http://127.0.0.1:8765/

> `file://` ile açma — OAuth redirect ve ES modules için HTTP gerekir.

## Spotify kurulumu (bir kez, site sahibi)

1. [Spotify Developer Dashboard](https://developer.spotify.com/dashboard) → **Create app**
2. App settings → **Redirect URIs** ekle (birebir aynı olmalı):
   - Yerel: `http://127.0.0.1:8765/`
   - veya `http://localhost:8765/`
   - GitHub Pages: `https://<user>.github.io/<repo>/`
3. **Client ID**’yi kopyala (Client Secret’a gerek yok)
4. `js/config.js` dosyasında:

```js
export const SPOTIFY_CLIENT_ID = "buraya_client_id";
```

5. Siteyi HTTP(S) üzerinden aç → **Spotify ile bağlan** → Spotify login/authorize → geri dönünce otomatik sync

Kullanıcı tarafında Client ID formu yok; tek tık yeter.

### Scope’lar

- `user-read-recently-played`
- `user-top-read`
- `user-read-email` / `user-read-private` (profil)

### API gerçeği

Spotify Web API **Extended Streaming History** (`ms_played` ömür boyu) vermez.  
Canlı katman = güncel özet. Derin grafik için export şart.

## Export dosyaları

- **Spotify:** `my_spotify_data.zip` veya `Streaming_History_Audio_*.json`  
  (account privacy → Extended streaming history)

## Ne nereden gelir?

```
┌─────────────────┐     ┌──────────────────────┐
│ Spotify OAuth   │────▶│ Top + recently played │  (canlı)
└─────────────────┘     └──────────────────────┘
┌─────────────────┐     ┌──────────────────────┐
│ Export upload   │────▶│ Dakika, albüm, ilk   │  (tarihsel)
│ Spotify         │     │ dinleme              │
└─────────────────┘     └──────────────────────┘
```

Dashboard’da önce canlı Spotify paneli, sonra export (tarihsel) görünür.

## GitHub Pages

1. Repoyu push et  
2. Settings → Pages → branch `main` / root  
3. Redirect URI’ye Pages URL’sini ekle  
4. `js/config.js` içine Client ID yaz  
5. Siteyi HTTPS üzerinden aç → Bağlan  

## Gizlilik

- Export dosyaları sunucuya yüklenmez
- Token’lar yalnızca tarayıcı `localStorage`
- Client ID kaynak kodda (public client; secret yok)
- CDN: JSZip + Chart.js

## Marka ikonu (UI)

Spotify bölümünde **inline SVG mark** kullanılır. Resmi logo dosyası veya harici PNG indirmeye gerek yok.

## Lisans

MIT
