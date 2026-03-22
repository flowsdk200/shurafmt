import axios from 'axios'
import * as cheerio from 'cheerio'
import { CookieJar } from 'tough-cookie'
import vm from 'vm'

let _gotScraping = null;
async function getGotScraping() {
  if (_gotScraping) return _gotScraping;
  const mod = await import('got-scraping');
  _gotScraping = mod?.gotScraping || mod?.default || mod;
  if (typeof _gotScraping !== 'function') {
    throw new Error('got-scraping not available');
  }
  return _gotScraping;
}

const TIMEOUT = {
  LONG: 30000,
  EXTRA_LONG: 60000
};

const HTTP_CONFIG = {
  USER_AGENT: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/138.0.0.0 Safari/537.36'
};

const EMBED_UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36';
const SNAPINSTA_REFERER = 'https://snapinsta.to/en2';
const SNAPINSTA_USERVERIFY_API = 'https://snapinsta.to/api/userverify';

const formatCount = (num) => {
  const n = Number(num);
  if (!Number.isFinite(n)) return undefined;
  if (n >= 1_000_000_000) return `${(n / 1_000_000_000).toFixed(1).replace(/\.0$/, '')}B`;
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1).replace(/\.0$/, '')}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(1).replace(/\.0$/, '')}K`;
  return `${Math.floor(n)}`;
};

const parseShortCount = (raw = '') => {
  const s = String(raw || '').trim().toUpperCase().replace(/,/g, '.');
  const m = s.match(/^(\d+(?:\.\d+)?)([KMB])?$/);
  if (!m) return null;
  let n = Number(m[1]);
  if (!Number.isFinite(n)) return null;
  const u = m[2] || '';
  if (u === 'K') n *= 1_000;
  if (u === 'M') n *= 1_000_000;
  if (u === 'B') n *= 1_000_000_000;
  return Math.round(n);
};

function decodeEscapes(input) {
  let out = String(input || '');
  if (!out) return '';

  out = out.replace(/\\u[dD][89abAB][0-9a-fA-F]{2}\\u[dD][cdefCDEF][0-9a-fA-F]{2}/g, (pair) => {
    const hi = parseInt(pair.slice(2, 6), 16);
    const lo = parseInt(pair.slice(8, 12), 16);
    return String.fromCodePoint(((hi - 0xd800) << 10) + (lo - 0xdc00) + 0x10000);
  });

  out = out
    .replace(/\\u([0-9a-fA-F]{4})/g, (_, hex) => String.fromCharCode(parseInt(hex, 16)))
    .replace(/\\n/g, '\n')
    .replace(/\\r/g, '')
    .replace(/\\t/g, ' ')
    .replace(/\\"/g, '"')
    .replace(/\\'/g, "'")
    .replace(/\\\//g, '/')
    .replace(/\\\\/g, '\\')
    .trim();

  return out;
}

function isInstagramUrl(input = '') {
  return /https?:\/\/(?:www\.)?instagram\.com\//i.test(String(input || '').trim());
}

function sanitizeUrl(input = '') {
  const s = String(input || '').trim();
  if (!s) return s;
  if (/^https?:\/\//i.test(s)) return s;
  if (/^www\./i.test(s)) return `https://${s}`;
  return s;
}

function extractShortcode(url) {
  const clean = sanitizeUrl(url);
  const match = clean.match(/instagram\.com\/(?:p|reel|reels|tv)\/([A-Za-z0-9_-]+)/i);
  return match ? match[1] : null;
}

function getPostType(input) {
  const v = String(input || '').trim().toLowerCase();
  if (v.includes('/reel/') || v.includes('/reels/')) return 'reel';
  if (v.includes('/stories/')) return 'story';
  if (v.includes('instagram.com/p/') || v.includes('instagram.com/tv/')) return 'post';
  if (!v.includes('instagram.com') && !v.includes('/')) return 'username';
  return 'post';
}

function decodeObfuscated(code) {
  let result = '';
  const sandbox = {
    decodeURIComponent,
    String,
    Math,
    eval: (s) => {
      result = String(s || '');
    },
    window: { location: { hostname: 'savevid.net' } },
    document: { getElementById: () => ({ innerHTML: '' }) }
  };
  try {
    vm.runInNewContext(String(code || ''), sandbox, { timeout: 2000 });
  } catch {}
  return result;
}

function decodeSnapCdnDownload(url) {
  try {
    const u = new URL(String(url || '').trim());
    const token = u.searchParams.get('token');
    if (!token) return null;
    if (!/(^|\.)dl\.snapcdn\.app$/i.test(u.hostname)) return null;
    if (!/^\/(?:download|get)\b/i.test(u.pathname)) return null;

    const parts = token.split('.');
    if (parts.length < 2) return null;

    let payloadB64 = parts[1].replace(/-/g, '+').replace(/_/g, '/');
    const pad = payloadB64.length % 4;
    if (pad) payloadB64 += '='.repeat(4 - pad);

    const json = JSON.parse(Buffer.from(payloadB64, 'base64').toString('utf8'));
    const filename = typeof json?.filename === 'string' ? json.filename : '';
    const srcUrl = typeof json?.url === 'string' ? json.url : '';

    const extFrom = (s) => {
      const m = String(s || '').toLowerCase().match(/\.([a-z0-9]{2,5})(?:\?|$)/i);
      return m ? m[1] : '';
    };
    const ext = extFrom(filename) || extFrom(srcUrl);

    let kind = '';
    if (['mp4', 'webm', 'mov', 'mkv', '3gp'].includes(ext)) kind = 'video';
    if (['jpg', 'jpeg', 'png', 'webp', 'gif'].includes(ext)) kind = 'image';

    return { filename, srcUrl, ext, kind };
  } catch {
    return null;
  }
}

function parseMedia(html) {
  const media = [];
  const seen = new Set();
  const cleanHtml = String(html || '').replace(/\\"/g, '"').replace(/\\\//g, '/');
  const $ = cheerio.load(cleanHtml);

  const normUrl = (u) => String(u || '').replace(/^["\\]+/, '').replace(/["\\]+$/, '').trim();

  const pushMedia = (type, url, thumb) => {
    const u = String(url || '').trim();
    if (!u) return;
    const snap = /dl\.snapcdn\.app\/(?:download|get)\?token=/i.test(u) ? decodeSnapCdnDownload(u) : null;
    const dedupKey = snap?.srcUrl || snap?.filename || u;
    if (seen.has(dedupKey)) return;
    if (/google\.com|googleusercontent|recaptcha|savevid\.net\/en/i.test(u)) return;
    seen.add(dedupKey);

    let finalType = type === 'video' ? 'video' : 'image';
    if (snap?.kind === 'video' || snap?.kind === 'image') finalType = snap.kind;
    media.push({
      type: finalType,
      url: u,
      thumbnail: thumb || undefined,
      filename: snap?.filename || undefined,
      sourceUrl: snap?.srcUrl || undefined
    });
  };

  const detectKind = (href, text) => {
    const h = String(href || '').toLowerCase();
    const t = String(text || '').toLowerCase();
    const snap = /dl\.snapcdn\.app\/(?:download|get)\?token=/i.test(href) ? decodeSnapCdnDownload(href) : null;
    if (snap?.kind) return { kind: snap.kind, snap };

    if (/\.(mp4|mov|mkv|webm|3gp)(\?|$)/i.test(h) || /\bvideo\b|\bmp4\b|\bhd\b|\bsd\b/i.test(t)) {
      return { kind: 'video', snap: null };
    }
    if (/\.(jpe?g|png|webp|gif)(\?|$)/i.test(h) || /\bimage\b|\bphoto\b|\bjpg\b|\bjpeg\b|\bpng\b|\bwebp\b/i.test(t)) {
      return { kind: 'image', snap: null };
    }
    return { kind: '', snap: null };
  };

  const lis = $('.download-box li');
  if (lis.length > 0) {
    lis.each((_, li) => {
      const $li = $(li);
      const thumb = normUrl($li.find('img').first().attr('src'));

      const links = [];
      $li.find('a[href]').each((__, a) => {
        const href = normUrl($(a).attr('href'));
        if (!href) return;
        if (/google\.com|googleusercontent|recaptcha|savevid\.net\/en/i.test(href)) return;
        const text = `${$(a).text() || ''} ${$(a).attr('title') || ''}`.trim();
        links.push({ href, text });
      });

      if (!links.length) return;

      const classified = links.map((x) => {
        const d = detectKind(x.href, x.text);
        return { ...x, kind: d.kind || 'video', snap: d.snap };
      });

      const hasVideo = classified.some((x) => x.kind === 'video');
      const chosen = hasVideo ? classified.filter((x) => x.kind === 'video') : classified.filter((x) => x.kind === 'image');
      const final = chosen.length ? chosen : classified;

      for (const it of final) {
        pushMedia(it.kind, it.href, thumb || undefined);
      }
    });
  } else {
    $('a[href]').each((_, el) => {
      const hrefRaw = $(el).attr('href');
      if (!hrefRaw) return;
      const href = normUrl(hrefRaw);
      const text = `${$(el).text() || ''} ${$(el).attr('title') || ''}`.toLowerCase();
      const thumb = normUrl($(el).closest('.download-items, li, .card, .item').find('img').first().attr('src'));

      const looksDownloadLink = /dl\.snapcdn\.app|\/download|token=|\.cdn\.|\.mp4|\.jpe?g|\.png|\.webp/i.test(href);
      if (!looksDownloadLink) return;

      const d = detectKind(href, text);
      pushMedia(d.kind || 'video', href, thumb || undefined);
    });
  }

  if (media.length === 0) {
    const links = cleanHtml.match(/https?:\/\/[^"'<> ]+/g) || [];
    for (const link of links) {
      if (!/dl\.snapcdn\.app|\.mp4|\.jpe?g|\.png|\.webp|\/download/i.test(link)) continue;
      const isVideo = /\.(mp4|mov|mkv|webm)(\?|$)/i.test(link);
      pushMedia(isVideo ? 'video' : 'image', link, undefined);
    }
  }

  return media;
}

function parseSnapInstaConfig(html = '') {
  const src = String(html || '');
  return {
    searchUrl: src.match(/k_url_search="([^"]+)"/i)?.[1] || 'https://snapinsta.to/api/ajaxSearch',
    version: src.match(/k_ver="([^"]+)"/i)?.[1] || 'v2',
    lang: src.match(/k_lang="([^"]+)"/i)?.[1] || 'en'
  };
}

async function fetchInstagramPageHtml(shortcode) {
  const gotScraping = await getGotScraping();
  const urls = [
    `https://www.instagram.com/p/${shortcode}/?__a=1`,
    `https://www.instagram.com/reel/${shortcode}/?__a=1`,
    `https://www.instagram.com/tv/${shortcode}/?__a=1`,
    `https://www.instagram.com/p/${shortcode}/`,
    `https://www.instagram.com/reel/${shortcode}/`,
    `https://www.instagram.com/tv/${shortcode}/`
  ];

  for (const url of urls) {
    try {
      const r = await gotScraping(url, {
        headers: { 'user-agent': HTTP_CONFIG.USER_AGENT, accept: 'text/html,*/*' },
        timeout: { request: TIMEOUT.LONG },
        throwHttpErrors: false
      });

      if (!r || r.statusCode < 200 || r.statusCode >= 400) continue;
      const html = String(r.body || '');
      if (!html || html.length < 1000) continue;

      // Skip halaman Cloudflare challenge.
      if (/just a moment|cf-challenge/i.test(html)) continue;

      return html;
    } catch {}
  }
  return '';
}

async function getMetadata(shortcode) {
  const author = {};
  const stats = {};
  let caption;
  let postId;

  const embedUrls = [
    `https://www.instagram.com/p/${shortcode}/embed/`,
    `https://www.instagram.com/reel/${shortcode}/embed/`,
    `https://www.instagram.com/tv/${shortcode}/embed/`
  ];

  const extractFirstJsonObject = (s) => {
    const str = String(s || '');
    if (!str.startsWith('{')) return null;
    let depth = 0;
    let inStr = false;
    let esc = false;
    for (let i = 0; i < str.length; i += 1) {
      const ch = str[i];
      if (inStr) {
        if (esc) { esc = false; continue; }
        if (ch === '\\') { esc = true; continue; }
        if (ch === '\"') { inStr = false; continue; }
        continue;
      }
      if (ch === '\"') { inStr = true; continue; }
      if (ch === '{') depth += 1;
      if (ch === '}') depth -= 1;
      if (depth === 0) return str.slice(0, i + 1);
    }
    return null;
  };

  const extractShortcodeMedia = (rawHtml) => {
    const html = String(rawHtml || '');
    const markers = ['\\\"gql_data\\\":', '\"gql_data\":'];
    for (const m of markers) {
      const idx = html.indexOf(m);
      if (idx === -1) continue;
      const after = html.slice(idx + m.length);
      const decoded = after
        .replace(/\\u0026/g, '&')
        .replace(/\\\//g, '/')
        .replace(/\\"/g, '\"');
      const objStr = extractFirstJsonObject(decoded.trimStart());
      if (!objStr) continue;
      try {
        const gql = JSON.parse(objStr);
        if (gql && typeof gql === 'object' && gql.shortcode_media) return gql.shortcode_media;
      } catch {}
    }
    return null;
  };

  try {
    let html = '';
    for (const embedUrl of embedUrls) {
      try {
        const { data, status } = await axios.get(embedUrl, {
          headers: { 'User-Agent': EMBED_UA },
          timeout: TIMEOUT.LONG,
          validateStatus: () => true
        });
        if (status >= 200 && status < 400 && typeof data === 'string' && data.length > 100) {
          html = data;
          break;
        }
      } catch {}
    }
    if (!html) return { author, stats, caption, postId };

    const scMedia = extractShortcodeMedia(html);
    if (scMedia && typeof scMedia === 'object') {
      try {
        if (scMedia?.owner?.username) author.username = String(scMedia.owner.username);
        if (typeof scMedia?.owner?.is_verified === 'boolean') author.isVerified = scMedia.owner.is_verified;
        if (scMedia?.owner?.profile_pic_url) author.avatar = String(scMedia.owner.profile_pic_url);

        const cap = scMedia?.edge_media_to_caption?.edges?.[0]?.node?.text;
        if (cap) caption = String(cap);

        postId = scMedia?.id ? String(scMedia.id) : postId;

        const likes =
          scMedia?.edge_liked_by?.count ??
          scMedia?.edge_media_preview_like?.count ??
          scMedia?.like_count ??
          null;
        if (likes != null) stats.likes = formatCount(Number(likes));

        const comments =
          scMedia?.edge_media_to_comment?.count ??
          scMedia?.commenter_count ??
          scMedia?.comment_count ??
          null;
        if (comments != null) stats.comments = formatCount(Number(comments));

        const views =
          scMedia?.video_view_count ??
          scMedia?.view_count ??
          scMedia?.play_count ??
          null;
        if (views != null) stats.views = formatCount(Number(views));
      } catch {}
    }

    const $ = cheerio.load(html);

    const avatarImg = $('.CollabAvatar img, .Header img, img').first();
    const avatarSrc = avatarImg.attr('src');
    if (avatarSrc) {
      author.avatar = decodeEscapes(avatarSrc);
    }

    const usernameFromAlt = avatarImg.attr('alt');
    if (usernameFromAlt) author.username = String(usernameFromAlt).replace(/^@+/, '').trim();

    if (!author.username) {
      const userRegexes = [
        /"author_name":"([^"]+)"/,
        /"username":"([^"]+)"/,
        /instagram\.com\/([A-Za-z0-9._]+)\//i
      ];
      for (const rgx of userRegexes) {
        const m = html.match(rgx);
        if (m && m[1]) {
          author.username = decodeEscapes(m[1]).replace(/^@+/, '').trim();
          break;
        }
      }
    }

    if (author.isVerified === undefined) {
      author.isVerified = /"is_verified"\s*:\s*true/i.test(html) || html.includes('coreSpriteVerifiedBadge');
    }

    const followersMatch =
      html.match(/"followers_count"\s*:\s*(\d+)/i) ||
      html.match(/([\d.,]+)\s*followers/i);
    if (followersMatch) {
      const raw = followersMatch[1].replace(/[.,]/g, '');
      author.followersCount = formatCount(Number(raw));
    }

    if (!stats.likes) {
      const likesMatch =
        html.match(/"edge_liked_by"\s*:\s*\{"count"\s*:\s*(\d+)/) ||
        html.match(/"edge_media_preview_like"\s*:\s*\{"count"\s*:\s*(\d+)/) ||
        html.match(/"like_count"\s*:\s*(\d+)/i) ||
        html.match(/([\d.,]+)\s*likes?/i);
      if (likesMatch) stats.likes = formatCount(Number(String(likesMatch[1]).replace(/[.,]/g, '')));
    }

    if (!stats.comments) {
      const commentsMatch =
        html.match(/"edge_media_to_comment"\s*:\s*\{"count"\s*:\s*(\d+)/) ||
        html.match(/"edge_media_to_parent_comment"\s*:\s*\{"count"\s*:\s*(\d+)/) ||
        html.match(/"commenter_count"\s*:\s*(\d+)/i) ||
        html.match(/"comment_count"\s*:\s*(\d+)/i) ||
        html.match(/View all ([\d,]+) comments/i) ||
        html.match(/Lihat semua ([\d.]+) komentar/i);
      if (commentsMatch) stats.comments = formatCount(Number(String(commentsMatch[1]).replace(/[.,]/g, '')));
    }

    if (!caption) {
      const captionMatch =
        html.match(/"edge_media_to_caption"\s*:\s*\{"edges":\[\{"node":\{"text":"([^"]*(?:\\.[^"]*)*)"/) ||
        html.match(/"caption":"([^"]*(?:\\.[^"]*)*)"/) ||
        html.match(/"description":"([^"]*(?:\\.[^"]*)*)"/);
      if (captionMatch && captionMatch[1]) {
        caption = decodeEscapes(captionMatch[1]);
      }
    }

    const idMatch = html.match(/"id":"(\d+)"/) || html.match(/data-media-id="(\d+)"/);
    if (idMatch) postId = idMatch[1];
  } catch {}

  // Embed kadang tidak memuat caption/stats. Ambil dari halaman post utama.
  try {
    const needsCaption = !caption;
    const needsLikes = !stats.likes;
    const needsComments = !stats.comments;
    const needsViews = !stats.views;

    if (needsCaption || needsLikes || needsComments || needsViews) {
      const pageHtml = await fetchInstagramPageHtml(shortcode);
      if (pageHtml) {
        if (!author.username) {
          const mUser = pageHtml.match(/"username"\s*:\s*"([A-Za-z0-9._]+)"/);
          if (mUser && mUser[1]) author.username = String(mUser[1]).replace(/^@+/, '').trim();
        }

        if (!caption) {
          const mCap = pageHtml.match(/"caption"\s*:\s*\{[^}]{0,2000}"text"\s*:\s*"([^"\\]*(?:\\.[^"\\]*)*)"/);
          if (mCap && mCap[1]) caption = decodeEscapes(mCap[1]);
        }

        if (!stats.likes) {
          const mLikes = pageHtml.match(/"like_count"\s*:\s*(\d+)/);
          if (mLikes && mLikes[1]) stats.likes = formatCount(Number(mLikes[1]));
        }

        if (!stats.comments) {
          const mComments = pageHtml.match(/"comment_count"\s*:\s*(\d+)/);
          if (mComments && mComments[1]) stats.comments = formatCount(Number(mComments[1]));
        }

        if (!stats.views) {
          const mViews =
            pageHtml.match(/"video_view_count"\s*:\s*(\d+)/) ||
            pageHtml.match(/"view_count"\s*:\s*(\d+)/) ||
            pageHtml.match(/"play_count"\s*:\s*(\d+)/);
          if (mViews && mViews[1]) stats.views = formatCount(Number(mViews[1]));
        }
      }
    }
  } catch {}

  /** Fallback followers untuk post/reel/tv dari halaman profile author */
  if (!author.followersCount && author.username) {
    try {
      const { data: profileHtml } = await axios.get(`https://www.instagram.com/${author.username}/`, {
        headers: { 'User-Agent': EMBED_UA },
        timeout: TIMEOUT.LONG,
        validateStatus: () => true
      });

      const src = String(profileHtml || '');
      const ogFollowers =
        src.match(/content="([0-9.,]+\s*[KMB]?)\s+Followers,\s*[0-9.,]+\s+Following,\s*[0-9.,]+\s+Posts/i)?.[1] ||
        src.match(/([0-9.,]+\s*[KMB]?)\s+Followers/i)?.[1] ||
        '';

      if (ogFollowers) {
        const parsed = parseShortCount(ogFollowers.replace(/\s+/g, ''));
        if (parsed) author.followersCount = formatCount(parsed);
      }
    } catch {}
  }

  return { author, stats, caption, postId };
}

async function getStoryAuthor(username) {
  const author = { username };
  try {
    const { data: html } = await axios.get(`https://www.instagram.com/${username}/embed/`, {
      headers: { 'User-Agent': EMBED_UA },
      timeout: TIMEOUT.LONG
    });

    const avatarMatch = html.match(/"profile_pic_url"\s*:\s*"([^"]+)"/);
    if (avatarMatch) author.avatar = decodeEscapes(avatarMatch[1]);

    author.isVerified = /"is_verified"\s*:\s*true/i.test(html) || html.includes('verified');

    const followersMatch = html.match(/"followers_count"\s*:\s*(\d+)/i) || html.match(/([\d.]+)([MK]?)\s*followers/i);
    if (followersMatch) {
      if (followersMatch[2]) {
        let count = parseFloat(followersMatch[1]);
        const unit = String(followersMatch[2] || '').toUpperCase();
        if (unit === 'M') count *= 1_000_000;
        if (unit === 'K') count *= 1000;
        author.followersCount = formatCount(Math.round(count));
      } else {
        author.followersCount = formatCount(parseInt(followersMatch[1], 10));
      }
    }
  } catch {}

  if (!author.followersCount && username) {
    try {
      const { data: profileHtml } = await axios.get(`https://www.instagram.com/${username}/`, {
        headers: { 'User-Agent': EMBED_UA },
        timeout: TIMEOUT.LONG,
        validateStatus: () => true
      });

      const src = String(profileHtml || '');
      const ogFollowers =
        src.match(/content="([0-9.,]+\s*[KMB]?)\s+Followers,\s*[0-9.,]+\s+Following,\s*[0-9.,]+\s+Posts/i)?.[1] ||
        src.match(/([0-9.,]+\s*[KMB]?)\s+Followers/i)?.[1] ||
        '';

      if (ogFollowers) {
        const parsed = parseShortCount(ogFollowers.replace(/\s+/g, ''));
        if (parsed) author.followersCount = formatCount(parsed);
      }
    } catch {}
  }

  return author;
}

async function fetchFromSnapInsta(query) {
  const gotScraping = await getGotScraping();
  const cookieJar = new CookieJar();
  const commonHeaders = {
    accept: '*/*',
    'x-requested-with': 'XMLHttpRequest',
    origin: 'https://snapinsta.to',
    referer: SNAPINSTA_REFERER,
    'user-agent': HTTP_CONFIG.USER_AGENT
  };

  const pageRes = await gotScraping({
    url: SNAPINSTA_REFERER,
    cookieJar,
    headers: {
      'accept-language': 'en-US,en;q=0.9',
      'user-agent': HTTP_CONFIG.USER_AGENT
    },
    timeout: { request: TIMEOUT.EXTRA_LONG },
    throwHttpErrors: false
  });

  if (!pageRes || pageRes.statusCode < 200 || pageRes.statusCode >= 400) {
    throw new Error(`SnapInsta HTTP ${pageRes?.statusCode || 0}`);
  }

  const pageHtml = String(pageRes.body || '');
  if (!pageHtml || /just a moment|cf-challenge/i.test(pageHtml)) {
    throw new Error('SnapInsta blocked by Cloudflare');
  }

  const config = parseSnapInstaConfig(pageHtml);

  const verifyRes = await gotScraping.post(SNAPINSTA_USERVERIFY_API, {
    cookieJar,
    headers: commonHeaders,
    form: { url: query },
    responseType: 'json',
    timeout: { request: TIMEOUT.EXTRA_LONG },
    throwHttpErrors: false
  });

  const verifyBody = typeof verifyRes?.body === 'string'
    ? JSON.parse(verifyRes.body)
    : (verifyRes?.body || {});

  const verificationToken = String(verifyBody?.token || '').trim();
  if (!verifyBody?.success || !verificationToken) {
    throw new Error(String(verifyBody?.message || verifyBody?.mess || 'SnapInsta token verification failed').replace(/<[^>]*>/g, '').trim() || 'SnapInsta token verification failed');
  }

  const searchRes = await gotScraping.post(config.searchUrl, {
    cookieJar,
    headers: commonHeaders,
    form: {
      q: query,
      t: 'media',
      v: config.version,
      lang: config.lang,
      cftoken: verificationToken,
      html: ''
    },
    responseType: 'json',
    timeout: { request: TIMEOUT.EXTRA_LONG },
    throwHttpErrors: false
  });

  if (searchRes?.statusCode && searchRes.statusCode >= 400) {
    throw new Error(`SnapInsta HTTP ${searchRes.statusCode}`);
  }

  const parsed = typeof searchRes?.body === 'string'
    ? JSON.parse(searchRes.body)
    : (searchRes?.body || {});

  if (!parsed || typeof parsed !== 'object') {
    throw new Error('Invalid SnapInsta response');
  }

  if (parsed.status !== 'ok') {
    const msg = String(parsed.mess || parsed.message || 'SnapInsta API error').replace(/<[^>]*>/g, '').trim();
    throw new Error(msg || 'SnapInsta API error');
  }

  if (parsed.mess && !parsed.data) {
    const msg = String(parsed.mess).replace(/<[^>]*>/g, '').trim();
    throw new Error(msg || 'SnapInsta API error');
  }

  let html = String(parsed.data || parsed.html || '');
  if (!html) throw new Error('No html data from SnapInsta');
  if (html.includes('eval(') || html.includes('_0x')) {
    html = decodeObfuscated(html) || html;
  }

  return parseMedia(html);
}

async function instagram(input) {
  const rawInput = String(input || '').trim();
  if (!rawInput) throw new Error('Input is required');

  let postType = getPostType(rawInput);
  let query = sanitizeUrl(rawInput);
  let storyUsername;

  if (postType === 'username') {
    storyUsername = rawInput.replace(/^@/, '').trim();
    if (!storyUsername) throw new Error('Username story tidak valid');
    query = `https://www.instagram.com/stories/${storyUsername}`;
    postType = 'story';
  } else if (postType === 'story') {
    const storyMatch = query.match(/\/stories\/([^/?#]+)/i);
    if (storyMatch) storyUsername = storyMatch[1];
  }

  const shortcode = extractShortcode(query);
  const baseMetadataPromise = shortcode
    ? getMetadata(shortcode)
    : storyUsername
      ? getStoryAuthor(storyUsername).then((author) => ({
          author,
          stats: {},
          caption: undefined,
          postId: undefined
        }))
      : Promise.resolve({
          author: {},
          stats: {},
          caption: undefined,
          postId: undefined
        });

  const [media, metadata] = await Promise.all([fetchFromSnapInsta(query), baseMetadataPromise]);

  if (!Array.isArray(media) || media.length === 0) {
    throw new Error('No media found');
  }

  let filteredMedia = media;
  if (postType === 'reel') {
    const videos = media.filter((m) => m.type === 'video');
    if (videos.length > 0) filteredMedia = videos;
  }

  return {
    type: postType,
    postId: metadata.postId,
    shortcode: shortcode || undefined,
    media: filteredMedia,
    author: metadata.author || {},
    caption: metadata.caption,
    stats: metadata.stats || {}
  };
}

export {
  instagram,
  isInstagramUrl
}
