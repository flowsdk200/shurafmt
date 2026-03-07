import axios from 'axios'

const SEARCH_URL = 'https://id.wikipedia.org/w/rest.php/v1/search/page'
const USER_AGENT = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36'
const DEFAULT_LIMIT = 5
const MAX_LIMIT = 5

const normalizeText = (value) => String(value || '').trim()

const stripHtml = (value) => {
    if (!value) return '-'
    return String(value)
        .replace(/<[^>]*>/g, ' ')
        .replace(/\s+/g, ' ')
        .trim()
}

const fetchImageBuffer = async (url) => {
    try {
        const response = await axios.get(url, {
            responseType: 'arraybuffer',
            timeout: 12000,
            validateStatus: () => true,
            headers: {
                'User-Agent': USER_AGENT,
                Accept: 'image/avif,image/webp,image/apng,image/*,*/*;q=0.8',
                Referer: 'https://id.wikipedia.org/'
            }
        })

        if (response.status < 200 || response.status >= 400) return null
        const contentType = String(response.headers['content-type'] || '').toLowerCase()
        if (!contentType.startsWith('image/')) return null
        const buffer = Buffer.from(response.data || [])
        return buffer.length ? buffer : null
    } catch {
        return null
    }
}

const isValidImageUrl = async (url) => {
    const response = await fetchImageBuffer(url)
    if (!response) return false
    return true
}

const parseLimit = (text) => {
    const raw = normalizeText(text)
    if (!raw) return DEFAULT_LIMIT

    const match = raw.match(/\blimit=(\d+)\b/i)
    if (match?.[1]) {
        const num = Number(match[1])
        if (Number.isInteger(num) && num > 0) return Math.min(MAX_LIMIT, num)
    }

    return DEFAULT_LIMIT
}

const normalizeWikimediaImage = (value) => {
    const url = normalizeImage(value)
    if (!url) return null
    return /^https?:\/\/upload\.wikimedia\.org\/.*\/\d+px-/.test(url)
        ? url.replace(/\/(\d+)px-/i, '/300px-')
        : url
}

const isValidImageCandidate = (url) => {
    const normalized = normalizeText(url)
    if (!normalized) return false
    if (!/^https?:\/\//i.test(normalized)) return false
    return /\.(jpe?g|png|webp|gif|bmp|svg|avif|heic|heif)(\?|$)/i.test(normalized) || /upload\.wikimedia\.org\/.+\/thumb\//i.test(normalized)
}

const fetchSummaryImage = async (key) => {
    try {
        const safeKey = encodeURIComponent(normalizeText(key))
        if (!safeKey) return null
        const { data } = await axios.get(`https://id.wikipedia.org/api/rest_v1/page/summary/${safeKey}`, {
            timeout: 120000,
            headers: {
                'User-Agent': USER_AGENT,
                'Accept': 'application/json'
            }
        })
        return normalizeImage(data?.thumbnail?.source || '')
    } catch {
        return null
    }
}

const fetchFullSummary = async (key) => {
    try {
        const safeKey = encodeURIComponent(normalizeText(key))
        if (!safeKey) return null
        const { data } = await axios.get(`https://id.wikipedia.org/api/rest_v1/page/summary/${safeKey}`, {
            timeout: 120000,
            headers: {
                'User-Agent': USER_AGENT,
                'Accept': 'application/json'
            }
        })
        return {
            description: stripHtml(data?.description || ''),
            summary: stripHtml(data?.extract || '')
        }
    } catch {
        return null
    }
}

const resolveImageUrl = async (item) => {
    const summaryImage = await fetchSummaryImage(item?.key || item?.title || '')
    const candidates = [
        summaryImage,
        normalizeWikimediaImage(item?.image || ''),
        normalizeImage(item?.image || '')
    ]

    const seen = new Set()
    for (const src of candidates) {
        if (!isValidImageCandidate(src) || seen.has(src)) continue
        seen.add(src)
        const valid = await isValidImageUrl(src)
        if (valid) return src
    }

    return null
}

const normalizeImage = (value) => {
    const url = normalizeText(value)
    if (!url) return null
    if (url.startsWith('//')) return `https:${url}`
    if (/^https?:\/\//i.test(url)) return url
    return null
}

const formatResults = (items) => items.map((item, index) => {
    const title = normalizeText(item.title)
    const description = stripHtml(item.fullDescription || item.description || '-')
    const excerpt = stripHtml(item.excerpt || '-')
    const link = `https://id.wikipedia.org/wiki/${encodeURIComponent(item.key || title).replace(/%20/g, '_')}`

    return (
        `${index + 1}. ${title}\n` +
        `× Description: ${description}\n` +
        `× Summary: ${excerpt}\n` +
        `× Link: ${link}`
    )
}).join('\n\n')

export default {
    name: 'wikipedia',
    aliases: ['wiki'],
    description: 'Cari artikel di wikipedia',
    execute: async ({ sock, msg, text, prefix, command, args, react, useLimit }) => {
        const jid = msg.key.remoteJid
        const q = normalizeText(String(text || '').trim())
        const limit = parseLimit(Array.isArray(args) ? args.join(' ') : q)

        const query = normalizeText(q.replace(/limit=\d+/gi, '').trim())
        if (!query) {
            return sock.sendMessage(jid, {
                text: `Contoh penggunaan:\n- ${prefix + command} javascript`
            }, { quoted: msg })
        }

        await react('⏳')

        try {
            const { data } = await axios.get(SEARCH_URL, {
                params: {
                    q: query,
                    limit
                },
                timeout: 120000,
                headers: {
                    'User-Agent': USER_AGENT,
                    'Accept': 'application/json'
                }
            })

            const pages = Array.isArray(data?.pages) ? data.pages : []
            if (!pages.length) {
                await react('❌')
                return sock.sendMessage(jid, {
                    text: `❌ Tidak ditemukan hasil wikipedia untuk: ${query}`
                }, { quoted: msg })
            }

            const items = await Promise.all(
                pages.slice(0, limit).map(async (item) => {
                    const fullSummary = await fetchFullSummary(item?.key || item?.title || '')
                    return {
                        title: item?.title || item?.key || '-',
                        description: item?.description || '-',
                        excerpt: item?.excerpt || '-',
                        fullDescription: fullSummary?.summary,
                        key: item?.key || '',
                        image: normalizeImage(item?.thumbnail?.url || '')
                    }
                })
            )

            const caption = `\`\`\`${formatResults(items)}\`\`\``
            let firstImage = null
            for (const item of items) {
                const img = await resolveImageUrl(item)
                if (img) {
                    firstImage = img
                    break
                }
            }

            if (firstImage) {
                await sock.sendMessage(jid, {
                    image: { url: firstImage },
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
            await sock.sendMessage(jid, {
                text: `❌ Error: ${err.message}`
            }, { quoted: msg })
        }
    }
}
