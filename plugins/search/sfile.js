import axios from 'axios'
import * as cheerio from 'cheerio'

const BASE_URL = 'https://sfile.co'
const SEARCH_URL = `${BASE_URL}/search?q={query}`
const MAX_RESULTS = 15
const REQUEST_TIMEOUT = 30000

const clean = (value) => String(value || '').replace(/\s+/g, ' ').trim()

const isCloudflareChallenge = (html) => {
    const text = clean(html).toLowerCase()
    return text.includes('just a moment') || text.includes('enable javascript and cookies')
}

const normalizeQuery = (raw) => {
    const text = clean(raw)
    if (!text) return ''

    try {
        const parsed = new URL(text)
        if (parsed.hostname === 'sfile.co' || parsed.hostname === 'www.sfile.co') {
            if (parsed.pathname === '/search') {
                const q = clean(parsed.searchParams.get('q'))
                if (q) return q
            }
        }
    } catch {
        // plain text input
    }

    return text
}

const toAbsolute = (href) => {
    const raw = clean(href)
    if (!raw) return ''
    if (/^https?:\/\//i.test(raw)) return raw
    return `${BASE_URL}${raw.startsWith('/') ? '' : '/'}${raw}`
}

const parseMeta = (text) => {
    const raw = clean(text)
    if (!raw) return { size: '-', date: '-' }

    const parts = raw.split('•').map((part) => clean(part))
    return {
        size: parts[0] || '-',
        date: parts[1] || '-'
    }
}

const normalizeIconType = (iconUrl) => {
    const raw = clean(iconUrl)
    if (!raw) return '-'
    const fileName = raw.split('/').pop().split('?')[0]
    return clean(fileName.replace(/\.svg$/i, '')) || '-'
}

const parseTotalText = (html) => {
    const $ = cheerio.load(html)
    const header = clean($('h1').first().text())
    const match = header.match(/([0-9.,]+)\s+results\s+for/i)
    if (!match?.[1]) return null
    return `${match[1]} results`
}

const parseResults = (html) => {
    const $ = cheerio.load(html)

    if (/No search results found/i.test(clean($('body').text()))) {
        return []
    }

    const rows = []

    $('div.group').each((_, row) => {
        if (rows.length >= MAX_RESULTS) return false

        const $row = $(row)
        const titleNode = $row.find('a.search-result-link').first()
        const link = toAbsolute(clean(titleNode.attr('data-file-url') || titleNode.attr('href')))
        const title = clean(titleNode.text())

        if (!title || !link) return

        const { size, date } = parseMeta($row.find('p').first().text())
        const type = normalizeIconType($row.find('img').first().attr('src'))

        rows.push({
            title,
            link,
            size,
            date,
            type,
        })
    })

    return rows
}

const fetchSearchHtml = async (query) => {
    const response = await axios.get(SEARCH_URL.replace('{query}', encodeURIComponent(query)), {
        timeout: REQUEST_TIMEOUT,
        headers: {
            'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
            'Accept-Language': 'id-ID,id;q=0.9,en-US;q=0.8,en;q=0.7',
            'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8'
        },
        validateStatus: () => true,
        maxRedirects: 8
    })

    if (response.status >= 400) {
        throw new Error(`HTTP ${response.status}`)
    }

    if (!response.data || !String(response.data).trim()) {
        throw new Error('Respons server tidak valid')
    }

    if (isCloudflareChallenge(String(response.data))) {
        throw new Error('security challenge')
    }

    return String(response.data)
}

const formatRows = (rows) => rows
    .map((row, idx) => (
        `${idx + 1}. ${row.title}\n` +
        `• Type: ${row.type}\n` +
        `• Size: ${row.size}\n` +
        `• Date: ${row.date}\n` +
        `• Link: ${row.link}`
    ))
    .join('\n\n')

export default {
    name: 'sfile',
    aliases: ['sf'],
    description: 'Cari file di sfile',
    execute: async ({ sock, msg, text, prefix, command, react, useLimit }) => {
        const jid = msg.key.remoteJid
        const query = normalizeQuery(text)

        if (!query) {
            return sock.sendMessage(jid, {
                text: `Contoh penggunaan:\n- ${prefix + command} whatsapp`
            }, { quoted: msg })
        }

        await react('⏳')

        try {
            const html = await fetchSearchHtml(query)
            const rows = parseResults(html)
            const total = parseTotalText(html)

            if (!rows.length) {
                await react('❌')
                return sock.sendMessage(jid, {
                    text: `❌ Tidak ada hasil sfile untuk: ${query}`
                }, { quoted: msg })
            }

            const body = `\`\`\`${formatRows(rows)}\`\`\``
            await sock.sendMessage(jid, { text: body }, { quoted: msg })

            useLimit()
            await react('✅')
        } catch (err) {
            await react('❌')
            const message = String(err?.message || '')

            if (/security challenge/i.test(message)) {
                return sock.sendMessage(jid, {
                    text: '❌ Gagal akses sfile (security challenge)'
                }, { quoted: msg })
            }

            if (/HTTP/i.test(message)) {
                return sock.sendMessage(jid, {
                    text: `❌ Gagal search Sfile: ${message}`
                }, { quoted: msg })
            }

            return sock.sendMessage(jid, {
                text: `❌ Error: ${message}`
            }, { quoted: msg })
        }
    }
}
