import axios from 'axios'
import * as cheerio from 'cheerio'

const BASE_URL = 'https://turnbackhoax.id'
const MAX_RESULTS = 10
const REQUEST_TIMEOUT = 30000
const FALLBACK_IMAGE_URL = 'https://turnbackhoax.id/images/logo-desktop.png'

const cleanText = (value) => String(value || '')
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
            if (/(^|\.)turnbackhoax\.id$/i.test(url.hostname) && /\/search$/i.test(url.pathname)) {
                return cleanText(url.searchParams.get('query'))
            }
        } catch {
            return text
        }
    }

    return text
}

const extractStatus = (title) => {
    const match = cleanText(title).match(/^\[([^\]]+)\]/)
    return cleanText(match?.[1] || '-') || '-'
}

const pickResponsiveText = ($, root, preferredClass) => {
    const spans = root.find('span').toArray()
    for (const span of spans) {
        const className = cleanText($(span).attr('class') || '')
        if (className.includes(preferredClass)) {
            const text = cleanText($(span).text())
            if (text) return text
        }
    }
    return cleanText(root.text())
}

const fetchRows = async (query) => {
    const response = await axios.get(`${BASE_URL}/search`, {
        timeout: REQUEST_TIMEOUT,
        maxRedirects: 5,
        validateStatus: () => true,
        params: { query },
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
    const $ = cheerio.load(html)
    const cards = $('div.news-card-h-alt').slice(0, MAX_RESULTS).toArray()
    const rows = []

    for (const card of cards) {
        const el = $(card)
        const link = cleanText(el.find('a[href*="/articles/"]').first().attr('href'))
        const image = cleanText(el.find('img').first().attr('src'))
        const linkBlock = el.find('a[href*="/articles/"]').eq(1)
        const imageAlt = cleanText(el.find('img').first().attr('alt') || '')
        const titleRoot = linkBlock.find('h2').first()
        const descRoot = linkBlock.find('p').first()
        const title = imageAlt || pickResponsiveText($, titleRoot, 'hidden lg:block')
        const desc = truncate(pickResponsiveText($, descRoot, 'hidden xl:block'))
        const metaLinks = el.find('div.flex.flex-row.items-end a')
        const category = cleanText(metaLinks.first().text()) || '-'
        const date = cleanText(el.find('span.text-light-black').first().text()) || '-'

        if (!title || !link) continue

        rows.push({
            title,
            source: 'TurnBackHoax',
            status: extractStatus(title),
            category,
            date,
            desc,
            image,
            link
        })
    }

    if (!rows.length) {
        throw new Error('Tidak ada hasil TurnBackHoax')
    }

    return rows
}

const formatItem = (item, idx) => (
    `${idx + 1}. ${item.title}\n` +
    `• Source: ${item.source}\n` +
    `• Status: ${item.status}\n` +
    `• Category: ${item.category}\n` +
    `• Date: ${item.date}\n` +
    `• Link: ${item.link}`
)

export default {
    name: 'turnbackhoax',
    aliases: ['tbh', 'gfd'],
    description: 'Cari artikel hoaks/fakta di TurnBackHoax',
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
