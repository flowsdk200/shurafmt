import axios from 'axios'
import { load } from 'cheerio'

const USER_AGENT = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36'
const DEFAULT_LIMIT = 15
const MAX_LIMIT = 15
const REQUEST_TIMEOUT = 15000
const VIDEO_EXT_RE = /(\.)(3gp|avi|flv|m4v|mkv|mov|mp4|mpg|mpeg|m3u8|webm|wmv|ogv)(\?|$)/i
const IMAGE_EXT_RE = /\.(jpe?g|png|webp|gif|bmp|svg|avif|heic|heif)(\?|$)/i

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

const stripHtml = (value) => {
    if (!value) return '-'
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

const truncate = (value, max = 140) => {
    const text = normalizeText(value)
    if (!text) return '-'
    return text.length > max ? `${text.slice(0, max)}...` : text
}

const parseLimit = (args) => {
    const result = {
        limit: DEFAULT_LIMIT
    }

    for (const tokenRaw of args || []) {
        const token = normalizeText(tokenRaw).toLowerCase()
        if (!token) continue

        if (token.startsWith('limit=')) {
            const value = Number(token.replace('limit=', ''))
            if (Number.isInteger(value) && value > 0) {
                result.limit = Math.min(MAX_LIMIT, Math.max(1, value))
            }
            continue
        }

        if (/^\d+$/.test(token)) {
            const value = Number(token)
            if (Number.isInteger(value) && value > 0) {
                result.limit = Math.min(MAX_LIMIT, Math.max(1, value))
            }
        }
    }

    return result
}

const toAbsoluteUrl = (value, baseUrl) => {
    const href = normalizeText(value)
    if (!href) return null
    if (href.startsWith('//')) return `https:${href}`
    if (/^https?:\/\//i.test(href)) return href

    try {
        return new URL(href, baseUrl).href
    } catch {
        return null
    }
}

const isImageUrl = (value) => {
    const url = normalizeText(value).toLowerCase()
    if (!url.startsWith('http://') && !url.startsWith('https://')) return false
    if (VIDEO_EXT_RE.test(url)) return false

    return IMAGE_EXT_RE.test(url) || /\/(image|images?|photo|media|thumb|thumbnail)\//i.test(url)
}

const imageRequestHeaders = (url) => {
    try {
        const parsed = new URL(url)
        return {
            'User-Agent': USER_AGENT,
            'Accept': 'image/avif,image/webp,image/apng,image/*,*/*;q=0.8',
            'Referer': `${parsed.origin}/`,
            'Origin': parsed.origin
        }
    } catch {
        return {
            'User-Agent': USER_AGENT,
            'Accept': 'image/avif,image/webp,image/apng,image/*,*/*;q=0.8'
        }
    }
}

const resolveImageBuffer = async (url) => {
    if (!url || !isImageUrl(url)) return null

    try {
        const response = await axios.get(url, {
            timeout: 120000,
            headers: imageRequestHeaders(url),
            responseType: 'arraybuffer',
            validateStatus: () => true,
        })

        if (response.status < 200 || response.status >= 400) return null
        const type = String(response.headers['content-type'] || '').toLowerCase()
        if (!type.startsWith('image/')) return null

        const buffer = Buffer.from(response.data || [])
        if (!buffer.length) return null
        return buffer
    } catch {
        return null
    }
}

const normalizeImageCandidate = (value, baseUrl) => {
    const url = toAbsoluteUrl(value, baseUrl)
    if (!url || !isImageUrl(url)) return null
    return url
}

const extractImageFromJsonLd = (node, baseUrl, out) => {
    if (!node || typeof node !== 'object') return

    if (Array.isArray(node)) {
        for (const item of node) extractImageFromJsonLd(item, baseUrl, out)
        return
    }

    if (typeof node.image === 'string') {
        const img = normalizeImageCandidate(node.image, baseUrl)
        if (img) out.add(img)
    } else if (node.image) {
        if (Array.isArray(node.image)) {
            for (const i of node.image) extractImageFromJsonLd(i, baseUrl, out)
        } else if (typeof node.image === 'object' && typeof node.image.url === 'string') {
            const img = normalizeImageCandidate(node.image.url, baseUrl)
            if (img) out.add(img)
        }
    }

    if (typeof node.thumbnailUrl === 'string') {
        const img = normalizeImageCandidate(node.thumbnailUrl, baseUrl)
        if (img) out.add(img)
    }

    if (typeof node.logo === 'string') {
        const img = normalizeImageCandidate(node.logo, baseUrl)
        if (img) out.add(img)
    }
}

const extractImageFromHtml = (html, baseUrl) => {
    const candidates = []
    if (!html) return candidates

    const $ = load(html)

    const selectors = [
        'meta[property="og:image"]',
        'meta[property="og:image:url"]',
        'meta[name="twitter:image"]',
        'meta[name="twitter:image:src"]',
        'meta[itemprop="image"]',
        'meta[name="sailthru.image.full"]'
    ]

    for (const sel of selectors) {
        const value = normalizeText($(sel).first().attr('content') || $(sel).first().attr('value') || '')
        const img = normalizeImageCandidate(value, baseUrl)
        if (img) candidates.push(img)
    }

    const jsonScript = $('script[type="application/ld+json"]')
    for (const raw of jsonScript.toArray()) {
        const text = normalizeText($(raw).text())
        if (!text) continue

        try {
            const parsed = JSON.parse(text)
            const found = new Set()
            extractImageFromJsonLd(parsed, baseUrl, found)
            found.forEach((img) => candidates.push(img))
        } catch {
            // ignore malformed JSON-LD
        }
    }

    const preload = $('link[rel="preload"][as="image"]').first().attr('href')
    const preloadImage = normalizeImageCandidate(preload, baseUrl)
    if (preloadImage) candidates.push(preloadImage)

    $('img').each((_, imgNode) => {
        const src = normalizeText($(imgNode).attr('src') || $(imgNode).attr('data-src') || $(imgNode).attr('data-original') || '')
        const img = normalizeImageCandidate(src, baseUrl)
        if (img) candidates.push(img)
    })

    return [...new Set(candidates)]
}

const extractDate = ($) => {
    const candidates = [
        $('meta[property="article:published_time"]').attr('content'),
        $('meta[name="publishdate"]').attr('content'),
        $('meta[name="pubdate"]').attr('content'),
        $('meta[name="date"]').attr('content'),
        $('meta[name="article:modified_time"]').attr('content'),
        $('meta[property="article:modified_time"]').attr('content'),
        $('meta[name="last-modified"]').attr('content'),
        $('[itemprop="datePublished"]').first().attr('datetime') || $('[itemprop="datePublished"]').first().text(),
        $('meta[itemprop="datePublished"]').attr('content'),
        $('time[datetime]').first().attr('datetime')
    ]

    for (const value of candidates) {
        const normalized = normalizeText(value)
        if (normalized) return normalized
    }

    const scripts = $('script[type="application/ld+json"]').toArray()
    for (const raw of scripts) {
        const txt = normalizeText($(raw).text())
        if (!txt) continue
        try {
            const parsed = JSON.parse(txt)
            const nodes = Array.isArray(parsed) ? parsed : [parsed]
            for (const node of nodes) {
                if (!node || typeof node !== 'object') continue
                const published = node.datePublished || node.dateCreated || node.uploadDate || node.publishedAt
                if (published) return normalizeText(published)
            }
        } catch {
            // skip
        }
    }

    const allScripts = $('script').toArray()
    for (const raw of allScripts) {
        const txt = normalizeText($(raw).text())
        if (!txt) continue
        const extracted = extractDateFromScriptText(txt)
        if (extracted) return extracted
    }

    return '-'
}

const extractMeta = async (url) => {
    const { data } = await axios.get(url, {
        timeout: REQUEST_TIMEOUT,
        headers: {
            'User-Agent': USER_AGENT,
            Referer: 'https://www.google.com/',
        },
        validateStatus: () => true,
    })

    const html = typeof data === 'string' ? data : ''
    if (!html) return null
    const $ = load(html)

    const title = normalizeText(
        $('meta[property="og:title"]').attr('content') ||
        $('meta[name="twitter:title"]').attr('content') ||
        $('h1').first().text() ||
        $('title').first().text() ||
        'Untitled'
    )

    const description = normalizeText(
        $('meta[name="description"]').attr('content') ||
        $('meta[property="og:description"]').attr('content') ||
        $('meta[name="twitter:description"]').attr('content') ||
        $('p').first().text() ||
        '-'
    )

    const date = toNewsDate(extractDate($))
    const imageCandidates = extractImageFromHtml(html, url)

    return {
        title,
        link: url,
        date,
        description,
        imageCandidates,
    }
}

const collectLinks = async (pageUrl, linkPattern, selector = 'a[href]') => {
    const { data } = await axios.get(pageUrl, {
        timeout: REQUEST_TIMEOUT,
        headers: {
            'User-Agent': USER_AGENT,
            Referer: 'https://www.google.com/',
            'Accept-Language': 'id-ID,id;q=0.9,en-US;q=0.8,en;q=0.7'
        },
        validateStatus: () => true,
    })

    const html = typeof data === 'string' ? data : ''
    const $ = load(html)
    const found = []

    $(`${selector}`).each((_, node) => {
        const href = normalizeText($(node).attr('href') || '')
        if (!href) return
        const abs = toAbsoluteUrl(href, pageUrl)
        if (!abs) return
        if (!linkPattern.test(abs)) return
        found.push(abs)
    })

    return [...new Set(found)]
}

const buildItemCaption = (item) => {
    return `${item.title}\n• Tanggal: ${item.date}\n• Link: ${item.link}`
}

const buildListCaption = (label, items, limit) => {
    return `\`\`\`${items.slice(0, limit).map((item, idx) => ` ${idx + 1}. ${buildItemCaption(item)}`).join('\n\n')}\`\`\``
}

const parseRssItems = (xmlText, linkPattern) => {
    const $ = load(xmlText, { xmlMode: true })
    return $('channel item').toArray().map((node) => {
        const $node = $(node)
        const title = normalizeText($node.find('title').first().text())
        const link = normalizeText($node.find('link').first().text() || $node.find('link').first().attr('href'))
        const dateRaw = normalizeText(
            $node.find('pubDate').first().text() ||
            $node.find('dc\\:date').first().text() ||
            $node.find('published').first().text() ||
            $node.find('updated').first().text()
        )
        const description = normalizeText(
            $node.find('description').first().text() ||
            $node.find('summary').first().text() ||
            $node.find('content\\:encoded').first().text() ||
            '-'
        )

        if (!title || !link) return null
        if (!linkPattern.test(link)) return null

        const imageFromDescription = (() => {
            const match = description.match(/<img[^>]+src=[\"']([^\"']+)[\"'][^>]*>/i)
            return normalizeText(match?.[1] || '')
        })()

        const fromEnclosure = normalizeText($node.find('enclosure').first().attr('url'))
        const item = {
            title,
            link,
            date: toNewsDate(dateRaw),
            description: stripHtml(description),
            imageCandidates: []
        }

        const imageCandidates = []
        const direct = normalizeImageCandidate(
            fromEnclosure || imageFromDescription || $node.find('media\\:content').first().attr('url') ||
            $node.find('media\\:thumbnail').first().attr('url'),
            link
        )
        if (direct) imageCandidates.push(direct)

        item.imageCandidates = imageCandidates

        return item
    }).filter(Boolean)
}

const extractDateFromScriptText = (text) => {
    const normalized = normalizeText(text).replace(/\\"/g, '"')
    if (!normalized) return null

    const patterns = [
        /(?:published_date|publish[_-]?date)\s*[:=]\s*["']([^"']+)["']/i,
        /(?:datePublished|dateCreated|uploadDate|publishedAt|dateModified|date)\s*:\s*["']([^"']+)["']/i,
        /(?:\"?datetime\"?\s*:\s*\"([^\"]+)\")/i,
    ]

    for (const pattern of patterns) {
        const matched = normalized.match(pattern)
        if (matched?.[1]) return matched[1]
    }

    const fallback = normalized.match(/(\d{4}-\d{2}-\d{2}(?:[ T]\d{2}:\d{2}(?::\d{2})?)?(?:Z|[+\-][0-9]{2}:[0-9]{2})?)/)
    return fallback?.[1] || null
}


export const createManualNewsCommand = ({
    name,
    aliases = [],
    description,
    source,
    feed,
    sourceUrl,
    linkPattern,
    maxCandidates = 40,
    useRss = false,
    selector = 'a[href]'
}) => ({
    name,
    aliases,
    description,
    execute: async ({ sock, msg, args, react, useLimit }) => {
        const jid = msg.key.remoteJid
        const { limit } = parseLimit(args)

        await react('⏳')

        try {
            const items = []

            const collect = useRss
                ? async () => {
                    const { data, status } = await axios.get(feed, {
                        timeout: REQUEST_TIMEOUT,
                        headers: {
                            'User-Agent': USER_AGENT,
                            'Accept-Language': 'id-ID,id;q=0.9,en-US;q=0.8,en;q=0.7'
                        },
                        validateStatus: () => true
                    })

                    if (status >= 400) return []
                    const rssItems = parseRssItems(String(data || ''), linkPattern)

                    for (const item of rssItems.slice(0, maxCandidates)) {
                        if (items.length >= limit) break

                        let finalBuffer = null
                        let meta = null
                        const baseCandidates = item.imageCandidates || []

                        if (baseCandidates.length) {
                            for (const candidate of baseCandidates) {
                                finalBuffer = await resolveImageBuffer(candidate)
                                if (finalBuffer) break
                            }
                        }

                        if (!finalBuffer) {
                            try {
                                meta = await extractMeta(item.link)
                            } catch {
                                meta = null
                            }
                            if (meta?.imageCandidates?.length) {
                                for (const candidate of meta.imageCandidates) {
                                    finalBuffer = await resolveImageBuffer(candidate)
                                    if (finalBuffer) break
                                }
                            }
                        }

                        if (finalBuffer) {
                            items.push({
                                title: item.title,
                                link: item.link,
                                date: item.date,
                                description: item.description || meta?.description || '-',
                                imageBuffer: finalBuffer
                            })
                        }
                    }
                }
                : async () => {
                    const links = await collectLinks(sourceUrl, linkPattern, selector)
                    for (const link of links.slice(0, maxCandidates)) {
                        if (items.length >= limit) break
                        let meta = null
                        try { meta = await extractMeta(link) } catch { meta = null }
                        if (!meta) continue

                        let imageBuffer = null
                        for (const candidate of meta.imageCandidates) {
                            imageBuffer = await resolveImageBuffer(candidate)
                            if (imageBuffer) break
                        }

                        if (!imageBuffer) continue

                        items.push({
                            ...meta,
                            imageBuffer
                        })
                    }
                }

            await collect()

            if (!items.length) {
                await react('❌')
                return sock.sendMessage(jid, {
                    text: `⚠️ Tidak ada berita ditemukan dari ${description}.`
                }, { quoted: msg })
            }

            const caption = buildListCaption(description.toUpperCase(), items, limit)
            const firstImage = items[0].imageBuffer

            await sock.sendMessage(jid, {
                image: firstImage,
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

export { parseLimit, toNewsDate, buildListCaption, buildItemCaption, extractMeta, extractImageFromHtml }
