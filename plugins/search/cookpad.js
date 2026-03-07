import axios from 'axios'
import * as cheerio from 'cheerio'

const SEARCH_URL = 'https://cookpad.com/id/cari/{query}'
const SEARCH_URL_FALLBACK = 'https://www.cookpad.com/id/cari/{query}'
const SEARCH_URL_EVENT = 'https://cookpad.com/id/cari/{query}?event=search.suggestion&order=recent'
const BASE_URL = 'https://cookpad.com'
const MAX_RESULTS = 10
const REQUEST_TIMEOUT = 30000
const MAX_RETRY = 2

const cleanText = (value) => String(value || '').replace(/\s+/g, ' ').trim()

const normalizeQuery = (raw) => {
    const trimmed = cleanText(raw)
    if (!trimmed) return ''

    try {
        const url = new URL(trimmed)
        if (/cookpad\.com$/i.test(url.hostname) && url.pathname.startsWith('/id/cari/')) {
            const pathQuery = decodeURIComponent(url.pathname.replace(/^\/id\/cari\//, '').trim()) || ''
            if (pathQuery) return pathQuery
        }
        const paramQ = cleanText(url.searchParams.get('q'))
        if (paramQ) return paramQ
    } catch {}

    return trimmed
}

const toAbsoluteUrl = (url) => {
    const raw = cleanText(url)
    if (!raw) return '-'
    if (/^https?:\/\//i.test(raw)) return raw
    return `${BASE_URL}${raw.startsWith('/') ? '' : '/'}${raw}`
}

const cleanImage = (url) => {
    const raw = cleanText(url)
    if (!raw) return null
    if (!/^https?:\/\//i.test(raw)) return null
    return raw
}

const extractImage = ($item) => {
    const candidates = $item.find('img')
        .map((_, img) => cleanImage(img.attribs?.src || img.attribs?.['data-src']))
        .get()
        .filter(Boolean)
        .filter((src) => /\/recipes?\//i.test(src) && !/\/comments?\//i.test(src))

    return candidates[0] || null
}

const parseResultCard = ($, $item) => {
    const title = cleanText($item.find('h2 a.block-link__main').first().text())
    if (!title) return null

    const link = toAbsoluteUrl($item.find('h2 a.block-link__main').first().attr('href'))
    const author = cleanText($item.find('span.clamp-1').first().text())
    const ingredient = cleanText($item.find('[data-ingredients-redesign-target=\"ingredients\"] .line-clamp-2').first().text())
    const meta = $item.find('.mise-icon-text').map((_, el) => cleanText($(el).text())).get().filter(Boolean)
    const duration = meta[0] || '-'
    const servings = meta[1] || '-'
    const image = extractImage($item) || null

    return {
        title,
        link,
        author: author || '-',
        duration,
        servings,
        ingredients: ingredient || '-',
        image
    }
}

const parseSearchResults = (html) => {
    const $ = cheerio.load(html)
    const results = []

    $('li[id^=\"recipe_\"]').each((_, item) => {
        if (results.length >= MAX_RESULTS) return false
        const row = parseResultCard($, $(item))
        if (row) results.push(row)
    })

    return results
}

const fetchSearchHtml = async (query) => {
    const candidates = [
        SEARCH_URL,
        SEARCH_URL_EVENT,
        SEARCH_URL_FALLBACK
    ]

    const headersList = [
        {
            'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
            'Accept-Language': 'id-ID,id;q=0.9,en-US;q=0.8,en;q=0.7',
            'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
            'Cache-Control': 'no-cache',
            'Pragma': 'no-cache'
        },
        {
            'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15',
            'Accept-Language': 'id-ID,id;q=0.9,en-US;q=0.8',
            'Accept': 'text/html,application/xml;q=0.9,*/*;q=0.8'
        }
    ]

    let lastErr = null

    for (const template of candidates) {
        const searchUrl = template.replace('{query}', encodeURIComponent(query))

        for (let attempt = 0; attempt < MAX_RETRY; attempt += 1) {
            const headers = headersList[Math.min(attempt, headersList.length - 1)]
            try {
                const { data, status } = await axios.get(searchUrl, {
                    timeout: REQUEST_TIMEOUT,
                    headers,
                    maxRedirects: 8,
                    validateStatus: () => true
                })

                if (!data || typeof data !== 'string' || data.length < 500) {
                    lastErr = new Error('Respons server tidak valid')
                    continue
                }

                if (status >= 400) {
                    lastErr = new Error(`HTTP ${status}`)
                    continue
                }

                if (/just a moment|enable javascript and cookies|cloudflare/i.test(data)) {
                    lastErr = new Error('security challenge')
                    continue
                }

                return data
            } catch (err) {
                lastErr = err
            }
        }
    }

    throw lastErr || new Error('Tidak bisa mengambil data search Cookpad')
}

const buildCaption = (query, rows) => {
    const rowsText = rows
        .map((row, idx) => {
            const ingredients = row.ingredients.length > 200
                ? `${row.ingredients.slice(0, 200)}...`
                : row.ingredients

            return `${idx + 1}. ${row.title}\n` +
                `× Author: ${row.author}\n` +
                `× Waktu: ${row.duration}\n` +
                `× Porsi: ${row.servings}\n` +
                `× Bahan: ${ingredients}\n` +
                `× Link: ${row.link}\n`
        })
        .join('\n')

    return `\`\`\`${rowsText}\`\`\``
}

export default {
    name: 'cookpad',
    aliases: ['cp', 'cookpadsearch'],
    description: 'Cari resep di Cookpad',
    execute: async ({ sock, msg, text, prefix, command, react, useLimit }) => {
        const jid = msg.key.remoteJid
        const query = normalizeQuery(text)

        if (!query) {
            return sock.sendMessage(jid, {
                text: `Contoh penggunaan:\n- ${prefix + command} ayam bakar`
            }, { quoted: msg })
        }

        await react('⏳')

        try {
            const data = await fetchSearchHtml(query)

            const rows = parseSearchResults(data)
            if (!rows.length) {
                await react('❌')
                return sock.sendMessage(jid, {
                    text: `❌ Tidak ditemukan hasil cookpad untuk: ${query}`
                }, { quoted: msg })
            }

            const caption = buildCaption(query, rows)
            const firstImage = rows[0]?.image

            if (firstImage) {
                await sock.sendMessage(jid, {
                    image: { url: firstImage },
                    caption
                }, { quoted: msg })
            } else {
                await sock.sendMessage(jid, { text: caption }, { quoted: msg })
            }

            useLimit()
            await react('✅')
        } catch (err) {
            await react('❌')
            const lowerMessage = String(err?.message || '').toLowerCase()
            if (lowerMessage.includes('security challenge')) {
                return sock.sendMessage(jid, {
                    text: '❌ Gagal mengakses cookpad (security challenge)'
                }, { quoted: msg })
            }
            if (lowerMessage.includes('tidak ada hasil') || lowerMessage.includes('respons server tidak valid')) {
                return sock.sendMessage(jid, {
                    text: `❌ Tidak ditemukan hasil cookpad untuk: ${query}`
                }, { quoted: msg })
            }
            const msgErr = err?.response?.status
                ? `❌ Gagal search Cookpad: HTTP ${err.response.status}`
                : `❌ Gagal search Cookpad: ${err.message}`
            await sock.sendMessage(jid, {
                text: msgErr
            }, { quoted: msg })
        }
    }
}
