import axios from 'axios'
import * as cheerio from 'cheerio'

const SEARCH_BASE_URL = 'https://id.softmany.com/android/search'
const MAX_RESULTS = 10
const REQUEST_TIMEOUT = 30000
const DETAIL_CONCURRENCY = 4

const cleanText = (value) => String(value || '')
    .replace(/\s+/g, ' ')
    .trim()

const normalizeQuery = (rawInput) => {
    const text = cleanText(rawInput)
    if (!text) return ''

    if (/^https?:\/\//i.test(text)) {
        try {
            const url = new URL(text)
            if (/(^|\.)softmany\.com$/i.test(url.hostname) && url.pathname.includes('/android/search')) {
                const q = cleanText(url.searchParams.get('q'))
                if (q) return q
            }
        } catch {
            return text
        }
    }

    return text
}

const normalizeUrl = (value) => {
    const raw = cleanText(value)
    if (!raw) return ''
    if (raw.startsWith('//')) return `https:${raw}`
    if (/^https?:\/\//i.test(raw)) return raw
    return ''
}

const fetchSearchHtml = async (query) => {
    const { data, status } = await axios.get(SEARCH_BASE_URL, {
        params: { q: query },
        timeout: REQUEST_TIMEOUT,
        maxRedirects: 8,
        validateStatus: () => true,
        headers: {
            'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
            'Accept-Language': 'id-ID,id;q=0.9,en-US;q=0.8,en;q=0.7',
            'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
            'Referer': 'https://id.softmany.com/android'
        }
    })

    if (status !== 200) throw new Error(`HTTP ${status}`)
    const html = String(data || '')
    if (!html.trim()) throw new Error('Halaman kosong')
    if (/access denied|forbidden|captcha|just a moment/i.test(html)) {
        throw new Error('Halaman terproteksi/challenge')
    }
    return html
}

const fetchDetailHtml = async (url) => {
    const target = normalizeUrl(url)
    if (!target) return ''

    try {
        const { data, status } = await axios.get(target, {
            timeout: REQUEST_TIMEOUT,
            maxRedirects: 8,
            validateStatus: () => true,
            headers: {
                'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
                'Accept-Language': 'id-ID,id;q=0.9,en-US;q=0.8,en;q=0.7',
                'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
                'Referer': 'https://id.softmany.com/android'
            }
        })
        if (status !== 200) return ''
        const html = String(data || '')
        if (!html.trim()) return ''
        return html
    } catch {
        return ''
    }
}

const parseResults = (html) => {
    const $ = cheerio.load(String(html || ''))
    const rows = []
    const seen = new Set()

    $('a.card-link-home').each((_, node) => {
        if (rows.length >= MAX_RESULTS) return false
        const $node = $(node)

        const title = cleanText($node.find('h3').first().text())
        const desc = cleanText($node.find('p').first().text()) || '-'
        const link = normalizeUrl($node.attr('href'))
        const image = normalizeUrl($node.find('img.app-icon-img').first().attr('src'))

        if (!title || !link) return
        const key = link.toLowerCase()
        if (seen.has(key)) return
        seen.add(key)

        rows.push({
            title,
            source: 'SoftMany Android',
            desc,
            link,
            image
        })
    })

    return rows
}

const parseDetailMeta = (html, fallbackDesc) => {
    const $ = cheerio.load(String(html || ''))

    const version = cleanText($('.app-title-sc p.text-muted').first().text()) || '-'
    const developer = cleanText($('.app-title-sc p.text-primary').first().text()) || '-'
    const avgRating = cleanText($('#avg-rating').first().text())
    const voteCount = cleanText($('#vote-count').first().text())
    const rating = avgRating
        ? `${avgRating} (${voteCount || '0'} votes)`
        : cleanText($('#rating-text').first().text()) || '-'

    const statItems = $('.stats-line .stat-item').map((_, el) => cleanText($(el).text())).get()
    const updated = cleanText(statItems[1]) || '-'
    const platform = cleanText(statItems[2]) || '-'
    const size = cleanText(statItems[3]) || '-'
    const license = cleanText(statItems[4]) || '-'

    const category = cleanText($('ol.breadcrumb .breadcrumb-item a').eq(1).text()) || '-'
    const download = normalizeUrl($('a.new-download-btn').first().attr('href')) || '-'
    const detailDesc = cleanText($('h2.app-desc-mini').first().text()) || cleanText(fallbackDesc) || '-'

    return {
        version,
        developer,
        rating,
        updated,
        platform,
        size,
        license,
        category,
        download,
        desc: detailDesc
    }
}

const mapLimit = async (items, limit, iteratee) => {
    const list = Array.isArray(items) ? items : []
    const max = Math.max(1, Number(limit) || 1)
    const results = new Array(list.length)
    let cursor = 0

    const worker = async () => {
        while (true) {
            const idx = cursor
            if (idx >= list.length) return
            cursor += 1
            results[idx] = await iteratee(list[idx], idx)
        }
    }

    const workers = Array.from({ length: Math.min(max, list.length) }, () => worker())
    await Promise.all(workers)
    return results
}

const enrichRows = async (rows) => mapLimit(rows, DETAIL_CONCURRENCY, async (item) => {
    const html = await fetchDetailHtml(item.link)
    if (!html) return item
    const detail = parseDetailMeta(html, item.desc)
    return { ...item, ...detail }
})

const fetchImageBuffer = async (url) => {
    const target = normalizeUrl(url)
    if (!target || target.startsWith('data:')) return null

    try {
        const res = await axios.get(target, {
            responseType: 'arraybuffer',
            timeout: REQUEST_TIMEOUT,
            validateStatus: () => true,
            headers: {
                'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
                'Accept': 'image/avif,image/webp,image/apng,image/*,*/*;q=0.8'
            }
        })

        if (res.status !== 200) return null
        const type = cleanText(res.headers?.['content-type']).toLowerCase()
        if (!type.startsWith('image/')) return null

        const buf = Buffer.from(res.data || [])
        return buf.length ? buf : null
    } catch {
        return null
    }
}

const formatItem = (item, idx) =>
    `${idx + 1}. ${item.title}\n` +
    `• Version: ${item.version || '-'}\n` +
    `• Developer: ${item.developer || '-'}\n` +
    `• Rating: ${item.rating || '-'}\n` +
    `• Updated: ${item.updated || '-'}\n` +
    `• Platform: ${item.platform || '-'}\n` +
    `• Size: ${item.size || '-'}\n` +
    `• License: ${item.license || '-'}\n` +
    `• Category: ${item.category || '-'}\n` +
    `• Desc: ${item.desc || '-'}\n` +
    `• Link: ${item.link}\n` +
    `• Download: ${item.download || '-'}`

export default {
    name: 'softmany',
    aliases: ['softsearch', 'sfm'],
    description: 'Cari aplikasi Android dari SoftMany',
    execute: async ({ sock, msg, text, prefix, command, react, useLimit }) => {
        const jid = msg.key.remoteJid
        const query = normalizeQuery(text)

        if (!query) {
            return sock.sendMessage(jid, {
                text: `Contoh penggunaan:\n- ${prefix + command} vpn`
            }, { quoted: msg })
        }

        await react('⏳')
        try {
            const html = await fetchSearchHtml(query)
            const rows = parseResults(html)

            if (!rows.length) {
                await react('❌')
                return sock.sendMessage(jid, {
                    text: `❌ Tidak ditemukan hasil softmany untuk: ${query}`
                }, { quoted: msg })
            }

            const enrichedRows = await enrichRows(rows)
            const caption = enrichedRows.map((item, idx) => formatItem(item, idx)).join('\n\n')
            const imageBuffer = await fetchImageBuffer(enrichedRows[0]?.image)

            if (imageBuffer) {
                await sock.sendMessage(jid, {
                    image: imageBuffer,
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
