import axios from 'axios'
import { gotScraping } from 'got-scraping'

const ENTRY_URL = 'https://anydownloader.com/en/'
const API_URL = 'https://anydownloader.com/wp-json/api/download/'
const USER_AGENT = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36'
const REQUEST_TIMEOUT = 120000

const cleanText = (value) => String(value || '').replace(/\s+/g, ' ').trim()

const normalizeCapcutUrl = (input) => {
    const text = cleanText(input)
    if (!text) return ''

    const idOnly = text.match(/^[A-Za-z0-9_-]{6,}$/)?.[0]
    if (idOnly) return `https://www.capcut.com/tv2/${idOnly}/`

    if (!/^https?:\/\//i.test(text)) return ''

    try {
        const parsed = new URL(text)

        if (/(^|\.)anydownloader\.com$/i.test(parsed.hostname) && parsed.hash.startsWith('#url=')) {
            const inner = decodeURIComponent(parsed.hash.slice(5))
            return normalizeCapcutUrl(inner)
        }

        if (!/(^|\.)capcut\.com$/i.test(parsed.hostname)) return ''

        const tv2 = parsed.pathname.match(/\/tv2\/([A-Za-z0-9_-]+)/i)?.[1]
        if (tv2) return `https://www.capcut.com/tv2/${tv2}/`

        const shortPath = parsed.pathname.match(/\/t\/([A-Za-z0-9_-]+)/i)?.[1]
        if (shortPath) return `https://www.capcut.com/tv2/${shortPath}/`

        const topLevel = parsed.pathname.match(/^\/([A-Za-z0-9_-]{6,})\/?$/)?.[1]
        if (topLevel) return `https://www.capcut.com/tv2/${topLevel}/`

        return ''
    } catch {
        return ''
    }
}

const calculateHash = (url) => Buffer.from(url).toString('base64') + (url.length + 1000) + Buffer.from('api').toString('base64')

const toAbsoluteUrl = (baseUrl, maybeUrl) => {
    try {
        return new URL(String(maybeUrl || ''), baseUrl).toString()
    } catch {
        return ''
    }
}

const fetchEntryToken = async () => {
    const { data } = await axios.get(ENTRY_URL, {
        timeout: REQUEST_TIMEOUT,
        headers: {
            'User-Agent': USER_AGENT,
            'Accept-Language': 'en-US,en;q=0.9',
            Accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8'
        }
    })

    const html = String(data || '')
    const token = html.match(/id="token"[^>]+value="([^"]+)"/i)?.[1] || ''

    if (!token) throw new Error('Gagal mengambil token AnyDownloader.')
    return token
}

const fetchCapcutData = async (pageUrl) => {
    const token = await fetchEntryToken()
    const response = await axios.post(API_URL, new URLSearchParams({
        url: pageUrl,
        token,
        hash: calculateHash(pageUrl)
    }).toString(), {
        timeout: REQUEST_TIMEOUT,
        validateStatus: () => true,
        headers: {
            'User-Agent': USER_AGENT,
            Accept: 'application/json,text/plain,*/*',
            'Content-Type': 'application/x-www-form-urlencoded',
            Origin: 'https://anydownloader.com',
            Referer: ENTRY_URL
        }
    })

    const payload = typeof response.data === 'string'
        ? JSON.parse(response.data || '{}')
        : response.data

    if (response.status >= 400) {
        throw new Error(cleanText(payload?.error) || `HTTP ${response.status}`)
    }

    if (payload?.error) {
        throw new Error(cleanText(payload.error))
    }

    if (cleanText(payload?.source).toLowerCase() !== 'capcut') {
        throw new Error('Respons AnyDownloader bukan sumber CapCut.')
    }

    return payload
}

const resolveTemplateDetailUrl = async (pageUrl) => {
    const { statusCode, headers, body, url } = await gotScraping(pageUrl, {
        throwHttpErrors: false,
        timeout: { request: REQUEST_TIMEOUT },
        retry: { limit: 0 },
        followRedirect: false,
        headers: {
            'User-Agent': USER_AGENT,
            'Accept-Language': 'id-ID,id;q=0.9,en-US;q=0.8,en;q=0.7',
            Accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8'
        }
    })

    const redirected = toAbsoluteUrl(pageUrl, headers?.location)
    if (statusCode >= 300 && statusCode < 400 && redirected && /\/template-detail\//i.test(redirected)) {
        return redirected
    }

    const finalUrl = cleanText(url)
    if (/\/template-detail\//i.test(finalUrl)) return finalUrl

    const html = String(body || '')
    const fromFound = html.match(/https?:\/\/www\.capcut\.com\/template-detail\/[^"'&\s<]+(?:\?[^"'<> ]+)?/i)?.[0]
    if (fromFound) return fromFound

    const canonical = html.match(/<link[^>]+rel=["']canonical["'][^>]+href=["']([^"']+)["']/i)?.[1]
    const canonicalAbs = toAbsoluteUrl(pageUrl, canonical)
    if (/\/template-detail\//i.test(canonicalAbs)) return canonicalAbs

    const fallbackUrl = toAbsoluteUrl(pageUrl, headers?.location || finalUrl)
    if (/\/template-detail\//i.test(fallbackUrl)) return fallbackUrl

    throw new Error('Gagal menemukan URL template-detail CapCut')
}

const fetchTemplateDetail = async (pageUrl) => {
    const templateUrl = await resolveTemplateDetailUrl(pageUrl)
    const loaderUrl = new URL(templateUrl)
    loaderUrl.searchParams.set('__loader', 'template-detail_$')
    loaderUrl.searchParams.set('__ssrDirect', 'true')

    const { statusCode, headers, body } = await gotScraping(loaderUrl.toString(), {
        throwHttpErrors: false,
        timeout: { request: REQUEST_TIMEOUT },
        retry: { limit: 0 },
        followRedirect: true,
        headers: {
            'User-Agent': USER_AGENT,
            'Accept-Language': 'id-ID,id;q=0.9,en-US;q=0.8,en;q=0.7',
            Accept: 'application/json,text/plain,*/*'
        }
    })

    if (statusCode !== 200) throw new Error(`CapCut loader HTTP ${statusCode}`)

    const contentType = String(headers?.['content-type'] || '').toLowerCase()
    if (!contentType.includes('application/json')) throw new Error('Loader CapCut tidak mengembalikan JSON')

    let parsed
    try {
        parsed = JSON.parse(String(body || '{}'))
    } catch {
        throw new Error('Gagal parse JSON loader CapCut')
    }

    const detail = parsed?.templateDetail
    if (!detail) throw new Error('Template detail tidak ditemukan dari loader')
    return detail
}

const isDirectVideo = (media) => {
    const extension = cleanText(media?.extension).toLowerCase()
    const url = cleanText(media?.url).toLowerCase()
    return extension === 'mp4' && /^https?:\/\//i.test(url) && !url.includes('.m3u8')
}

const extractResolution = (quality) => {
    const text = cleanText(quality).toLowerCase()
    if (text.includes('4k') || text.includes('2160')) return 2160
    if (text.includes('2k') || text.includes('1440')) return 1440
    if (text.includes('1080')) return 1080
    if (text.includes('720')) return 720
    return 0
}

const scoreMedia = (media) => {
    const quality = cleanText(media?.quality).toLowerCase()
    let score = Number(media?.size || 0)

    if (quality.includes('no watermark') || quality.includes('no-watermark') || quality.includes('nowatermark') || quality.includes(' nw')) {
        score += 10_000_000
    }

    score += extractResolution(quality) * 1_000
    return score
}

const formatNumber = (value) => {
    const numeric = Number(value || 0)
    if (!Number.isFinite(numeric) || numeric < 0) return '0'
    if (numeric >= 1_000_000_000) return `${Number((numeric / 1_000_000_000).toFixed(1)).toString().replace(/\.0$/, '')}B`
    if (numeric >= 1_000_000) return `${Number((numeric / 1_000_000).toFixed(1)).toString().replace(/\.0$/, '')}M`
    if (numeric >= 1_000) return `${Number((numeric / 1_000).toFixed(1)).toString().replace(/\.0$/, '')}K`
    return String(Math.floor(numeric))
}

const formatDuration = (secValue) => {
    const raw = Number(secValue || 0)
    if (!Number.isFinite(raw) || raw < 0) return '-'
    const total = Math.floor(raw >= 1000 ? raw / 1000 : raw)
    const minutes = Math.floor(total / 60)
    const seconds = String(total % 60).padStart(2, '0')
    if (minutes < 60) return `${minutes}:${seconds}`
    const hours = Math.floor(minutes / 60)
    const mm = String(minutes % 60).padStart(2, '0')
    return `${hours}:${mm}:${seconds}`
}

const pickBestVideo = (medias) => {
    const items = Array.isArray(medias) ? medias.filter(isDirectVideo) : []
    if (!items.length) return null
    return items.slice().sort((a, b) => scoreMedia(b) - scoreMedia(a))[0] || null
}

const formatSize = (value, fallback = '') => {
    const numeric = Number(value || 0)
    if (numeric > 0 && Number.isFinite(numeric)) {
        if (numeric >= 1024 * 1024 * 1024) return `${(numeric / (1024 * 1024 * 1024)).toFixed(2)} GB`
        if (numeric >= 1024 * 1024) return `${(numeric / (1024 * 1024)).toFixed(2)} MB`
        if (numeric >= 1024) return `${(numeric / 1024).toFixed(2)} KB`
        return `${numeric} B`
    }

    return cleanText(fallback) || '-'
}

const buildCaption = (detail, result, media) => {
    if (detail) {
        return (
            `\`Author: ${cleanText(detail?.author?.name) || '-'}\`\n\n` +
            `${cleanText(detail?.title) || cleanText(result?.title) || '-'}\n\n` +
            `\`\`\`• Duration: ${formatDuration(detail?.templateDuration)}\`\`\`\n` +
            `\`\`\`• Plays: ${formatNumber(detail?.playAmount)}\n` +
            `• Usage: ${formatNumber(detail?.usageAmount)}\n` +
            `• Likes: ${formatNumber(detail?.likeAmount)}\n` +
            `• Comments: ${formatNumber(detail?.commentAmount)}\`\`\``
        )
    }

    return (
        `\`Author: -\`\n\n` +
        `${cleanText(result?.title) || '-'}\n\n` +
        `\`\`\`• Duration: -\`\`\`\n` +
        `\`\`\`• Source: ${cleanText(result?.source) || '-'}\n` +
        `• Quality: ${cleanText(media?.quality) || '-'}\n` +
        `• Format: ${cleanText(media?.extension).toUpperCase() || '-'}\n` +
        `• Size: ${formatSize(media?.size, media?.formattedSize)}\`\`\``
    )
}

export default {
    name: 'capcut',
    aliases: ['capcutdl', 'ccdl', 'capcutdownload'],
    description: 'Download video template capcut',
    execute: async ({ sock, msg, text, prefix, command, react, useLimit }) => {
        const jid = msg.key.remoteJid
        const pageUrl = normalizeCapcutUrl(text)

        if (!pageUrl) {
            return sock.sendMessage(jid, {
                text: `Contoh penggunaan:\n- ${prefix + command} https://www.capcut.com/tv2/ZSuecoHjU/`
            }, { quoted: msg })
        }

        await react('⏳')

        try {
            const [result, detail] = await Promise.all([
                fetchCapcutData(pageUrl),
                fetchTemplateDetail(pageUrl).catch(() => null)
            ])
            const media = pickBestVideo(result?.medias)

            if (!media?.url) {
                await react('❌')
                return sock.sendMessage(jid, {
                    text: '❌ Video capcut tidak ditemukan dari link tersebut.'
                }, { quoted: msg })
            }

            await sock.sendMessage(jid, {
                video: { url: media.url },
                mimetype: 'video/mp4',
                caption: buildCaption(detail, result, media)
            }, { quoted: msg })

            useLimit()
            await react('✅')
        } catch (err) {
            await react('❌')
            await sock.sendMessage(jid, {
                text: `❌ Error: ${err.message}`
            }, { quoted: msg })
        }
    }
}
