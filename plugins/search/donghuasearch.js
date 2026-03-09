import * as cheerio from 'cheerio'
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'

const BASE_URL = 'https://donghuafilm.com'
const SEARCH_URL = `${BASE_URL}/`
const USER_AGENT = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/136.0.0.0 Safari/537.36'
const REQUEST_TIMEOUT = 30000
const MAX_RESULTS = 5
const execFileAsync = promisify(execFile)

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

const parseSearchCards = (html) => {
    const $ = cheerio.load(String(html || ''))
    const rows = []
    const seen = new Set()

    $('.listupd article.bs .bsx').each((_, el) => {
        const box = $(el)
        const anchor = box.find('a').first()
        const url = toAbsoluteUrl(anchor.attr('href'))
        const title = cleanText(anchor.attr('title') || box.find('.tt').first().clone().children().remove().end().text())
        const image = toAbsoluteUrl(box.find('img').first().attr('src') || box.find('img').first().attr('data-src'))

        if (!url || !title || seen.has(url)) return
        seen.add(url)

        rows.push({
            title,
            url,
            image: image || null,
            type: cleanText(box.find('.typez').first().text()) || '-',
            status: cleanText(box.find('.status').first().text() || box.find('.epx').first().text()) || '-'
        })

        if (rows.length >= MAX_RESULTS) return false
    })

    return rows
}

const mergeUnique = (...groups) => {
    const seen = new Set()
    const rows = []

    for (const group of groups) {
        for (const item of group || []) {
            const key = cleanText(item?.url)
            if (!key || seen.has(key)) continue
            seen.add(key)
            rows.push(item)
            if (rows.length >= MAX_RESULTS) return rows
        }
    }

    return rows
}

const fetchSearchPage = async (query) => parseSearchCards(
    await fetchTextViaCurl(`${SEARCH_URL}?s=${encodeURIComponent(query)}`)
)

const fetchExpandedResults = async (query) => {
    const primary = await fetchSearchPage(query)
    if (primary.length >= 2) return primary.slice(0, MAX_RESULTS)

    const tokens = [...new Set(
        cleanText(query)
            .split(/\s+/)
            .map((part) => cleanText(part))
            .filter((part) => part.length >= 3)
    )]

    const relatedGroups = []
    for (const token of tokens) {
        if (cleanText(token).toLowerCase() === cleanText(query).toLowerCase()) continue
        try {
            relatedGroups.push(await fetchSearchPage(token))
        } catch {
            relatedGroups.push([])
        }
    }

    return mergeUnique(primary, ...relatedGroups).slice(0, MAX_RESULTS)
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

const parseDetailPage = (html, fallback = {}) => {
    const $ = cheerio.load(String(html || ''))
    const info = extractInfoMap($)

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
        type: info.type || fallback.type || '-',
        episodes: info.episodes || '-',
        duration: info.duration || '-',
        studio: info.studio || '-',
        latestEpisodeLink: toAbsoluteUrl($('.epcurlast').first().closest('a').attr('href'), fallback.url || BASE_URL) || '-',
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

const formatItem = (item, index) => (
    `${index + 1}. ${item.title}\n` +
    `• Rating: ${item.rating}\n` +
    `• Status: ${item.status}\n` +
    `• Tipe: ${item.type}\n` +
    `• Episode: ${item.episodes}\n` +
    `• Durasi: ${item.duration}\n` +
    `• Genre: ${item.genres}\n` +
    `• Link: ${item.link}\n` +
    `• Download: ${item.latestEpisodeLink}`
)

export default {
    name: 'donghua',
    aliases: ['df', 'dh'],
    description: 'Cari anime di DonghuaFilm',
    execute: async ({ sock, msg, text, prefix, command, react, useLimit }) => {
        const jid = msg.key.remoteJid
        const query = normalizeQuery(text)

        if (!query) {
            return sock.sendMessage(jid, {
                text: `Contoh penggunaan:\n- ${prefix + command} martial master`
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

            const rows = []
            for (const item of hits) {
                rows.push(await fetchDetail(item))
            }

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
