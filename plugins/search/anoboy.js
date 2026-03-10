import axios from 'axios'
import * as cheerio from 'cheerio'

const SEARCH_URL = 'https://anoboy.be/'
const BASE_URL = 'https://anoboy.be'
const MAX_RESULTS = 15
const DETAIL_CONCURRENCY = 4
const REQUEST_TIMEOUT = 30000

const cleanText = (value) => String(value || '')
    .replace(/\*+/g, '')
    .replace(/\s+/g, ' ')
    .trim()

const shortText = (value, max) => {
    const text = cleanText(value)
    if (!text) return '-'
    if (text.length <= max) return text
    return `${text.slice(0, max - 3).trim()}...`
}

const normalizeUrl = (value) => {
    const raw = cleanText(value)
    if (!raw) return ''
    if (raw.startsWith('//')) return `https:${raw}`
    if (/^https?:\/\//i.test(raw)) return raw

    try {
        return new URL(raw, BASE_URL).toString()
    } catch {
        return ''
    }
}

const normalizeQuery = (rawInput) => {
    const text = cleanText(rawInput)
    if (!text) return ''

    if (/^https?:\/\//i.test(text)) {
        try {
            const url = new URL(text)
            if (/(^|\.)anoboy\.be$/i.test(url.hostname)) {
                const keyword = cleanText(url.searchParams.get('s'))
                if (keyword) return keyword

                if (url.pathname.startsWith('/search/')) {
                    const pathQuery = cleanText(decodeURIComponent(url.pathname.replace(/^\/search\//, '').replace(/\/+$/, '')))
                    if (pathQuery) return pathQuery
                }
            }
        } catch {
            return text
        }
    }

    return text
}

const requestHeaders = {
    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
    'Accept-Language': 'id-ID,id;q=0.9,en-US;q=0.8,en;q=0.7',
    Accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
    Referer: `${BASE_URL}/`
}

const fetchHtml = async (url, params = undefined) => {
    const response = await axios.get(url, {
        params,
        timeout: REQUEST_TIMEOUT,
        maxRedirects: 5,
        validateStatus: () => true,
        headers: requestHeaders
    })

    if (response.status !== 200) {
        throw new Error(`HTTP ${response.status}`)
    }

    const html = String(response.data || '')
    if (!html.trim()) throw new Error('Respons kosong')
    if (/just a moment|cf-browser-verification|cf-challenge|attention required|captcha|access denied/i.test(html)) {
        throw new Error('Halaman terproteksi/challenge')
    }

    return html
}

const fetchSearchHtml = async (query) => fetchHtml(SEARCH_URL, { s: query })

const parseSearchRows = (html) => {
    const $ = cheerio.load(html)
    const rows = []
    const seen = new Set()

    $('.listupd article.bs').each((_, article) => {
        if (rows.length >= MAX_RESULTS) return false

        const card = $(article)
        const link = normalizeUrl(card.find('a').first().attr('href'))
        const title = cleanText(card.find('.tt h2').first().text()) || cleanText(card.find('.tt').first().text())
        const image = normalizeUrl(card.find('img').first().attr('src'))
        const status = cleanText(card.find('.status').first().text())
        const type = cleanText(card.find('.typez').first().text())
        const progress = cleanText(card.find('.bt .epx').first().text())
        const sub = cleanText(card.find('.bt .sb').first().text())

        if (!title || !link) return

        const key = link.toLowerCase()
        if (seen.has(key)) return
        seen.add(key)

        rows.push({
            title,
            link,
            image,
            status: status || '-',
            type: type || '-',
            progress: progress || '-',
            sub: sub || '-'
        })
    })

    return rows
}

const parseInfoPairs = ($) => {
    const info = {}

    $('.infox .spe span').each((_, node) => {
        const el = $(node)
        const label = cleanText(el.find('b').first().text()).replace(/:$/, '').toLowerCase()
        if (!label) return

        const clone = el.clone()
        clone.find('b').remove()
        const value = cleanText(clone.text())
        if (!value) return

        info[label] = value
    })

    return info
}

const parseDetail = (html, fallbackRow) => {
    const $ = cheerio.load(html)
    const info = parseInfoPairs($)

    const synopsis = cleanText($('.bixbox.synp .entry-content').first().text())
    const genres = $('.infox .genxed a')
        .map((_, a) => cleanText($(a).text()))
        .get()
        .filter(Boolean)
        .join(', ')

    const title = cleanText($('.infox h1.entry-title').first().text()) || fallbackRow.title
    const rating = cleanText($('.rating strong').first().text().replace(/^Rating\s*/i, '')) ||
        cleanText($('meta[itemprop="ratingValue"]').first().attr('content')) ||
        '-'
    const image = normalizeUrl($('.bigcontent .thumb img').first().attr('src')) || fallbackRow.image

    return {
        ...fallbackRow,
        title,
        image,
        rating: rating || '-',
        altTitle: shortText($('.infox .alter').first().text(), 140),
        status: cleanText(info.status) || fallbackRow.status || '-',
        studio: cleanText(info.studio) || '-',
        released: cleanText(info.released) || '-',
        duration: cleanText(info.duration) || '-',
        season: cleanText(info.season) || '-',
        type: cleanText(info.type) || fallbackRow.type || '-',
        episodes: cleanText(info.episodes) || '-',
        director: cleanText(info.director) || '-',
        producers: cleanText(info.producers) || '-',
        postedBy: cleanText(info['posted by']) || '-',
        releasedOn: cleanText(info['released on']) || '-',
        updatedOn: cleanText(info['updated on']) || '-',
        genres: genres || '-',
        synopsis: shortText(synopsis, 180)
    }
}

const fetchDetail = async (row) => {
    try {
        const html = await fetchHtml(row.link)
        return parseDetail(html, row)
    } catch {
        return {
            ...row,
            rating: '-',
            altTitle: '-',
            studio: '-',
            released: '-',
            duration: '-',
            season: '-',
            episodes: '-',
            director: '-',
            producers: '-',
            postedBy: '-',
            releasedOn: '-',
            updatedOn: '-',
            genres: '-',
            synopsis: '-'
        }
    }
}

const mapWithConcurrency = async (items, limit, worker) => {
    const results = new Array(items.length)
    let index = 0

    const runners = Array.from({ length: Math.min(limit, items.length) }, async () => {
        while (true) {
            const current = index
            index += 1
            if (current >= items.length) break
            results[current] = await worker(items[current], current)
        }
    })

    await Promise.all(runners)
    return results
}

const fetchImageBuffer = async (url) => {
    const target = normalizeUrl(url)
    if (!target) return null

    try {
        const response = await axios.get(target, {
            responseType: 'arraybuffer',
            timeout: REQUEST_TIMEOUT,
            maxRedirects: 5,
            validateStatus: () => true,
            headers: {
                'User-Agent': requestHeaders['User-Agent'],
                'Accept-Language': requestHeaders['Accept-Language'],
                Accept: 'image/avif,image/webp,image/apng,image/*,*/*;q=0.8',
                Referer: `${BASE_URL}/`
            }
        })

        if (response.status !== 200) return null
        const contentType = cleanText(response.headers?.['content-type']).toLowerCase()
        if (!contentType.startsWith('image/')) return null

        const buffer = Buffer.from(response.data || [])
        return buffer.length ? buffer : null
    } catch {
        return null
    }
}

const formatItem = (item, index) => {
    const lines = [
        `${index + 1}. ${item.title}`,
        `• Rating: ${item.rating || '-'}`,
        `• Status: ${item.status || '-'}`,
        `• Type: ${item.type || '-'}`,
        `• Episode: ${item.episodes || '-'}`,
        `• Duration: ${item.duration || '-'}`,
        `• Genre: ${item.genres || '-'}`,
        `• Link: ${item.link}`
    ]

    return lines.join('\n')
}

const buildCaption = (rows) => rows.map((item, index) => formatItem(item, index)).join('\n\n')

export default {
    name: 'anoboy',
    aliases: ['anoboysearch', 'anosearch'],
    description: 'Cari anime di Anoboy',
    execute: async ({ sock, msg, text, prefix, command, react, useLimit }) => {
        const jid = msg.key.remoteJid
        const query = normalizeQuery(text)

        if (!query) {
            return sock.sendMessage(jid, {
                text: `Contoh penggunaan:\n- ${prefix + command} alya`
            }, { quoted: msg })
        }

        await react('⏳')

        try {
            const html = await fetchSearchHtml(query)
            const baseRows = parseSearchRows(html)

            if (!baseRows.length) {
                await react('❌')
                return sock.sendMessage(jid, {
                    text: `❌ Tidak ditemukan hasil anoboy untuk: ${query}`
                }, { quoted: msg })
            }

            const rows = await mapWithConcurrency(baseRows, DETAIL_CONCURRENCY, fetchDetail)
            const caption = `\`\`\`${buildCaption(rows)}\`\`\``
            const imageBuffer = await fetchImageBuffer(rows[0]?.image)

            if (imageBuffer) {
                await sock.sendMessage(jid, {
                    image: imageBuffer,
                    caption
                }, { quoted: msg })
            } else {
                await sock.sendMessage(jid, {
                    text: caption
                }, { quoted: msg })
            }

            useLimit()
            await react('✅')
        } catch (err) {
            await react('❌')
            return sock.sendMessage(jid, {
                text: `❌ Error: ${err?.message || 'Unknown error'}`
            }, { quoted: msg })
        }
    }
}
