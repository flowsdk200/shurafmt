import { gotScraping } from 'got-scraping'

const REQUEST_TIMEOUT = 30000

const cleanText = (value) => String(value || '')
    .replace(/\s+/g, ' ')
    .trim()

const normalizeCapcutUrl = (input) => {
    const text = cleanText(input)
    if (!text) return ''

    const idOnly = text.match(/^[A-Za-z0-9_-]{6,}$/)?.[0]
    if (idOnly) return `https://www.capcut.com/tv2/${idOnly}/`

    if (!/^https?:\/\//i.test(text)) return ''

    try {
        const u = new URL(text)
        if (!/(^|\.)capcut\.com$/i.test(u.hostname)) return ''

        const m = u.pathname.match(/\/tv2\/([A-Za-z0-9_-]+)/i)
        if (m?.[1]) return `https://www.capcut.com/tv2/${m[1]}/`

        const tPath = u.pathname.match(/\/t\/([A-Za-z0-9_-]+)/i)
        if (tPath?.[1]) return `https://www.capcut.com/tv2/${tPath[1]}/`

        const shortId = u.pathname.match(/^\/([A-Za-z0-9_-]{6,})\/?$/)?.[1]
        if (shortId) return `https://www.capcut.com/tv2/${shortId}/`

        if (/\/template-detail\//i.test(u.pathname)) return u.toString()

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

const resolveTemplateDetailUrl = async (pageUrl) => {
    const { statusCode, headers, body, url } = await gotScraping(pageUrl, {
        throwHttpErrors: false,
        timeout: { request: REQUEST_TIMEOUT },
        retry: { limit: 0 },
        followRedirect: false,
        headers: {
            'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
            'Accept-Language': 'id-ID,id;q=0.9,en-US;q=0.8,en;q=0.7',
            'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8'
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
            'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
            'Accept-Language': 'id-ID,id;q=0.9,en-US;q=0.8,en;q=0.7',
            'Accept': 'application/json,text/plain,*/*'
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

    const previewUrl = cleanText(detail?.videoUrl || detail?.structuredData?.contentUrl)
    if (!previewUrl) throw new Error('Video template tidak ditemukan')

    return { detail, templateUrl, videoUrl: previewUrl }
}

const formatNumber = (value) => {
    const n = Number(value || 0)
    if (!Number.isFinite(n) || n < 0) return '0'
    if (n >= 1_000_000_000) return `${Number((n / 1_000_000_000).toFixed(1)).toString().replace(/\.0$/, '')}B`
    if (n >= 1_000_000) return `${Number((n / 1_000_000).toFixed(1)).toString().replace(/\.0$/, '')}M`
    if (n >= 1_000) return `${Number((n / 1_000).toFixed(1)).toString().replace(/\.0$/, '')}K`
    return String(Math.floor(n))
}

const formatDuration = (secValue) => {
    const raw = Number(secValue || 0)
    if (!Number.isFinite(raw) || raw < 0) return '-'
    const total = Math.floor(raw >= 1000 ? raw / 1000 : raw)
    const m = Math.floor(total / 60)
    const s = String(total % 60).padStart(2, '0')
    if (m < 60) return `${m}:${s}`
    const h = Math.floor(m / 60)
    const mm = String(m % 60).padStart(2, '0')
    return `${h}:${mm}:${s}`
}

const buildCaption = (detail, pageUrl) => {
    const title = cleanText(detail?.title) || '-'
    const author = cleanText(detail?.author?.name) || '-'
    const playAmount = formatNumber(detail?.playAmount)
    const usageAmount = formatNumber(detail?.usageAmount)
    const likeAmount = formatNumber(detail?.likeAmount)
    const commentAmount = formatNumber(detail?.commentAmount)
    const duration = formatDuration(detail?.templateDuration)
    const templateId = cleanText(detail?.templateId) || '-'

    return (
        `\`\`\`× Title: ${title}\n` +
        `× Duration: ${duration}\n` +
        `× Author: ${author}\n` +
        `× Plays: ${playAmount}\n` +
        `× Usage: ${usageAmount}\n` +
        `× Likes: ${likeAmount}\n` +
        `× Comments: ${commentAmount}\`\`\``
    )
}

export default {
    name: 'capcutdl',
    aliases: ['capcut', 'ccdl', 'capcutdownload'],
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
            const { detail, videoUrl, templateUrl } = await fetchTemplateDetail(pageUrl)
            const caption = buildCaption(detail, templateUrl || pageUrl)

            await sock.sendMessage(jid, {
                video: { url: videoUrl },
                mimetype: 'video/mp4',
                caption
            }, { quoted: msg })

            useLimit()
            await react('✅')
        } catch (err) {
            await react('❌')
            await sock.sendMessage(jid, {
                text: `❌ Error: ${err?.message}`
            }, { quoted: msg })
        }
    }
}
