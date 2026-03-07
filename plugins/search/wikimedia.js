import axios from 'axios'

const WIKI_MEDIA_URL = 'https://commons.wikimedia.org/w/api.php'
const USER_AGENT = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36'
const DEFAULT_LIMIT = 5
const MAX_LIMIT = 5
const ALLOWED_MIMES = new Set([
    'image/jpeg',
    'image/jpg',
    'image/png',
    'image/webp',
    'image/gif',
    'image/bmp'
])

const normalizeText = (value) => String(value || '').trim()

const normalizeImageUrl = (url) => {
    const normalized = normalizeText(url)
    if (!normalized) return null
    return normalized.split('?')[0]
}

const isAllowedImageExt = (url) => {
    const n = normalizeText(url)
    if (!n) return false
    return /\.(jpe?g|png|webp|gif|bmp|avif)(\?|$)/i.test(n)
}

const normalizeMime = (mime) => String(mime || '').toLowerCase().split(';')[0].trim()

const isAllowedImageMime = (mime, url) => {
    const n = normalizeMime(mime)
    if (n && ALLOWED_MIMES.has(n)) return true
    return isAllowedImageExt(url)
}

const fetchImageBuffer = async (url) => {
    try {
        const response = await axios.get(url, {
            responseType: 'arraybuffer',
            timeout: 120000,
            validateStatus: () => true,
            headers: {
                'User-Agent': USER_AGENT,
                'Accept': 'image/avif,image/webp,image/apng,image/*,*/*;q=0.8'
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

const cleanTitle = (value) => normalizeText(String(value || '')).replace(/^File:/i, '') || 'Tanpa judul'

const cleanDesc = (value) => {
    if (!value || typeof value !== 'string') return '-'
    return value
        .replace(/<[^>]*>/g, ' ')
        .replace(/\s+/g, ' ')
        .trim()
        .replace(/^\[\[|\]\]$/g, '')
}

const isNotFileIcon = (url) => {
    return !/\/w\/resources\/assets\/file-type-icons\//i.test(url)
}

const resolveImageSource = (page) => {
    const imageInfo = page?.imageinfo?.[0] || {}
    const rawUrl = imageInfo.url || imageInfo.thumburl
    const url = normalizeImageUrl(rawUrl)
    if (!url || !url.startsWith('https://')) return null
    if (!isNotFileIcon(url)) return null
    return url
}

export default {
    name: 'wikimedia',
    aliases: ['wmedia', 'commons'],
    description: 'Cari gambar di wikimedia',
    execute: async ({ sock, msg, text, prefix, command, args, react, useLimit }) => {
        const jid = msg.key.remoteJid
        const q = normalizeText(String(text || '').trim())
        const limit = parseLimit(Array.isArray(args) ? args.join(' ') : q)

        if (!q) {
            return sock.sendMessage(jid, {
                text: `Contoh penggunaan:\n- ${prefix + command} kucing`
            }, { quoted: msg })
        }

        await react('⏳')

        const query = q.replace(/limit=\d+/gi, '').trim()
        if (!query) {
            await react('❌')
            return sock.sendMessage(jid, {
                text: '❌ Query tidak valid.'
            }, { quoted: msg })
        }

        try {
            const searchLimit = Math.min(20, Math.max(10, limit * 3))

            const { data } = await axios.get(WIKI_MEDIA_URL, {
                params: {
                    action: 'query',
                    generator: 'search',
                    gsrnamespace: 6,
                    gsrlimit: searchLimit,
                    gsrsearch: query,
                    prop: 'imageinfo',
                    iiprop: 'url|mime|extmetadata',
                    iiurlwidth: 1280,
                    format: 'json',
                    origin: '*'
                },
                timeout: 120000,
                headers: {
                    'User-Agent': USER_AGENT,
                    Accept: 'application/json'
                }
            })

            const pages = Object.values(data?.query?.pages || {})
                .filter((page) => page?.imageinfo?.[0])

            if (!pages.length) {
                await react('❌')
                return sock.sendMessage(jid, {
                    text: `❌ Tidak ada hasil wikimedia untuk: ${query}`
                }, { quoted: msg })
            }

            const results = []
            const seenUrls = new Set()
            const seenKeys = new Set()

            for (const page of pages) {
                const imageInfo = page?.imageinfo?.[0] || {}
                const imageUrl = resolveImageSource(page)
                if (!imageUrl || !isNotFileIcon(imageUrl) || !isAllowedImageMime(imageInfo?.mime, imageUrl)) continue

                const title = cleanTitle(page.title)
                const normalizedUrl = normalizeImageUrl(imageUrl)
                const uniqueKey = `${title.toLowerCase()}::${normalizedUrl}`
                if (seenUrls.has(imageUrl) || seenKeys.has(uniqueKey)) continue

                const buf = await fetchImageBuffer(imageUrl)
                if (!buf) continue

                seenUrls.add(imageUrl)
                seenKeys.add(uniqueKey)

                const desc = cleanDesc(page.imageinfo?.[0]?.extmetadata?.ImageDescription?.value)

                results.push({
                    title,
                    desc,
                    imageUrl,
                    image: buf
                })

                if (results.length >= limit) break
            }

            if (!results.length) {
                await react('❌')
                return sock.sendMessage(jid, {
                    text: '❌ Gagal mengambil gambar. coba query lain.'
                }, { quoted: msg })
            }

            const meta = results.map((item, i) => (
                `${i + 1}. ${item.title}\n` +
                `× Description: ${item.desc}`
            )).join('\n\n')

            const caption = `\`\`\`${meta}\`\`\``

            const albumMessage = results.map((item, i) => ({
                image: item.image,
                ...(i === 0 ? { caption } : {})
            }))

            await sock.sendMessage(jid, { albumMessage }, { quoted: msg })

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
