import axios from 'axios'
import * as cheerio from 'cheerio'
import { gotScraping } from 'got-scraping'

const SEARCH_URL = 'https://r.jina.ai/http://apkpure.com/search?q={query}'
const BASE_URL = 'https://apkpure.com'
const DEFAULT_LIMIT = 10
const MAX_LIMIT = 10
const DETAIL_LIMIT = 10
const REQUEST_TIMEOUT = 30000
const DETAIL_TIMEOUT = 15000

const normalizeText = (value) => String(value || '').trim()
const normalizeUrl = (value) => {
    const raw = normalizeText(value)
    if (!raw) return null
    if (!/^https?:\/\//i.test(raw)) return null
    return raw
}

const parseLimit = (text) => {
    const raw = normalizeText(text)
    const match = raw.match(/\blimit=(\d+)\b/i)
    if (!match?.[1]) return DEFAULT_LIMIT

    const value = Number(match[1])
    if (!Number.isInteger(value) || value <= 0) return DEFAULT_LIMIT
    return Math.min(MAX_LIMIT, value)
}

const removeLimitToken = (text) => normalizeText(String(text || '')).replace(/\blimit=\d+\b/gi, '').trim()

const isAppUrl = (value) => {
    const raw = normalizeText(value)
    if (!raw) return false
    try {
        const parsed = new URL(raw)
        if (!/^apkpure\.com$/i.test(parsed.hostname)) return false
        const parts = parsed.pathname.split('/').filter(Boolean)
        if (parts.length < 2) return false

        let offset = 0
        const firstSegment = normalizeText(parts[0]).toLowerCase()
        if (/^[a-z]{2}(-[a-z]{2})?$/i.test(firstSegment) || ['id','es','ru','in'].includes(firstSegment)) {
            offset = 1
        }

        if (parts.length - offset < 2) return false

        const blockedFirst = new Set(['search', 'howto', 'news', 'topic', 'topics', 'tag', 'account', 'login', 'settings', 'privacy', 'terms', 'cookie', 'contact', 'about', 'app', 'apps'])
        const first = normalizeText(parts[offset]).toLowerCase()
        if (blockedFirst.has(first)) {
            return false
        }

        const second = normalizeText(parts[offset + 1])
        if (!/^[a-z0-9][a-z0-9._-]*$/i.test(second)) return false
        return true
    } catch {
        return false
    }
}

const cleanSearchLine = (line) => normalizeText(line).replace(/\s+/g, ' ')

const isAppEntryBoundary = (line, index, itemsInSection) => {
    const raw = cleanSearchLine(line)
    if (!raw) return false
    if (raw === 'Related Searches' || raw === 'Articles' || raw === 'How To') return true
    if (/^\d+\./.test(raw)) return false
    if (parseSimpleAppLine(raw)?.url || parseCompactAppLine(raw)?.url) return true
    return false
}

const parseCompactAppLine = (line) => {
    const raw = cleanSearchLine(line)
    if (!raw.startsWith('*')) return null

    const linkMatch = raw.match(/^\*+\s*\[(.*)\]\((https?:\/\/[^)\s]+)\)\s*$/)
    if (!linkMatch) return null

    const appUrl = normalizeUrl(linkMatch[2])
    if (!isAppUrl(appUrl)) return null

    const inner = linkMatch[1]
    const imageOnly = inner.match(/^!\[Image\s*\d+:\s*([^\]]+)\]\([^)]+\)\s*(.*)$/)
    if (!imageOnly) return null

    const titleHint = normalizeText(imageOnly[1]).replace(/^Image\s*\d+:\s*/i, '')
    const tail = normalizeText(imageOnly[2])
    if (!tail) return null

    const ratingMatch = tail.match(/(\d+(?:\.\d+)?)\s*$/)
    const rating = ratingMatch ? ratingMatch[1] : '-'
    const text = ratingMatch ? tail.slice(0, ratingMatch.index).trim() : tail
    let title = '-'
    let developer = '-'

    if (titleHint && text.toLowerCase().startsWith(titleHint.toLowerCase())) {
        const remainder = normalizeText(text.slice(titleHint.length))
        title = titleHint || '-'
        if (remainder) developer = remainder
    } else {
        const parts = text.split(/\s+/)
        if (parts.length <= 2) {
            title = text || '-'
        } else {
            title = `${parts[0]} ${parts[1]}`.trim()
            developer = parts.slice(2).join(' ')
        }
    }

    return { title, developer, rating, reviews: '-', size: '-', android: '-', image: null, link: appUrl }
}

const parseSimpleAppLine = (line) => {
    const raw = cleanSearchLine(line)
    const match = raw.match(/^\[(.+)\]\((https?:\/\/[^)\s]+)\)\s*$/)
    if (!match) return null

    const appUrl = normalizeUrl(match[2])
    if (!isAppUrl(appUrl)) return null

    const title = normalizeText(match[1])
    if (!title || title.startsWith('![') || title.startsWith('[![Image')) return null
    return { title, developer: '-', rating: '-', reviews: '-', size: '-', android: '-', image: null, link: appUrl }
}

const parseSearchMetadataLine = (line, item) => {
    const raw = cleanSearchLine(line)
    if (!raw) return item

    if (raw.startsWith('*')) {
        const bullet = raw.replace(/^\*+\s*/, '')

        if (item.rating === '-') {
            const ratingMatch = bullet.match(/^\s*([0-9]+(?:\.[0-9]+)?)\s*([0-9.,]+[kKmM]?)?\s*Reviews?/i)
            if (ratingMatch?.[1]) item.rating = ratingMatch[1]
            if (ratingMatch?.[2]) item.reviews = normalizeText(ratingMatch[2])
        }

        if (item.reviews === '-' && /Reviews/i.test(bullet)) {
            const reviewMatch = bullet.match(/([0-9.,]+[kKmM]?)\s*Reviews?/i)
            if (reviewMatch?.[1]) item.reviews = normalizeText(reviewMatch[1])
        }

        if (item.size === '-') {
            const sizeMatch = bullet.match(/([0-9]+(?:\.[0-9]+)?\s*(?:KB|MB|GB|TB))\s+File Size/i)
            if (sizeMatch?.[1]) item.size = normalizeText(sizeMatch[1])
        }

        if (item.android === '-') {
            const andMatch = bullet.match(/Android\s+(.+?)\s+Android OS/i)
            if (andMatch?.[1]) item.android = normalizeText(andMatch[1])
        }

        return item
    }

    if (item.developer === '-' && !/^\d/.test(raw) && !raw.includes('http') && !raw.endsWith('UTC')) {
        item.developer = raw
    }

    return item
}

const parseAppText = (rawText) => {
    const text = cleanSearchLine(rawText)
    if (!text) return null

    const imageLine = text.match(/^!\[Image\s*\d+:\s*([^\]]+)\]\([^)]+\)\s*(.*)$/)
    if (imageLine) {
        const titleHint = normalizeText(imageLine[1]).replace(/^Image\s*\d+:\s*/i, '')
        const tail = normalizeText(imageLine[2])
        if (!tail) return null

        const ratingMatch = tail.match(/(\d+(?:\.\d+)?)\s*$/)
        const rating = ratingMatch ? ratingMatch[1] : '-'
        const plain = ratingMatch ? tail.slice(0, ratingMatch.index).trim() : tail

        let title = '-'
        let developer = '-'
        if (titleHint && plain.toLowerCase().startsWith(titleHint.toLowerCase())) {
            const remainder = normalizeText(plain.slice(titleHint.length))
            title = titleHint || '-'
            if (remainder) developer = remainder
        } else {
            const parts = plain.split(/\s+/)
            if (parts.length <= 2) {
                title = plain
            } else {
                title = `${parts[0]} ${parts[1]}`.trim()
                developer = parts.slice(2).join(' ')
            }
        }

        return { title: title || '-', developer, rating, reviews: '-', size: '-', android: '-', image: null }
    }

    const compactCandidate = text.match(/^[^[]*\]\((https?:\/\/[^)\s]+)\)\s*(.*)$/)
    const title = compactCandidate ? normalizeText(compactCandidate[2] || text) : text
    return {
        title: title || '-',
        developer: '-',
        rating: '-',
        reviews: '-',
        size: '-',
        android: '-',
        image: null
    }
}

const parseFallbackEntries = (lines, limit) => {
    const items = []
    const seen = new Set()
    const max = Math.min(limit, MAX_LIMIT)

    for (const line of lines) {
        const raw = cleanSearchLine(line)
        if (!raw) continue

        const matches = [...raw.matchAll(/\[([^\]]+)\]\((https?:\/\/[^)\s]+)\)/g)]
        if (!matches.length) continue

        for (let i = matches.length - 1; i >= 0; i -= 1) {
            const matchText = matches[i]?.[1]
            const matchUrl = normalizeUrl(matches[i]?.[2])
            if (!matchUrl || !isAppUrl(matchUrl)) continue

            const parsedFromText = parseAppText(matchText)
            if (!parsedFromText) continue

            const app = { ...parsedFromText, link: matchUrl }
            if (seen.has(app.link)) continue
            seen.add(app.link)
            items.push(app)
            break
        }

        if (items.length >= max) break
    }

    return items.slice(0, max)
}

const parseSearchHtml = (html, limit) => {
    const $ = cheerio.load(String(html || ''))
    const max = Math.min(limit, MAX_LIMIT)

    const $list = $('#search-res').length ? $('#search-res') : $('ul.search-res')
    if (!$list.length) return []

    const items = []
    const seen = new Set()

    $list.find('> li').each((_, li) => {
        if (items.length >= max) return false
        const $item = $(li)
        const $anchor = $item.find('a.dd').first()
        const link = normalizeUrl($anchor.attr('href'))
        if (!link || seen.has(link)) return

        const title = normalizeText($item.find('p.p1').first().text())
        const developer = normalizeText($item.find('p.p2').first().text())
        const rating = normalizeText($item.find('.stars-search .star').first().text())
        const reviewsText = normalizeText($item.find('.desc').first().text())

        if (!title || !link || !isAppUrl(link)) return

        items.push({
            title,
            developer: developer || '-',
            rating: rating || '-',
            reviews: reviewsText.includes('Reviews') ? (reviewsText.match(/[0-9.,]+[kKmM]?/)?.[0] || '-') : '-',
            size: '-',
            android: '-',
            image: null,
            link
        })

        seen.add(link)
        return
    })

    return items.slice(0, max)
}

const extractQueryTokens = (query) => normalizeText(query)
    .toLowerCase()
    .split(/\s+/)
    .map((token) => token.trim())
    .filter((token) => token.length > 2)

const filterByQuery = (items, query) => {
    const tokens = extractQueryTokens(query)
    if (!tokens.length) return items

    const filtered = items.filter((item) => {
        const target = `${normalizeText(item.title)} ${normalizeText(item.developer)}`.toLowerCase()
        return tokens.some((token) => target.includes(token))
    })

    return filtered.length ? filtered : []
}

const mergeUniqueByLink = (items, extra) => {
    const map = new Map()
    for (const item of [...items, ...extra]) {
        if (!item?.link) continue
        if (!map.has(item.link)) map.set(item.link, item)
    }
    return [...map.values()]
}

const parseDetailMetadataFromHtml = (html) => {
    const $ = cheerio.load(String(html || ''))
    const out = { rating: '-', reviews: '-', size: '-', android: '-', developer: '-' }

    const score = normalizeText($('.score-search').first().text() || $('.head').first().text())
    if (score && /\d/.test(score)) {
        out.rating = normalizeText(score.match(/[0-9]+(?:\.[0-9]+)?/)?.[0] || score)
    }

    const reviewText = normalizeText($('.desc').filter((_, el) => /Reviews?/i.test($(el).text())).first().text())
    if (reviewText) {
        const match = reviewText.match(/([0-9.,]+[kKmM]?)\s*Reviews?/)
        if (match?.[1]) out.reviews = match[1]
    }

    const sizeMatches = String(html || '').matchAll(/Download\s*[^()]{0,200}?\(([^)]+)\)/gi)
    for (const match of sizeMatches) {
        const sizeValue = normalizeText(match?.[1])
        const sizeMatch = sizeValue.match(/(\d+(?:\.\d+)?\s*(?:KB|MB|GB|TB))\b/i)
        if (sizeMatch?.[1]) {
            out.size = normalizeText(sizeMatch[1])
            break
        }
    }

    const andText = normalizeText(
        $('.head').filter((_, el) => /^Android\b/.test(normalizeText($(el).text()))).first().text()
    )
    if (andText) out.android = andText.replace(/Android\s*/, 'Android ').trim()

    const dev = normalizeText($('.p2').first().text())
    if (dev) out.developer = dev

    return out
}

const parseDetailMetadataFromMarkdown = (markdown) => {
    const text = normalizeText(markdown)
    const lines = text.split('\n')
    const out = { rating: '-', reviews: '-', size: '-', android: '-', developer: '-' }
    const developerMatch = text.match(/\[([^\]]+)\]\(https?:\/\/apkpure\.com\/developer\/[^)]+\)/i)
    if (developerMatch?.[1]) out.developer = normalizeText(developerMatch[1])

    for (const line of lines) {
        const raw = cleanSearchLine(line)
        if (!raw) continue

        if (out.rating === '-') {
            const match = raw.match(/^\*\s*\[\s*([0-9]+(?:\.[0-9]+)?)\s+([0-9.,]+[kKmM]?)\s*Reviews/i)
            if (match?.[1]) {
                out.rating = match[1]
                if (match?.[2]) out.reviews = normalizeText(match[2])
                continue
            }
        }

        if (out.reviews === '-') {
            const m = raw.match(/([0-9.,]+[kKmM]?)\s*Reviews/i)
            if (m?.[1]) out.reviews = normalizeText(m[1])
        }

        if (out.size === '-') {
            const downloadMatch = raw.match(/Download [^(]*\(([^)]+)\)/i)
            if (downloadMatch?.[1] && /[0-9]/.test(downloadMatch[1])) {
                const sizeMatch = downloadMatch[1].match(/([0-9]+(?:\.[0-9]+)?\s*(?:KB|MB|GB|TB))/i)
                if (sizeMatch?.[1]) out.size = normalizeText(sizeMatch[1])
            }

            const fileSizeMatch = raw.match(/([0-9]+(?:\.[0-9]+)?\s*(?:KB|MB|GB|TB))\s+File Size/i)
            if (fileSizeMatch?.[1]) out.size = normalizeText(fileSizeMatch[1])
        }

        if (out.android === '-') {
            const andMatch = raw.match(/Android\s+(.+?)\s+Android OS/i)
            if (andMatch?.[1]) out.android = normalizeText(andMatch[1])
        }
    }

    return out
}

const parseDetailMetadata = (content) => {
    const text = String(content || '')
    if (text.includes('<!DOCTYPE html>') || text.includes('<html')) {
        return parseDetailMetadataFromHtml(text)
    }
    return parseDetailMetadataFromMarkdown(text)
}

const fetchDetailPage = async (itemLink) => {
    const base = new URL(itemLink)
    const path = base.pathname.replace(/\/+$/, '')

    try {
        const response = await gotScraping(`${BASE_URL}${path}`, {
            timeout: {
                request: DETAIL_TIMEOUT
            },
            headers: {
                'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
                'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8'
            }
        })
        if (response?.body) return response.body
    } catch (err) {
        // fallback to r.jina proxy below
    }

    const proxy = `https://r.jina.ai/http://apkpure.com${path}`
    return fetchMarkdown(proxy, DETAIL_TIMEOUT)
}

const fetchSearchHtml = async (query) => {
    const response = await gotScraping(`https://apkpure.com/search?q=${encodeURIComponent(query)}`, {
        timeout: {
            request: REQUEST_TIMEOUT
        },
        headers: {
            'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
            'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8'
        }
    })
    return response.body || null
}

const fetchMarkdown = async (url, timeout = REQUEST_TIMEOUT) => {
    const { data } = await axios.get(url, {
        timeout,
        validateStatus: () => true,
        headers: {
            'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
            Accept: 'text/plain, text/html,*/*',
            Referer: `${BASE_URL}/`
        }
    })
    if (!data) return null
    return String(data)
}

const parseApps = (markdown, limit) => {
    const lines = String(markdown || '')
        .replace(/\r/g, '')
        .split('\n')
        .map(cleanSearchLine)
        .filter((line) => line.length > 0)

    const appsStart = lines.findIndex((line) => /^Apps$/i.test(line))
    if (appsStart < 0) {
        const fallbackItems = parseFallbackEntries(lines, limit)
        return { items: fallbackItems, total: fallbackItems.length }
    }

    let appsEnd = lines.findIndex((line, index) => index > appsStart && /^Related Searches$/i.test(line))
    if (appsEnd < 0) appsEnd = lines.length

    const section = lines.slice(appsStart + 1, appsEnd)
    const items = []
    const seen = new Set()
    const max = Math.min(limit, MAX_LIMIT)

    const hasCompleteMeta = (item) => (
        item.developer !== '-' &&
        item.rating !== '-' &&
        item.size !== '-' &&
        item.android !== '-' &&
        item.reviews !== '-'
    )

    for (let i = 0; i < section.length; i += 1) {
        if (items.length >= max) break

        const line = section[i]
        const compact = parseCompactAppLine(line)
        const simple = compact ? null : parseSimpleAppLine(line)
        const parsed = compact || simple
        if (!parsed || seen.has(parsed.link)) continue

        const item = { ...parsed }

        if (simple) {
            for (let j = i + 1; j < section.length; j += 1) {
                if (isAppEntryBoundary(section[j], j, section.length)) break
                parseSearchMetadataLine(section[j], item)
            }
        }

        if (!hasCompleteMeta(item)) {
            seen.add(item.link)
        }

        seen.add(item.link)
        items.push(item)
    }

    const limited = items.slice(0, max)
    if (!limited.length) {
        const fallbackItems = parseFallbackEntries(section, max)
        return { items: fallbackItems, total: fallbackItems.length }
    }

    return { items: limited, total: limited.length }
}

const enrichMetaFromDetail = async (item) => {
    if (!item?.link) return item

    const markdown = await fetchDetailPage(item.link)
    if (!markdown) return item

    const detail = parseDetailMetadata(markdown)
    return {
        ...item,
        developer: normalizeText(item.developer !== '-' ? item.developer : detail.developer) || item.developer,
        rating: normalizeText(item.rating !== '-' ? item.rating : detail.rating) || item.rating,
        reviews: normalizeText(item.reviews !== '-' ? item.reviews : detail.reviews) || item.reviews,
        size: normalizeText(item.size !== '-' ? item.size : detail.size) || item.size,
        android: normalizeText(item.android !== '-' ? item.android : detail.android) || item.android
    }
}

const formatResults = (items = []) => items
    .map((item, index) => (
        `\`\`\`${index + 1}. ${item.title}\n` +
        `× Developer: ${item.developer}\n` +
        `× Rating: ${item.rating}\n` +
        `× Reviews: ${item.reviews}\n` +
        `× Size: ${item.size}\n` +
        `× Android: ${item.android}\n` +
        `× Link: ${item.link}\`\`\``
    )).join('\n\n')

export default {
    name: 'apkpure',
    aliases: ['apk', 'apkp'],
    description: 'Cari aplikasi dari APKPure',
    execute: async ({ sock, msg, text, prefix, command, args, react, useLimit }) => {
        const jid = msg.key.remoteJid
        const raw = normalizeText(Array.isArray(args) ? args.join(' ') : text)
        const limit = parseLimit(raw)
        const q = removeLimitToken(raw)

        if (!q) {
            return sock.sendMessage(jid, {
                text: `Contoh penggunaan:\n- ${prefix + command} whatsapp`
            }, { quoted: msg })
        }

        await react('⏳')

        try {
            const searchUrl = SEARCH_URL.replace('{query}', encodeURIComponent(q))
            const markdown = await fetchMarkdown(searchUrl, REQUEST_TIMEOUT)
            const parsed = parseApps(markdown, limit)
            let htmlItems = []

            try {
                const html = await fetchSearchHtml(q)
                htmlItems = parseSearchHtml(html, limit)
            } catch {
                htmlItems = []
            }

            let merged = parsed.items
            if (htmlItems.length) {
                merged = mergeUniqueByLink(parsed.items, htmlItems)
            }

            const filteredItems = filterByQuery(merged, q)
            if (!filteredItems.length) {
                await react('❌')
                return sock.sendMessage(jid, {
                    text: `❌ Tidak ditemukan hasil APKPure untuk: ${q}`
                }, { quoted: msg })
            }

            const finalItems = filteredItems.slice(0, limit)
            const finalParsed = { items: finalItems, total: finalItems.length }

            const toEnrich = finalParsed.items.filter((item) => item.developer === '-' || item.rating === '-' || item.size === '-' || item.android === '-' || item.reviews === '-')
                .slice(0, DETAIL_LIMIT)

            if (toEnrich.length) {
                const settled = await Promise.allSettled(toEnrich.map((item) => enrichMetaFromDetail(item)))
                for (let i = 0; i < settled.length; i += 1) {
                    if (settled[i].status === 'fulfilled' && settled[i].value) {
                        const idx = finalParsed.items.findIndex((entry) => entry.link === toEnrich[i].link)
                        if (idx >= 0) finalParsed.items[idx] = settled[i].value
                    }
                }
            }

            const body = formatResults(finalParsed.items)

            await sock.sendMessage(jid, { text: body }, { quoted: msg })

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
