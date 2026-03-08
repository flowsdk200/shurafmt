import axios from 'axios'
import crypto from 'crypto'
import { gotScraping } from 'got-scraping'

const REQUEST_TIMEOUT = 30000
const MAX_RESULTS = 10
const MAX_ALBUM = 10

const cleanText = (value) => String(value || '')
    .replace(/\*+/g, '')
    .replace(/\s+/g, ' ')
    .trim()

const truncate = (value, max = 160) => {
    const text = cleanText(value)
    if (!text) return '-'
    return text.length > max ? `${text.slice(0, max)}...` : text
}

const normalizeImageUrl = (value) => {
    const url = cleanText(value)
    if (!url || url.startsWith('data:')) return ''
    if (url.startsWith('//')) return `https:${url}`
    if (/^https?:\/\//i.test(url)) return url
    return ''
}

const hashBuffer = (buf) => crypto.createHash('sha1').update(buf).digest('hex')

const normalizeQuery = (rawInput) => {
    const text = cleanText(rawInput)
    if (!text) return ''

    if (/^https?:\/\//i.test(text)) {
        try {
            const url = new URL(text)
            if (/(^|\.)pexels\.com$/i.test(url.hostname)) {
                const parts = url.pathname.split('/').filter(Boolean)
                const last = cleanText(decodeURIComponent(parts[parts.length - 1] || ''))
                if (last && !/^\d+$/.test(last)) return last.replace(/-/g, ' ')
            }
        } catch {
            return text
        }
    }

    return text
}

const formatAuthor = (user = {}) => {
    const full = cleanText([user.first_name, user.last_name].filter(Boolean).join(' '))
    const username = cleanText(user.username)
    if (full && username) return `${full} (@${username})`
    return full || (username ? `@${username}` : '-')
}

const buildSearchUrl = (query) => `https://www.pexels.com/id-id/pencarian/${encodeURIComponent(query).replace(/%20/g, '-')}/`

const extractNextData = (html) => {
    const match = String(html || '').match(/<script id="__NEXT_DATA__" type="application\/json">([\s\S]*?)<\/script>/)
    if (!match?.[1]) throw new Error('NEXT_DATA Pexels tidak ditemukan')
    return JSON.parse(match[1])
}

const extractLinkMap = (html) => {
    const map = new Map()
    const re = /href="(\/id-id\/foto\/[^"]*?-(\d+)\/)"/g
    for (const match of String(html || '').matchAll(re)) {
        const href = cleanText(match[1])
        const id = cleanText(match[2])
        if (!href || !id || map.has(id)) continue
        map.set(id, `https://www.pexels.com${href}`)
    }
    return map
}

const fetchRows = async (query) => {
    const url = buildSearchUrl(query)
    const response = await gotScraping({
        url,
        timeout: { request: REQUEST_TIMEOUT },
        headers: {
            'accept-language': 'en-US,en;q=0.9'
        }
    })

    if (response.statusCode !== 200) {
        throw new Error(`Pexels HTTP ${response.statusCode}`)
    }

    const html = String(response.body || '')
    const nextData = extractNextData(html)
    const pageProps = nextData?.props?.pageProps || {}
    const items = Array.isArray(pageProps?.initialData?.data) ? pageProps.initialData.data : []
    const linkMap = extractLinkMap(html)

    const rows = items
        .filter((item) => item?.type === 'photo' && item?.attributes)
        .map((item) => {
            const attr = item.attributes
            const id = cleanText(attr.id || item.id)
            const tags = Array.isArray(attr.tags) ? attr.tags.map((tag) => cleanText(tag?.name)).filter(Boolean).slice(0, 6) : []
            return {
                id,
                title: cleanText(attr.title || attr.alt || attr.slug || id) || '-',
                author: formatAuthor(attr.user),
                size: `${Number(attr.width || 0)}x${Number(attr.height || 0)}`,
                desc: truncate(attr.description || attr.alt || attr.title || '-'),
                tags: tags.length ? tags.join('/') : '-',
                image: normalizeImageUrl(attr.image?.medium || attr.image?.large || attr.image?.small || attr.image?.download_link),
                link: linkMap.get(id) || ''
            }
        })
        .filter((item) => item.title && item.image && item.link)
        .slice(0, MAX_RESULTS)

    if (!rows.length) {
        throw new Error('Tidak ada hasil Pexels')
    }

    return rows
}

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
                'Referer': 'https://www.pexels.com/'
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

const formatItem = (item, index) => (
    `${index + 1}. ${item.title}\n` +
    `• Author: ${item.author}\n` +
    `• Tags: ${item.tags}\n` +
    `• Desc: ${item.desc}\n` +
    `• Link: ${item.link}`
)

const buildCaption = (rows) => rows
    .map((item, index) => formatItem(item, index))
    .join('\n\n')

export default {
    name: 'pexels',
    aliases: ['pexelssearch'],
    description: 'Cari gambar di Pexels',
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
            const albumBuffers = []
            const seenHash = new Set()

            for (const row of rows) {
                if (albumBuffers.length >= MAX_ALBUM) break
                const buf = await fetchImageBuffer(row.image)
                if (!buf) continue
                const hash = hashBuffer(buf)
                if (seenHash.has(hash)) continue
                seenHash.add(hash)
                albumBuffers.push(buf)
            }

            if (!albumBuffers.length) {
                throw new Error('Tidak ada gambar Pexels yang valid untuk ditampilkan')
            }

            const visibleRows = rows.slice(0, albumBuffers.length)
            await sock.sendMessage(jid, {
                albumMessage: albumBuffers.map((buf, index) => ({
                    image: buf,
                    ...(index === 0 ? { caption: `\`\`\`${buildCaption(visibleRows)}\`\`\`` } : {})
                }))
            }, { quoted: msg })

            useLimit()
            await react('✅')
        } catch (err) {
            await react('❌')
            await sock.sendMessage(jid, {
                text: `❌ Error: ${err?.message || 'Gagal cari di Pexels'}`
            }, { quoted: msg })
        }
    }
}
