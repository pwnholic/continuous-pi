# pi-web-access

> Web search, URL/content extraction, and web analysis for [Pi Coding Agent](https://pi.ai) — powered by **webclaw**.

---

## ✨ Features

| Feature | Description |
|---------|-------------|
| 🔍 **`web_search`** | Multi-provider search (Exa, Perplexity, Gemini) with curator UI |
| 📄 **`fetch_content`** | URL fetching & extraction (webclaw → Readability fallback) |
| 💻 **`code_search`** | Code & API documentation search via Exa |
| 📦 **`get_search_content`** | Retrieve stored results from previous searches |
| 🎬 **YouTube** | Frame extraction via yt-dlp + ffmpeg |
| 🎥 **Local Video** | Analysis via ffmpeg + Gemini Files API |
| 🖥️ **Curator UI** | Browser-based search result curator (React + Vite) |
| 🧩 **Activity Widget** | Real-time activity monitoring |

---

## 🚀 Installation

### Prerequisites

- **webclaw** – Primary extraction engine ([install guide](https://github.com/0xMassi/webclaw))
  ```bash
  brew install webclaw        # macOS
  cargo install webclaw-cli   # Any platform
  ```
- **ffmpeg + yt-dlp** – For video frame extraction
  ```bash
  brew install ffmpeg yt-dlp  # macOS
  ```

### From npm

```bash
npm install pi-web-access
```

### Or as a Pi extension

Add to your `package.json`:

```json
{
    "pi": {
        "extensions": ["./node_modules/pi-web-access/src/index.ts"]
    }
}
```

---

## 🔧 Configuration

Edit `~/.pi/web-search.json`:

```json
{
    "provider": "auto",
    "perplexityApiKey": "pplx-...",
    "exaApiKey": "exa-...",
    "geminiApiKey": "AI...",
    "webclaw": {
        "browser": "chrome",
        "fallbackToReadability": true
    },
    "shortcuts": {
        "curate": "ctrl+shift+s",
        "activity": "ctrl+shift+w"
    }
}
```

---

## 🛠️ Tools

### `web_search`
Multi-angle web research with AI-synthesized answers.

```typescript
web_search queries={["React 19 features", "React Server Components"]}
```

Parameters: `query`, `queries`, `numResults`, `includeContent`, `recencyFilter`, `domainFilter`, `provider`

### `fetch_content`
Extract readable content from URLs. Supports web pages, GitHub repos, YouTube, and local videos.

```typescript
fetch_content url="https://example.com"
fetch_content urls={["url1", "url2"]} prompt="What is this about?"
```

Parameters: `url`, `urls`, `forceClone`, `prompt`, `timestamp`, `frames`, `model`

### `code_search`
Search for code examples and API references.

```typescript
code_search query="Next.js App Router middleware"
```

Parameters: `query`, `maxTokens`

### `get_search_content`
Retrieve stored results from a previous search or fetch.

```typescript
get_search_content responseId="abc123"
```

Parameters: `responseId`, `query`, `queryIndex`, `url`, `urlIndex`

---

## 🧩 Architecture

```
src/
├── index.ts              # Entry: registers 4 tools + events
├── config.ts             # Zod schema for ~/.pi/web-search.json
├── types.ts              # Shared type definitions
├── utils.ts              # Utility functions
│
├── extractors/
│   ├── webclaw.ts        # ⭐ Webclaw CLI integration
│   ├── youtube.ts        # YouTube frame extraction
│   └── video.ts          # Local video analysis
│
├── providers/
│   ├── registry.ts       # Provider resolution
│   ├── perplexity.ts     # Perplexity AI search
│   ├── exa.ts            # Exa search (API + MCP)
│   ├── gemini-api.ts     # Gemini API
│   ├── gemini-web.ts     # Gemini Web (browser cookies)
│   └── gemini-search.ts  # Router/aggregator
│
├── tools/
│   ├── web-search.ts     # web_search tool handler
│   ├── fetch-content.ts  # fetch_content tool handler
│   ├── code-search.ts    # code_search tool handler
│   └── get-content.ts    # get_search_content tool handler
│
├── summary-review.ts     # LLM summary generation
├── curator/
│   └── server.ts         # Curator HTTP server
├── storage/index.ts      # Session storage
├── activity/monitor.ts   # Activity monitor
└── auth/
    └── chrome-cookies.ts # Chrome cookie extraction
```

---

## 🧪 Development

```bash
# Install dependencies
npm install

# Build curator UI
npm run build:curator

# Type-check
npm run typecheck

# Lint & format
npm run lint
npm run format

# Full build
npm run build
```

---

## 📋 License

MIT
