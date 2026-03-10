import axios from 'axios'
import * as cheerio from 'cheerio'

const SEARCH_URL = 'https://shopee.co.id/search'
const BASE_URL = 'https://shopee.co.id'
const MAX_RESULTS = 15
const REQUEST_TIMEOUT = 45000
const USER_AGENTS = [
    'Mozilla/5.0 (compatible; Googlebot/2.1; +http://www.google.com/bot.html)',
    'Mozilla/5.0 (compatible; bingbot/2.0; +http://www.bing.com/bingbot.htm)',
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
    'Mozilla/5.0 (iPhone; CPU iPhone OS 16_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/16.0 Mobile/15E148 Safari/604.1'
]

const cleanText = (value) => String(value || '')
    .replace(/\s+/g, ' ')
    .trim()

const tokenize = (text) => cleanText(text)
    .toLowerCase()
    .replace(/[^a-z0-9]+/gi, ' ')
    .split(' ')
    .filter((w) => w && w.length >= 2)

const normalizeQuery = (rawInput) => {
    const text = cleanText(rawInput)
    if (!text) return ''

    if (/^https?:\/\//i.test(text)) {
        try {
            const url = new URL(text)
            if (/(^|\.)shopee\.co\.id$/i.test(url.hostname) && url.pathname.startsWith('/search')) {
                const keyword = cleanText(url.searchParams.get('keyword') || url.searchParams.get('q'))
                if (keyword) return keyword
            }
        } catch {
            // keep raw text as fallback
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

const pickTitle = ($item) => {
    const title = cleanText($item.find('div.line-clamp-2').first().text())
    return title || '-'
}

const pickPrice = ($item) => {
    const text = cleanText($item.find('div.truncate.flex.items-baseline').first().text())
    return text ? text : '-'
}

const pickDiscount = ($item) => {
    const text = cleanText($item.find('div.bg-shopee-pink').first().text())
    return text || '-'
}

const pickRating = ($item) => {
    const text = cleanText($item.find('div.text-shopee-black87').first().text())
    return text || '-'
}

const pickLocation = ($item) => {
    const label = $item.find('span[aria-label^="location-"]').first()
    if (!label.length) return '-'

    const raw = cleanText(label.attr('aria-label') || '')
    if (raw) return cleanText(raw.replace(/^location-/, ''))

    return cleanText(label.closest('div').text()) || '-'
}

const normalizeImageFromCard = ($item) => {
    const rawCandidates = []

    $item.find('img').each((_, el) => {
        rawCandidates.push(el.attribs?.src || '')
        rawCandidates.push(el.attribs?.['data-src'] || '')
    })

    $item.find('[aria-label]').each((_, el) => {
        const label = cleanText(el.attribs?.ariaLabel || '')
        const match = label.match(/src:([^\s,]+)/i)
        if (match?.[1]) rawCandidates.push(match[1])
    })

    const images = rawCandidates
        .map((value) => normalizeImage(value))
        .filter(Boolean)

    return images.find((src) => /susercontent\.com\/file\//i.test(src) && !/_tn\.gif$/i.test(src) && !/_tn\.webp$/i.test(src)) ||
        images.find((src) => /susercontent\.com\/file\//i.test(src)) ||
        images.find((src) => /\/file\//i.test(src)) ||
        images.find((src) => /shopee\.(?:com|mobile)\/.*\.(webp|jpg|jpeg|png)/i.test(src)) ||
        images[0] ||
        null
}

const extractShopId = ($item) => {
    const shopLink = $item.find('a[href*="shopid="]').first().attr('href') || ''
    const match = String(shopLink).match(/(?:\?|&)shopid=(\d+)/i)
    return match?.[1] || null
}

const shopNameCache = new Map()

const fetchShopName = async (shopId) => {
    if (!shopId) return '-'
    if (shopNameCache.has(shopId)) return shopNameCache.get(shopId) || '-'

    try {
        const { data, status } = await axios.get(`${BASE_URL}/api/v4/shop/get_shop_base`, {
            params: { shopid: shopId },
            timeout: 12000,
            validateStatus: () => true,
            headers: {
                'User-Agent': USER_AGENTS[0],
                'Accept-Language': 'id-ID,id;q=0.9,en-US;q=0.8,en;q=0.7'
            }
        })

        if (status !== 200) {
            shopNameCache.set(shopId, '-')
            return '-'
        }

        const shopName = cleanText(data?.data?.name || data?.name || '')
        const result = shopName || '-'
        shopNameCache.set(shopId, result)
        return result
    } catch {
        shopNameCache.set(shopId, '-')
        return '-'
    }
}

const enrichShopNames = async (rows) => {
    const pending = []
    const seen = new Set()

    for (const row of rows) {
        if (!row.shopId || seen.has(row.shopId)) continue
        seen.add(row.shopId)
        pending.push((async () => {
            const name = await fetchShopName(row.shopId)
            row.shop = name
            return { shopId: row.shopId, name }
        })())
    }

    await Promise.all(pending.slice(0, 8))
    return rows
}

const pickRelevance = ($item, keywords) => {
    if (!keywords.length) return 1

    const title = cleanText($item.find('div.line-clamp-2').first().text()).toLowerCase()
    if (!title) return 0

    let score = 0
    for (const keyword of keywords) {
        if (title.includes(keyword)) {
            score += 1
        }
    }

    return score
}

const isProductHref = (href) => {
    if (!href) return false
    return /-i\.\d+\.\d+/.test(href)
}

const parseRows = (html, keywords = []) => {
    const $ = cheerio.load(String(html || ''))
    const rows = []
    const seen = new Set()

    $('li.shopee-search-item-result__item').each((_, itemEl) => {
        const $anchor = $(itemEl).find('a.contents').first()
        if (!$anchor.length) return

        const link = toAbsoluteUrl($anchor.attr('href'))
        if (!isProductHref(link)) return
        if (seen.has(link)) return

        const title = pickTitle($anchor)
        if (!title || title === '-') return

        const relevance = pickRelevance($anchor, keywords)
        const item = {
            title,
            link,
            shop: '-',
            price: pickPrice($anchor),
            discount: pickDiscount($anchor),
            rating: pickRating($anchor),
            location: pickLocation($anchor),
            image: normalizeImageFromCard($anchor),
            shopId: extractShopId($(itemEl)),
            relevance
        }
        rows.push(item)
        seen.add(link)

        if (rows.length >= MAX_RESULTS) {
            return false
        }
    })

    if (keywords.length) {
        const matched = rows.filter((row) => row.relevance > 0)
        if (matched.length > 0) {
            const unmatched = rows.filter((row) => row.relevance === 0)
            return [...matched, ...unmatched].slice(0, MAX_RESULTS)
        }
    }

    return rows
}

const fetchSearchHtml = async (query) => {
    const keywords = tokenize(query)
    let lastError = null

    for (const userAgent of USER_AGENTS) {
        try {
            const { data, status } = await axios.get(SEARCH_URL, {
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

            if (status !== 200) {
                lastError = new Error(`HTTP ${status}`)
                continue
            }

            const rows = parseRows(data, keywords)
            if (!rows.length) {
                lastError = new Error('Produk tidak ditemukan pada respons Shopee')
                continue
            }

            return rows
        } catch (err) {
            lastError = err
        }
    }

    throw lastError || new Error('Gagal mengambil data Shopee')
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
            const rows = await fetchSearchHtml(q)
            await enrichShopNames(rows)

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
                    caption: `\`\`\`\n${caption}\`\`\``
                }, { quoted: msg })
            } else {
                await sock.sendMessage(jid, {
                    text: `\`\`\`\n${caption}\`\`\``
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
