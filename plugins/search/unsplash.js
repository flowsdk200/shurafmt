import axios from 'axios'
import crypto from 'crypto'

const API_URL = 'https://unsplash.com/napi/search/photos'
const MAX_RESULTS = 10
const MAX_ALBUM = 10
const REQUEST_TIMEOUT = 30000

const cleanText = (value) => String(value || '')
    .replace(/\*+/g, '')
    .replace(/\s+/g, ' ')
    .trim()

const truncate = (value, max = 160) => {
    const text = cleanText(value)
    if (!text) return '-'
    return text.length > max ? `${text.slice(0, max)}...` : text
}

const formatNumber = (value) => {
    const num = Number(value || 0)
    if (!Number.isFinite(num)) return '0'
    if (num >= 1_000_000_000) return `${(num / 1_000_000_000).toFixed(num >= 10_000_000_000 ? 0 : 1).replace(/\.0$/, '')}B`
    if (num >= 1_000_000) return `${(num / 1_000_000).toFixed(num >= 10_000_000 ? 0 : 1).replace(/\.0$/, '')}M`
    if (num >= 1_000) return `${(num / 1_000).toFixed(num >= 10_000 ? 0 : 1).replace(/\.0$/, '')}K`
    return String(num)
}

const normalizeImageUrl = (value) => {
    const url = cleanText(value)
    if (!url || url.startsWith('data:')) return ''
    if (url.startsWith('//')) return `https:${url}`
    if (/^https?:\/\//i.test(url)) return url
    return ''
}

const hashBuffer = (buf) => crypto.createHash('sha1').update(buf).digest('hex')

const fetchImageBuffer = async (url) => {
    const target = normalizeImageUrl(url)
    if (!target) return null

    try {
        const res = await axios.get(target, {
            responseType: 'arraybuffer',
            timeout: REQUEST_TIMEOUT,
            validateStatus: () => true,
            headers: {
                'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
                'Accept': 'image/avif,image/webp,image/apng,image/*,*/*;q=0.8',
                'Referer': 'https://unsplash.com/'
            }
        })

        if (res.status !== 200) return null
        const contentType = cleanText(res.headers?.['content-type']).toLowerCase()
        if (!contentType.startsWith('image/')) return null

        const buf = Buffer.from(res.data || [])
        if (!buf.length) return null
        return buf
    } catch {
        return null
    }
}

const slugToTitle = (slug) => cleanText(String(slug || '')
    .replace(/-[A-Za-z0-9_-]{8,}$/, '')
    .replace(/-/g, ' '))

const normalizeQuery = (rawInput) => {
    const text = cleanText(rawInput)
    if (!text) return ''

    if (/^https?:\/\//i.test(text)) {
        try {
            const url = new URL(text)
            if (/(^|\.)unsplash\.com$/i.test(url.hostname)) {
                const query = cleanText(url.searchParams.get('query'))
                if (query) return query

                const parts = url.pathname.split('/').filter(Boolean)
                if (parts.length) {
                    const last = cleanText(decodeURIComponent(parts[parts.length - 1] || ''))
                    if (last && !['photos', 'photo', 's', 'id', 'foto'].includes(last.toLowerCase())) {
                        return last.replace(/-/g, ' ')
                    }
                }
            }
        } catch {
            return text
        }
    }

    return text
}

const toRow = (item) => {
    const title = cleanText(item.description || item.alt_description || slugToTitle(item.slug) || item.id)
    const author = cleanText(item.user?.name || '-')
    const username = cleanText(item.user?.username || '-')
    const description = truncate(item.description || item.alt_description || '-')

    return {
        title: title || '-',
        author: author || '-',
        username: username || '-',
        likes: formatNumber(item.likes),
        size: `${Number(item.width || 0)}x${Number(item.height || 0)}`,
        description,
        link: cleanText(item.links?.html || `https://unsplash.com/photos/${item.id}`),
        image: normalizeImageUrl(item.urls?.small || item.urls?.regular || item.urls?.thumb),
    }
}

const fetchRows = async (query) => {
    const { data, status } = await axios.get(API_URL, {
        timeout: REQUEST_TIMEOUT,
        validateStatus: () => true,
        params: {
            query,
            per_page: MAX_RESULTS,
            page: 1
        },
        headers: {
            'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
            'Accept': 'application/json, text/plain, */*',
            'Accept-Language': 'en-US,en;q=0.9',
            'Referer': 'https://unsplash.com/'
        }
    })

    if (status !== 200) {
        throw new Error(`Unsplash HTTP ${status}`)
    }

    const results = Array.isArray(data?.results) ? data.results : []
    const rows = results
        .map(toRow)
        .filter((item) => item.title && item.link && item.image)

    if (!rows.length) {
        throw new Error('Tidak ada hasil Unsplash')
    }

    return rows
}

const formatItem = (item, index) => (
    `${index + 1}. ${item.title}\n` +
    `• Author: ${item.author} (@${item.username})\n` +
    `• Likes: ${item.likes}\n` +
    `• Desc: ${item.description}\n` +
    `• Link: ${item.link}`
)

const buildCaption = (rows) => rows
    .map((item, index) => formatItem(item, index))
    .join('\n\n')

export default {
    name: 'unsplash',
    aliases: ['unsplashsearch'],
    description: 'Cari gambar di Unsplash',
    execute: async ({ sock, msg, text, prefix, command, react, useLimit }) => {
        const jid = msg.key.remoteJid
        const query = normalizeQuery(text)

        if (!query) {
            return sock.sendMessage(jid, {
                text: `Contoh penggunaan:\n- ${prefix + command} anime`
            }, { quoted: msg })
        }

        await react('⏳')
        try {
            const rows = await fetchRows(query)

            const album = []
            const seenHash = new Set()
            for (const item of rows) {
                if (album.length >= MAX_ALBUM) break
                const buf = await fetchImageBuffer(item.image)
                if (!buf) continue
                const hash = hashBuffer(buf)
                if (seenHash.has(hash)) continue
                seenHash.add(hash)
                album.push(buf)
            }

            if (!album.length) {
                throw new Error('Tidak ada gambar Unsplash yang valid untuk ditampilkan')
            }

            const caption = `\`\`\`${buildCaption(rows.slice(0, album.length))}\`\`\``
            await sock.sendMessage(jid, {
                albumMessage: album.map((buf, index) => ({
                    image: buf,
                    ...(index === 0 ? { caption } : {})
                }))
            }, { quoted: msg })

            useLimit()
            await react('✅')
        } catch (err) {
            await react('❌')
            await sock.sendMessage(jid, {
                text: `❌ Error: ${err?.message || 'Gagal cari di Unsplash'}`
            }, { quoted: msg })
        }
    }
}
