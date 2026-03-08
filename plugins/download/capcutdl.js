import { gotScraping } from 'got-scraping'
import { CookieJar } from 'tough-cookie'

const ENTRY_URL = 'https://3bic.com/id'
const API_URL = 'https://3bic.com/api/download'
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

const toAbsoluteUrl = (baseUrl, maybeUrl) => {
    try {
        return new URL(String(maybeUrl || ''), baseUrl).toString()
    } catch {
        return ''
    }
}

const create3bicClient = () => {
    const cookieJar = new CookieJar()
    return gotScraping.extend({
        cookieJar,
        throwHttpErrors: false,
        responseType: 'text',
        timeout: { request: REQUEST_TIMEOUT },
        retry: { limit: 0 },
        followRedirect: true
    })
}

const warmup3bic = async (client) => {
    const { statusCode } = await client(ENTRY_URL, {
        headers: {
            'User-Agent': USER_AGENT,
            'Accept-Language': 'id-ID,id;q=0.9,en-US;q=0.8,en;q=0.7',
            Accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8'
        }
    })

    if (statusCode !== 200) throw new Error(`3Bic entry HTTP ${statusCode}`)
}

const fetchCapcutData = async (pageUrl) => {
    const client = create3bicClient()
    await warmup3bic(client)

    const { statusCode, body, headers } = await client.post(API_URL, {
        json: { url: pageUrl },
        headers: {
            'User-Agent': USER_AGENT,
            Accept: 'application/json,text/plain,*/*',
            'Content-Type': 'application/json',
            Origin: 'https://3bic.com',
            Referer: ENTRY_URL
        }
    })

    const rawBody = String(body || '')
    let payload
    try {
        payload = JSON.parse(rawBody)
    } catch {
        const contentType = String(headers?.['content-type'] || '').toLowerCase()
        if (contentType.includes('text/html') || /just a moment|cf-browser-verification|challenge-platform/i.test(rawBody)) {
            throw new Error('3Bic kena Cloudflare challenge.')
        }

        throw new Error('Gagal parse respons 3Bic.')
    }

    if (statusCode >= 400) {
        throw new Error(cleanText(payload?.message || payload?.error) || `HTTP ${statusCode}`)
    }

    if (Number(payload?.code) !== 200) {
        throw new Error(cleanText(payload?.message || payload?.error) || '3Bic gagal memproses link CapCut.')
    }

    payload.originalVideoUrl = toAbsoluteUrl('https://3bic.com', payload?.originalVideoUrl)
    payload.coverUrl = toAbsoluteUrl('https://3bic.com', payload?.coverUrl)

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

const fetchRemoteSize = async (url) => {
    const target = cleanText(url)
    if (!/^https?:\/\//i.test(target)) return ''

    try {
        const { headers, statusCode } = await gotScraping(target, {
            method: 'HEAD',
            throwHttpErrors: false,
            timeout: { request: REQUEST_TIMEOUT },
            retry: { limit: 0 },
            followRedirect: true,
            headers: {
                'User-Agent': USER_AGENT,
                Referer: ENTRY_URL
            }
        })

        if (statusCode < 200 || statusCode >= 400) return ''
        return formatSize(headers?.['content-length'])
    } catch {
        return ''
    }
}

const buildCaption = (detail, result, sizeText) => {
    if (detail) {
        return (
            `\`Author: ${cleanText(detail?.author?.name) || cleanText(result?.authorName) || '-'}\`\n\n` +
            `${cleanText(detail?.title) || cleanText(result?.title) || '-'}\n\n` +
            `\`\`\`• Duration: ${formatDuration(detail?.templateDuration)}\`\`\`\n` +
            `\`\`\`• Plays: ${formatNumber(detail?.playAmount)}\n` +
            `• Usage: ${formatNumber(detail?.usageAmount)}\n` +
            `• Likes: ${formatNumber(detail?.likeAmount)}\n` +
            `• Comments: ${formatNumber(detail?.commentAmount)}\`\`\``
        )
    }

    return (
        `\`Author: ${cleanText(result?.authorName) || '-'}\`\n\n` +
        `${cleanText(result?.title) || '-'}\n\n` +
        `\`\`\`• Duration: -\`\`\`\n` +
        `\`\`\`• Source: 3Bic\n` +
        `• Format: MP4\n` +
        `• Size: ${sizeText || '-'}\`\`\``
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
            const videoUrl = cleanText(result?.originalVideoUrl)
            if (!videoUrl) {
                await react('❌')
                return sock.sendMessage(jid, {
                    text: '❌ Video capcut tidak ditemukan dari link tersebut.'
                }, { quoted: msg })
            }

            const sizeText = await fetchRemoteSize(videoUrl)

            await sock.sendMessage(jid, {
                video: { url: videoUrl },
                mimetype: 'video/mp4',
                caption: buildCaption(detail, result, sizeText)
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
