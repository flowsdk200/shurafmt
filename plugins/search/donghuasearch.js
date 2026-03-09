import * as cheerio from 'cheerio'
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'

const BASE_URL = 'https://donghuafilm.com'
const EXACT_SEARCH_URL = `${BASE_URL}/wp-json/wp/v2/search`
const USER_AGENT = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/136.0.0.0 Safari/537.36'
const REQUEST_TIMEOUT = 30000
const MAX_RESULTS = 15
const CATALOG_TTL = 6 * 60 * 60 * 1000
const AZ_KEYS = ['0-9', ...'ABCDEFGHIJKLMNOPQRSTUVWXYZ']
const STOP_WORDS = new Set(['the', 'and', 'of', 'season', 'movie', 'ova', 'ona', 'sub', 'subtitle', 'indonesia'])
const execFileAsync = promisify(execFile)
const catalogCache = {
    expiresAt: 0,
    items: []
}

const cleanText = (value) => String(value || '')
    .replace(/&#8211;/g, '-')
    .replace(/&#038;/g, '&')
    .replace(/&amp;/g, '&')
    .replace(/\s+/g, ' ')
    .trim()

const normalizeQuery = (rawInput) => {
    const text = cleanText(rawInput)
    if (!text) return ''

    if (/^https?:\/\//i.test(text)) {
        try {
            const url = new URL(text)
            if (/(^|\.)donghuafilm\.com$/i.test(url.hostname)) {
                const q = cleanText(url.searchParams.get('s') || url.searchParams.get('search'))
                if (q) return q
            }
        } catch {
            // ignore invalid URL
        }
    }

    return text.replace(/^[^A-Za-z0-9]+/, '')
}

const toAbsoluteUrl = (value, base = BASE_URL) => {
    const raw = cleanText(value)
    if (!raw || raw === '#') return ''
    try {
        return new URL(raw, base).toString()
    } catch {
        return ''
    }
}

const normalizeSearchText = (value) => cleanText(value)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim()

const getQueryTokens = (query) => [...new Set(
    normalizeSearchText(query)
        .split(' ')
        .map((part) => cleanText(part))
        .filter((part) => part.length >= 2 && !STOP_WORDS.has(part))
)]

const buildCurlArgs = (url, { referer = `${BASE_URL}/`, textMode = true } = {}) => {
    const args = [
        '-L',
        '--compressed',
        '--max-time', String(Math.max(10, Math.ceil(REQUEST_TIMEOUT / 1000))),
        '-sS',
        '-A', USER_AGENT,
        '-H', 'Accept-Language: id-ID,id;q=0.9,en-US;q=0.8,en;q=0.7'
    ]

    if (textMode) {
        args.push('-H', 'Accept: text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8')
    }

    if (referer) args.push('-e', referer)
    args.push(url)
    return args
}

const fetchTextViaCurl = async (url, referer = `${BASE_URL}/`) => {
    try {
        const { stdout } = await execFileAsync('curl', buildCurlArgs(url, { referer, textMode: true }), {
            encoding: 'utf8',
            maxBuffer: 8 * 1024 * 1024
        })

        const html = String(stdout || '')
        if (!html.trim()) throw new Error('Respons DonghuaFilm kosong')
        return html
    } catch (err) {
        throw new Error(err?.stderr?.trim() || err?.message || 'curl request gagal')
    }
}

const fetchJsonViaCurl = async (url, referer = `${BASE_URL}/`) => {
    const text = await fetchTextViaCurl(url, referer)
    try {
        return JSON.parse(text)
    } catch {
        throw new Error('Respons JSON DonghuaFilm tidak valid')
    }
}

const fetchBufferViaCurl = async (url, referer = `${BASE_URL}/`) => {
    try {
        const { stdout } = await execFileAsync('curl', buildCurlArgs(url, { referer, textMode: false }), {
            encoding: 'buffer',
            maxBuffer: 10 * 1024 * 1024
        })

        const buffer = Buffer.from(stdout || [])
        return buffer.length ? buffer : null
    } catch {
        return null
    }
}

const parseCatalogCards = (html) => {
    const $ = cheerio.load(String(html || ''))
    const rows = []
    const seen = new Set()

    $('.listupd.azara article.bs .bsx, .listupd article.bs .bsx').each((_, el) => {
        const box = $(el)
        const anchor = box.find('a[itemprop="url"]').first()
        const url = toAbsoluteUrl(anchor.attr('href'))
        const title = cleanText(anchor.attr('title') || box.find('.tt').first().clone().children().remove().end().text())
        const image = toAbsoluteUrl(box.find('img').first().attr('data-src') || box.find('img').first().attr('src'))

        if (!url || !title || seen.has(url)) return
        seen.add(url)

        rows.push({
            title,
            url,
            image: image || null,
            type: cleanText(box.find('.typez').first().text()) || '-',
            status: cleanText(box.find('.status').first().text() || box.find('.epx').first().text()) || '-'
        })

    })

    return rows
}

const mapWithConcurrency = async (items, limit, iteratee) => {
    const list = Array.from(items || [])
    const results = new Array(list.length)
    let cursor = 0

    const worker = async () => {
        while (cursor < list.length) {
            const index = cursor++
            results[index] = await iteratee(list[index], index)
        }
    }

    const size = Math.min(Math.max(1, limit), list.length || 1)
    await Promise.all(Array.from({ length: size }, () => worker()))
    return results
}

const fetchAzPage = async (key) => parseCatalogCards(
    await fetchTextViaCurl(`${BASE_URL}/az-list/?show=${encodeURIComponent(key)}`)
)

const getCatalogIndex = async () => {
    if (catalogCache.expiresAt > Date.now() && catalogCache.items.length) {
        return catalogCache.items
    }

    const groups = await mapWithConcurrency(AZ_KEYS, 4, async (key) => {
        try {
            return await fetchAzPage(key)
        } catch {
            return []
        }
    })

    const merged = new Map()
    for (const group of groups) {
        for (const item of group) {
            if (!merged.has(item.url)) merged.set(item.url, item)
        }
    }

    catalogCache.items = [...merged.values()]
    catalogCache.expiresAt = Date.now() + CATALOG_TTL
    return catalogCache.items
}

const fetchExactSearch = async (query) => {
    const url = `${EXACT_SEARCH_URL}?search=${encodeURIComponent(query)}&per_page=100&_fields=url,title,subtype,type`
    const json = await fetchJsonViaCurl(url)
    if (!Array.isArray(json)) return []

    const rows = []
    const seen = new Set()

    for (const item of json) {
        const link = toAbsoluteUrl(item?.url)
        const title = cleanText(item?.title)
        if (!link || !title || seen.has(link)) continue
        if (cleanText(item?.subtype).toLowerCase() !== 'anime') continue
        seen.add(link)
        rows.push({ title, url: link })
    }

    return rows
}

const scoreSearchItem = (item, query) => {
    const title = normalizeSearchText(item?.title)
    const q = normalizeSearchText(query)
    const tokens = getQueryTokens(query)

    if (!title || !q) return 0

    let score = 0

    if (title === q) score += 4000
    if (title.startsWith(q)) score += 2000
    if (title.includes(q)) score += 1500

    let matchedTokens = 0
    for (const token of tokens) {
        if (!token) continue
        const wholeWord = new RegExp(`(^|\\s)${token}(\\s|$)`, 'i')
        if (wholeWord.test(title)) {
            score += 300
            matchedTokens += 1
            continue
        }

        if (title.includes(token)) {
            score += 120
            matchedTokens += 1
        }
    }

    if (tokens.length && matchedTokens === tokens.length) score += 600
    return score
}

const fetchExpandedResults = async (query) => {
    const [exactHits, catalog] = await Promise.all([
        fetchExactSearch(query).catch(() => []),
        getCatalogIndex()
    ])

    const merged = new Map()
    const catalogByUrl = new Map(catalog.map((item) => [item.url, item]))

    for (const item of exactHits) {
        const mergedItem = {
            ...(catalogByUrl.get(item.url) || {}),
            ...item
        }
        merged.set(item.url, mergedItem)
    }

    const fuzzyHits = []
    for (const item of catalog) {
        const score = scoreSearchItem(item, query)
        if (score <= 0) continue
        fuzzyHits.push({ ...item, score })
    }

    fuzzyHits.sort((a, b) => b.score - a.score || a.title.localeCompare(b.title))

    const tokens = getQueryTokens(query)
    const strictMode = tokens.length >= 2
    const strictHits = fuzzyHits.filter((item) => {
        const title = normalizeSearchText(item.title)
        return tokens.every((token) => title.includes(token))
    })

    if (strictMode && strictHits.length) {
        const strictMerged = new Map()
        for (const item of strictHits) {
            strictMerged.set(item.url, {
                ...(catalogByUrl.get(item.url) || {}),
                ...item
            })
        }

        return [...strictMerged.values()].slice(0, MAX_RESULTS)
    }

    for (const item of fuzzyHits) {
        if (!merged.has(item.url)) merged.set(item.url, item)
        if (merged.size >= MAX_RESULTS) break
    }

    return [...merged.values()].slice(0, MAX_RESULTS)
}

const extractInfoMap = ($) => {
    const info = {}

    $('.info-content .spe span').each((_, el) => {
        const label = cleanText($(el).find('b').first().text()).replace(/:$/, '').toLowerCase()
        const clone = $(el).clone()
        clone.find('b').remove()
        const value = cleanText(clone.text().replace(/^:/, ''))
        if (!label || !value) return
        info[label] = value
    })

    return info
}

const getUrlSlug = (value) => {
    try {
        const url = new URL(String(value || ''))
        const parts = url.pathname.split('/').filter(Boolean)
        return cleanText(parts[parts.length - 1] || '').toLowerCase()
    } catch {
        return ''
    }
}

const getSeasonInfo = (fallback = {}) => {
    const haystack = `${cleanText(fallback.title)} ${getUrlSlug(fallback.url)}`.toLowerCase()
    const match = haystack.match(/season[\s-]*(\d{1,2})/i)
    if (!match) return null

    const number = String(Number(match[1]))
    return {
        number,
        padded: number.padStart(2, '0')
    }
}

const extractEpisodeNumber = (value) => {
    const text = cleanText(value)
    if (!text) return -1
    const explicitEpisode = text.match(/episode[\s-]*(\d{1,4})/i)
    if (explicitEpisode) return Number(explicitEpisode[1])
    const firstNumber = text.match(/(\d{1,4})/)
    return firstNumber ? Number(firstNumber[1]) : -1
}

const buildEpisodeCandidates = ($) => $('.eplister ul li a').toArray().map((el) => {
    const anchor = $(el)
    const numberText = cleanText(anchor.find('.epl-num').first().text())
    const titleText = cleanText(anchor.find('.epl-title').first().text())
    const href = toAbsoluteUrl(anchor.attr('href'))
    const raw = `${titleText} ${href}`.toLowerCase()

    return {
        latestEpisode: numberText || titleText || '-',
        latestEpisodeLink: href || '-',
        episodeNumber: extractEpisodeNumber(numberText || titleText),
        isEnd: /\bend\b/i.test(`${numberText} ${titleText}`),
        raw
    }
}).filter((item) => item.latestEpisodeLink !== '-')

const filterSeasonCandidates = (candidates, fallback = {}) => {
    const season = getSeasonInfo(fallback)
    if (!season) return candidates

    const patterns = [
        `season ${season.number}`,
        `season ${season.padded}`,
        `season-${season.number}`,
        `season-${season.padded}`
    ]

    const filtered = candidates.filter((item) => patterns.some((pattern) => item.raw.includes(pattern)))
    return filtered.length ? filtered : candidates
}

const extractLatestEpisode = ($, fallback = {}) => {
    const scoped = filterSeasonCandidates(buildEpisodeCandidates($), fallback)
    if (!scoped.length) {
        return {
            latestEpisode: '-',
            latestEpisodeLink: '-'
        }
    }

    const ordered = [...scoped].sort((a, b) => {
        if (a.episodeNumber !== b.episodeNumber) return a.episodeNumber - b.episodeNumber
        if (a.isEnd !== b.isEnd) return Number(a.isEnd) - Number(b.isEnd)
        return a.latestEpisode.localeCompare(b.latestEpisode)
    })

    const best = ordered[ordered.length - 1] || scoped[scoped.length - 1]

    return {
        latestEpisode: best.latestEpisode || '-',
        latestEpisodeLink: best.latestEpisodeLink || '-'
    }
}

const parseDetailPage = (html, fallback = {}) => {
    const $ = cheerio.load(String(html || ''))
    const info = extractInfoMap($)
    const latest = extractLatestEpisode($, fallback)
    const type = info.type || fallback.type || '-'
    const isMovie = /\bmovie\b/i.test(type)

    const image = toAbsoluteUrl(
        $('.thumbook .thumb img').first().attr('data-src')
        || $('.thumbook .thumb img').first().attr('src')
        || $('meta[property="og:image"]').attr('content')
    )

    return {
        title: cleanText($('h1.entry-title').first().text()) || fallback.title || '-',
        image: image || fallback.image || null,
        rating: cleanText($('[itemprop="ratingValue"]').attr('content') || $('.rating strong').first().text().replace(/^Rating\s*/i, '')) || '-',
        status: info.status || fallback.status || '-',
        type,
        episodes: info.episodes || '-',
        duration: info.duration || '-',
        studio: info.studio || '-',
        latestEpisode: isMovie ? '-' : latest.latestEpisode,
        latestEpisodeLink: isMovie ? '-' : latest.latestEpisodeLink,
        genres: $('.genxed a').map((_, el) => cleanText($(el).text())).get().filter(Boolean).join(', ') || '-',
        link: fallback.url || '-'
    }
}

const fetchDetail = async (item) => {
    const html = await fetchTextViaCurl(item.url, `${BASE_URL}/`)
    return parseDetailPage(html, item)
}

const fetchImageBuffer = async (url) => {
    const target = toAbsoluteUrl(url)
    if (!target) return null
    return fetchBufferViaCurl(target, `${BASE_URL}/`)
}

const sendResults = async (sock, jid, msg, caption, firstImage) => {
    if (!firstImage) throw new Error('Gambar DonghuaFilm tidak ditemukan')

    const imageBuffer = await fetchImageBuffer(firstImage)
    if (imageBuffer) {
        return sock.sendMessage(jid, {
            image: imageBuffer,
            caption
        }, { quoted: msg })
    }

    throw new Error('Gagal ambil gambar DonghuaFilm')
}

const formatItem = (item, index) => {
    const lines = [
        `${index + 1}. ${item.title}`,
        `• Rating: ${item.rating}`,
        `• Status: ${item.status}`,
        `• Tipe: ${item.type}`,
        `• Episode: ${item.episodes}`,
        `• Durasi: ${item.duration}`,
        `• Genre: ${item.genres}`,
        `• Link: ${item.link}`
    ]

    if (item.latestEpisode !== '-' && item.latestEpisodeLink !== '-') {
        lines.splice(5, 0, `• Episode Terbaru: ${item.latestEpisode}`)
        lines.push(`• Link Episode Terbaru: ${item.latestEpisodeLink}`)
    }

    return lines.join('\n')
}

export default {
    name: 'donghua',
    aliases: ['df', 'dh'],
    description: 'Cari anime di DonghuaFilm',
    execute: async ({ sock, msg, text, prefix, command, react, useLimit }) => {
        const jid = msg.key.remoteJid
        const query = normalizeQuery(text)

        if (!query) {
            return sock.sendMessage(jid, {
                text: `Contoh penggunaan:\n- ${prefix + command} renegade immortal`
            }, { quoted: msg })
        }

        await react('⏳')

        try {
            const hits = await fetchExpandedResults(query)
            if (!hits.length) {
                await react('❌')
                return sock.sendMessage(jid, {
                    text: `❌ Tidak ditemukan hasil DonghuaFilm untuk: ${query}`
                }, { quoted: msg })
            }

            const rows = await mapWithConcurrency(hits, 3, (item) => fetchDetail(item))

            const caption = `\`\`\`${rows.map(formatItem).join('\n\n')}\`\`\``
            await sendResults(sock, jid, msg, caption, rows[0]?.image)

            useLimit()
            await react('✅')
        } catch (err) {
            await react('❌')
            const detail = err?.message || err?.code || String(err) || 'Unknown error'
            await sock.sendMessage(jid, {
                text: `❌ Error: ${detail}`
            }, { quoted: msg })
        }
    }
}
