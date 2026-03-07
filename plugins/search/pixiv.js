import axios from 'axios'

const SEARCH_URL = 'https://www.pixiv.net/ajax/search/artworks/{query}'
const DETAIL_URL = 'https://www.pixiv.net/ajax/illust/{id}'
const USER_AGENT = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36'
const DEFAULT_LIMIT = 5
const MAX_LIMIT = 5

const normalizeText = (value) => String(value || '').trim()
const sanitizeQuery = (text) => normalizeText(String(text || '').replace(/\s+/g, ' '))

const parseLimit = (text) => {
    const raw = sanitizeQuery(text)
    const match = raw.match(/\blimit=(\d+)\b/i)
    if (!match?.[1]) return DEFAULT_LIMIT

    const value = Number(match[1])
    if (!Number.isInteger(value) || value <= 0) return DEFAULT_LIMIT
    return Math.min(MAX_LIMIT, Math.max(1, value))
}

const removeLimitToken = (text) => sanitizeQuery(String(text || '')).replace(/\blimit=\d+\b/gi, '').trim()

const normalizeImageUrl = (value) => {
    const url = normalizeText(value)
    if (!url || !/^https?:\/\//i.test(url)) return null
    return url.split('?')[0]
}

const isImageUrl = (value) => /\.(jpe?g|png|webp|gif|bmp|avif)(\?|$)/i.test(normalizeText(value))

const normalizePixivId = (value) => {
    const raw = normalizeText(value)
    if (!raw) return null
    return raw.replace(/^https?:\/\/www\.pixiv\.net\/(?:en\/)?artworks\//i, '')
}

const fetchDetailImageUrls = async (id) => {
    const artId = normalizePixivId(id)
    if (!artId) return []

    try {
        const endpoint = DETAIL_URL.replace('{id}', encodeURIComponent(artId))
        const { data } = await axios.get(endpoint, {
            params: { lang: 'en' },
            timeout: 120000,
            headers: {
                'User-Agent': USER_AGENT,
                Referer: 'https://www.pixiv.net/'
            }
        })

        const urls = data?.body?.urls || {}
        return [
            normalizeImageUrl(urls.regular),
            normalizeImageUrl(urls.original),
            normalizeImageUrl(urls.small),
            normalizeImageUrl(urls.thumb),
            normalizeImageUrl(urls.mini)
        ].filter((u) => u && isImageUrl(u))
    } catch {
        return []
    }
}

const getCandidateUrls = (item = {}) => {
    const raw = [
        item?.url,
        item?.url_big,
        item?.image
    ]
    return raw.map((u) => normalizeImageUrl(u)).filter((u) => u && isImageUrl(u))
}

const fetchImageBuffer = async (url) => {
    try {
        const response = await axios.get(url, {
            responseType: 'arraybuffer',
            timeout: 15000,
            validateStatus: () => true,
            headers: {
                'User-Agent': USER_AGENT,
                Referer: 'https://www.pixiv.net/',
                Origin: 'https://www.pixiv.net',
                Accept: 'image/avif,image/webp,image/apng,image/*,*/*;q=0.8'
            }
        })
        if (response.status < 200 || response.status >= 400) return null
        if (!String(response.headers['content-type'] || '').toLowerCase().startsWith('image/')) return null

        const buffer = Buffer.from(response.data || [])
        if (!buffer.length) return null

        const header = buffer.slice(0, 12)
        const isJpeg = header[0] === 0xff && header[1] === 0xd8
        const isPng = header[0] === 0x89 && header[1] === 0x50 && header[2] === 0x4e && header[3] === 0x47
        const isGif = header[0] === 0x47 && header[1] === 0x49 && header[2] === 0x46
        const isWebp = header[0] === 0x52 && header[1] === 0x49 && header[2] === 0x46 && header[3] === 0x46
        if (!isJpeg && !isPng && !isGif && !isWebp) return null

        return buffer
    } catch {
        return null
    }
}

const buildCandidates = async (items = [], limit = DEFAULT_LIMIT) => {
    const used = new Set()
    const out = []

    for (const item of items) {
        const title = normalizeText(item?.title || item?.alt || '-')
        const artist = normalizeText(item?.userName || item?.userName?.name || '-')
        const urls = getCandidateUrls(item)
        const detailUrls = await fetchDetailImageUrls(item?.id || item?.illustId)
        const merged = [...detailUrls, ...urls]

        if (!merged.length) continue

        const uniqueUrl = merged.find((x) => !used.has(x))
        if (!uniqueUrl) continue

        used.add(uniqueUrl)
        out.push({ title, artist, url: uniqueUrl })
        if (out.length >= limit) break
    }

    return out
}

const formatLines = (items = []) => items
    .map((item, index) => `${index + 1}. ${item.title}\n× Artis: ${item.artist}`)
    .join('\n\n')

export default {
    name: 'pixiv',
    aliases: ['pix'],
    description: 'Cari gambar di pixiv',
    execute: async ({ sock, msg, text, prefix, command, args, react, useLimit }) => {
        const jid = msg.key.remoteJid
        const fullText = sanitizeQuery(text)
        const limit = parseLimit(Array.isArray(args) ? args.join(' ') : fullText)
        const query = removeLimitToken(fullText)

        if (!query) {
            return sock.sendMessage(jid, {
                text: `Contoh penggunaan:\n- ${prefix + command} idol`
            }, { quoted: msg })
        }

        await react('⏳')

        try {
            const endpoint = SEARCH_URL.replace('{query}', encodeURIComponent(query))
            const { data } = await axios.get(endpoint, {
                params: {
                    word: query,
                    order: 'date_d',
                    mode: 'all',
                    p: 1,
                    s_mode: 's_tag',
                    type: 'all',
                    lang: 'en'
                },
                timeout: 120000,
                headers: {
                    'User-Agent': USER_AGENT,
                    Referer: 'https://www.pixiv.net/',
                    'X-Requested-With': 'XMLHttpRequest',
                    Accept: 'application/json, text/plain, */*'
                }
            })

            const rawItems = data?.body?.illustManga?.data || data?.body?.illust?.data || []
            const candidates = await buildCandidates(rawItems, limit)

            if (!candidates.length) {
                await react('❌')
                return sock.sendMessage(jid, {
                    text: `❌ Tidak ada hasil untuk: ${query}`
                }, { quoted: msg })
            }

            const selected = candidates.slice(0, limit)
            const albumMessage = []
            const sentItems = []

            for (const item of selected) {
                const buffer = await fetchImageBuffer(item.url)
                if (!buffer) continue

                albumMessage.push({ image: buffer })
                sentItems.push(item)
            }

            if (!albumMessage.length) {
                await react('❌')
                return sock.sendMessage(jid, {
                    text: '❌ Semua gambar pixiv gagal diambil. coba query lain.'
                }, { quoted: msg })
            }

            albumMessage[0].caption = `\`\`\`${formatLines(sentItems)}\`\`\``

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
