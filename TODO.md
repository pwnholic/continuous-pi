# pi-web-access Rewrite — Master Plan

> Rewrite dengan webclaw sebagai extraction engine utama.
> Target: kode lebih bersih, performa lebih cepat, token lebih hemat.

---

## ✅ Fase 1: Foundation & Webclaw Integration

- [x] Buat `package.json` (pi manifest + deps latest)
- [x] Buat `biome.json` (linter + formatter)
- [x] Buat `tsconfig.json`
- [x] Buat `src/config.ts` (Zod schema untuk ~/.pi/web-search.json)
- [x] Buat `src/types.ts` (shared types)
- [x] Buat `src/extractors/webclaw.ts` (integrasi CLI webclaw)
- [x] Buat `src/index.ts` (entry point minimal)
- [x] Install dependencies
- [x] Biome + TypeScript clean ✅

## ✅ Fase 2: Providers & Tools

- [x] Foundation Services: `storage/`, `activity/`, `auth/`, `utils/`
- [x] Providers: `registry`, `perplexity`, `exa`, `gemini-api`, `gemini-web`, `gemini-search`
- [x] Tools: `web-search`, `fetch-content`, `code-search`, `get-content`
- [x] `summary-review.ts` — LLM summary generation
- [x] `extractors/youtube.ts` — YouTube frame extraction
- [x] `extractors/video.ts` — Local video analysis
- [x] `index.ts` — Semua 4 tools + shortcuts + events terdaftar

## ✅ Fase 3: Curator UI Rewrite

- [x] Setup `curator-ui/` dengan Vite + React + TypeScript
- [x] `src/hooks/useCurator.ts` — SSE hook + API calls
- [x] `src/components/SearchResultCard.tsx` — Result card
- [x] `src/App.tsx` — Full curator UI (add query, select, sumarize, submit)
- [x] Build: 207KB JS (gzip 65KB)
- [x] `src/curator/server.ts` — HTTP server serving React build + API endpoints

## ✅ Fase 4: Polish & Documentation

- [x] `scripts` in package.json: `typecheck`, `lint`, `format`, `build:curator`, `build`
- [x] `README.md` — Complete documentation with installation, config, architecture
- [x] Biome clean (16 warnings, 0 errors)
- [x] TypeScript strict mode clean

---

## 🏗️ Struktur Final (28 file, 6.424 baris)

```
pi-web-access/
├── package.json, biome.json, tsconfig.json
├── README.md, TODO.md
│
├── src/                         # 23 files, 5.958 baris
│   ├── index.ts                 # Entry point
│   ├── config.ts, types.ts, utils.ts
│   ├── extractors/ (webclaw, youtube, video)
│   ├── providers/ (6 providers)
│   ├── tools/ (4 tools)
│   ├── curator/server.ts        # HTTP server (React SPA)
│   ├── summary-review.ts
│   ├── storage/, activity/, auth/
│
├── curator-ui/                  # 5 files, 466 baris (React + Vite)
│   ├── src/
│   │   ├── App.tsx
│   │   ├── main.tsx
│   │   ├── types.ts
│   │   ├── hooks/useCurator.ts
│   │   └── components/SearchResultCard.tsx
│   └── dist/                    # Build output
│       ├── index.html           # 0.39 KB
│       └── assets/              # 207 KB (gzip 65 KB)
│
└── skills/librarian/
```

## 📈 Savings vs Old Codebase

| Metrik | Old | New | Hemat |
|--------|-----|-----|-------|
| Total files | ~22 | 28 (termasuk React) | +6 |
| src lines | ~85.000 | **5.958** | **-93%** |
| Curator page | 3.359 (inline) | **466** (React) | **-86%** |
| Config | Manual parse | Zod schema | ~ |
| Extraction | Readability 83.5% | **webclaw 95.1%** | +12% |
| CSS/JS curator | Inline | Vite build | ~ |
| Linting | ❌ | Biome | ✅ |
| TypeScript | Non-strict | **Strict mode** | ✅ |
