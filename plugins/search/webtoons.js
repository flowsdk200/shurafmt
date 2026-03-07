import axios from 'axios'
import * as cheerio from 'cheerio'

const SEARCH_URL = 'https://m.webtoons.com/id/search'
const MAX_RESULTS = 15
const REQUEST_TIMEOUT = 30000

const cleanText = (value) => String(value || '')
    .replace(/\*+/g, '')
    .replace(/\s+/g, ' ')
    .trim()

const normalizeUrl = (value) => {
    const raw = cleanText(value)
    if (!raw) return ''
    if (raw.startsWith('//')) return `https:${raw}`
    if (/^https?:\/\//i.test(raw)) return raw
    try {
        return new URL(raw, SEARCH_URL).toString()
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
            if (/(^|\.)webtoons\.com$/i.test(url.hostname)) {
                const keyword = cleanText(url.searchParams.get('keyword'))
                if (keyword) return keyword
            }
        } catch {
            return text
        }
    }

    return text
}

const capitalize = (value) => {
    const text = cleanText(value).toLowerCase()
    if (!text) return '-'
    return text.charAt(0).toUpperCase() + text.slice(1)
}

const parseLinkMeta = (url) => {
    const raw = normalizeUrl(url)
    if (!raw) return { genre: '-', titleNo: '-' }
    try {
        const u = new URL(raw)
        const titleNo = cleanText(u.searchParams.get('title_no')) || '-'
        const parts = u.pathname.split('/').filter(Boolean)
        // /id/action/high-school-soldier/list
        const genre = parts[1] && parts[1] !== 'canvas'
            ? capitalize(parts[1])
            : (parts[1] === 'canvas' ? 'Canvas' : '-')
        return { genre, titleNo }
    } catch {
        return { genre: '-', titleNo: '-' }
    }
}

const fetchSearchHtml = async (query) => {
    const response = await axios.get(SEARCH_URL, {
        params: { keyword: query },
        timeout: REQUEST_TIMEOUT,
        maxRedirects: 5,
        validateStatus: () => true,
        headers: {
            'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
            'Accept-Language': 'id-ID,id;q=0.9,en-US;q=0.8,en;q=0.7',
            'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8'
        }
    })

    if (response.status !== 200) {
        throw new Error(`HTTP ${response.status}`)
    }

    const html = String(response.data || '')
    if (!html.trim()) throw new Error('Respons kosong')
    return html
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
                'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
                'Accept-Language': 'id-ID,id;q=0.9,en-US;q=0.8,en;q=0.7',
                'Accept': 'image/avif,image/webp,image/apng,image/*,*/*;q=0.8',
                Referer: 'https://m.webtoons.com/'
            }
        })

        if (response.status !== 200) return null
        const contentType = cleanText(response.headers?.['content-type']).toLowerCase()
        if (!contentType.startsWith('image/')) return null

        const buffer = Buffer.from(response.data || [])
        if (!buffer.length) return null
        return buffer
    } catch {
        return null
    }
}

const parseRows = (html) => {
    const $ = cheerio.load(html)
    const wrap = $('.webtoon_list_wrap').first()
    if (!wrap.length) return []

    const rows = []
    const seen = new Set()
    let section = '-'

    wrap.children().each((_, node) => {
        const el = $(node)

        if (el.hasClass('section_header')) {
            const s = cleanText(el.find('.section_title').first().text())
            if (s) section = s
            return
        }

        if (!el.is('ul.webtoon_list')) return

        el.find('li > a.link').each((__, card) => {
            if (rows.length >= MAX_RESULTS) return
            const a = $(card)

            const link = normalizeUrl(a.attr('href'))
            const title = cleanText(a.find('.info_text .title').first().text())
            const author = cleanText(a.find('.info_text .author').first().text())
            const views = cleanText(a.find('.info_text .view_count').first().text())
            const image = normalizeUrl(a.find('.image_wrap img').first().attr('src'))
            const webtoonTypeRaw = cleanText(a.attr('data-webtoon-type'))
            const webtoonType = webtoonTypeRaw === 'CHALLENGE'
                ? 'CHALLENGE'
                : webtoonTypeRaw === 'WEBTOON'
                    ? 'WEBTOON'
                    : '-'
            const { genre, titleNo } = parseLinkMeta(link)

            if (!title || !link) return

            const key = link.toLowerCase()
            if (seen.has(key)) return
            seen.add(key)

            rows.push({
                title,
                section: cleanText(section || '-') || '-',
                author: author || '-',
                views: views || '-',
                type: webtoonType,
                genre,
                titleNo,
                link,
                image
            })
        })
    })

    return rows.slice(0, MAX_RESULTS)
}

const formatItem = (item, index) => (
    `${index + 1}. ${item.title}\n` +
    `× Type: ${item.section} (${item.type})\n` +
    `× Author: ${item.author}\n` +
    `× Views: ${item.views}\n` +
    `× Genre: ${item.genre}\n` +
    `× Title No: ${item.titleNo}\n` +
    `× Link: ${item.link}`
)

const buildCaption = (query, rows) => {
    const originalCount = rows.filter((x) => cleanText(x.section).toUpperCase() === 'ORIGINAL').length
    const canvasCount = rows.filter((x) => cleanText(x.section).toUpperCase() === 'KANVAS').length
    return (
    rows.map((item, idx) => formatItem(item, idx)).join('\n\n')
    )
}

export default {
    name: 'webtoons',
    aliases: ['webtoon', 'wtoon'],
    description: 'Cari webtoon (Original/Kanvas) dari Webtoons ID',
    execute: async ({ sock, msg, text, prefix, command, react, useLimit }) => {
        const jid = msg.key.remoteJid
        const query = normalizeQuery(text)

        if (!query) {
            return sock.sendMessage(jid, {
                text: `Contoh penggunaan:\n- ${prefix + command} change me`
            }, { quoted: msg })
        }

        await react('⏳')

        try {
            const html = await fetchSearchHtml(query)
            const rows = parseRows(html)
            if (!rows.length) {
                throw new Error('Tidak ada hasil Webtoons')
            }

            const caption = buildCaption(query, rows)
            const firstImage = normalizeUrl(rows[0]?.image)

            if (firstImage) {
                const imageBuffer = await fetchImageBuffer(firstImage)
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
                text: `❌ Error: ${cleanText(err?.message) || 'Gagal ambil data Webtoons'}`
            }, { quoted: msg })
        }
    }
}
