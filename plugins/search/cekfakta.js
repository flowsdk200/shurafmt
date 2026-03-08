import axios from 'axios'

const SEARCH_URL = 'https://cekfakta.com/api-search'
const MAX_RESULTS = 10
const REQUEST_TIMEOUT = 30000
const FALLBACK_IMAGE_URL = 'https://cekfakta.com/img/themes/smz-logo.png'

const cleanText = (value) => String(value || '')
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/\\u0026amp;/g, '&')
    .replace(/\\u[0-9a-fA-F]{4}/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()

const truncate = (value, max = 180) => {
    const text = cleanText(value)
    if (!text) return '-'
    return text.length > max ? `${text.slice(0, max - 3).trim()}...` : text
}

const normalizeQuery = (rawInput) => {
    const text = cleanText(rawInput)
    if (!text) return ''

    if (/^https?:\/\//i.test(text)) {
        try {
            const url = new URL(text)
            if (/(^|\.)cekfakta\.com$/i.test(url.hostname) && /\/api-search$/i.test(url.pathname)) {
                return cleanText(url.searchParams.get('search'))
            }
        } catch {
            return text
        }
    }

    return text
}

const extractJsonArray = (html, marker) => {
    const startMarker = html.indexOf(marker)
    if (startMarker === -1) return ''

    const start = html.indexOf('[', startMarker)
    if (start === -1) return ''

    let depth = 0
    let inString = false
    let escaped = false

    for (let i = start; i < html.length; i += 1) {
        const char = html[i]

        if (escaped) {
            escaped = false
            continue
        }

        if (char === '\\') {
            escaped = true
            continue
        }

        if (char === '"') {
            inString = !inString
            continue
        }

        if (inString) continue

        if (char === '[') depth += 1
        if (char === ']') {
            depth -= 1
            if (depth === 0) {
                return html.slice(start, i + 1)
            }
        }
    }

    return ''
}

const fetchRows = async (query) => {
    const response = await axios.get(SEARCH_URL, {
        timeout: REQUEST_TIMEOUT,
        maxRedirects: 5,
        validateStatus: () => true,
        params: { search: query },
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
    const rawJson = extractJsonArray(html, 'const responseData =')
    if (!rawJson) {
        throw new Error('responseData tidak ditemukan')
    }

    let parsed
    try {
        parsed = JSON.parse(rawJson)
    } catch {
        throw new Error('responseData tidak valid')
    }

    const seen = new Set()

    const rows = parsed
        .filter((item) => item && item.id && item.title)
        .map((item) => ({
            title: cleanText(item.title),
            source: cleanText(item.authors || item.classification || 'CekFakta'),
            status: cleanText(item.status || '-') || '-',
            date: cleanText(item.tanggal || '-') || '-',
            desc: truncate(item.conclusion || item.fact || item.content || '-'),
            image: cleanText(item.picture1 || ''),
            link: `https://cekfakta.com/focus/${item.id}`
        }))
        .filter((item) => {
            const key = `${item.title}`.toLowerCase()
            if (seen.has(key)) return false
            seen.add(key)
            return true
        })
        .slice(0, MAX_RESULTS)

    if (!rows.length) {
        throw new Error('Tidak ada hasil CekFakta')
    }

    return rows
}

const formatItem = (item, idx) => (
    `${idx + 1}. ${item.title}\n` +
    `× Source: ${item.source}\n` +
    `× Status: ${item.status}\n` +
    `× Date: ${item.date}\n` +
    `× Link: ${item.link}`
)

export default {
    name: 'cekfakta',
    aliases: ['cfakta', 'factcheckid'],
    description: 'Cari artikel cek fakta Indonesia di CekFakta',
    execute: async ({ sock, msg, text, prefix, command, react, useLimit }) => {
        const jid = msg.key.remoteJid
        const query = normalizeQuery(text)

        if (!query) {
            return sock.sendMessage(jid, {
                text: `Contoh penggunaan:\n- ${prefix + command} prabowo`
            }, { quoted: msg })
        }

        await react('⏳')
        try {
            const rows = await fetchRows(query)
            const image = rows[0]?.image || FALLBACK_IMAGE_URL
            const caption = rows.map((item, idx) => formatItem(item, idx)).join('\n\n')

            await sock.sendMessage(jid, image ? {
                image: { url: image },
                caption: `\`\`\`${caption}\`\`\``
            } : {
                text: `\`\`\`${caption}\`\`\``
            }, { quoted: msg })

            useLimit()
            await react('✅')
        } catch (err) {
            await react('❌')
            await sock.sendMessage(jid, {
                text: `❌ Error: ${err?.message}`
            }, { quoted: msg })
        }
    }
}
