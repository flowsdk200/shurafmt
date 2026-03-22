import axios from 'axios'

const API_BASE = 'https://sol-news-api.vercel.app/v1'
const USER_AGENT = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36'
const DEFAULT_LIMIT = 15
const MAX_LIMIT = 15
const DEFAULT_CATEGORY = 'general'

const IMAGE_EXTENSIONS = /\.(jpe?g|png|webp|gif|bmp|svg)$/
const normalizeText = (value) => String(value || '').trim().toLowerCase()

const toNewsDate = (value) => {
    if (!value) return '-'

    const parsed = new Date(value)
    if (Number.isNaN(parsed.getTime())) return String(value)

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

const normalizeImageUrl = (value) => {
    if (!value) return null
    const url = String(value || '').trim()
    return url.startsWith('https://') || url.startsWith('http://')
        ? url
        : null
}

const toImageSource = (item) => {
    const candidates = [
        item.urlToImage,
        item.image,
        item.image_url,
        item.picture,
        item.pic,
        item.thumbnail
    ]

    for (const value of candidates) {
        const url = normalizeImageUrl(value)
        if (!url) continue
        if (IMAGE_EXTENSIONS.test(url.toLowerCase()) || /\/(png|jpg|jpeg|webp|gif|bmp)(\?|$)/i.test(url)) return url
    }
    return null
}

const truncate = (text, max = 140) => {
    const value = String(text || '').trim()
    if (!value) return '-'
    return value.length > max ? `${value.slice(0, max)}...` : value
}

const parseArgs = (args = []) => {
    const normalized = args.map((arg) => String(arg || '').trim()).filter(Boolean)

    const result = {
        category: '',
        limit: DEFAULT_LIMIT
    }

    for (const tokenRaw of normalized) {
        const token = normalizeText(tokenRaw)

        if (token.startsWith('limit=')) {
            const limit = Number(token.replace('limit=', ''))
            if (Number.isInteger(limit) && limit > 0) {
                result.limit = Math.min(MAX_LIMIT, Math.max(1, limit))
            }
            continue
        }

        if (/^\d+$/.test(token)) {
            const num = Number(token)
            if (Number.isInteger(num) && num > 0) {
                result.limit = Math.min(MAX_LIMIT, Math.max(1, num))
            }
            continue
        }

        if (token === 'all' || token === 'semua') {
            result.category = 'all'
            continue
        }

        if (token.startsWith('cat=')) {
            result.category = token.replace(/^cat=/, '')
            continue
        }

        if (!result.category) result.category = token
    }

    return result
}

const getNewsData = async () => {
    const { data, status } = await axios.get(API_BASE, {
        timeout: 120000,
        headers: {
            'User-Agent': USER_AGENT
        },
        validateStatus: () => true
    })

    if (status !== 200 || !data || typeof data !== 'object') {
        throw new Error('Gagal mengambil data dari Sol News.')
    }

    return data
}

const getAvailableCategories = (data) => {
    return Object.keys(data || {})
        .map((key) => normalizeText(key))
        .filter((key) => key && key !== 'default' && data[key]?.articles)
}

const getItemsByCategory = (data, category) => {
    const list = []
    const available = getAvailableCategories(data)

    const addFromCategory = (key) => {
        const container = data?.[key]
        if (!container?.articles || !Array.isArray(container.articles)) return
        container.articles.forEach((item, index) => {
            if (!item) return
            list.push({
                ...item,
                category: key,
                order: index + 1
            })
        })
    }

    if (!category || category === 'general') {
        addFromCategory(category || DEFAULT_CATEGORY)
    } else if (category === 'all') {
        available.forEach((key) => addFromCategory(key))
    } else if (available.includes(category)) {
        addFromCategory(category)
    } else {
        return { valid: false, items: [], available }
    }

    const unique = []
    const seen = new Set()
    list.forEach((item) => {
        const title = String(item.title || '').trim()
        if (!title || seen.has(title)) return
        seen.add(title)
        unique.push(item)
    })

    return { valid: true, items: unique, available }
}

const formatItem = (item) => {
    const title = String(item.title || '-').trim().replace(/\n/g, ' ')
    const source = item.source?.name || item.source || '-'
    const desc = truncate(stripHtml(item.description || item.summary || item.content), 120)
    const rawDate = item.publishedAt || item.pubDate || item.date

    return `${title}\n• Tanggal: ${toNewsDate(rawDate)}\n• Link: ${String(item.url || item.link || '-')}`
}

const formatList = (items, limit) => items
    .slice(0, limit)
    .map((item, i) => ` ${i + 1}. ${formatItem(item)}`)
    .join('\n\n')

const pickFallbackImage = (items) => {
    const found = items
        .map(toImageSource)
        .find(Boolean)

    return found || null
}

export default {
    name: 'solnews',
    aliases: ['worldnews', 'globalnews'],
    description: 'Berita global dari Sol News',
    execute: async ({ sock, msg, args, react, useLimit, config }) => {
        const jid = msg.key.remoteJid
        const parsed = parseArgs(args)
        const limit = parsed.limit
        const category = parsed.category || DEFAULT_CATEGORY

        await react('⏳')

        try {
            const data = await getNewsData()
            const result = getItemsByCategory(data, category)

            if (!result.valid) {
                await react('❌')
                const available = getAvailableCategories(data)
                    .sort((a, b) => a.localeCompare(b))
                    .join(', ')

                return sock.sendMessage(jid, {
                    text: `❌ Kategori \"${category}\" tidak valid.\nKategori yang tersedia: ${available}`
                }, { quoted: msg })
            }

            if (!result.items.length) {
                await react('❌')
                return sock.sendMessage(jid, {
                    text: `⚠️ Tidak ada berita ditemukan untuk kategori "${category}".`
                }, { quoted: msg })
            }

            const label = category === 'all' ? 'SEMUA KATEGORI' : category.toUpperCase()
            const caption = `📰 *SOL NEWS* (${label})\nTampilkan: ${Math.min(limit, result.items.length)} dari ${result.items.length}\n\n${formatList(result.items, limit)}`
            const image = pickFallbackImage(result.items)

            if (image) {
                await sock.sendMessage(jid, {
                    image: { url: image },
                    caption
                }, { quoted: msg })
            } else {
                await sock.sendMessage(jid, { text: `📰 *SOL NEWS* (${label})\n\n${formatList(result.items, limit)}` }, { quoted: msg })
            }

            useLimit()
            await react('✅')
        } catch (err) {
            await react('❌')
            await sock.sendMessage(jid, {
                text: `❌ Gagal ambil berita Sol News: ${err.message}`
            }, { quoted: msg })
        }
    }
}
