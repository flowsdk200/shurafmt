import axios from 'axios'
import * as cheerio from 'cheerio'

const SEARCH_BASE_URL = 'https://search.f-droid.org/'
const MAX_RESULTS = 15
const REQUEST_TIMEOUT = 30000
const FALLBACK_IMAGE_URL = 'https://f-droid.org/assets/ic_repo_app_default.png'

const cleanText = (value) => String(value || '')
    .replace(/\s+/g, ' ')
    .trim()

const normalizeQuery = (rawInput) => {
    const text = cleanText(rawInput)
    if (!text) return ''

    if (/^https?:\/\//i.test(text)) {
        try {
            const url = new URL(text)
            if (/(^|\.)search\.f-droid\.org$/i.test(url.hostname) || /(^|\.)f-droid\.org$/i.test(url.hostname)) {
                const q = cleanText(url.searchParams.get('q'))
                if (q) return q
            }
        } catch {
            return text
        }
    }

    return text
}

const normalizeUrl = (value) => {
    const raw = cleanText(value)
    if (!raw) return ''
    if (raw.startsWith('//')) return `https:${raw}`
    if (/^https?:\/\//i.test(raw)) return raw
    return ''
}

const fetchSearchHtml = async (query) => {
    const { data, status } = await axios.get(SEARCH_BASE_URL, {
        params: {
            q: query,
            lang: 'en'
        },
        timeout: REQUEST_TIMEOUT,
        maxRedirects: 8,
        validateStatus: () => true,
        headers: {
            'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
            'Accept-Language': 'en-US,en;q=0.9',
            'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
            'Referer': 'https://search.f-droid.org/'
        }
    })

    if (status !== 200) throw new Error(`HTTP ${status}`)
    const html = String(data || '')
    if (!html.trim()) throw new Error('Halaman kosong')
    if (/captcha|access denied|forbidden|just a moment/i.test(html)) {
        throw new Error('Halaman terproteksi/challenge')
    }

    return html
}

const parseResults = (html) => {
    const $ = cheerio.load(String(html || ''))
    const rows = []
    const seen = new Set()

    $('a.package-header').each((_, node) => {
        if (rows.length >= MAX_RESULTS) return false
        const $node = $(node)

        const link = normalizeUrl($node.attr('href'))
        const title = cleanText($node.find('.package-name').first().text())
        const desc = cleanText($node.find('.package-summary').first().text()) || '-'
        const license = cleanText($node.find('.package-license').first().text()) || '-'
        const image = normalizeUrl($node.find('.package-icon').first().attr('src'))

        if (!title || !link) return
        const key = link.toLowerCase()
        if (seen.has(key)) return
        seen.add(key)

        rows.push({
            title,
            source: 'F-Droid',
            desc,
            license,
            link,
            image
        })
    })

    return rows
}

const fetchImageBuffer = async (url) => {
    const target = normalizeUrl(url)
    if (!target || target.startsWith('data:')) return null

    try {
        const res = await axios.get(target, {
            responseType: 'arraybuffer',
            timeout: REQUEST_TIMEOUT,
            validateStatus: () => true,
            headers: {
                'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
                'Accept': 'image/avif,image/webp,image/apng,image/*,*/*;q=0.8'
            }
        })

        if (res.status !== 200) return null
        const type = cleanText(res.headers?.['content-type']).toLowerCase()
        if (!type.startsWith('image/')) return null

        const buf = Buffer.from(res.data || [])
        return buf.length ? buf : null
    } catch {
        return null
    }
}

const formatItem = (item, idx) =>
    `${idx + 1}. ${item.title}\n` +
    `• Source: ${item.source}\n` +
    `• Desc: ${item.desc}\n` +
    `• License: ${item.license}\n` +
    `• Link: ${item.link}`

export default {
    name: 'fdroid',
    aliases: ['fdr', 'fdroidsearch'],
    description: 'Cari aplikasi dari F-Droid',
    execute: async ({ sock, msg, text, prefix, command, react, useLimit }) => {
        const jid = msg.key.remoteJid
        const query = normalizeQuery(text)

        if (!query) {
            return sock.sendMessage(jid, {
                text: `Contoh penggunaan:\n- ${prefix + command} termux`
            }, { quoted: msg })
        }

        await react('⏳')
        try {
            const html = await fetchSearchHtml(query)
            const rows = parseResults(html)

            if (!rows.length) {
                await react('❌')
                return sock.sendMessage(jid, {
                    text: `❌ Tidak ditemukan hasil f-droid untuk: ${query}`
                }, { quoted: msg })
            }

            const caption = rows.map((item, idx) => formatItem(item, idx)).join('\n\n')
            const imageBuffer = await fetchImageBuffer(rows[0]?.image) || await fetchImageBuffer(FALLBACK_IMAGE_URL)

            if (imageBuffer) {
                await sock.sendMessage(jid, {
                    image: imageBuffer,
                    caption: `\`\`\`${caption}\`\`\``
                }, { quoted: msg })
            } else {
                await sock.sendMessage(jid, {
                    text: `\`\`\`${caption}\`\`\``
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
