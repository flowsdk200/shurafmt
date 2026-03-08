import axios from 'axios'
import * as cheerio from 'cheerio'

const STORE_FRONT = 'th'
const PLATFORM = 'iphone'
const MAX_RESULTS = 10
const REQUEST_TIMEOUT = 30000
const FALLBACK_IMAGE_URL = 'https://www.apple.com/ac/structured-data/images/knowledge_graph_logo.png?202201180743'

const cleanText = (value) => String(value || '')
    .replace(/\*+/g, '')
    .replace(/\s+/g, ' ')
    .trim()

const normalizeQuery = (rawInput) => {
    const text = cleanText(rawInput)
    if (!text) return ''

    if (/^https?:\/\//i.test(text)) {
        try {
            const url = new URL(text)
            if (/(^|\.)apps\.apple\.com$/i.test(url.hostname) && /\/search$/i.test(url.pathname)) {
                const term = cleanText(url.searchParams.get('term'))
                if (term) return term
            }
        } catch {
            return text
        }
    }

    return text
}

const normalizeImageUrl = (value) => {
    const raw = cleanText(value)
    if (!raw || raw.startsWith('data:')) return ''
    if (raw.startsWith('//')) return `https:${raw}`
    if (/^https?:\/\//i.test(raw)) return raw
    return ''
}

const buildSearchUrl = (query) =>
    `https://apps.apple.com/${STORE_FRONT}/${PLATFORM}/search?term=${encodeURIComponent(query)}`

const formatIconTemplate = (template, variants = []) => {
    const raw = cleanText(template)
    if (!raw || !raw.includes('{w}') || !raw.includes('{h}')) return ''
    const firstFormat = cleanText(variants?.[0]?.format).toLowerCase()
    const ext = firstFormat === 'jpeg' ? 'jpg' : (firstFormat || 'jpg')
    return raw
        .replace('{w}', '512')
        .replace('{h}', '512')
        .replace('{c}', 'bb')
        .replace('{f}', ext)
}

const formatRating = (rating, count) => {
    const r = cleanText(rating)
    const c = cleanText(count)
    if (!r && !c) return '-'
    if (r && c) return `${r} (${c})`
    return r || c
}

const extractActionUrl = (lockup) => {
    const direct = cleanText(lockup?.clickAction?.pageUrl || lockup?.clickAction?.destination)
    if (/^https?:\/\//i.test(direct)) return direct

    const metricsUrl = cleanText(
        lockup?.clickAction?.actionMetrics?.data?.[0]?.fields?.actionUrl
    )
    if (/^https?:\/\//i.test(metricsUrl)) return metricsUrl

    const adamId = cleanText(lockup?.adamId)
    if (adamId) return `https://apps.apple.com/${STORE_FRONT}/app/id${adamId}`
    return ''
}

const extractRows = (json) => {
    const shelves = Array.isArray(json?.data?.[0]?.data?.shelves) ? json.data[0].data.shelves : []
    const rows = []
    const seen = new Set()

    for (const shelf of shelves) {
        const items = Array.isArray(shelf?.items) ? shelf.items : []
        for (const node of items) {
            if (rows.length >= MAX_RESULTS) break
            const lockup = node?.lockup || {}

            const title = cleanText(lockup.title)
            const subtitle = cleanText(lockup.subtitle || lockup.shortEditorialDescription || lockup.productDescription)
            const developer = cleanText(lockup.developerName)
            const rating = formatRating(lockup.rating, lockup.ratingCount)
            const price = cleanText(lockup?.offerDisplayProperties?.priceFormatted || lockup?.offerDisplayProperties?.titles?.standard || 'Get')
            const link = extractActionUrl(lockup)
            const icon = formatIconTemplate(lockup?.icon?.template, lockup?.icon?.variants)
            const adamId = cleanText(lockup.adamId)
            const bundleId = cleanText(lockup.bundleId)
            const ageRating = cleanText(lockup.ageRating?.name || lockup.ageRating?.abbreviation || lockup.ageRating)

            if (!title || !link) continue
            const key = (adamId || link).toLowerCase()
            if (seen.has(key)) continue
            seen.add(key)

            rows.push({
                title,
                subtitle: subtitle || '-',
                developer: developer || '-',
                rating,
                price,
                appId: adamId || '-',
                bundleId: bundleId || '-',
                ageRating: ageRating || '-',
                link,
                image: normalizeImageUrl(icon),
                source: 'App Store'
            })
        }
        if (rows.length >= MAX_RESULTS) break
    }

    return rows
}

const fetchSearchRows = async (query) => {
    const url = buildSearchUrl(query)
    const response = await axios.get(url, {
        timeout: REQUEST_TIMEOUT,
        maxRedirects: 6,
        validateStatus: () => true,
        headers: {
            'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
            'Accept-Language': 'en-US,en;q=0.9',
            'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8'
        }
    })

    if (response.status !== 200) {
        throw new Error(`HTTP ${response.status}`)
    }

    const html = String(response.data || '')
    if (!html.trim()) throw new Error('Respons kosong')

    const $ = cheerio.load(html)
    const serialized = cleanText($('#serialized-server-data').html())
    if (!serialized) throw new Error('Serialized data tidak ditemukan')

    let parsed
    try {
        parsed = JSON.parse(serialized)
    } catch {
        throw new Error('Serialized data tidak valid')
    }

    const rows = extractRows(parsed)
    if (!rows.length) {
        throw new Error('Tidak ada hasil App Store')
    }

    return rows
}

const formatItem = (item, idx) => {
    const desc = cleanText(item.subtitle) || '-'
    return (
        `${idx + 1}. ${item.title}\n` +
        `• Developer: ${item.developer}\n` +
        `• Rating: ${item.rating}\n` +
        `• Desc: ${desc}\n` +
        `• Link: ${item.link}`
    )
}

const buildCaption = (rows) => rows
    .map((item, idx) => formatItem(item, idx))
    .join('\n\n')

export default {
    name: 'appstore',
    aliases: ['appstoresearch', 'assearch'],
    description: 'Cari aplikasi di App Store',
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
            const rows = await fetchSearchRows(query)
            const firstImage = normalizeImageUrl(rows[0]?.image) || FALLBACK_IMAGE_URL
            const allCaptions = buildCaption(rows)

            if (firstImage) {
                await sock.sendMessage(jid, {
                    image: { url: firstImage },
                    caption: `\`\`\`${allCaptions}\`\`\``
                }, { quoted: msg })
            } else {
                await sock.sendMessage(jid, {
                    text: `\`\`\`${allCaptions}\`\`\``
                }, { quoted: msg })
            }

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
