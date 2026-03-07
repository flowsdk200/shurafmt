import axios from 'axios'

const MOBILE_SEARCH_URL = 'https://m.soundcloud.com/search/sounds'
const MAX_RESULTS = 15
const REQUEST_TIMEOUT = 30000
const FALLBACK_IMAGE_URL = 'https://m.sndcdn.com/_next/static/images/apple-touch-icon-180-893d0d532e8fbba714cceb8d9eae9567.png'

const cleanText = (value) => String(value || '')
    .replace(/\s+/g, ' ')
    .trim()

const normalizeUrl = (value) => {
    const raw = cleanText(value)
    if (!raw) return ''
    if (raw.startsWith('//')) return `https:${raw}`
    if (!/^https?:\/\//i.test(raw)) return ''
    return raw
}

const normalizeQuery = (rawInput) => {
    const text = cleanText(rawInput)
    if (!text) return ''

    if (/^https?:\/\//i.test(text)) {
        try {
            const url = new URL(text)
            if (/(^|\.)soundcloud\.com$/i.test(url.hostname) || /(^|\.)m\.soundcloud\.com$/i.test(url.hostname)) {
                const q = cleanText(url.searchParams.get('q'))
                if (q) return q
            }
        } catch {
            return text
        }
    }

    return text
}

const formatCount = (value) => {
    const n = Number(value || 0)
    if (!Number.isFinite(n) || n < 0) return '0'
    if (n >= 1_000_000_000) return `${Number((n / 1_000_000_000).toFixed(1)).toString().replace(/\.0$/, '')}B`
    if (n >= 1_000_000) return `${Number((n / 1_000_000).toFixed(1)).toString().replace(/\.0$/, '')}M`
    if (n >= 1_000) return `${Number((n / 1_000).toFixed(1)).toString().replace(/\.0$/, '')}K`
    return String(Math.floor(n))
}

const formatDuration = (ms) => {
    const total = Math.max(0, Math.floor(Number(ms || 0) / 1000))
    const h = Math.floor(total / 3600)
    const m = Math.floor((total % 3600) / 60)
    const s = total % 60
    if (h > 0) return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`
    return `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`
}

const parseNextData = (html) => {
    const m = String(html || '').match(/<script id="__NEXT_DATA__" type="application\/json">([\s\S]*?)<\/script>/i)
    if (!m?.[1]) throw new Error('__NEXT_DATA__ tidak ditemukan')

    let parsed = null
    try {
        parsed = JSON.parse(m[1])
    } catch {
        throw new Error('JSON __NEXT_DATA__ tidak valid')
    }
    if (!parsed || typeof parsed !== 'object') throw new Error('Data Next tidak valid')
    return parsed
}

const getTrackFromEntity = (entities, ref) => {
    const node = entities?.tracks?.[ref]
    if (!node) return null
    return node?.data && typeof node.data === 'object' ? node.data : node
}

const getUserFromTrack = (entities, track) => {
    const userId = cleanText(track?.user_id)
    if (!userId) return null
    const key = `soundcloud:users:${userId}`
    const node = entities?.users?.[key]
    if (!node) return null
    return node?.data && typeof node.data === 'object' ? node.data : node
}

const parseRows = (nextData) => {
    const entities = nextData?.props?.pageProps?.initialStoreState?.entities
    if (!entities || typeof entities !== 'object') throw new Error('Entities SoundCloud tidak ditemukan')

    const resultCollections = entities?.searchResultsCollections
    const firstKey = Object.keys(resultCollections || {})[0]
    if (!firstKey) return []

    const refs = Array.isArray(resultCollections?.[firstKey]?.data?.collection)
        ? resultCollections[firstKey].data.collection
        : []
    if (!refs.length) return []

    const rows = []
    for (const item of refs) {
        if (rows.length >= MAX_RESULTS) break
        if (cleanText(item?.schema).toLowerCase() !== 'track') continue

        const ref = cleanText(item?.id)
        if (!ref) continue

        const track = getTrackFromEntity(entities, ref)
        if (!track) continue

        const user = getUserFromTrack(entities, track)
        const title = cleanText(track?.title)
        const link = normalizeUrl(track?.permalink_url)
        if (!title || !link) continue

        const artwork = normalizeUrl(track?.artwork_url)
        const avatar = normalizeUrl(user?.avatar_url)
        const image = artwork || avatar || ''

        rows.push({
            title,
            artist: cleanText(user?.username || user?.full_name || '-') || '-',
            duration: formatDuration(track?.full_duration || track?.duration),
            plays: formatCount(track?.playback_count),
            likes: formatCount(track?.likes_count),
            reposts: formatCount(track?.reposts_count),
            genre: cleanText(track?.genre || '-') || '-',
            link,
            image
        })
    }

    return rows
}

const fetchRows = async (query) => {
    const response = await axios.get(MOBILE_SEARCH_URL, {
        timeout: REQUEST_TIMEOUT,
        validateStatus: () => true,
        maxRedirects: 5,
        params: { q: query },
        headers: {
            'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
            'Accept-Language': 'en-US,en;q=0.9',
            'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8'
        }
    })

    if (response.status !== 200) throw new Error(`HTTP ${response.status}`)

    const html = String(response.data || '')
    if (!html.trim()) throw new Error('Respons SoundCloud kosong')
    const challenge = /just a moment|access denied|attention required/i.test(html.toLowerCase())
    let nextData = null
    try {
        nextData = parseNextData(html)
    } catch (err) {
        if (challenge) throw new Error('SoundCloud security challenge')
        throw err
    }

    return parseRows(nextData)
}

const formatRow = (row, idx) =>
    `${idx + 1}. ${row.title}\n` +
    `× Artist: ${row.artist}\n` +
    `× Duration: ${row.duration}\n` +
    `× Plays: ${row.plays}\n` +
    `× Likes: ${row.likes}\n` +
    `× Reposts: ${row.reposts}\n` +
    `× Genre: ${row.genre}\n` +
    `× Link: ${row.link}`

const buildCaption = (query, rows) =>
    rows.map((row, idx) => formatRow(row, idx)).join('\n\n')

export default {
    name: 'soundcloud',
    aliases: ['scsearch', 'soundsearch'],
    description: 'Cari track dari SoundCloud',
    execute: async ({ sock, msg, text, prefix, command, react, useLimit }) => {
        const jid = msg.key.remoteJid
        const query = normalizeQuery(text)

        if (!query) {
            return sock.sendMessage(jid, {
                text: `Contoh penggunaan:\n- ${prefix + command} night changes`
            }, { quoted: msg })
        }

        await react('⏳')
        try {
            const rows = await fetchRows(query)
            if (!rows.length) {
                await react('❌')
                return sock.sendMessage(jid, {
                    text: `❌ Tidak ditemukan hasil soundcloud untuk: ${query}`
                }, { quoted: msg })
            }

            const caption = `\`\`\`${buildCaption(query, rows)}\`\`\``
            const firstImage = normalizeUrl(rows[0]?.image) || FALLBACK_IMAGE_URL

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
                text: `❌ Gagal search soundcloud: ${err?.message || 'Unknown error'}`
            }, { quoted: msg })
        }
    }
}
