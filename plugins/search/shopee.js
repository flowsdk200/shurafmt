import axios from 'axios'
import * as cheerio from 'cheerio'
import { ffmpeg } from '../../src/utils/converter.js'

const SEARCH_URL = 'https://shopee.co.id/search'
const BASE_URL = 'https://shopee.co.id'
const MAX_RESULTS = 15
const REQUEST_TIMEOUT = 45000
const SHOP_NAME_CONCURRENCY = 6
const IMAGE_CHECK_TIMEOUT = 12000
const IMAGE_EXTS = ['webp', 'jpeg', 'jpg', 'png']
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
        .map((value) => normalizeShopNameImage(normalizeImage(value)))
        .filter(Boolean)

    return images.find((src) => /susercontent\.com\/file\//i.test(src) && !/_tn\.gif$/i.test(src) && !/_tn\.webp$/i.test(src)) ||
        images.find((src) => /susercontent\.com\/file\//i.test(src)) ||
        images.find((src) => /\/file\//i.test(src)) ||
        images.find((src) => /shopee\.(?:com|mobile)\/.*\.(webp|jpg|jpeg|png)/i.test(src)) ||
        images[0] ||
        null
}

const extractShopId = ($item) => {
    const link = cleanText($item.find('a.contents').first().attr('href'))
    if (!link) return null

    const matchProduct = link.match(/-i\.(\d+)\.(\d+)/i)
    if (matchProduct?.[1]) return matchProduct[1]

    const matchShop = link.match(/(?:\?|&)shopid=(\d+)/i)
    if (matchShop?.[1]) return matchShop[1]

    const anyShopLink = $item.find('a[href*="shopid="]').first().attr('href') || ''
    const matchShopFromAny = String(anyShopLink).match(/(?:\?|&)shopid=(\d+)/i)
    if (matchShopFromAny?.[1]) return matchShopFromAny[1]

    const dataShopId = cleanText(
        $item.find('[data-shopid], [data-shop-id]').first().attr('data-shopid')
        || $item.find('[data-shop-id]').first().attr('data-shop-id')
        || $item.attr('data-shopid')
        || ''
    )
    if (dataShopId && /^\d+$/.test(dataShopId)) return dataShopId

    const itemHtml = String($item.html() || '')
    const matchFromHtml = itemHtml.match(/(?:-i\.(\d+)\.(\d+))|shopid=(\d+)/i)
    if (matchFromHtml) return matchFromHtml[1] || matchFromHtml[3]

    return null
}

const normalizeShopNameImage = (value) => {
    const raw = cleanText(value)
    if (!raw) return null

    if (!/^https?:\/\//i.test(raw)) return null

    const isShopeeHost = /susercontent\.com/.test(raw)
    const removedTn = raw.replace(/_tn(?=\.[a-z0-9]+$|$)/i, '')

    if (isShopeeHost) {
        return removedTn
    }

    const isImageLike = /^https?:\/.+\.(?:jpe?g|png|webp|gif|bmp|avif)(?:$|\?|#)/i.test(raw)
    if (!isImageLike) return null

    return removedTn
}

const buildImageCandidates = (value) => {
    const raw = normalizeImage(value)
    if (!raw) return []

    const set = new Set()
    const add = (candidate) => {
        if (!candidate) return
        const normalized = candidate.replace(/(\?.*)$/g, '')
        if (!normalized || !/^https?:\/\//i.test(normalized)) return
        set.add(normalized)
    }

    add(raw)
    add(normalizeShopNameImage(raw))

    try {
        const url = new URL(raw)
        const path = url.pathname
        const base = `${url.origin}${path}`
        add(base)

        const noTn = path.replace(/_tn(?=\.[^./?#]+$)/i, '')
        add(`${url.origin}${noTn}`)

        const withoutExt = base.replace(/\.[^./?#]+$/i, '')
        IMAGE_EXTS.forEach((ext) => add(`${withoutExt}.${ext}`))

        const noTnNoExt = `${url.origin}${noTn.replace(/\.[^./?#]+$/i, '')}`
        IMAGE_EXTS.forEach((ext) => add(`${noTnNoExt}.${ext}`))
    } catch {
        // ignore invalid URLs
    }

    return [...set]
}

const sniffImageMime = (buffer) => {
    if (!buffer || buffer.length < 12) return null

    const b = buffer.slice(0, 12)

    if (b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff) return 'image/jpeg'
    if (b[0] === 0x89 && b[1] === 0x50 && b[2] === 0x4e && b[3] === 0x47) return 'image/png'
    if (b[0] === 0x47 && b[1] === 0x49 && b[2] === 0x46 && b[3] === 0x38) return 'image/gif'
    if (b.toString('latin1', 0, 4) === 'RIFF' && b.toString('latin1', 8, 12) === 'WEBP') return 'image/webp'
    if (b.toString('latin1', 4, 12) === 'ftyp') return 'video/mp4'
    return null
}

const convertWebpToJpegIfNeeded = async (payload) => {
    if (!payload || !Buffer.isBuffer(payload.buffer)) return payload
    if (payload.mimetype !== 'image/webp') return payload

    try {
        const converted = await ffmpeg(payload.buffer, ['-frames:v', '1'], 'webp', 'jpg')
        const jpeg = converted?.data
        if (Buffer.isBuffer(jpeg) && jpeg.length) {
            return { buffer: jpeg, mimetype: 'image/jpeg' }
        }
    } catch {
        // fallback to original if conversion fails
    }

    return payload
}

const fetchImageBuffer = async (url) => {
    if (!url || !/^https?:\/\//i.test(url)) return null

    try {
        const response = await axios.get(url, {
            timeout: IMAGE_CHECK_TIMEOUT,
            maxRedirects: 5,
            responseType: 'arraybuffer',
            validateStatus: () => true,
            headers: {
                'User-Agent': USER_AGENTS[0],
                'Accept': 'image/avif,image/webp,image/apng,image/*,*/*;q=0.8',
                'Referer': BASE_URL
            }
        })

        if (response.status < 200 || response.status >= 400) return null

        const ct = String(response.headers?.['content-type'] || '').toLowerCase()
        const mimeFromCt = ct ? ct.split(';')[0].trim() : ''
        if (mimeFromCt && !mimeFromCt.startsWith('image/')) return null

        const buffer = Buffer.from(response.data || [])
        if (!buffer.length) return null

        const mimeFromBuffer = sniffImageMime(buffer)
        const resolvedMime = mimeFromCt || mimeFromBuffer
        if (!resolvedMime || !resolvedMime.startsWith('image/')) return null

        return { buffer, mimetype: resolvedMime }
    } catch {
        return null
    }
}

const sendImageMessage = async (sock, jid, msg, caption, imageSources) => {
    const attempted = new Set()

    for (const source of imageSources) {
        const candidates = buildImageCandidates(normalizeShopNameImage(source))
        for (const candidate of candidates) {
            if (!candidate || attempted.has(candidate)) continue
            attempted.add(candidate)

            try {
                const result = await fetchImageBuffer(candidate)
                if (!result) continue

                const finalImage = await convertWebpToJpegIfNeeded(result)
                await sock.sendMessage(jid, {
                    image: finalImage.buffer,
                    mimetype: finalImage.mimetype || 'image/jpeg',
                    fileName: 'shopee-result.jpg',
                    caption
                }, { quoted: msg })
                return true
            } catch {
                // keep trying next candidate
            }
        }
    }

    return false
}

const sendInChunks = async (sock, jid, text, msg) => {
    const MAX_LEN = 4000
    let remaining = cleanText(text)

    if (!remaining) {
        return
    }

    if (remaining.length <= MAX_LEN) {
        await sock.sendMessage(jid, { text: remaining }, { quoted: msg })
        return
    }

    while (remaining.length) {
        let chunk = remaining.slice(0, MAX_LEN)
        let cut = chunk.lastIndexOf('\n\n')

        if (cut < 1200) cut = chunk.lastIndexOf('\n')
        if (cut < 1000) cut = chunk.lastIndexOf(' ')
        if (cut < 1) cut = MAX_LEN

        chunk = remaining.slice(0, cut).trimEnd()
        if (chunk) {
            await sock.sendMessage(jid, { text: chunk }, { quoted: msg })
        }
        remaining = remaining.slice(cut).trimStart()
    }
}

const fetchProductImage = async (productUrl) => {
    if (!productUrl || !/^https?:\/\//i.test(productUrl)) return null

    try {
        const { data, status } = await axios.get(productUrl, {
            timeout: IMAGE_CHECK_TIMEOUT,
            maxRedirects: 5,
            headers: {
                'User-Agent': USER_AGENTS[0],
                'Accept-Language': 'id-ID,id;q=0.9,en-US;q=0.8,en;q=0.7'
            },
            validateStatus: () => true
        })

        if (status !== 200 || !data) return null

        const $ = cheerio.load(String(data))
        const metaImage = [
            normalizeImage($('meta[property="og:image"]').attr('content')),
            normalizeImage($('meta[name="twitter:image"]').attr('content')),
            normalizeImage($('meta[property="og:image:secure_url"]').attr('content'))
        ].find(Boolean)

        if (metaImage) return metaImage

        const jsonLd = $('script[type="application/ld+json"]').map((_, el) => $(el).text()).get()
            .map((value) => {
                try {
                    return JSON.parse(value)
                } catch {
                    return null
                }
            })
            .find((item) => item && (item['@type'] === 'Product' || item['@type'] === 'ItemList'))

        const ldImage = normalizeImage(Array.isArray(jsonLd?.image) ? jsonLd.image[0] : jsonLd?.image)
        if (ldImage) return ldImage
    } catch {
        return null
    }

    return null
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
    const queue = []
    const seen = new Set()

    for (const row of rows) {
        if (!row.shopId || seen.has(row.shopId)) continue
        seen.add(row.shopId)
        queue.push(row.shopId)
    }

    const processNext = async () => {
        if (!queue.length) return
        const shopId = queue.shift()
        const rowsForId = rows.filter((row) => row.shopId === shopId)
        const name = await fetchShopName(shopId)
        for (const row of rowsForId) {
            row.shop = name
        }
        await processNext()
    }

    await Promise.all(
        Array.from({ length: Math.min(SHOP_NAME_CONCURRENCY, queue.length) }, () => processNext())
    )
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
            const captionText = `\`\`\`\n${caption}\`\`\``

            const imageSources = []
            const imageCandidates = rows.slice(0, 3)

            imageCandidates.forEach((row) => {
                if (row?.image) imageSources.push(row.image)
            })

            const extraProductImages = await Promise.all(
                imageCandidates
                    .map((row) => row?.link)
                    .filter(Boolean)
                    .map((link) => fetchProductImage(link))
            )

            extraProductImages.forEach((itemImage) => {
                if (itemImage) imageSources.push(itemImage)
            })

            const sent = await sendImageMessage(sock, jid, msg, captionText, imageSources)
            if (!sent) {
                await sendInChunks(sock, jid, captionText, msg)
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
