import fs from 'fs/promises';
import path from 'path';
import puppeteer from 'puppeteer';
import dayjs from 'dayjs';

const ROOT = path.resolve(process.cwd());
const DATA_DIR = path.join(ROOT, 'data');
const STORE_PATH = path.join(DATA_DIR, 'store.json');
const TOP24_PATH = path.join(DATA_DIR, 'top24.json');

const ensureDir = async (p) => { await fs.mkdir(p, { recursive: true }); };
const loadJson = async (p, fallback) => { try { const s = await fs.readFile(p, 'utf8'); return JSON.parse(s); } catch { return fallback; } };
const saveJson = async (p, obj) => { await fs.writeFile(p, JSON.stringify(obj, null, 2), 'utf8'); };

const isArabic = (s='') => /[\u0600-\u06FF]/.test(s);
const toAsciiDigits = (s='') => s
  .replace(/[٠-٩]/g, d => '٠١٢٣٤٥٦٧٨٩'.indexOf(d))
  .replace(/[۰-۹]/g, d => '۰۱۲۳۴۵۶۷۸۹'.indexOf(d));

const nowIso = () => new Date().toISOString();

async function extractAds(page) {
  return await page.evaluate(() => {
    const origin = location.origin.replace(/\/$/, '');
    const adRegexes = [ /^\/?\d{6,}(?:\/?|$)/i, /^\/?\d{6,}\/[^\/?#]+/i, /\/(?:ads?|posts?)\/(\d{6,})(?:[\/-]|$)/i ];
    const toAsciiDigits = (s='') => s
      .replace(/[٠-٩]/g, d => '٠١٢٣٤٥٦٧٨٩'.indexOf(d))
      .replace(/[۰-۹]/g, d => '۰۱۲۳۴۵۶۷۸۹'.indexOf(d));
    const isArabic = (s='') => /[\u0600-\u06FF]/.test(s);
    const truncate = (s, n=400) => { s = String(s||''); return s.length>n ? (s.slice(0,n-1)+'…') : s; };
    const getAdId = (href) => { try { const m = String(href||'').match(/\/(\d{6,})(?:[\/-]|$)/); return m? m[1] : ''; } catch { return ''; } };
    const isAdLink = (href='') => {
      try {
        const u = href.startsWith('http') ? new URL(href) : new URL(href, origin);
        const path = (u.pathname||'').trim();
        if (/\b(add|create|new)\b/i.test(path)) return false;
        const host = (u.hostname||'').replace(/^www\./,'');
        if (host && host !== 'haraj.com.sa') return false;
        const hasId = /\d{6,}/.test(path) || /\d{6,}/.test(u.href);
        if (!hasId) return false;
        return [ /^\/?\d{6,}(?:\/?|$)/i, /^\/?\d{6,}\/[^\/?#]+/i, /\/(?:ads?|posts?)\/(\d{6,})(?:[\/-]|$)/i ].some(rx => rx.test(path) || rx.test(u.href));
      } catch { return false; }
    };
    const pickTextFromNode = (root) => {
      const badTags = new Set(['svg','img','i','use','path','button','script','style']);
      const nodes = [root, ...root.querySelectorAll('*')];
      let best = '';
      for (const el of nodes) {
        if (!(el instanceof Element)) continue;
        if (badTags.has(el.tagName.toLowerCase())) continue;
        const t = (el.textContent||'').trim();
        if (t && !/^[.•·|]+$/.test(t) && t.length > best.length) best = t;
      }
      return best.trim();
    };

    const allAs = [...document.querySelectorAll('a[href]')];
    const anchors = allAs.filter(a => isAdLink(a.getAttribute('href')||''));
    const titleSpansFallback = !anchors.length ? [...document.querySelectorAll('span.overflow-hidden.text-ellipsis, span[class*="text-ellipsis"]')] : [];
    const cards = new Set();
    if (anchors.length) {
      for (const a of anchors) { const card = a.closest('article, li, div, section'); if (card) cards.add(card); }
    } else {
      for (const s of titleSpansFallback) { const card = s.closest('article, li, div, section'); if (card) cards.add(card); }
    }

    const results = [];
    for (const card of cards) {
      let linkEl = null;
      {
        const as = card.querySelectorAll('a[href]');
        for (const a of as) { if (isAdLink(a.getAttribute('href')||'')) { linkEl = a; break; } }
        if (!linkEl) {
          const tSpan = card.querySelector('span.overflow-hidden.text-ellipsis, span[class*="text-ellipsis"]');
          const a2 = tSpan ? (tSpan.closest('a') || tSpan.parentElement?.querySelector('a[href]')) : null;
          if (a2 && isAdLink(a2.getAttribute('href')||'')) linkEl = a2;
        }
      }
      const link = linkEl?.href || '';

      let desc = '';
      let titleEl = null;
      if (linkEl) titleEl = linkEl.querySelector('a[data-testid="post-title-link"] span.overflow-hidden.text-ellipsis, span.overflow-hidden.text-ellipsis, span[class*="text-ellipsis"]') || linkEl;
      if (!titleEl) titleEl = card.querySelector('a[data-testid="post-title-link"] span.overflow-hidden.text-ellipsis, span.overflow-hidden.text-ellipsis, span[class*="text-ellipsis"]');
      if (titleEl) desc = (titleEl.textContent||'').trim();
      if (!desc) desc = pickTextFromNode(card);

      let city = '';
      const cityA = card.querySelector('a[href^="/city/"]');
      if (cityA) city = pickTextFromNode(cityA);
      if (!city) {
        const spanCandidates = card.querySelectorAll('span.overflow-hidden.overflow-ellipsis.whitespace-nowrap, span[class*="overflow-ellipsis"]');
        const isTime = (s) => /الآن|قبل\s+\d+\s*(دقيقة|دقائق|ساعة|ساعات|يوم|أيام)/.test(s);
        for (const sp of spanCandidates) {
          const t = (sp.textContent||'').trim();
          if (!t || isTime(t)) continue;
          if (t.length >= 2 && t.length <= 20) { city = t; break; }
        }
      }

      let time = '';
      const timeElSpecific = card.querySelector('span.max-w-\\[90\\%\\].overflow-hidden.overflow-ellipsis.whitespace-nowrap[dir="rtl"]');
      if (timeElSpecific) {
        time = (timeElSpecific.textContent||'').trim();
      } else {
        const candidates = card.querySelectorAll('[dir="rtl"], span, div');
        const rx = /^(الآن|قبل\s+\d+\s*(دقيقة|دقائق|ساعة|ساعات|يوم|أيام))/;
        outer: for (const el of candidates) {
          const lines = (el.textContent||'').split('\n').map(s=>s.trim()).filter(Boolean);
          const hit = lines.find(s => rx.test(s));
          if (hit) { time = hit; break outer; }
        }
      }

      let replies = 0;
      let repliesSpan = (titleEl?.closest('article, li, div, section') || card)
        .querySelector('svg[data-icon="comments-alt"] + span, svg.fa-comments-alt + span');
      if (!repliesSpan) {
        const commentsSvg = (titleEl?.closest('article, li, div, section') || card)
          .querySelector('svg[data-icon="comments-alt"], svg.fa-comments-alt');
        if (commentsSvg?.nextElementSibling?.tagName === 'SPAN') repliesSpan = commentsSvg.nextElementSibling;
      }
      if (repliesSpan) {
        const val = toAsciiDigits((repliesSpan.textContent||'').trim());
        if (/^\d{1,3}$/.test(val)) replies = Math.max(0, Math.min(200, parseInt(val, 10)));
      }

      const badDesc = /^(إضافة\s+عرض|أضف\s+إعلان|Add\s+Ad)$/i.test(desc);
      const valid = !!(link && isAdLink(link) && desc && desc.length > 2 && isArabic(desc) && !badDesc);
      if (valid) {
        results.push({ id: getAdId(link) || '', desc: (truncate(desc||'')).trim(), city: (city||'غير محدد').trim(), time: (time||'غير محدد').trim(), replies, link });
      }
    }
    return results;
  });
}

async function autoScrollAndCollect(page, maxPasses = 8, sleepMs = 1000) {
  let all = [];
  for (let i = 0; i < maxPasses; i++) {
    const before = all.length;
    const batch = await extractAds(page);
    const byKey = new Map(all.map(a => [a.id || a.link || a.desc, a]));
    for (const ad of batch) {
      const key = ad.id || ad.link || ad.desc;
      if (!byKey.has(key)) byKey.set(key, ad);
      else {
        const prev = byKey.get(key);
        if ((ad.replies||0) > (prev.replies||0)) byKey.set(key, ad);
      }
    }
    all = Array.from(byKey.values());
    await page.evaluate(() => { window.scrollTo(0, document.documentElement.scrollHeight); });
    await new Promise(r => setTimeout(r, sleepMs));
    await page.evaluate(() => {
      const spans = [...document.querySelectorAll('span')];
      const more = spans.find(s => (s.textContent||'').trim() === 'مشاهدة المزيد');
      if (more) (more.closest('button, a, div') || more).click();
    });
    await new Promise(r => setTimeout(r, sleepMs));
    if (all.length === before) {
      // no new items; break early after a couple steady iterations
    }
  }
  return all;
}

async function main() {
  await ensureDir(DATA_DIR);
  const store = await loadJson(STORE_PATH, {});
  const now = new Date();
  const browser = await puppeteer.launch({
    headless: 'new',
    args: ['--no-sandbox','--disable-setuid-sandbox','--disable-dev-shm-usage'],
  });
  try {
    const page = await browser.newPage();
    await page.setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/119.0.0.0 Safari/537.36');
    await page.setViewport({ width: 1366, height: 900 });
    await page.goto('https://haraj.com.sa/', { waitUntil: 'domcontentloaded', timeout: 120000 });
    await new Promise(r => setTimeout(r, 1500));

    const ads = await autoScrollAndCollect(page, 8, 1200);

    const nowISO = nowIso();
    const map = new Map(Object.entries(store));
    for (const ad of ads) {
      const key = ad.id || ad.link || ad.desc;
      const prev = map.get(key);
      if (!prev) {
        map.set(key, {
          ...ad,
          firstSeenAt: nowISO,
          lastSeenAt: nowISO,
          latestReplies: ad.replies||0
        });
      } else {
        map.set(key, {
          ...prev,
          ...ad,
          lastSeenAt: nowISO,
          latestReplies: ad.replies||prev.latestReplies||0
        });
      }
    }

    // prune older than 24h since lastSeenAt
    const cutoff = Date.now() - 24*60*60*1000;
    const pruned = Array.from(map.values()).filter(x => {
      const t = Date.parse(x.lastSeenAt || x.firstSeenAt || nowISO);
      return isFinite(t) && t >= cutoff;
    });

    // sort and produce top24
    pruned.sort((a,b) => (b.latestReplies - a.latestReplies) || (a.desc||'').localeCompare(b.desc||'', 'ar'));
    const top24 = pruned.slice(0, 300); // cap for payload size

    // persist
    const newStoreObj = {};
    for (const x of pruned) {
      const k = x.id || x.link || x.desc;
      newStoreObj[k] = x;
    }
    await saveJson(STORE_PATH, newStoreObj);
    await saveJson(TOP24_PATH, { updatedAt: nowISO, count: top24.length, items: top24 });

    console.log(`Saved ${top24.length} top items; store size: ${pruned.length}`);
  } finally {
    await browser.close().catch(()=>{});
  }
}

main().catch(err => {
  console.error('SCRAPE_FAILED', err);
  process.exitCode = 1;
});
