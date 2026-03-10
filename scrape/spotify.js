import axios from 'axios'

const ENTRY_URL = 'https://spotidown.app/en1'
const BASE_URL = 'https://spotidown.app'
const ACTION_URL = `${BASE_URL}/action`
const TRACK_ACTION_URL = `${BASE_URL}/action/track`
const SPOTDOWN_BASE_URL = 'https://spotdown.org'
const PAGE_HEADERS = {
    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/137.0.0.0 Safari/537.36',
    'Accept-Language': 'en-US,en;q=0.9'
}

let spotdownSessionCache = {
    token: '',
    expires: 0
}

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

    const token = await getSpotdownSessionToken()
    const res = await axios.get(`${SPOTDOWN_BASE_URL}/api/song-details`, {
        params: { url: q },
        timeout: 30000,
        headers: {
            'User-Agent': PAGE_HEADERS['User-Agent'],
            'Accept': 'application/json,text/plain,*/*',
            'X-Session-Token': token
        }
    })

    if (res.data?.success === false) {
        throw new Error(String(res.data?.message || 'Pencarian Spotify gagal'))
    }

    const items = Array.isArray(res.data?.songs) ? res.data.songs : []
    const sliced = items.slice(0, Math.max(1, Math.min(50, Number(limit) || 50)))

    return sliced.map((item) => {
        const durationMs = parseDurationToMs(item.duration)
        return {
            id: extractTrackId(item.url),
            title: item.title,
            artists: item.artist,
            album: item.album || '',
            duration: durationMs,
            durationFormatted: formatDuration(durationMs),
            releaseDate: item.release_date || '',
            popularity: undefined,
            explicit: undefined,
            preview: null,
            image: item.thumbnail || null,
            url: item.url,
            uri: item.url
        }
    })
}

async function getSpotdownSessionToken() {
    if (spotdownSessionCache.token && Date.now() < Number(spotdownSessionCache.expires || 0)) {
        return spotdownSessionCache.token
    }

    const res = await axios.get(`${SPOTDOWN_BASE_URL}/api/get-session-token`, {
        timeout: 30000,
        headers: {
            'User-Agent': PAGE_HEADERS['User-Agent'],
            'Accept': 'application/json,text/plain,*/*'
        }
    })

    const token = String(res.data?.token || '').trim()
    const expires = Number(res.data?.expires || 0)

    if (!token) {
        throw new Error('Token search Spotdown tidak ditemukan')
    }

    spotdownSessionCache = { token, expires }
    return token
}

const decodeValue = (value = '') => String(value || '')
    .replace(/\\\//g, '/')
    .replace(/&amp;/g, '&')
    .trim()

const decodeBase64Json = (value = '') => {
    try {
        const json = Buffer.from(String(value || '').trim(), 'base64').toString('utf8')
        const parsed = JSON.parse(json)
        return parsed && typeof parsed === 'object' ? parsed : null
    } catch {
        return null
    }
}

const extractInputFields = (html = '') => {
    const tags = String(html || '').match(/<input\b[^>]*>/gi) || []

    return tags.map((tag) => {
        const name = tag.match(/\bname=(['"])(.*?)\1/i)?.[2] || ''
        const value = tag.match(/\bvalue=(['"])(.*?)\1/i)?.[2] || ''
        const type = (tag.match(/\btype=(['"])(.*?)\1/i)?.[2] || 'text').toLowerCase()

        return {
            name,
            value: decodeValue(value),
            type
        }
    }).filter((item) => item.name)
}

async function getSession() {
    const res = await fetch(ENTRY_URL, {
        headers: PAGE_HEADERS
    })

    if (!res.ok) {
        throw new Error(`SpotiDown entry HTTP ${res.status}`)
    }

    const html = await res.text()
    const cookies = res.headers.getSetCookie?.() || []
    const sessionCookie = cookies.find((c) => c.startsWith('session_data='))
    const hiddenFields = extractInputFields(html)
        .filter((item) => item.type === 'hidden')
        .filter((item) => item.name !== 'g-recaptcha-response' && item.name !== 'url')

    if (!hiddenFields.length) {
        throw new Error('Hidden form token SpotiDown tidak ditemukan')
    }

    return {
        hiddenFields,
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
    const coverMatch = source.match(/src="(https:\/\/i\.(?:scdn|scdn\.co)\/image\/[^"]+)"/i)
    const inputs = extractInputFields(source)
    const dataField = inputs.find((item) => item.name === 'data')?.value || ''
    const baseField = inputs.find((item) => item.name === 'base')?.value || ''
    const tokenField = inputs.find((item) => item.name === 'token')?.value || ''
    const encodedMeta = decodeBase64Json(dataField)
    const durationMs = parseDurationToMs(encodedMeta?.duration)

    const linkMatches = [...source.matchAll(/<a[^>]+href="([^"]+)"[^>]*>\s*<span><span>([^<]+)<\/span><\/span>/gi)]
        .map((match) => ({
            href: decodeValue(match[1]),
            label: String(match[2] || '').trim()
        }))
    const downloadMatch = linkMatches.find((item) => /download mp3/i.test(item.label))
    const coverDlMatch = linkMatches.find((item) => /download cover/i.test(item.label))

    return {
        title: titleMatch ? titleMatch[2].trim() : 'Unknown',
        artists: artistMatch ? artistMatch[1].trim() : 'Unknown',
        cover: coverMatch ? decodeValue(coverMatch[1]) : null,
        album: encodedMeta?.album ? String(encodedMeta.album).trim() : '',
        duration: durationMs,
        durationFormatted: durationMs ? formatDuration(durationMs) : '',
        releaseDate: encodedMeta?.date ? String(encodedMeta.date).trim() : '',
        data: dataField,
        base: baseField,
        token: tokenField,
        downloadUrl: downloadMatch ? downloadMatch.href : '',
        coverUrl: coverDlMatch ? coverDlMatch.href : null
    }
}

async function download(urlOrId) {
    const input = String(urlOrId || '').trim()
    const spotifyUrl = input.includes('spotify.com') ? input : `https://open.spotify.com/track/${input}`

    const session = await getSession()
    const form = new FormData()
    form.append('url', spotifyUrl)
    form.append('g-recaptcha-response', '')
    for (const field of session.hiddenFields) {
        form.append(field.name, field.value)
    }

    const res = await fetch(ACTION_URL, {
        method: 'POST',
        headers: {
            ...PAGE_HEADERS,
            Origin: BASE_URL,
            Referer: ENTRY_URL,
            Cookie: session.cookie
        },
        body: form
    })

    if (!res.ok) {
        throw new Error(`SpotiDown action HTTP ${res.status}`)
    }

    const payload = await res.json()
    if (payload?.error) {
        throw new Error(String(payload.message || 'Gagal resolve Spotify track di SpotiDown'))
    }

    const parsed = parseResponse(payload.data)
    if (!parsed.data || !parsed.base || !parsed.token) {
        throw new Error('Payload track SpotiDown tidak lengkap')
    }

    const formTrack = new FormData()
    formTrack.append('data', parsed.data)
    formTrack.append('base', parsed.base)
    formTrack.append('token', parsed.token)

    const trackRes = await fetch(TRACK_ACTION_URL, {
        method: 'POST',
        headers: {
            ...PAGE_HEADERS,
            Origin: BASE_URL,
            Referer: ENTRY_URL,
            Cookie: session.cookie
        },
        body: formTrack
    })

    if (!trackRes.ok) {
        throw new Error(`SpotiDown track HTTP ${trackRes.status}`)
    }

    const trackPayload = await trackRes.json()
    if (trackPayload?.error) {
        throw new Error(String(trackPayload.message || 'Gagal ambil MP3 dari SpotiDown'))
    }

    const finalParsed = parseResponse(trackPayload.data)
    if (!finalParsed.downloadUrl) {
        throw new Error('Link MP3 SpotiDown tidak ditemukan')
    }

    return {
        id: extractId(spotifyUrl),
        title: finalParsed.title || parsed.title,
        artists: finalParsed.artists || parsed.artists,
        album: parsed.album || finalParsed.album || finalParsed.title || parsed.title,
        duration: parsed.duration || finalParsed.duration || 0,
        durationFormatted: parsed.durationFormatted || finalParsed.durationFormatted || '',
        releaseDate: parsed.releaseDate || finalParsed.releaseDate || '',
        cover: finalParsed.cover || parsed.cover,
        downloadUrl: finalParsed.downloadUrl,
        coverUrl: finalParsed.coverUrl,
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
        duration: data.duration,
        durationFormatted: data.durationFormatted,
        releaseDate: data.releaseDate,
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
        album: data.album,
        duration: data.duration,
        durationFormatted: data.durationFormatted,
        releaseDate: data.releaseDate,
        cover: data.cover
    }
}

export { searchTracks, download, downloadBuffer, getMetadata }
