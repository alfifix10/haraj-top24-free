# Haraj Top 24h (Free Plan)

- Scraper runs on GitHub Actions every 15 minutes using Puppeteer.
- Results are saved to `data/top24.json` and rendered by `public/index.html`.

## Usage

1. Create a new GitHub repo and push this folder content to it.
2. Enable GitHub Actions (default).
3. (Optional) Run once manually: Actions > Scrape Haraj Top24 > Run workflow.
4. Open `public/index.html` via GitHub Pages (serve the repo root; URL ends with `/public/`).

## Local test

- Node 20+ recommended.
- Install deps: `npm i`
- Run: `npm run scrape`
- Open `public/index.html` in a browser (it reads `data/top24.json`).

## Notes

- This is periodic updates (not a 24/7 always-on server) but fully free.
- If Haraj DOM changes, update selectors in `scripts/scrape.js`.
