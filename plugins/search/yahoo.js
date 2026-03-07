import axios from 'axios'
import * as cheerio from 'cheerio'

const SEARCH_BASE_URL = 'https://search.yahoo.com/search'
const MAX_RESULTS = 11 // 1 image+caption result + 10 text captions
const REQUEST_TIMEOUT = 30000
const RESULT_META_IMAGE_TIMEOUT = 12000

const cleanText = (value) => String(value || '')
    .replace(/\*+/g, '')
    .replace(/\s+/g, ' ')
    .trim()

const normalizeQuery = (rawInput) => {
    const text = cleanText(rawInput)
    if (!text) return ''

    if (/^https?:\/\//i.test(text)) {
        try {
            const url = new URL(text)
            if (/search\.yahoo\.com$/i.test(url.hostname)) {
                const p = cleanText(url.searchParams.get('p'))
                if (p) return p
            }
        } catch {
            // fallback to raw input below
        }
    }

    return text
}

const normalizeResultUrl = (value) => {
    const raw = cleanText(value)
    if (!raw) return null
    if (!/^https?:\/\//i.test(raw)) return null
    if (raw.includes('javascript:')) return null
    if (raw.startsWith('mailto:')) return null
    if (raw.startsWith('tel:')) return null
    return raw
}

const isSkippableDomain = (url) => {
    const lower = String(url || '').toLowerCase()
    return (
        lower.startsWith('https://search.yahoo.com/search') ||
        lower.includes('help.yahoo.com') ||
        lower.includes('/preferences/preferences') ||
        lower.includes('login.yahoo.com') ||
        lower.includes('geo.yahoo.com')
    )
}

const decodeYahooRedirect = (url) => {
    if (!url || !url.includes('/RU=')) return url

    const ruIndex = url.indexOf('/RU=')
    if (ruIndex < 0) return url

    const tail = url.slice(ruIndex + 4)
    const end = tail.indexOf('/RK=')
    const encoded = end >= 0 ? tail.slice(0, end) : tail

    try {
        return decodeURIComponent(encoded)
    } catch {
        return encoded
    }
}

const normalizeImageUrl = (value) => {
    const raw = cleanText(value)
    if (!raw || raw.startsWith('data:')) return null
    if (raw.startsWith('http://')) return raw
    if (raw.startsWith('//')) return `https:${raw}`
    if (!/^https?:\/\//i.test(raw)) return null
    return raw
}

const parseImageFromNode = ($, $anchor) => {
    const candidates = new Set()
    const parent = $anchor.parent()
    const grandParent = parent.parent()

    const push = (node) => {
        if (!node || !node.length) return
        if (!node[0] || node[0].type === 'root') return
        candidates.add(node[0])
    }

    push($anchor)
    push($anchor.closest('li'))
    push($anchor.closest('.compDib'))
    push($anchor.closest('.srp-rg-box'))
    push($anchor.closest('article'))
    push($anchor.closest('.compList'))
    push(parent)
    push(grandParent)

    if (parent.length) {
        push(parent.prev())
        push(parent.next())
        parent.siblings().each((_, node) => push($(node)))
        parent.find('.imgbox, .thmb, .compImageList, .compImageProfile').each((_, node) => push($(node)))
    }

    if (grandParent.length) {
        grandParent.siblings().each((_, node) => push($(node)))
        grandParent.find('.imgbox, .thmb, .compImageList, .compImageProfile').each((_, node) => push($(node)))
    }

    const containers = [...candidates].map((el) => $(el))

    const readImage = (node, sel) => {
        const el = node.find(sel).first()
        if (!el.length) return null

        const srcAttr =
            el.attr('src') ||
            el.attr('data-src') ||
            el.attr('data-lazy-src') ||
            el.attr('srcset')

        if (!srcAttr) return null

        const first = String(srcAttr)
            .split(',')[0]
            .trim()
            .split(' ')[0]

        return normalizeImageUrl(first)
    }

    const selectors = [
        'img.s-img',
        'img[data-src]',
        'img[data-lazy-src]',
        'img[data-srcset]',
        'source[srcset]',
        '.thmb img',
        '.imgbox img',
        '.compImageList img',
        '.compImageProfile img',
        'img[src]',
        'picture img',
        'img'
    ]

    for (const node of containers) {
        for (const sel of selectors) {
            const value = readImage(node, sel)
            if (value) return value
        }
    }

    return null
}

const parseResultImageFromPage = async (url) => {
    const normalizedUrl = normalizeResultUrl(url)
    if (!normalizedUrl) return null

    try {
        const { data, status } = await axios.get(normalizedUrl, {
            timeout: RESULT_META_IMAGE_TIMEOUT,
            maxRedirects: 8,
            headers: {
                'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
                'Accept-Language': 'en-US,en;q=0.9',
                'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8'
            },
            validateStatus: () => true
        })

        if (status !== 200) return null

        const html = String(data || '')
        if (!html || /just a moment|enable javascript and cookies|cloudflare|access denied|forbidden/i.test(html)) {
            return null
        }

        const $ = cheerio.load(html)

        const metaCandidates = [
            $('meta[property="og:image"]').attr('content'),
            $('meta[name="twitter:image"]').attr('content'),
            $('meta[name="twitter:image:src"]').attr('content'),
            $('meta[property="twitter:image:src"]').attr('content'),
            $('meta[itemprop="image"]').attr('content'),
            $('link[rel="image_src"]').attr('href')
        ]

        for (const candidate of metaCandidates) {
            const image = normalizeImageUrl(candidate)
            if (image) return image
        }

        const firstImageNode = $('img[src], img[data-src], img[data-lazy-src], source[srcset]').first()
        const source =
            firstImageNode.attr('src') ||
            firstImageNode.attr('data-src') ||
            firstImageNode.attr('data-lazy-src') ||
            firstImageNode.attr('srcset')

        if (!source) return null

        const first = String(source)
            .split(',')[0]
            .trim()
            .split(' ')[0]

        return normalizeImageUrl(first)
    } catch {
        return null
    }
}

const parseResultFromLinkedData = ($) => {
    const results = []
    const seen = new Set()

    $('script[type="application/ld+json"]').each((_, el) => {
        const text = $(el).text()
        if (!text) return

        let json
        try {
            json = JSON.parse(text)
        } catch {
            return
        }

        const entries = Array.isArray(json) ? json : [json]
        for (const item of entries) {
            const list = item?.itemListElement
            if (!Array.isArray(list)) continue

            for (const it of list) {
                const node = it?.item || it
                const link = decodeYahooRedirect(normalizeResultUrl(node?.url))
                if (!link || isSkippableDomain(link)) continue

                const normalized = normalizeResultUrl(link)
                if (!normalized) continue

                const title = cleanText(node?.name)
                const desc = cleanText(node?.description)
                const image = normalizeImageUrl(node?.image?.url || node?.image || node?.thumbnailUrl || node?.thumbnail)

                if (!normalized || !title || seen.has(normalized)) continue

                seen.add(normalized)
                results.push({
                    title,
                    link: normalized,
                    source: '-',
                    desc: desc || '-',
                    image
                })

                if (results.length >= MAX_RESULTS) return results
            }
        }
    })

    return results
}

const parseYahooDirectResults = ($) => {
    const seen = new Set()
    const rows = []

    $('#web .compTitle a').each((_, anchor) => {
        if (rows.length >= MAX_RESULTS) return false

        const $anchor = $(anchor)
        const hrefRaw = normalizeResultUrl($anchor.attr('href'))
        if (!hrefRaw) return

        const decoded = decodeYahooRedirect(hrefRaw)
        const href = normalizeResultUrl(decoded)
        if (!href || isSkippableDomain(href) || seen.has(href)) return

        const title = cleanText($anchor.find('h3.title span, h3 span, .title h3, .title').first().text())
            || cleanText($anchor.find('h3').first().text())

        if (!title) return

        const source = cleanText($anchor.find('.fc-141414, .site-name-content, cite').first().text()) || cleanText(new URL(href).hostname)
        const desc = cleanText($anchor.closest('.dd').find('.compText, .summary').first().text()) || '-'
        const image = parseImageFromNode($, $anchor)

        seen.add(href)
        rows.push({
            title,
            link: href,
            source: source || '-',
            desc: desc || '-',
            image
        })
    })

    return rows
}

const parseResults = (html) => {
    const $ = cheerio.load(String(html || ''))

    const jsonRows = parseResultFromLinkedData($)
    const domRows = parseYahooDirectResults($)

    const merged = new Map()

    for (const row of [...jsonRows, ...domRows]) {
        if (!row?.link) continue

        if (!merged.has(row.link)) {
            merged.set(row.link, { ...row })
            continue
        }

        const existing = merged.get(row.link)
        if (!existing.image && row.image) {
            existing.image = row.image
        }
    }

    return [...merged.values()].slice(0, MAX_RESULTS)
}

const formatCaption = (item, idx) =>
    `${idx + 1}. ${item.title}\n× Source: ${item.source}\n× Desc: ${item.desc}\n× Link: ${item.link}`

export default {
    name: 'yahoo',
    aliases: ['yahoosearch', 'ys'],
    description: 'Cari hasil web dari yahoo',
    execute: async ({ sock, msg, text, prefix, command, react, useLimit }) => {
        const jid = msg.key.remoteJid
        const query = normalizeQuery(text)

        if (!query) {
            return sock.sendMessage(jid, {
                text: `Contoh penggunaan:\n- ${prefix + command} mark zuckerberg`
            }, { quoted: msg })
        }

        await react('⏳')

        try {
            const html = await fetchHtml(query)
            const rows = parseResults(html)

            if (!rows.length) {
                await react('❌')
                return sock.sendMessage(jid, {
                    text: `❌ Tidak ditemukan hasil yahoo untuk: ${query}`
                }, { quoted: msg })
            }

            const displayRows = rows.slice(0, MAX_RESULTS)
            const firstResult = displayRows[0]
            let firstImage = firstResult?.image

            if (!firstImage) {
                firstImage = await parseResultImageFromPage(firstResult.link)
            }

            const allCaptions = displayRows
                .map((item, idx) => formatCaption(item, idx))
                .join('\n\n')

            if (firstImage) {
                await sock.sendMessage(jid, {
                    image: { url: firstImage },
                    caption: `\`\`\`${allCaptions}\`\`\``
                }, { quoted: msg })
            } else {
                await sock.sendMessage(jid, {
                    text: `\`\`\`${allCaptions}\`\`\``
                }, { quoted: msg })
            }

            useLimit()
            await react('✅')
        } catch (err) {
            await react('❌')
            const lower = String(err?.message || '').toLowerCase()

            if (lower.includes('cloudflare')) {
                return sock.sendMessage(jid, {
                    text: '❌ Gagal mengakses yahoo (security challenge)'
                }, { quoted: msg })
            }

            const message = err?.response?.status
                ? `❌ Gagal search yahoo: HTTP ${err.response.status}`
                : `❌ Error: ${err.message}`

            return sock.sendMessage(jid, {
                text: message
            }, { quoted: msg })
        }
    }
}

const fetchHtml = async (query) => {
    const encoded = encodeURIComponent(query)
    const candidates = [
        `${SEARCH_BASE_URL}?p=${encoded}`,
        `${SEARCH_BASE_URL}?fr=opensearch&p=${encoded}`
    ]

    let lastError = null

    for (const url of candidates) {
        try {
            const { data, status } = await axios.get(url, {
                timeout: REQUEST_TIMEOUT,
                maxRedirects: 8,
                headers: {
                    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
                    'Accept-Language': 'en-US,en;q=0.9',
                    'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8'
                },
                validateStatus: () => true
            })

            if (status !== 200 || !String(data || '').trim()) {
                lastError = new Error(`HTTP ${status}`)
                continue
            }

            const text = String(data)
            if (/just a moment|enable javascript and cookies|cloudflare|access denied|forbidden/i.test(text)) {
                lastError = new Error('Cloudflare challenge')
                continue
            }

            return text
        } catch (err) {
            lastError = err
        }
    }

    throw lastError || new Error('Fetch failed')
}
