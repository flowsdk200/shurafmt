import axios from 'axios'
import * as cheerio from 'cheerio'

const SEARCH_BASE_URL = 'https://www.bing.com/search'
const MAX_RESULTS = 11 // 1 image+caption result + 10 list rows
const REQUEST_TIMEOUT = 30000
const RESULT_META_IMAGE_TIMEOUT = 12000
const FALLBACK_IMAGE_URL = 'https://www.bing.com/sa/simg/facebook_sharing_5.png'

const cleanText = (value) => String(value || '').replace(/\s+/g, ' ').trim()

const normalizeQuery = (rawInput) => {
    const text = cleanText(rawInput)
    if (!text) return ''

    if (/^https?:\/\//i.test(text)) {
        try {
            const url = new URL(text)
            if (/(^|\.)bing\.com$/i.test(url.hostname) && url.pathname.startsWith('/search')) {
                const q = cleanText(url.searchParams.get('q'))
                if (q) return q
            }
        } catch {
            // fallback to raw text
        }
    }

    return text
}

const decodeBingRedirect = (value) => {
    const raw = cleanText(value)
    if (!raw) return raw

    try {
        const parsed = new URL(raw)
        if (!/(^|\.)bing\.com$/i.test(parsed.hostname)) return raw
        if (!parsed.pathname.startsWith('/ck/a')) return raw

        let u = cleanText(parsed.searchParams.get('u'))
        if (!u) return raw
        if (u.startsWith('a1')) u = u.slice(2)

        const normalized = u.replace(/-/g, '+').replace(/_/g, '/')
        const padded = normalized + '='.repeat((4 - (normalized.length % 4)) % 4)
        const decoded = Buffer.from(padded, 'base64').toString('utf8')
        if (/^https?:\/\//i.test(decoded)) return decoded
    } catch {
        return raw
    }

    return raw
}

const normalizeResultUrl = (value) => {
    const raw = cleanText(value)
    if (!raw) return null
    if (!/^https?:\/\//i.test(raw)) return null
    if (raw.startsWith('javascript:')) return null
    if (raw.startsWith('mailto:')) return null
    if (raw.startsWith('tel:')) return null

    const decoded = decodeBingRedirect(raw)
    if (!/^https?:\/\//i.test(decoded)) return null
    if (decoded.startsWith('javascript:') || decoded.startsWith('mailto:') || decoded.startsWith('tel:')) return null
    return decoded
}

const normalizeImageUrl = (value) => {
    const raw = cleanText(value)
    if (!raw || raw.startsWith('data:')) return null
    if (raw.startsWith('//')) return `https:${raw}`
    if (/^https?:\/\//i.test(raw)) return raw
    return null
}

const parseResultImageFromNode = ($node) => {
    const candidates = [
        $node.find('.rms_iac').first().attr('data-src'),
        $node.find('.rms_iac').first().attr('data-src-hq'),
        $node.find('[data-src]').first().attr('data-src'),
        $node.find('img').first().attr('src'),
        $node.find('img').first().attr('data-src'),
        $node.find('source').first().attr('srcset')
    ]

    for (const value of candidates) {
        const image = normalizeImageUrl(value)
        if (image) return image
    }

    return null
}

const parseResultImageFromPage = async (url) => {
    const normalizedUrl = normalizeResultUrl(url)
    if (!normalizedUrl) return null

    try {
        const { data, status } = await axios.get(normalizedUrl, {
            timeout: RESULT_META_IMAGE_TIMEOUT,
            maxRedirects: 8,
            headers: {
                'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
                'Accept-Language': 'en-US,en;q=0.9',
                'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8'
            },
            validateStatus: () => true
        })

        if (status !== 200) return null
        const html = String(data || '')
        if (!html || /just a moment|enable javascript and cookies|cloudflare|access denied|forbidden/i.test(html)) {
            return null
        }

        const $ = cheerio.load(html)
        const metaCandidates = [
            $('meta[property="og:image"]').attr('content'),
            $('meta[name="twitter:image"]').attr('content'),
            $('meta[name="twitter:image:src"]').attr('content'),
            $('meta[property="twitter:image:src"]').attr('content'),
            $('meta[itemprop="image"]').attr('content'),
            $('link[rel="image_src"]').attr('href')
        ]

        for (const candidate of metaCandidates) {
            const image = normalizeImageUrl(candidate)
            if (image) return image
        }

        return null
    } catch {
        return null
    }
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

const parseResults = (html) => {
    const $ = cheerio.load(String(html || ''))
    const rows = []
    const seen = new Set()

    $('li.b_algo').each((_, node) => {
        if (rows.length >= MAX_RESULTS) return false
        const $node = $(node)

        const title = cleanText($node.find('h2').first().text())
        const link = normalizeResultUrl($node.find('h2 a').first().attr('href'))
        const source = cleanText($node.find('cite').first().text().split('›')[0]) || cleanText(new URL(link).hostname)
        const desc = cleanText($node.find('.b_caption p').first().text()) || '-'
        const image = parseResultImageFromNode($node)

        if (!title || !link) return
        const key = link.toLowerCase()
        if (seen.has(key)) return
        seen.add(key)

        rows.push({
            title,
            link,
            source,
            desc,
            image
        })
    })

    return rows
}

const formatCaption = (item, idx) =>
    `${idx + 1}. ${item.title}\n× Source: ${item.source}\n× Desc: ${item.desc}\n× Link: ${item.link}`

const fetchHtml = async (query) => {
    const encoded = encodeURIComponent(query)
    const candidates = [
        `${SEARCH_BASE_URL}?q=${encoded}`,
        `${SEARCH_BASE_URL}?q=${encoded}&form=QBLH`
    ]

    let lastError = null
    for (const url of candidates) {
        try {
            const { data, status } = await axios.get(url, {
                timeout: REQUEST_TIMEOUT,
                maxRedirects: 8,
                headers: {
                    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
                    'Accept-Language': 'en-US,en;q=0.9',
                    'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8'
                },
                validateStatus: () => true
            })

            if (status !== 200 || !String(data || '').trim()) {
                lastError = new Error(`HTTP ${status}`)
                continue
            }

            const text = String(data)
            if (/captcha|our systems have detected unusual traffic|access denied/i.test(text)) {
                lastError = new Error('Bing challenge')
                continue
            }

            return text
        } catch (err) {
            lastError = err
        }
    }

    throw lastError || new Error('Fetch failed')
}

export default {
    name: 'bing',
    aliases: ['bingsearch', 'bs'],
    description: 'Cari hasil web dari bing',
    execute: async ({ sock, msg, text, prefix, command, react, useLimit }) => {
        const jid = msg.key.remoteJid
        const query = normalizeQuery(text)

        if (!query) {
            return sock.sendMessage(jid, {
                text: `Contoh penggunaan:\n- ${prefix + command} iran war news live`
            }, { quoted: msg })
        }

        await react('⏳')
        try {
            const html = await fetchHtml(query)
            const rows = parseResults(html)

            if (!rows.length) {
                await react('❌')
                return sock.sendMessage(jid, {
                    text: `❌ Tidak ditemukan hasil bing untuk: ${query}`
                }, { quoted: msg })
            }

            const displayRows = rows.slice(0, MAX_RESULTS)
            const firstResult = displayRows[0]
            let firstImage = normalizeImageUrl(firstResult?.image)
            if (!firstImage) {
                firstImage = await parseResultImageFromPage(firstResult.link)
            }
            let imageBuffer = null

            for (const candidate of [firstImage, FALLBACK_IMAGE_URL]) {
                imageBuffer = await fetchImageBuffer(candidate)
                if (imageBuffer) break
            }

            const allCaptions = displayRows.map((item, idx) => formatCaption(item, idx)).join('\n\n')

            if (imageBuffer) {
                await sock.sendMessage(jid, {
                    image: imageBuffer,
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
            const message = err?.response?.status
                ? `❌ Gagal search Bing: HTTP ${err.response.status}`
                : `❌ Gagal search Bing: ${err?.message || 'Coba lagi nanti.'}`
            await sock.sendMessage(jid, {
                text: message
            }, { quoted: msg })
        }
    }
}
