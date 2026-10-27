# Security & privacy

- **Your media never leaves your device.** Photos, videos, edits, presets and LUTs are stored in the browser's IndexedDB on the device you use. There is no server, account, analytics or tracking.
- **Network use** is limited to: loading the app itself, Google Fonts, and — only when you use AI masks — the AI runtime (cdn.jsdelivr.net) and model files (huggingface.co). Images are analysed locally; they are never uploaded.
- **Content Security Policy** restricts scripts to this site and the pinned AI runtime, blocks plugins/framing, and sends no referrer.
- **Backups**: Home → *Your data* → *Back up library* creates a .zip with your originals and edits. Keep it somewhere safe (it contains your photos). *Restore backup* brings everything back on any device.
- **This repository** contains only source code — no personal media or data. Commits use a GitHub no-reply address.
- Report problems via a private GitHub security advisory on this repository.
