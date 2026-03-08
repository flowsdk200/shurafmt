import * as cheerio from 'cheerio'
import { gotScraping } from 'got-scraping'

const BASE_URL = 'https://apkcombo.com'
const SEARCH_URLS = [
    `${BASE_URL}/id/search/{query}`,
    `${BASE_URL.replace('https://', 'https://www.')}/id/search/{query}`,
    `${BASE_URL}/id/search?q={query}`,
]

const MAX_RESULTS = 10
const REQUEST_TIMEOUT = 30000

const clean = (value) => String(value || '').replace(/\s+/g, ' ').trim()

const isCloudflareBlocked = (html) => {
    const text = clean(html).toLowerCase()
    return text.includes('just a moment') ||
        text.includes('enable javascript and cookies') ||
        text.includes('cloudflare')
}

const normalizeQuery = (raw) => {
    const value = clean(raw)
    if (!value) return ''

    try {
        const parsed = new URL(value)
        const hostOk = /^((www\.)?apkcombo\.com)$/i.test(parsed.hostname)
        if (!hostOk) return value

        const fragment = parsed.hash || ''
        const fragmentText = fragment.replace(/^#/, '')
        const hashQuery = new URLSearchParams(fragmentText).get('gsc.q')
        if (hashQuery) return clean(decodeURIComponent(hashQuery))

        const path = parsed.pathname.replace(/^\/+/, '')
        const match = path.match(/^id\/search\/([^/]+)(?:\/)?$/i)
        if (match?.[1]) return decodeURIComponent(clean(match[1]))

        const q = parsed.searchParams.get('q')
        if (q) return clean(q)
    } catch {
        // Not URL, treat as plain query
    }

    return value
}

const toAbsolute = (value) => {
    const raw = clean(value)
    if (!raw) return ''
    if (/^https?:\/\//i.test(raw)) return raw
    if (raw.startsWith('//')) return `https:${raw}`
    return `${BASE_URL}${raw.startsWith('/') ? '' : '/'}${raw}`
}

const parseAuthorInfo = (author) => {
    const base = clean(author)
    if (!base) return { developer: '-', category: '-' }

    const parts = base.split('·').map((text) => clean(text)).filter(Boolean)
    const developer = parts[0] || '-'
    const category = parts[1] || '-'
    return { developer, category }
}

const parseDescription = ($, $item) => {
    const chunks = $item.find('.description > span')
        .map((_, span) => clean($(span).text()))
        .get()
        .filter(Boolean)

    const metrics = {
        downloads: '-',
        rating: '-',
        size: '-',
    }

    if (chunks[0]) metrics.downloads = chunks[0]
    if (chunks[1]) metrics.rating = chunks[1]
    if (chunks[2]) metrics.size = chunks[2]

    return metrics
}

const parsePackage = (href) => {
    const path = clean(href).split('?')[0]
    const parts = path.split('/').filter(Boolean)
    if (parts.length >= 3) return parts[parts.length - 1]
    return '-'
}

const parseResults = (html) => {
    const $ = cheerio.load(html)
    const rows = []

    $('a.l_item').each((_, a) => {
        if (rows.length >= MAX_RESULTS) return false

        const $item = $(a)
        const title = clean($item.find('.name').first().text())
        if (!title) return

        const link = toAbsolute(clean($item.attr('href')))
        if (!link) return

        const hrefRaw = clean($item.attr('href'))
        const { developer, category } = parseAuthorInfo($item.find('.author').first().text())
        const metrics = parseDescription($, $item)

        rows.push({
            title,
            developer,
            category,
            downloads: metrics.downloads,
            rating: metrics.rating,
            size: metrics.size,
            package: parsePackage(hrefRaw),
            link,
        })
    })

    return rows
}

const fetchSearchHtml = async (query) => {
    const keywords = clean(query)
    const headersList = [
        {
            'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
            'Accept-Language': 'id-ID,id;q=0.9,en-US;q=0.8,en;q=0.7',
            'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
            'Cache-Control': 'no-cache',
            'Pragma': 'no-cache',
        },
        {
            'User-Agent': 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
            'Accept-Language': 'en-US,en;q=0.9',
            'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
        },
    ]

    let lastError = null

    for (const template of SEARCH_URLS) {
        const searchUrl = template.replace('{query}', encodeURIComponent(keywords))

        for (const headers of headersList) {
            try {
                const { statusCode, body } = await gotScraping(searchUrl, {
                    timeout: {
                        request: REQUEST_TIMEOUT,
                    },
                    headers,
                    followRedirect: true,
                    method: 'GET',
                })

                if (!body || statusCode >= 400) {
                    lastError = new Error(`HTTP ${statusCode || '-'} from APKCombo`)
                    continue
                }

                if (isCloudflareBlocked(body)) {
                    lastError = new Error('security challenge')
                    continue
                }

                return body
            } catch (err) {
                lastError = err
            }
        }
    }

    throw lastError || new Error('Tidak bisa mengambil data search APKCombo')
}

const formatRows = (rows) => rows
    .map((item, idx) => (
        `${idx + 1}. ${item.title}\n` +
        `• Developer: ${item.developer}\n` +
        `• Category: ${item.category}\n` +
        `• Package: ${item.package}\n` +
        `• Rating: ${item.rating}\n` +
        `• Size: ${item.size}\n` +
        `• Downloads: ${item.downloads}\n` +
        `• Link: ${item.link}`
    ))
    .join('\n\n')

export default {
    name: 'apkcombo',
    aliases: ['apkc'],
    description: 'Cari aplikasi dari APKCombo',
    execute: async ({ sock, msg, text, prefix, command, react, useLimit }) => {
        const jid = msg.key.remoteJid
        const query = normalizeQuery(text)

        if (!query) {
            return sock.sendMessage(jid, {
                text: `Contoh penggunaan:\n- ${prefix + command} whatsapp`,
            }, { quoted: msg })
        }

        await react('⏳')

        try {
            const html = await fetchSearchHtml(query)
            const items = parseResults(html)

            if (!items.length) {
                await react('❌')
                return sock.sendMessage(jid, {
                    text: `❌ Tidak ditemukan hasil apkcombo untuk: ${query}`,
                }, { quoted: msg })
            }

            const textResult = formatRows(items)
            await sock.sendMessage(jid, {
                text: `\`\`\`${textResult}\`\`\``,
            }, { quoted: msg })

            useLimit()
            await react('✅')
        } catch (err) {
            await react('❌')
            const lowerMessage = clean(err?.message || '')

            if (/security challenge/i.test(lowerMessage)) {
                await sock.sendMessage(jid, {
                    text: '❌ Gagal akses apkcombo (cloudflare challenge).',
                }, { quoted: msg })
                return
            }

            await sock.sendMessage(jid, {
                text: `❌ Error: ${err.message}`,
            }, { quoted: msg })
        }
    }
}
