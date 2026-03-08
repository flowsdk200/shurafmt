import axios from 'axios'

const BASE_URL = 'https://appteka.store'
const SEARCH_PATH = '/search'
const MAX_RESULTS = 10
const REQUEST_TIMEOUT = 30000
const FALLBACK_IMAGE_URL = 'https://appteka.store/assets/favicon/apple-touch-icon.png'

const cleanText = (value) => String(value || '')
    .replace(/\*+/g, '')
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
            if (/(^|\.)appteka\.store$/i.test(url.hostname) && url.pathname.startsWith('/search')) {
                const q = cleanText(url.searchParams.get('q') || url.searchParams.get('query'))
                if (q) return q
            }
        } catch {
            return text
        }
    }

    return text
}

const formatCount = (value) => {
    const n = Number(value)
    if (!Number.isFinite(n) || n < 0) return '0'
    if (n < 1000) return String(Math.floor(n))
    if (n >= 1e9) return `${(n / 1e9).toFixed(n >= 1e10 ? 0 : 1).replace(/\.0$/, '')}B`
    if (n >= 1e6) return `${(n / 1e6).toFixed(n >= 1e7 ? 0 : 1).replace(/\.0$/, '')}M`
    return `${(n / 1e3).toFixed(n >= 1e4 ? 0 : 1).replace(/\.0$/, '')}K`
}

const formatSize = (bytes) => {
    const n = Number(bytes)
    if (!Number.isFinite(n) || n <= 0) return '-'
    const units = ['B', 'KB', 'MB', 'GB', 'TB']
    let size = n
    let idx = 0
    while (size >= 1024 && idx < units.length - 1) {
        size /= 1024
        idx += 1
    }
    const fixed = size >= 100 ? 0 : size >= 10 ? 1 : 2
    return `${size.toFixed(fixed).replace(/\.0+$/, '')} ${units[idx]}`
}

const formatRating = (value) => {
    const n = Number(value)
    if (!Number.isFinite(n) || n <= 0) return '-'
    return String(Number(n.toFixed(2)))
}

const formatDate = (unixSec) => {
    const n = Number(unixSec)
    if (!Number.isFinite(n) || n <= 0) return '-'
    const date = new Date(n * 1000)
    if (Number.isNaN(date.getTime())) return '-'
    return new Intl.DateTimeFormat('id-ID', {
        day: '2-digit',
        month: 'short',
        year: 'numeric'
    }).format(date)
}

const extractEscapedArrayText = (html, marker) => {
    const idx = html.indexOf(marker)
    if (idx < 0) return ''
    const start = html.indexOf('[', idx)
    if (start < 0) return ''

    let depth = 0
    let inString = false
    let escaped = false

    for (let i = start; i < html.length; i++) {
        const ch = html[i]

        if (inString) {
            if (escaped) escaped = false
            else if (ch === '\\') escaped = true
            else if (ch === '"') inString = false
            continue
        }

        if (ch === '"') {
            inString = true
            continue
        }

        if (ch === '[') depth += 1
        else if (ch === ']') {
            depth -= 1
            if (depth === 0) {
                return html.slice(start, i + 1)
            }
        }
    }

    return ''
}

const parseEscapedJsonArray = (escapedArrayText) => {
    const text = cleanText(escapedArrayText)
    if (!text) return []

    const normalized = text
        .replace(/\\"/g, '"')
        .replace(/\\\\/g, '\\')

    for (let i = normalized.length - 1; i >= 0; i--) {
        if (normalized[i] !== ']') continue
        const candidate = normalized.slice(0, i + 1)
        try {
            const parsed = JSON.parse(candidate)
            if (Array.isArray(parsed)) return parsed
        } catch {}
    }

    return []
}

const fetchSearchRows = async (query) => {
    const response = await axios.get(`${BASE_URL}${SEARCH_PATH}`, {
        timeout: REQUEST_TIMEOUT,
        maxRedirects: 5,
        validateStatus: () => true,
        params: { q: query },
        headers: {
            'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
            'Accept-Language': 'en-US,en;q=0.9',
            'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8'
        }
    })

    if (response.status !== 200) throw new Error(`HTTP ${response.status}`)

    const html = String(response.data || '')
    if (!html.trim()) throw new Error('Respons kosong')

    const escapedArrayText = extractEscapedArrayText(html, '\\"initialResults\\":[')
    if (!escapedArrayText) throw new Error('Data initialResults tidak ditemukan')

    const parsedRows = parseEscapedJsonArray(escapedArrayText)
    if (!Array.isArray(parsedRows) || !parsedRows.length) {
        throw new Error('Data hasil search appteka tidak valid')
    }

    const seen = new Set()
    const rows = []

    for (const item of parsedRows) {
        if (rows.length >= MAX_RESULTS) break

        const appId = cleanText(item?.app_id)
        if (!appId) continue
        if (seen.has(appId)) continue
        seen.add(appId)

        const row = {
            title: cleanText(item?.label) || '-',
            package: cleanText(item?.package) || '-',
            version: cleanText(item?.ver_name) || '-',
            versionCode: cleanText(item?.ver_code) || '-',
            rating: formatRating(item?.rating),
            downloads: formatCount(item?.downloads),
            size: formatSize(item?.size),
            updated: formatDate(item?.time),
            category: cleanText(item?.category?.name?.en || item?.category?.name?.id || item?.category?.id) || '-',
            exclusive: item?.exclusive ? 'Ya' : 'Tidak',
            source: 'Appteka',
            link: `${BASE_URL}/app/${appId}`,
            download: `${BASE_URL}/apps/${appId}/download`,
            image: normalizeUrl(item?.icon) || ''
        }

        rows.push(row)
    }

    return rows
}

const formatItem = (item, idx) =>
    `${idx + 1}. ${item.title}\n` +
    `• Package: ${item.package}\n` +
    `• Version: ${item.version} (${item.versionCode})\n` +
    `• Rating: ${item.rating}\n` +
    `• Downloads: ${item.downloads}\n` +
    `• Size: ${item.size}\n` +
    `• Category: ${item.category}\n` +
    `• Updated: ${item.updated}\n` +
    `• Exclusive: ${item.exclusive}\n` +
    `• Link: ${item.link}\n` +
    `• Download: ${item.download}`

const buildCaption = (rows) => rows.map((item, idx) => formatItem(item, idx)).join('\n\n')

export default {
    name: 'appteka',
    aliases: ['apptekasearch', 'apteka'],
    description: 'Cari aplikasi dari Appteka',
    execute: async ({ sock, msg, text, prefix, command, react, useLimit }) => {
        const jid = msg.key.remoteJid
        const query = normalizeQuery(text)

        if (!query) {
            return sock.sendMessage(jid, {
                text: `Contoh penggunaan:\n- ${prefix + command} tiktok`
            }, { quoted: msg })
        }

        await react('⏳')
        try {
            const rows = await fetchSearchRows(query)
            if (!rows.length) {
                await react('❌')
                return sock.sendMessage(jid, {
                    text: `❌ Tidak ditemukan hasil appteka untuk: ${query}`
                }, { quoted: msg })
            }

            const firstImage = normalizeUrl(rows[0]?.image) || FALLBACK_IMAGE_URL
            const caption = `\`\`\`${buildCaption(rows)}\`\`\``

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
                text: `❌ Gagal search appteka: ${err?.message || 'Unknown error'}`
            }, { quoted: msg })
        }
    }
}
