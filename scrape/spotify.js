import axios from 'axios'
import FormData from 'form-data'

const BASE_URL = 'https://spotimate.io'
const TURNSTILE_SITEKEY = '0x4AAAAAAA_b5m4iQN755mZw'
const BYPASS_API = 'https://flowzsh-solver.hf.space/api/v1/solve'

const extractTrackId = (url = '') => {
    const m = String(url).match(/track\/([A-Za-z0-9]+)/)
    return m ? m[1] : ''
}

const parseDurationToMs = (input = '') => {
    const s = String(input || '').trim().toLowerCase()
    if (!s) return 0

    if (/^\d+$/.test(s)) {
        const n = Number(s)
        return n > 10000 ? n : n * 1000
    }

    const parts = s.split(':').map((x) => Number(x))
    if (parts.every((n) => Number.isFinite(n))) {
        if (parts.length === 2) return (parts[0] * 60 + parts[1]) * 1000
        if (parts.length === 3) return (parts[0] * 3600 + parts[1] * 60 + parts[2]) * 1000
    }

    const min = Number(s.match(/(\d+)\s*m/)?.[1] || 0)
    const sec = Number(s.match(/(\d+)\s*s/)?.[1] || 0)
    return (min * 60 + sec) * 1000
}

const formatDuration = (ms = 0) => {
    const total = Math.max(0, Math.floor(Number(ms || 0) / 1000))
    const m = Math.floor(total / 60)
    const s = String(total % 60).padStart(2, '0')
    return `${m}:${s}`
}

async function searchTracks(query, limit = 50) {
    const q = String(query || '').trim()
    if (!q) throw new Error('Query kosong')

    const res = await axios.get('https://api.baguss.xyz/api/search/spotify', {
        params: { q },
        timeout: 30000,
        headers: {
            'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
        }
    })

    const items = Array.isArray(res.data?.data) ? res.data.data : []
    const sliced = items.slice(0, Math.max(1, Math.min(50, Number(limit) || 50)))

    return sliced.map((item) => {
        const durationMs = parseDurationToMs(item.duration)
        return {
            id: extractTrackId(item.track_url),
            title: item.title,
            artists: item.artist,
            album: item.album,
            duration: durationMs,
            durationFormatted: formatDuration(durationMs),
            releaseDate: item.release_date,
            popularity: undefined,
            explicit: undefined,
            preview: item.preview_url || null,
            image: item.thumbnail || null,
            url: item.track_url,
            uri: item.track_url
        }
    })
}

async function getTurnstileToken() {
    const res = await axios.post(BYPASS_API, {
        url: BASE_URL,
        siteKey: TURNSTILE_SITEKEY
    }, { timeout: 120000 })

    if (!res.data?.success) throw new Error('Failed to get turnstile token')
    return res.data.result
}

async function getSession() {
    const res = await axios.get(BASE_URL, {
        headers: {
            'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36'
        },
        timeout: 30000
    })

    const csrfMatch = String(res.data || '').match(/name="(_[^"]+)"\s+type="hidden"\s+value="([^"]+)"/)
    if (!csrfMatch) throw new Error('Failed to get CSRF token')

    const cookies = res.headers['set-cookie']
    const sessionCookie = cookies?.find((c) => c.startsWith('session_data='))

    return {
        csrfName: csrfMatch[1],
        csrfValue: csrfMatch[2],
        cookie: sessionCookie ? sessionCookie.split(';')[0] : ''
    }
}

const extractId = (url = '') => {
    const m = String(url).match(/track\/([a-zA-Z0-9]+)/)
    return m ? m[1] : String(url)
}

function parseResponse(html) {
    const source = String(html || '')
    const titleMatch = source.match(/title="([^"]+)"[^>]*>([^<]+)</)
    const artistMatch = source.match(/<p><span>([^<]+)<\/span><\/p>/)
    const coverMatch = source.match(/src="(https:\/\/i\.scdn\.co\/image\/[^"]+)"/)
    const downloadMatch = source.match(/href="(https:\/\/spotimate\.io\/dl\?token=[^"]+)"[^>]*>.*?Download Mp3/)
    const coverDlMatch = source.match(/href="(https:\/\/spotimate\.io\/dl\?token=[^"]+)"[^>]*>.*?Download Cover/)

    if (!downloadMatch) throw new Error('Download link not found')

    return {
        title: titleMatch ? titleMatch[2].trim() : 'Unknown',
        artists: artistMatch ? artistMatch[1].trim() : 'Unknown',
        cover: coverMatch ? coverMatch[1] : null,
        downloadUrl: downloadMatch[1].replace(/&amp;/g, '&'),
        coverUrl: coverDlMatch ? coverDlMatch[1].replace(/&amp;/g, '&') : null
    }
}

async function download(urlOrId) {
    const input = String(urlOrId || '').trim()
    const spotifyUrl = input.includes('spotify.com') ? input : `https://open.spotify.com/track/${input}`

    const session = await getSession()
    const turnstileToken = await getTurnstileToken()

    const form = new FormData()
    form.append('url', spotifyUrl)
    form.append(session.csrfName, session.csrfValue)
    form.append('cf-turnstile-response', turnstileToken)

    const res = await axios.post(`${BASE_URL}/action`, form, {
        headers: {
            ...form.getHeaders(),
            'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
            Origin: BASE_URL,
            Referer: `${BASE_URL}/`,
            Cookie: session.cookie
        },
        timeout: 60000
    })

    if (String(res.data || '').includes('error') && String(res.data || '').includes('Please Refresh')) {
        throw new Error('Session expired, please retry')
    }

    const parsed = parseResponse(res.data)
    const id = extractId(spotifyUrl)

    return {
        id,
        title: parsed.title,
        artists: parsed.artists,
        album: parsed.title,
        cover: parsed.cover,
        downloadUrl: parsed.downloadUrl,
        coverUrl: parsed.coverUrl,
        cookie: session.cookie
    }
}

async function downloadBuffer(urlOrId) {
    const data = await download(urlOrId)

    const audioRes = await axios.get(data.downloadUrl, {
        responseType: 'arraybuffer',
        maxRedirects: 5,
        timeout: 120000,
        headers: {
            'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
            Cookie: data.cookie,
            Referer: `${BASE_URL}/`
        }
    })

    let coverBuffer = null
    if (data.cover) {
        try {
            const coverRes = await axios.get(data.cover, { responseType: 'arraybuffer', timeout: 30000 })
            coverBuffer = Buffer.from(coverRes.data)
        } catch {}
    }

    return {
        id: data.id,
        title: data.title,
        artists: data.artists,
        album: data.album,
        cover: data.cover,
        audioBuffer: Buffer.from(audioRes.data),
        coverBuffer
    }
}

async function getMetadata(urlOrId) {
    const data = await download(urlOrId)
    return {
        id: data.id,
        title: data.title,
        artists: data.artists,
        cover: data.cover
    }
}

export { searchTracks, download, downloadBuffer, getMetadata }
