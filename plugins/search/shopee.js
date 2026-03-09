import axios from 'axios'
import * as cheerio from 'cheerio'

const SEARCH_BASE_URL = 'https://shopee.co.id/search'
const BASE_URL = 'https://shopee.co.id'
const MAX_RESULTS = 15
const REQUEST_TIMEOUT = 45000
const DETAIL_TIMEOUT = 20000
const DETAIL_CONCURRENCY = 3
const BOT_USER_AGENTS = [
    'Mozilla/5.0 (compatible; Googlebot/2.1; +http://www.google.com/bot.html)',
    'Mozilla/5.0 (compatible; bingbot/2.0; +http://www.bing.com/bingbot.htm)'
]

const cleanText = (value) => String(value || '')
    .replace(/\s+/g, ' ')
    .trim()

const normalizeQuery = (rawInput) => {
    const text = cleanText(rawInput)
    if (!text) return ''

    if (/^https?:\/\//i.test(text)) {
        try {
            const url = new URL(text)
            if (/(^|\.)shopee\.co\.id$/i.test(url.hostname) && url.pathname.startsWith('/search')) {
                const q = cleanText(url.searchParams.get('keyword') || url.searchParams.get('q'))
                if (q) return q
            }
        } catch {
            // fallback to raw text
        }
    }

    return text
}

const toAbsoluteUrl = (value) => {
    const raw = cleanText(value)
    if (!raw) return null
    if (/^https?:\/\//i.test(raw)) return raw
    return `${BASE_URL}${raw.startsWith('/') ? '' : '/'}${raw}`
}

const normalizeImage = (value) => {
    const raw = cleanText(value)
    if (!raw) return null
    if (/^https?:\/\//i.test(raw)) return raw
    if (raw.startsWith('//')) return `https:${raw}`
    return null
}

const parseJsonLdBlocks = (html) => {
    const scripts = [...String(html || '').matchAll(/<script[^>]*type="application\/ld\+json"[^>]*>([\s\S]*?)<\/script>/gi)]
    const rows = []

    for (const match of scripts) {
        try {
            rows.push(JSON.parse(match[1]))
        } catch {
            // ignore invalid block
        }
    }

    return rows
}

const parseCard = ($, $item) => {
    const $anchor = $item.find('a.contents').first()
    const link = toAbsoluteUrl($anchor.attr('href'))
    if (!link) return null

    const title = cleanText($anchor.find('div.line-clamp-2').first().text())
    if (!title) return null

    const image = $anchor.find('img')
        .map((_, el) => normalizeImage($(el).attr('src')))
        .get()
        .filter(Boolean)
        .find((src) => /susercontent\.com\/file\//i.test(src) && !/_tn\.gif$/i.test(src)) || null

    const price = cleanText($anchor.find('span[aria-label="promotion price"]').parent().siblings('div.truncate.flex.items-baseline').text())
        || cleanText($anchor.find('div.truncate.flex.items-baseline').first().text())
        || '-'

    const discount = cleanText($anchor.find('div.bg-shopee-pink').first().text()) || '-'
    const rating = cleanText($anchor.find('div.text-shopee-black87').first().text()) || '-'
    const location = cleanText($anchor.find('span[aria-label^="location-"]').parent().find('span').last().text()) || '-'

    const itemMatch = link.match(/-i\.(\d+)\.(\d+)/i)

    return {
        title,
        link,
        image,
        price,
        discount,
        rating,
        location,
        shop: '-',
        shopId: itemMatch?.[1] || '-',
        itemId: itemMatch?.[2] || '-'
    }
}

const parseResults = (html) => {
    const $ = cheerio.load(String(html || ''))
    const rows = []
    const seen = new Set()

    $('li.shopee-search-item-result__item').each((_, el) => {
        const row = parseCard($, $(el))
        if (!row) return
        if (seen.has(row.link)) return
        seen.add(row.link)
        rows.push(row)
        if (rows.length >= MAX_RESULTS) return false
    })

    return rows
}

const fetchSearchHtml = async (query) => {
    let lastErr = null

    for (const userAgent of BOT_USER_AGENTS) {
        try {
            const { data, status } = await axios.get(SEARCH_BASE_URL, {
                params: { keyword: query },
                timeout: REQUEST_TIMEOUT,
                maxRedirects: 5,
                validateStatus: () => true,
                headers: {
                    'User-Agent': userAgent,
                    'Accept-Language': 'id-ID,id;q=0.9,en-US;q=0.8,en;q=0.7',
                    'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
                    'Cache-Control': 'no-cache',
                    'Pragma': 'no-cache'
                }
            })

            const html = String(data || '')
            if (status !== 200) {
                lastErr = new Error(`HTTP ${status}`)
                continue
            }

            if (!html || html.length < 5000) {
                lastErr = new Error('Respons HTML Shopee tidak valid')
                continue
            }

            if (!/shopee-search-item-result__item/i.test(html)) {
                lastErr = new Error('Card produk Shopee tidak ditemukan')
                continue
            }

            return { html, userAgent }
        } catch (err) {
            lastErr = err
        }
    }

    throw lastErr || new Error('Gagal mengambil HTML Shopee')
}

const extractShopNameFromDetail = (html) => {
    for (const block of parseJsonLdBlocks(html)) {
        const type = cleanText(block?.['@type']).toLowerCase()
        if (type !== 'product') continue

        const sellerName = cleanText(block?.offers?.seller?.name || block?.seller?.name)
        if (sellerName) return sellerName
    }

    return '-'
}

const fetchShopName = async (link, userAgent) => {
    if (!link) return '-'

    const { data, status } = await axios.get(link, {
        timeout: DETAIL_TIMEOUT,
        maxRedirects: 5,
        validateStatus: () => true,
        headers: {
            'User-Agent': userAgent,
            'Accept-Language': 'id-ID,id;q=0.9,en-US;q=0.8,en;q=0.7',
            'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
            'Cache-Control': 'no-cache',
            'Pragma': 'no-cache'
        }
    })

    if (status !== 200) return '-'
    return extractShopNameFromDetail(data)
}

const enrichRowsWithShop = async (rows, userAgent) => {
    const output = rows.map((row) => ({ ...row }))
    let cursor = 0

    const worker = async () => {
        while (cursor < output.length) {
            const index = cursor++
            const row = output[index]

            try {
                row.shop = await fetchShopName(row.link, userAgent)
            } catch {
                row.shop = row.shop || '-'
            }
        }
    }

    const workers = Array.from(
        { length: Math.min(DETAIL_CONCURRENCY, output.length) },
        () => worker()
    )

    await Promise.all(workers)
    return output
}

const formatItem = (item, index) =>
    `${index + 1}. ${item.title}\n` +
    `• Harga: ${item.price}\n` +
    `• Toko: ${item.shop}\n` +
    `• Diskon: ${item.discount}\n` +
    `• Rating: ${item.rating}\n` +
    `• Lokasi: ${item.location}\n` +
    `• Link: ${item.link}`

export default {
    name: 'shopee',
    aliases: ['shp'],
    description: 'Cari produk di shopee',
    execute: async ({ sock, msg, text, prefix, command, react, useLimit }) => {
        const jid = msg.key.remoteJid
        const q = normalizeQuery(text)

        if (!q) {
            return sock.sendMessage(jid, {
                text: `Contoh penggunaan:\n- ${prefix + command} pc gaming`
            }, { quoted: msg })
        }

        await react('⏳')

        try {
            const { html, userAgent } = await fetchSearchHtml(q)
            const parsedRows = parseResults(html)
            const rows = await enrichRowsWithShop(parsedRows, userAgent)

            if (!rows.length) {
                await react('❌')
                return sock.sendMessage(jid, {
                    text: `❌ Tidak ditemukan hasil shopee untuk: ${q}`
                }, { quoted: msg })
            }

            const caption = rows
                .map((item, index) => formatItem(item, index))
                .join('\n\n')

            const firstImage = rows[0]?.image
            if (firstImage) {
                await sock.sendMessage(jid, {
                    image: { url: firstImage },
                    caption: `\`\`\`${caption}\`\`\``
                }, { quoted: msg })
            } else {
                await sock.sendMessage(jid, {
                    text: `\`\`\`${caption}\`\`\``
                }, { quoted: msg })
            }

            useLimit()
            await react('✅')
        } catch (err) {
            await react('❌')
            await sock.sendMessage(jid, {
                text: `❌ Error: ${err?.message}`
            }, { quoted: msg })
        }
    }
}
