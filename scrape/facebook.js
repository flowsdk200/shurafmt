import axios from 'axios'

const BASE_URL = 'https://y2date.com'
const ENDPOINT = `${BASE_URL}/wp-json/aio-dl/video-data/`
const DEFAULT_TOKEN = '3ecace38ab99d0aa20f9560f0c9703787d4957d34d2a2d42bfe5b447f397e03c'

const HEADERS = {
    accept: '*/*',
    'accept-language': 'id-ID,id;q=0.9,en-US;q=0.8,en;q=0.7',
    origin: BASE_URL,
    referer: `${BASE_URL}/facebook-video-downloader/`,
    'sec-ch-ua': '"Not:A-Brand";v="99", "Google Chrome";v="145", "Chromium";v="145"',
    'sec-ch-ua-mobile': '?0',
    'sec-ch-ua-platform': '"Windows"',
    'sec-fetch-dest': 'empty',
    'sec-fetch-mode': 'cors',
    'sec-fetch-site': 'same-origin',
    'user-agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/145.0.0.0 Safari/537.36',
    'content-type': 'application/x-www-form-urlencoded'
}

const toUrl = (input = '') => {
    const trimmed = String(input || '').trim()
    if (!trimmed) return ''
    return trimmed.includes('://') ? trimmed : `https://${trimmed}`
}

export const isFacebookUrl = (input = '') => {
    try {
        const url = new URL(toUrl(input))
        const host = url.hostname.toLowerCase()
        return (
            host === 'facebook.com' ||
            host === 'fb.com' ||
            host === 'fb.watch' ||
            host.endsWith('.facebook.com') ||
            host.endsWith('.fb.com')
        )
    } catch {
        return false
    }
}

const buildPayload = (url, token) => new URLSearchParams({
    url,
    token
}).toString()

const normalizeError = (data, status) => {
    if (!data) return `Gagal mengambil data dari y2date (${status || 'unknown'})`
    if (typeof data === 'string') return data
    if (data?.message) return data.message
    if (data?.error) return data.error
    if (data?.code && data?.data?.message) return data.data.message
    if (data?.code) return `${data.code}: ${data.message || 'Parameter tidak valid'}`
    return `Gagal mengambil data dari y2date (${status || 'unknown'})`
}

const pickBestMedia = (medias = []) => {
    const candidates = medias.filter((m) => String(m?.url || '').startsWith('http'))
    if (!candidates.length) return null

    const qualityScore = (q = '') => {
        const norm = String(q).toLowerCase()
        if (norm === 'hd') return 3
        if (norm === 'sd') return 2
        if (norm.includes('1080')) return 3
        if (norm.includes('720')) return 2
        if (norm.includes('480')) return 1.8
        if (norm.includes('360')) return 1.2
        return 1
    }

    return candidates
        .filter((m) => String(m.extension || '').toLowerCase() === 'mp4')
        .sort((a, b) => {
            const qa = qualityScore(a.quality) + (Number(a.size || 0) > 0 ? (Math.log10(Number(a.size || 1)) - 1) * 0.02 : 0)
            const qb = qualityScore(b.quality) + (Number(b.size || 0) > 0 ? (Math.log10(Number(b.size || 1)) - 1) * 0.02 : 0)
            return qb - qa
        })[0] || candidates[0]
}

export const getVideo = async (url, options = {}) => {
    const input = String(url || '').trim()
    if (!input) throw new Error('URL Facebook tidak boleh kosong')

    const normalizedUrl = toUrl(input)
    if (!isFacebookUrl(normalizedUrl)) throw new Error('Link Facebook tidak valid')

    const token = options?.token || process.env.Y2DATE_TOKEN || DEFAULT_TOKEN
    if (!token) throw new Error('Token y2date tidak ditemukan')

    const response = await axios.post(
        ENDPOINT,
        buildPayload(normalizedUrl, token),
        {
            timeout: 60000,
            headers: HEADERS,
            maxRedirects: 5,
            validateStatus: () => true
        }
    )

    if (response.status >= 400) {
        throw new Error(normalizeError(response.data, response.status))
    }

    const data = response?.data
    if (!data || typeof data !== 'object') {
        throw new Error(normalizeError(data, response.status))
    }

    if (data.error || data.code) {
        throw new Error(normalizeError(data, response.status))
    }

    const medias = Array.isArray(data.medias) ? data.medias : []
    const bestMedia = pickBestMedia(medias)

    return {
        source: data.source || 'facebook',
        rawUrl: data.url || normalizedUrl,
        title: data.title || 'Facebook Video',
        author: data.author || data.uploader || data.owner || '',
        caption: data.caption || data.description || data.text || data.title || '',
        thumbnail: data.thumbnail || '',
        duration: data.duration || null,
        medias,
        bestMedia
    }
}

export default {
    getVideo,
    isFacebookUrl
}
