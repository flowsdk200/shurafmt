import axios from 'axios'
import crypto from 'crypto'

const OEMBED_URL = 'https://www.youtube.com/oembed'
const TIMEOUT = 60000
const YT_TIMEOUT = 15000
const YT1S_ORIGIN = 'https://embed.dlsrv.online'
const YT1S_REFERER = 'https://embed.dlsrv.online/'
const YT1S_REF_FULL_BASE = 'https://embed.dlsrv.online/v1/full?videoId='
const YT1S_SESSION_ENDPOINT = '/api/session-token'
const YT1S_SIGN_SECRET = '682b2h1Sj5xzcjq4dKM59bKCkyZ7W3QWAM8efefOwqBJOs0qLgregrg4e3c5a8swswd'
const BROWSER_UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/137.0.0.0 Safari/537.36'

const withBrowserHeaders = (videoId = '') => ({
  'User-Agent': BROWSER_UA,
  Origin: YT1S_ORIGIN,
  Referer: `${YT1S_REF_FULL_BASE}${videoId || ''}`,
  Accept: 'application/json, text/plain, */*',
  'Accept-Language': 'en-US,en;q=0.9',
  'Sec-Fetch-Site': 'same-origin',
  'Sec-Fetch-Mode': 'cors',
  'Sec-Fetch-Dest': 'empty',
  Priority: 'u=1, i',
  'Sec-CH-UA': '"Google Chrome";v="137", "Chromium";v="137", "Not/A)Brand";v="24"',
  'Sec-CH-UA-Mobile': '?0',
  'Sec-CH-UA-Platform': '"Windows"'
})

const client = axios.create({
  baseURL: YT1S_ORIGIN,
  timeout: TIMEOUT,
  headers: withBrowserHeaders('')
})
const ytClient = axios.create({
  timeout: YT_TIMEOUT,
  headers: {
    'User-Agent': 'Mozilla/5.0 (Linux; Android 10; K) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/137.0.0.0 Mobile Safari/537.36'
  }
})

function extractVideoId(url) {
  const m = url?.match(/(?:https?:\/\/)?(?:www\.)?(?:youtube\.com\/(?:shorts\/|[^\/\n\s]+\/\S+\/|(?:v|e(?:mbed)?)\/|\S*?[?&]v=)|youtu\.be\/)([a-zA-Z0-9_-]{11})/)
  return m ? m[1] : ''
}

function pickQuality(available, requested, defaults) {
  if (requested && available.includes(String(requested))) return String(requested)
  for (const q of defaults) {
    if (available.includes(q)) return q
  }
  return available[0] || ''
}

let sessionTokenCache = {
  token: '',
  expiresAt: 0
}

function decodeTokenExpMs(jwt = '') {
  try {
    const parts = String(jwt || '').split('.')
    if (parts.length < 2) return 0
    const payloadRaw = Buffer.from(parts[1], 'base64url').toString('utf8')
    const payload = JSON.parse(payloadRaw)
    const expSec = Number(payload?.exp || 0)
    if (!Number.isFinite(expSec) || expSec <= 0) return 0
    return expSec * 1000
  } catch {
    return 0
  }
}

async function getSessionToken(forceRefresh = false) {
  const now = Date.now()
  if (!forceRefresh && sessionTokenCache.token && sessionTokenCache.expiresAt > now + 5000) {
    return sessionTokenCache.token
  }

  const { data } = await client.get(YT1S_SESSION_ENDPOINT, {
    headers: withBrowserHeaders('')
  })
  const token = String(data?.token || '').trim()
  if (!token) throw new Error('Gagal mendapatkan session token')

  const tokenExpMs = decodeTokenExpMs(token)
  sessionTokenCache = {
    token,
    expiresAt: tokenExpMs || (Date.now() + 8 * 60 * 1000)
  }
  return token
}

function isAuthError(err) {
  const status = Number(err?.response?.status || 0)
  return status === 401 || status === 403
}

function withSessionHeaders(token) {
  return {
    'Content-Type': 'application/json',
    'x-session-token': token
  }
}

async function getPublicIp(videoId = '') {
  const { data } = await client.get('/api/get-ip', {
    headers: {
      ...withBrowserHeaders(videoId)
    }
  })

  const ip = String(data?.ip || '').trim()
  if (!ip) throw new Error('Gagal mendapatkan IP publik')
  return ip
}

function buildSignature(timestamp, ip, videoId) {
  return crypto
    .createHmac('sha256', YT1S_SIGN_SECRET)
    .update(`${timestamp}:${ip}:${videoId}`)
    .digest('hex')
}

async function postWithSession(path, payload, { videoId = '' } = {}) {
  let token = await getSessionToken(false)
  try {
    const { data } = await client.post(path, payload, {
      headers: {
        ...withBrowserHeaders(videoId),
        ...withSessionHeaders(token)
      }
    })
    return data
  } catch (err) {
    if (!isAuthError(err)) throw err
    token = await getSessionToken(true)
    const { data } = await client.post(path, payload, {
      headers: {
        ...withBrowserHeaders(videoId),
        ...withSessionHeaders(token)
      }
    })
    return data
  }
}

async function getInfo(videoId) {
  try {
    const data = await postWithSession('/api/info', { videoId }, { videoId })
    if (!data || data.status !== 'info' || !data.info) {
      throw new Error(data?.error || 'Gagal mengambil data')
    }
    return data.info
  } catch (err) {
    if (process.env.DEBUG_YT1S) {
      console.error('[YT1S DEBUG] info error', err?.response?.status || err.message)
    }
    throw err
  }
}

async function getDownload(videoId, format, quality) {
  try {
    const endpoint = format === 'mp4' ? '/api/download/mp4' : '/api/download/mp3'
    const ip = await getPublicIp(videoId)
    const timestamp = Date.now().toString()
    const signature = buildSignature(timestamp, ip, videoId)

    const data = await postWithSession(endpoint, {
      videoId,
      format,
      quality,
      timestamp,
      signature
    }, { videoId })
    if (!data || data.status !== 'tunnel' || !data.url) {
      throw new Error(data?.error || 'Gagal mendapatkan link download')
    }
    return String(data.url)
  } catch (err) {
    if (process.env.DEBUG_YT1S) {
      console.error('[YT1S DEBUG] download error', err?.response?.status || err.message)
    }
    throw err
  }
}

async function fetchMeta(youtubeUrl) {
  try {
    const { data } = await ytClient.get(OEMBED_URL, {
      params: { url: youtubeUrl, format: 'json' }
    });
    if (!data) return null
    return {
      title: data.title || '',
      author: data.author_name || '',
      authorUrl: data.author_url || '',
      thumbnail: data.thumbnail_url || ''
    }
  } catch (_) {
    return null
  }
}

async function fetchDurationSeconds(youtubeUrl) {
  try {
    const id = extractVideoId(youtubeUrl);
    if (!id) return 0
    const { data } = await ytClient.get(`https://www.youtube.com/watch?v=${id}`, {
      headers: {
        'Accept-Language': 'en-US,en;q=0.9'
      }
    });
    const html = String(data || '')
    const m = html.match(/\"lengthSeconds\":\"(\d+)\"/)
    if (m) return parseInt(m[1], 10) || 0
    return 0
  } catch (_) {
    return 0
  }
}

async function yt1sdl(youtubeUrl, opts = {}) {
  if (!youtubeUrl) throw new Error('URL YouTube tidak boleh kosong')

  const videoId = extractVideoId(youtubeUrl);
  if (!videoId) throw new Error('URL YouTube tidak valid')

  const type = opts.type || 'both'
  const wantAudio = type !== 'video'
  const wantVideo = type !== 'audio'

  const baseInfo = await getInfo(videoId)
  const formats = Array.isArray(baseInfo?.formats) ? baseInfo.formats : []

  let title = baseInfo?.title || ''
  let thumbnail = baseInfo?.thumbnail || ''
  let audio = []
  let video = []

  if (wantAudio) {
    const reqAudio = String(opts.audioQuality || '').toLowerCase();
    let audioFormat = 'mp3'
    if (reqAudio === 'm4a' || reqAudio === 'opus') {
      const exists = formats.some((f) => f?.type === 'audio' && String(f?.format || '').toLowerCase() === reqAudio)
      if (exists) audioFormat = reqAudio
    }
    const audioQuality = (audioFormat === 'mp3')
      ? pickQuality(['64', '96', '128', '192', '256', '320'], String(opts.audioQuality || ''), ['64', '96', '128', '192', '256', '320'])
      : '';
    const audioUrl = await getDownload(videoId, audioFormat, audioQuality)
    const audioMime = audioFormat === 'm4a' ? 'audio/mp4' : audioFormat === 'opus' ? 'audio/ogg; codecs=opus' : 'audio/mpeg'
    audio = [{
      url: audioUrl,
      quality: audioQuality || audioFormat,
      format: audioFormat,
      mime: audioMime
    }];
  }

  if (wantVideo) {
    const available = formats
      .filter((f) => f?.type === 'video' && String(f?.format || '').toLowerCase() === 'mp4')
      .map((f) => String(f?.quality || '').replace(/p$/i, ''))
      .filter(Boolean);
    const unique = [...new Set(available)]
    const videoQuality = pickQuality(unique, String(opts.quality || '').replace(/p$/i, ''), ['720', '480', '360', '240', '144', '1080'])
    if (!videoQuality) throw new Error('Kualitas video tidak tersedia')
    const videoUrl = await getDownload(videoId, 'mp4', videoQuality)
    video = [{
      url: videoUrl,
      quality: `${videoQuality}p`,
      format: 'mp4',
      mime: 'video/mp4'
    }];
  }

  const [metaRes, durationRes] = await Promise.allSettled([
    fetchMeta(youtubeUrl),
    fetchDurationSeconds(youtubeUrl)
  ])
  const meta = metaRes.status === 'fulfilled' ? metaRes.value : null
  const durationSeconds = durationRes.status === 'fulfilled' ? durationRes.value : 0

  return {
    id: videoId,
    title: meta?.title || title || 'YouTube Video',
    thumbnail: meta?.thumbnail || thumbnail || '',
    duration: durationSeconds,
    durationLabel: durationSeconds
      ? `${Math.floor(durationSeconds / 60)}:${(durationSeconds % 60).toString().padStart(2, '0')}`
      : '',
    channel: {
      name: meta?.author || 'YouTube',
      url: meta?.authorUrl || `https://youtube.com/watch?v=${videoId}`
    },
    stats: { views: 0 },
    uploadDate: '',
    video,
    audio
  }
}

export { yt1sdl }
