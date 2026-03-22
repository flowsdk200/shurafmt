import axios from 'axios'
import { load } from 'cheerio'

const USER_AGENT = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36'
const DEFAULT_LIMIT = 10
const MAX_LIMIT = 10

const normalizeText = (value) => String(value || '').trim()

const toNewsDate = (value) => {
    if (!value) return '-'

    const parsed = new Date(value)
    if (Number.isNaN(parsed.getTime())) return normalizeText(value)

    return parsed.toLocaleString('id-ID', {
        timeZone: 'Asia/Jakarta',
        year: 'numeric',
        month: '2-digit',
        day: '2-digit',
        hour: '2-digit',
        minute: '2-digit',
        hour12: false,
    })
}

const decodeHtml = (value) => {
    if (!value) return ''

    return String(value)
        .replace(/&lt;/g, '<')
        .replace(/&gt;/g, '>')
        .replace(/&amp;/g, '&')
        .replace(/&quot;/g, '"')
        .replace(/&#39;/g, "'")
}

const stripHtml = (value) => {
    if (!value) return '-'

    const text = decodeHtml(String(value))
    return text
        .replace(/<script[^>]*>[\s\S]*?<\/script>/gi, '')
        .replace(/<[^>]+>/g, ' ')
        .replace(/\s+/g, ' ')
        .trim()
}

const truncate = (text, max = 150) => {
    const value = normalizeText(text)
    if (!value) return '-'
    return value.length > max ? `${value.slice(0, max)}...` : value
}

const normalizeImage = (url) => {
    const value = normalizeText(url)
    if (!value) return null
    if (!/^https?:\/\//i.test(value)) return null
    return value
}

const extractImageFromText = (text) => {
    if (!text) return null
    const decoded = decodeHtml(String(text))
    const imgsetMatch = decoded.match(/<img[^>]+srcset=["']([^"']+)["'][^>]*>/i)
    if (imgsetMatch?.[1]) {
        const first = imgsetMatch[1].split(',')[0]?.trim().split(' ')[0]
        if (first) return normalizeImage(first)
    }

    const imgMatch = decoded.match(/<img[^>]+src=["']([^"']+)["'][^>]*>/i)
    return normalizeImage(imgMatch?.[1])
}

const extractImageFromItemMarkup = (markup) => {
    const matchers = [
        /<media:thumbnail[^>]*\surl="([^"]+)"/i,
        /<media:content[^>]*\surl="([^"]+)"/i,
        /<enclosure[^>]*\surl="([^"]+)"/i,
        /<image>\s*<url>([^<]+)<\/url>/i,
    ]

    for (const re of matchers) {
        const match = markup.match(re)
        if (match?.[1]) {
            const normalized = normalizeImage(match[1])
            if (normalized) return normalized
        }
    }

    return null
}

const toAbsoluteUrl = (value, baseUrl) => {
    const url = normalizeText(value)
    if (!url) return null
    if (/^\/\//.test(url)) return `https:${url}`
    if (/^https?:\/\//i.test(url)) return url
    if (!baseUrl) return null

    try {
        return new URL(url, baseUrl).href
    } catch {
        return null
    }
}

const normalizeCandidateImage = (value, baseUrl = null) => {
    const url = normalizeImage(value)
    if (url) return toAbsoluteUrl(url, baseUrl)
    return null
}

const decodeHtmlForMarkup = (value) => {
    if (!value) return ''
    return decodeHtml(String(value))
}

const extractImageFromHtml = (html, baseUrl) => {
    if (!html) return null

    const decoded = decodeHtmlForMarkup(html)
    const patterns = [
        /<meta[^>]+(?:property|name)=["']og:image(?:.*?)["'][^>]*content=["']([^"']+)["']/i,
        /<meta[^>]+(?:property|name)=["']twitter:image(?:.*?)["'][^>]*content=["']([^"']+)["']/i,
        /<meta[^>]+itemprop=["']image["'][^>]*content=["']([^"']+)["']/i,
    ]

    for (const pattern of patterns) {
        const match = decoded.match(pattern)
        if (match?.[1]) {
            const candidate = normalizeCandidateImage(match[1], baseUrl)
            if (candidate) return candidate
        }
    }

    const imageMatch = decoded.match(/<img[^>]+src=["']([^"']+)["'][^>]*>/i)
    if (imageMatch?.[1]) {
        return normalizeCandidateImage(imageMatch[1], baseUrl)
    }

    return null
}

const extractImageFromItem = (item) => {
    const candidates = []

    if (item.image) candidates.push(item.image)
    if (item.contentEncoded) candidates.push(item.contentEncoded)

    const fromDescription = extractImageFromText(item.description)
    if (fromDescription) candidates.push(fromDescription)

    return [...new Set(candidates.map((itemImage) => normalizeCandidateImage(itemImage, item.link)))]
        .filter(Boolean)
}

const imageRequestHeaders = (url) => {
    try {
        const parsed = new URL(url)
        const origin = `${parsed.protocol}//${parsed.host}/`
        return {
            'User-Agent': USER_AGENT,
            Referer: origin,
            Origin: origin,
            Accept: 'image/avif,image/webp,image/apng,image/*,*/*;q=0.8'
        }
    } catch {
        return {
            'User-Agent': USER_AGENT
        }
    }
}

const fetchImageBuffer = async (url, requestConfig = {}) => {
    try {
        const mergedHeaders = {
            ...imageRequestHeaders(url),
            ...(requestConfig.headers || {})
        }

        const response = await axios.get(url, {
            timeout: 120000,
            responseType: 'arraybuffer',
            validateStatus: () => true,
            ...requestConfig,
            headers: mergedHeaders
        })

        const contentType = String(response.headers['content-type'] || '').toLowerCase()
        if (response.status < 200 || response.status >= 400) return null
        if (!contentType.startsWith('image/')) return null

        const buffer = Buffer.from(response.data || [])
        if (!buffer.length) return null
        return buffer
    } catch {
        return null
    }
}

const fetchImageFromPage = async (url, requestConfig = {}) => {
    if (!url) return null

    try {
        const mergedHeaders = {
            'User-Agent': USER_AGENT,
            ...(requestConfig.headers || {})
        }

        const response = await axios.get(url, {
            timeout: 120000,
            validateStatus: () => true,
            ...requestConfig,
            headers: mergedHeaders
        })

        if (response.status < 200 || response.status >= 400) return null
        if (typeof response.data !== 'string') return null

        return extractImageFromHtml(response.data, url)
    } catch {
        return null
    }
}

const resolveImageForItems = async (items, limit, requestConfig = {}) => {
    const candidates = []

    for (const item of items.slice(0, limit)) {
        const itemImages = extractImageFromItem(item)
        for (const img of itemImages) {
            const fromItem = await fetchImageBuffer(img, requestConfig)
            if (fromItem) candidates.push(fromItem)
        }

        if (itemImages.length > 0 && candidates.length) break
        const pageImage = await fetchImageFromPage(item.link, requestConfig)
        const fromPage = pageImage ? await fetchImageBuffer(pageImage, requestConfig) : null
        if (fromPage) {
            candidates.push(fromPage)
            break
        }
    }

    return candidates[0] || null
}

const parseArgs = (args = []) => {
    const result = {
        limit: DEFAULT_LIMIT
    }

    for (const token of args) {
        const fixed = normalizeText(token)
        if (!fixed) continue

        if (fixed.startsWith('limit=')) {
            const value = Number(fixed.replace('limit=', ''))
            if (Number.isInteger(value) && value > 0) {
                result.limit = Math.min(MAX_LIMIT, value)
            }
            continue
        }

        if (/^\d+$/.test(fixed)) {
            const value = Number(fixed)
            if (Number.isInteger(value) && value > 0) {
                result.limit = Math.min(MAX_LIMIT, value)
            }
        }
    }

    return result
}

const parseItems = (xmlText) => {
    const $ = load(xmlText, { xmlMode: true })

    const channelTitle = normalizeText($('channel > title').first().text() || $('feed > title').first().text())
    const items = $('channel item, item, entry')
        .toArray()
        .map((itemNode) => {
            const $item = $(itemNode)
            const title = normalizeText($item.find('title').first().text())
            const linkNode = $item.find('link').first()
            const link = normalizeText(linkNode.text() || linkNode.attr('href'))
            const pubDate = normalizeText(
                $item.find('pubDate').first().text() ||
                $item.find('dc\\:date').first().text() ||
                $item.find('published').first().text() ||
                $item.find('updated').first().text()
            )
            const description =
                $item.find('description').first().text() ||
                $item.find('summary').first().text() ||
                $item.find('content\\:encoded').first().text() ||
                ''
            const contentEncoded = $item.find('content\\:encoded').first().text()

            const rawMarkup = String($item.toString())
            const image =
                extractImageFromItemMarkup(rawMarkup) ||
                extractImageFromText(description)

            return {
                title,
                link,
                pubDate,
                description,
                contentEncoded,
                image
            }
        })
        .filter((item) => item.title && item.link)

    return {
        channelTitle,
        items
    }
}

const formatItem = (item) => {
    const title = normalizeText(item.title)
    const desc = truncate(stripHtml(item.description), 130)
    const date = toNewsDate(item.pubDate)

    return `${title}\n• Tanggal: ${date}\n• Link: ${item.link}`
}

const formatList = (items, limit) =>
    items
        .slice(0, limit)
        .map((item, i) => `${i + 1}. ${formatItem(item)}`)
        .join('\n\n')

export const createRssCommand = ({
    name,
    aliases = [],
    description,
    feed,
    axiosConfig = {}
}) => ({
    name,
    aliases,
    description,
    execute: async ({ sock, msg, args, react, useLimit, config }) => {
        const jid = msg.key.remoteJid
        const { limit } = parseArgs(args)

        await react('⏳')

        try {
            const requestConfig = {
                headers: { 'User-Agent': USER_AGENT },
                timeout: 120000,
                validateStatus: () => true,
                ...axiosConfig,
                headers: {
                    'User-Agent': USER_AGENT,
                    ...(axiosConfig.headers || {})
                },
            }

            const response = await axios.get(feed, {
                ...requestConfig
            })

            if (response.status >= 400) {
                throw new Error(`RSS endpoint merespon status ${response.status}.`)
            }

            const { channelTitle, items } = parseItems(response.data)

            if (!items.length) {
                await react('❌')
                return sock.sendMessage(jid, {
                    text: `⚠️ Tidak ada berita ditemukan dari ${description}.`
                }, { quoted: msg })
            }

            const caption = `\`\`\`${formatList(items, limit)}\`\`\``
            const imagePayload = await resolveImageForItems(items, limit, requestConfig)

            if (!imagePayload) {
                await react('❌')
                return sock.sendMessage(jid, {
                    text: `❌ ${description}: Tidak ada gambar valid yang bisa diambil untuk ditampilkan.`
                }, { quoted: msg })
            }

            await sock.sendMessage(jid, {
                image: imagePayload,
                caption
            }, { quoted: msg })

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
