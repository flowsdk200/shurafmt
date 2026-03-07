import axios from 'axios'
import { load } from 'cheerio'

const FEED_URL = 'https://www.inews.id/feed'
const USER_AGENT = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36'
const DEFAULT_LIMIT = 10
const MAX_LIMIT = 10
const IMAGE_EXTENSIONS = /\.(jpe?g|png|webp|gif|bmp|svg|avif|heic|heif)(\?|$)/i
const VIDEO_EXTENSIONS = /\.(3gp|avi|flv|m4v|mkv|mov|mp4|mpg|mpeg|m3u8|webm|wmv|ogv)(\?|$)/i

const normalizeText = (value) => String(value || '').trim()
const toNewsDate = (value) => {
    if (!value) return '-'

    const parsed = new Date(value)
    if (Number.isNaN(parsed.getTime())) return normalizeText(value)

    return parsed.toLocaleString('id-ID', {
        timeZone: 'Asia/Jakarta',
        year: 'numeric',
        month: '2-digit',
        day: '2-digit',
        hour: '2-digit',
        minute: '2-digit',
        hour12: false
    })
}

const stripHtml = (value) => {
    if (!value) return '-'
    return String(value)
        .replace(/<[^>]*>/g, ' ')
        .replace(/\s+/g, ' ')
        .trim()
}

const truncate = (text, max = 150) => {
    const value = normalizeText(text)
    if (!value) return '-'
    return value.length > max ? `${value.slice(0, max)}...` : value
}

const normalizeImageUrl = (value) => {
    const url = normalizeText(value)
    if (!url) return null
    if (!url.startsWith('http://') && !url.startsWith('https://')) return null
    if (VIDEO_EXTENSIONS.test(url.toLowerCase())) return null
    return IMAGE_EXTENSIONS.test(url.toLowerCase()) || /\/(image|images?|thumb|media|photo)\//i.test(url)
        ? url
        : url
}

const extractImageFromPage = async (url) => {
    try {
        const response = await axios.get(url, {
            timeout: 120000,
            headers: {
                'User-Agent': USER_AGENT
            },
            validateStatus: () => true
        })

        if (response.status < 200 || response.status >= 400) return null
        const html = String(response.data || '')

        const $ = load(html)
        const candidates = [
            $('meta[property="og:image"]').attr('content'),
            $('meta[property="og:image:url"]').attr('content'),
            $('meta[name="twitter:image"]').attr('content'),
            $('meta[name="twitter:image:src"]').attr('content'),
            $('meta[itemprop="image"]').attr('content')
        ]

        for (const candidate of candidates) {
            const image = normalizeImageUrl(candidate)
            if (image) return image
        }
        return null
    } catch {
        return null
    }
}

const isImage = (url) => {
    if (!url) return false
    if (VIDEO_EXTENSIONS.test(url.toLowerCase())) return false
    const lower = url.toLowerCase()
    return IMAGE_EXTENSIONS.test(lower) || /\/(image|images?|thumb|media|photo)/i.test(lower)
}

const parseArgs = (args = []) => {
    const result = {
        category: '',
        limit: DEFAULT_LIMIT
    }

    for (const token of args) {
        const fixed = normalizeText(token).toLowerCase()
        if (!fixed) continue

        if (fixed.startsWith('limit=')) {
            const value = Number(fixed.replace('limit=', ''))
            if (Number.isInteger(value) && value > 0) {
                result.limit = Math.min(MAX_LIMIT, Math.max(1, value))
            }
            continue
        }

        if (/^\d+$/.test(fixed)) {
            const value = Number(fixed)
            if (Number.isInteger(value) && value > 0) {
                result.limit = Math.min(MAX_LIMIT, Math.max(1, value))
            }
            continue
        }

        if (!result.category) {
            result.category = fixed
        }
    }

    return result
}

const parseItems = (xmlText) => {
    const $ = load(xmlText, { xmlMode: true })
    const rows = []

    $('channel item').each((_, itemNode) => {
        const $item = $(itemNode)
        const title = normalizeText($item.find('title').first().text())
        const link = normalizeText($item.find('link').first().text())
        const date = normalizeText(
            $item.find('pubDate').first().text() ||
            $item.find('dc\\:date').first().text()
        )
        const category = normalizeText($item.find('category').first().text())
        const description = normalizeText($item.find('description').first().text() || $item.find('content\\:encoded').first().text())

        const image = normalizeImageUrl(
            $item.find('media\\:content').first().attr('url') ||
            $item.find('imglink').first().text() ||
            $item.find('enclosure').first().attr('url')
        )

        if (!title || !link) return

        rows.push({ title, link, date, description, category, image })
    })

    return rows
}

const formatItem = ({ title, link, date, description, category }) =>
    `${title}${category ? `\n× Kategori: ${category}` : ''}\n× Tanggal: ${toNewsDate(date)}\n× Link: ${link}\n× Deskripsi: ${truncate(stripHtml(description))}`

const buildMessage = (items, limit, label) =>
    items.slice(0, limit).map((item, index) => `\`\`\`${index + 1}. ${formatItem(item)}\`\`\``).join('\n\n')

export default {
    name: 'inews',
    aliases: ['inewsid', 'i-news'],
    description: 'iNews',
    execute: async ({ sock, msg, args, react, useLimit, config }) => {
        const jid = msg.key.remoteJid
        const { limit, category } = parseArgs(args)

        await react('⏳')

        try {
            const response = await axios.get(FEED_URL, {
                timeout: 120000,
                headers: { 'User-Agent': USER_AGENT },
                validateStatus: () => true
            })

            if (response.status >= 400) {
                throw new Error(`RSS feed merespon status ${response.status}.`)
            }

            const items = parseItems(response.data)
            const filtered = category
                ? items.filter((item) => item.category?.toLowerCase().includes(category))
                : items

            const result = []
            for (const item of filtered) {
                if (result.length >= limit) break

                let image = item.image
                if (!isImage(image)) {
                    image = await extractImageFromPage(item.link)
                }

                if (!isImage(image)) continue
                result.push({ ...item, image })
            }

            if (!result.length) {
                await react('❌')
                const list = [...new Set(items.map((item) => normalizeText(item.category).toLowerCase()).filter(Boolean))].join(', ')
                const extra = category ? `\nKategori tersedia: ${list || '-'}`
                    : ''
                return sock.sendMessage(jid, {
                    text: `⚠️ Tidak ada berita ditemukan dari iNews.${extra}`
                }, { quoted: msg })
            }

            const caption = buildMessage(result, limit, category || 'terbaru')
            await sock.sendMessage(jid, {
                image: { url: result[0].image },
                caption
            }, { quoted: msg })

            useLimit()
            await react('✅')
        } catch (err) {
            await react('❌')
            await sock.sendMessage(jid, {
                text: `❌ Gagal ambil berita iNews: ${err.message}`
            }, { quoted: msg })
        }
    }
}
