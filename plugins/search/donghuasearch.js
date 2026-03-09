import axios from 'axios'
import * as cheerio from 'cheerio'

const API_URL = 'https://donghuafilm.com/wp-json/wp/v2/search'
const BASE_URL = 'https://donghuafilm.com'
const USER_AGENT = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/136.0.0.0 Safari/537.36'
const REQUEST_TIMEOUT = 30000
const MAX_RESULTS = 5

const cleanText = (value) => String(value || '')
    .replace(/&#8211;/g, '-')
    .replace(/&#038;/g, '&')
    .replace(/&amp;/g, '&')
    .replace(/\s+/g, ' ')
    .trim()

const shortText = (value, max = 160) => {
    const text = cleanText(value)
    if (!text) return '-'
    if (text.length <= max) return text
    return `${text.slice(0, max - 3).trim()}...`
}

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
        image: image || null,
        rating: cleanText($('[itemprop="ratingValue"]').attr('content') || $('.rating strong').first().text().replace(/^Rating\s*/i, '')) || '-',
        status: info.status || '-',
        type: info.type || '-',
        episodes: info.episodes || '-',
        duration: info.duration || '-',
        studio: info.studio || '-',
        country: info.country || '-',
        season: info.season || '-',
        latestEpisode: cleanText($('.epcurlast').first().text()) || '-',
        latestEpisodeLink: toAbsoluteUrl($('.epcurlast').first().closest('a').attr('href'), fallback.url || BASE_URL) || '-',
        firstEpisode: cleanText($('.epcurfirst').first().text()) || '-',
        firstEpisodeLink: toAbsoluteUrl($('.epcurfirst').first().closest('a').attr('href'), fallback.url || BASE_URL) || '-',
        genres: $('.genxed a').map((_, el) => cleanText($(el).text())).get().filter(Boolean).join(', ') || '-',
        description: shortText($('.desc').first().text() || $('.mindesc').first().text()),
        link: fallback.url || '-'
    }
}

const fetchSearchResults = async (query) => {
    const { data, status } = await axios.get(API_URL, {
        params: {
            search: query,
            per_page: MAX_RESULTS,
            page: 1
        },
        timeout: REQUEST_TIMEOUT,
        validateStatus: () => true,
        headers: {
            'User-Agent': USER_AGENT,
            'Accept-Language': 'id-ID,id;q=0.9,en-US;q=0.8,en;q=0.7',
            Accept: 'application/json,text/plain,*/*',
            Referer: `${BASE_URL}/`
        }
    })

    if (status !== 200 || !Array.isArray(data)) {
        throw new Error(`DonghuaFilm search HTTP ${status}`)
    }

    return data
        .filter((item) => cleanText(item?.subtype).toLowerCase() === 'anime')
        .map((item) => ({
            id: item.id,
            title: cleanText(item.title),
            url: toAbsoluteUrl(item.url)
        }))
        .filter((item) => item.title && item.url)
}

const mergeUniqueResults = (...groups) => {
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

const fetchExpandedResults = async (query) => {
    const primary = await fetchSearchResults(query)
    if (primary.length >= 2) return primary.slice(0, MAX_RESULTS)

    const tokens = [...new Set(
        cleanText(query)
            .split(/\s+/)
            .map((part) => cleanText(part))
            .filter((part) => part.length >= 3)
    )]

    if (tokens.length <= 1) return primary.slice(0, MAX_RESULTS)

    const relatedGroups = await Promise.all(
        tokens.map((token) => fetchSearchResults(token).catch(() => []))
    )

    return mergeUniqueResults(primary, ...relatedGroups).slice(0, MAX_RESULTS)
}

const fetchDetail = async (item) => {
    const response = await axios.get(item.url, {
        timeout: REQUEST_TIMEOUT,
        validateStatus: () => true,
        headers: {
            'User-Agent': USER_AGENT,
            'Accept-Language': 'id-ID,id;q=0.9,en-US;q=0.8,en;q=0.7',
            Accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
            Referer: `${BASE_URL}/`
        }
    })

    if (response.status !== 200) {
        throw new Error(`Detail DonghuaFilm HTTP ${response.status}`)
    }

    return parseDetailPage(response.data, item)
}

const fetchImageBuffer = async (url) => {
    const target = toAbsoluteUrl(url)
    if (!target) return null

    try {
        const response = await axios.get(target, {
            responseType: 'arraybuffer',
            timeout: REQUEST_TIMEOUT,
            validateStatus: () => true,
            headers: {
                'User-Agent': USER_AGENT,
                Referer: `${BASE_URL}/`
            }
        })

        if (response.status !== 200) return null
        const buffer = Buffer.from(response.data || [])
        return buffer.length ? buffer : null
    } catch {
        return null
    }
}

const sendResults = async (sock, jid, msg, caption, firstImage) => {
    if (!firstImage) {
        throw new Error('Gambar DonghuaFilm tidak ditemukan')
    }

    const imageBuffer = firstImage ? await fetchImageBuffer(firstImage) : null

    if (imageBuffer) {
        try {
            return await sock.sendMessage(jid, {
                image: imageBuffer,
                caption
            }, { quoted: msg })
        } catch {
            // try remote URL below
        }
    }

    if (firstImage) {
        try {
            return await sock.sendMessage(jid, {
                image: { url: firstImage },
                caption
            }, { quoted: msg })
        } catch {
            throw new Error('Gagal kirim hasil DonghuaFilm sebagai gambar')
        }
    }
    
    throw new Error('Gagal kirim hasil DonghuaFilm sebagai gambar')
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
            for (const item of hits.slice(0, MAX_RESULTS)) {
                try {
                    rows.push(await fetchDetail(item))
                } catch {
                    rows.push({
                        title: item.title,
                        rating: '-',
                        status: '-',
                        type: '-',
                        episodes: '-',
                        latestEpisode: '-',
                        latestEpisodeLink: '-',
                        duration: '-',
                        studio: '-',
                        genres: '-',
                        image: null,
                        link: item.url
                    })
                }
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
