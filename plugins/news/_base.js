import axios from 'axios'

const API_BASE = 'https://berita-indo-api-next.vercel.app/api'
const USER_AGENT = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36'
const DEFAULT_LIMIT = 10
const MAX_LIMIT = 10
const VIDEO_EXT_RE = /\.(3gp|avi|flv|m4v|mkv|mov|mp4|mpg|mpeg|m3u8|webm|wmv|ogv)(\?|$)/i
const IMAGE_EXT_RE = /\.(jpe?g|png|webp|gif|bmp|svg|avif|heic|heif|ico)(\?|$)/i

const normalizeText = (value) => String(value || '').trim().toLowerCase()

const toNewsDate = (value) => {
    if (!value) return '-'

    const parsed = new Date(value)
    if (Number.isNaN(parsed.getTime())) return String(value)

    return parsed.toLocaleString('id-ID', {
        timeZone: 'Asia/Jakarta',
        year: 'numeric',
        month: '2-digit',
        day: '2-digit',
        hour: '2-digit',
        minute: '2-digit',
        hour12: false
    })
}

const stripHtml = (value) => {
    if (!value) return ''
    return String(value)
        .replace(/<[^>]*>/g, ' ')
        .replace(/&nbsp;/gi, ' ')
        .replace(/&amp;/g, '&')
        .replace(/&lt;/g, '<')
        .replace(/&gt;/g, '>')
        .replace(/&quot;/g, '"')
        .replace(/&#39;/g, "'")
        .replace(/\s+/g, ' ')
        .trim()
}

const truncate = (text, max = 180) => {
    const value = String(text || '').trim()
    if (!value) return '-'
    return value.length > max ? `${value.slice(0, max)}...` : value
}

const isImageUrl = (value) => {
    const url = String(value || '').trim()
    if (!url) return false
    if (!url.startsWith('http://') && !url.startsWith('https://') && !url.startsWith('//')) return false
    if (VIDEO_EXT_RE.test(url.toLowerCase())) return false

    try {
        const parsed = new URL(url.startsWith('//') ? `https:${url}` : url)
        if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') return false

        const path = parsed.pathname.toLowerCase()
        const looksLikeImageExt = /\.(jpe?g|png|webp|gif|bmp|svg|avif|heic|heif|ico)$/.test(path) ||
            /\.(jpe?g|png|webp|gif|bmp|svg|avif|heic|heif|ico)\?/.test(parsed.pathname.toLowerCase() + parsed.search.toLowerCase())
            || (parsed.search && /\.(jpe?g|png|webp|gif|bmp|svg)/i.test(parsed.search))

        const hasDataPath = /\/image\//i.test(path) ||
            /\/img\//i.test(path) ||
            /\/media\/(images?|photos?)\//i.test(path) ||
            /\/thumb(?:nail)?\//i.test(path) ||
            /\/photo(?:s)?\//i.test(path)

        return looksLikeImageExt || hasDataPath
    } catch {
        return false
    }
}

const isImageContentType = async (url) => {
    try {
        const head = await axios.head(url, {
            timeout: 8000,
            headers: { 'User-Agent': USER_AGENT },
            validateStatus: () => true,
            maxRedirects: 5
        })

        if (head.status < 200 || head.status >= 400) return false
        const type = String(head.headers['content-type'] || '').toLowerCase()
        if (!type) return false
        if (type.startsWith('video/')) return false
        return type.startsWith('image/')
    } catch {
        return false
    }
}

const isSupportedImage = async (value) => {
    const url = String(value || '').trim()
    if (!isImageUrl(url)) return false
    if (IMAGE_EXT_RE.test(url.toLowerCase())) return true

    return isImageContentType(url)
}

const makeAbsoluteUrl = (value, baseUrl) => {
    const url = String(value || '').trim()
    if (!url) return null
    if (url.startsWith('//')) return `https:${url}`

    if (url.startsWith('http://') || url.startsWith('https://')) return url

    if (!baseUrl) return null
    try {
        return new URL(url, baseUrl).href
    } catch {
        return null
    }
}

const extractImageFromHtml = (html, baseUrl) => {
    if (!html) return null

    const patterns = [
        /<meta[^>]+(?:property|name)=["']og:image(?:.*?)["'][^>]*content=["']([^"']+)["']/i,
        /<meta[^>]+(?:property|name)=["']twitter:image(?:.*?)["'][^>]*content=["']([^"']+)["']/i,
        /<meta[^>]+itemprop=["']image["'][^>]*content=["']([^"']+)["']/i
    ]

    for (const pattern of patterns) {
        const match = html.match(pattern)
        if (match?.[1]) {
            const candidate = makeAbsoluteUrl(match[1], baseUrl)
            if (candidate && isImageUrl(candidate)) return candidate
        }
    }

    const jsonLdMatches = html.match(/<script[^>]*type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi)
    if (jsonLdMatches?.length) {
        for (const block of jsonLdMatches) {
            const content = block
                .replace(/^[\s\S]*?>/i, '')
                .replace(/<\/script>$/i, '')
                .trim()

            try {
                const parsed = JSON.parse(content)
                const firstImage = Array.isArray(parsed)
                    ? parsed.find((item) => item?.image)?.image
                    : parsed?.image

                const img = Array.isArray(firstImage) ? firstImage[0] : firstImage
                const candidate = makeAbsoluteUrl(img, baseUrl)
                if (candidate && isImageUrl(candidate)) return candidate
            } catch { }
        }
    }

    const imageMatch = html.match(/<img[^>]+src=["']([^"']+)["'][^>]*>/i)
    if (imageMatch?.[1]) {
        const candidate = makeAbsoluteUrl(imageMatch[1], baseUrl)
        if (candidate && isImageUrl(candidate)) return candidate
    }

    return null
}

const resolveImageFromPage = async (item) => {
    if (!item?.link) return null
    try {
        const { data } = await axios.get(item.link, {
            timeout: 15000,
            headers: {
                'User-Agent': USER_AGENT
            },
            validateStatus: () => true
        })

        if (typeof data !== 'string') return null
        return extractImageFromHtml(data, item.link)
    } catch {
        return null
    }
}

const pickFirstImage = (item) => {
    if (!item) return null
    const candidates = []

    if (typeof item.image === 'string') candidates.push(item.image)
    if (typeof item.image === 'object' && item.image) {
        if (item.image.small) candidates.push(item.image.small)
        if (item.image.medium) candidates.push(item.image.medium)
        if (item.image.large) candidates.push(item.image.large)
    }

    if (item.thumbnail) candidates.push(item.thumbnail)
    if (item.enclosure?.url) candidates.push(item.enclosure.url)
    if (item.media?.thumbnail?.url) candidates.push(item.media.thumbnail.url)

    const normalized = candidates
        .map((value) => String(value || '').trim())
        .filter(Boolean)
        .filter((url) => isImageUrl(url))

    if (!normalized.length) return null
    return normalized[0]
}

const toNewsArray = (raw) => {
    if (!raw) return []
    if (Array.isArray(raw)) return raw.filter(Boolean)

    if (raw.data) {
        const fromData = toNewsArray(raw.data)
        if (fromData.length) return fromData
    }

    return Object.values(raw)
        .filter((value) => value && typeof value === 'object' && (value.title || value.judul))
}

const parseArgs = ({ args = [], requiresType = false }) => {
    const normalized = args.map((arg) => String(arg || '').trim()).filter(Boolean)
    const values = requiresType ? normalized.slice(1) : normalized

    const result = {
        type: '',
        page: 1,
        limit: DEFAULT_LIMIT
    }

    if (!normalized.length) return result

    if (requiresType) {
        const [first] = normalized
        result.type = normalizeText(first)
    }

    for (const token of values) {
        const lower = normalizeText(token)

        if (lower.startsWith('page=')) {
            const p = Number(lower.replace('page=', ''))
            if (Number.isInteger(p) && p >= 1) {
                result.page = p
            }
            continue
        }

        if (lower.startsWith('limit=')) {
            const l = Number(lower.replace('limit=', ''))
            if (Number.isInteger(l) && l > 0) {
                result.limit = Math.min(MAX_LIMIT, Math.max(1, l))
            }
            continue
        }

        const num = Number(lower)
        if (Number.isInteger(num) && num > 0) {
            result.limit = Math.min(MAX_LIMIT, num)
        }
    }

    return result
}

const fetchNews = async (path, type, page = 1) => {
    const url = `${API_BASE}/${[path, type].filter(Boolean).join('/')}`
    const { data, status } = await axios.get(url, {
        timeout: 120000,
        params: { page },
        headers: { 'User-Agent': USER_AGENT },
        validateStatus: () => true
    })

    if (status >= 400) {
        throw new Error('Endpoint tidak valid atau sedang bermasalah.')
    }

    return {
        items: toNewsArray(data),
        total: Number(data?.total) || toNewsArray(data)?.length || 0
    }
}

const formatItem = (item) => {
    const title = String(item.title || item.judul || '-').trim().replace(/\n/g, ' ')
    const desc = truncate(stripHtml(item.content || item.description || item.contentSnippet || item.excerpt || item.summary), 150)
    const rawDate = item.isoDate || item.pubDate || item.publishedAt || item.tanggal

    return (
        `${title}\n` +
        `× Tanggal: ${toNewsDate(rawDate)}\n` +
        `× Link: ${String(item.link || item.url || '-')}`
        + `\n× Deskripsi: ${desc}`
    )
}

const formatList = (items, limit) => {
    const visible = items.slice(0, limit)
    const rows = visible
        .map((item, i) => `${i + 1}. ${formatItem(item)}`)
        .join('\n\n')
    return rows
}

const findTopImage = async (items, limit = 1) => {
    const maxLookup = Math.min(items.length, Math.max(5, Math.min(limit, MAX_LIMIT)))
    const candidates = items.slice(0, maxLookup)
    for (const item of candidates) {
        const direct = pickFirstImage(item)
        if (await isSupportedImage(direct)) return direct

        const fromPage = await resolveImageFromPage(item)
        if (await isSupportedImage(fromPage)) return fromPage
    }

    return null
}

const sendNews = async ({ sock, jid, sourceLabel, typeLabel, items, limit, total, msg }) => {
    const top = await findTopImage(items, limit)
    const title = `📰 ${sourceLabel}`
    const sub = `${typeLabel ? `• Kategori: ${typeLabel}` : '• Semua kategori'}\n• Menampilkan: ${Math.min(limit, items.length)} dari ${total}`
    const text = `\`\`\`${formatList(items, limit)}\`\`\``

    const imagePayload = top
        ? { image: { url: top } }
        : null

    if (imagePayload && imagePayload.image) {
        return sock.sendMessage(jid, {
            ...imagePayload,
            caption: text
        }, { quoted: msg })
    }

    throw new Error(`Tidak ada gambar yang valid untuk ${sourceLabel}.`)
}

export const createNewsCommand = ({
    name,
    aliases = [],
    description,
    path,
    categories = [],
    requiresType = false
}) => ({
    name,
    aliases,
    description,
    execute: async ({ sock, msg, args, react, useLimit, config }) => {
        const jid = msg.key.remoteJid
        const parsed = parseArgs({ args, requiresType })
        let type = parsed.type

        if (requiresType && !type) {
            type = categories[0] || ''
        }

        if (type && categories.length > 0 && !categories.includes(type)) {
            return sock.sendMessage(jid, {
                text: `❌ Kategori \"${type}\" tidak valid untuk ${description}.\nKategori: ${categories.join(', ')}`
            }, { quoted: msg })
        }

        await react('⏳')

        try {
            const { items, total } = await fetchNews(path, type, parsed.page)

            if (!items.length) {
                await react('❌')
                return sock.sendMessage(jid, {
                    text: `⚠️ Tidak ada berita ditemukan dari ${description}.`
                }, { quoted: msg })
            }

            await sendNews({
                sock,
                jid,
                sourceLabel: description,
                typeLabel: type || 'terbaru',
                items,
                limit: parsed.limit,
                total,
                msg
            })

            useLimit()
            await react('✅')
        } catch (err) {
            await react('❌')
            await sock.sendMessage(jid, {
                text: `❌ Gagal ambil berita ${description}: ${err.message}`
            }, { quoted: msg })
        }
    }
})
