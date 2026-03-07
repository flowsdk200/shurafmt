import axios from 'axios'
import * as cheerio from 'cheerio'

const LINKEDIN_SEARCH_BASE = 'https://www.linkedin.com/search/results/all'
const BRAVE_SEARCH_URL = 'https://search.brave.com/search'
const MAX_RESULTS = 11
const REQUEST_TIMEOUT = 30000
const RESULT_META_IMAGE_TIMEOUT = 12000
const FALLBACK_IMAGE_URL = 'https://upload.wikimedia.org/wikipedia/commons/c/ca/LinkedIn_logo_initials.png'

const cleanText = (value) => String(value || '').replace(/\s+/g, ' ').trim()

const normalizeUrl = (value) => {
    const raw = cleanText(value)
    if (!raw) return ''
    if (raw.startsWith('javascript:') || raw.startsWith('mailto:') || raw.startsWith('tel:')) return ''
    try {
        const u = new URL(raw)
        u.hash = ''
        return u.toString()
    } catch {
        return ''
    }
}

const normalizeImageUrl = (value) => {
    const raw = cleanText(value)
    if (!raw || raw.startsWith('data:')) return ''
    if (raw.startsWith('//')) return `https:${raw}`
    if (/^https?:\/\//i.test(raw)) return raw
    return ''
}

const isLinkedInDomain = (url) => {
    const raw = cleanText(url)
    if (!raw) return false
    try {
        const u = new URL(raw)
        return /(^|\.)linkedin\.com$/i.test(u.hostname)
    } catch {
        return false
    }
}

const normalizeQuery = (input) => {
    const raw = cleanText(input)
    if (!raw) return ''

    if (/^https?:\/\//i.test(raw)) {
        try {
            const u = new URL(raw)
            if (/(^|\.)linkedin\.com$/i.test(u.hostname) && u.pathname.startsWith('/search/results/all')) {
                const keyword = cleanText(u.searchParams.get('keywords'))
                if (keyword) return keyword
            }
        } catch {
            return raw
        }
    }

    return raw
}

const fetchLinkedInRawResults = async (query) => {
    const { data, status } = await axios.get(LINKEDIN_SEARCH_BASE, {
        params: { keywords: query },
        timeout: REQUEST_TIMEOUT,
        headers: {
            'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
            'Accept-Language': 'en-US,en;q=0.9',
            'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8'
        },
        maxRedirects: 5,
        validateStatus: () => true
    })

    if (status !== 200) return []
    const html = String(data || '')
    if (!html) return []

    const $ = cheerio.load(html)
    const rows = []
    const seen = new Set()

    $('a[href]').each((_, node) => {
        if (rows.length >= MAX_RESULTS) return false
        const href = normalizeUrl($(node).attr('href'))
        if (!href || !isLinkedInDomain(href)) return
        if (!/(linkedin\.com\/(in|company|school|posts|jobs|feed|pulse|events|groups|showcase))/i.test(href)) return

        const key = href.toLowerCase()
        if (seen.has(key)) return
        seen.add(key)

        const title = cleanText($(node).text()) || href
        rows.push({
            title,
            link: href,
            source: 'LinkedIn',
            desc: '-',
            image: ''
        })
    })

    return rows
}

const fetchBraveLinkedInResults = async (query) => {
    const { data, status } = await axios.get(BRAVE_SEARCH_URL, {
        params: {
            q: `site:linkedin.com ${query}`,
            source: 'web'
        },
        timeout: REQUEST_TIMEOUT,
        headers: {
            'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
            'Accept-Language': 'en-US,en;q=0.9',
            'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8'
        },
        maxRedirects: 5,
        validateStatus: () => true
    })

    if (status !== 200) throw new Error(`HTTP ${status}`)
    const html = String(data || '')
    if (!html) throw new Error('Respons kosong')
    if (/just a moment|enable javascript and cookies|cloudflare|access denied/i.test(html)) {
        throw new Error('Brave security challenge')
    }

    const $ = cheerio.load(html)
    const rows = []
    const seen = new Set()

    $('div.snippet[data-pos]').each((_, node) => {
        if (rows.length >= MAX_RESULTS) return false
        const $node = $(node)
        if ($node.attr('data-type') !== 'web') return

        const title = cleanText($node.find('.search-snippet-title').first().text())
        const href = normalizeUrl($node.find('a[href]').first().attr('href'))
        const desc = cleanText($node.find('.generic-snippet .content').first().text() || $node.find('.generic-snippet .line-clamp-dynamic').first().text()) || '-'
        const source = cleanText($node.find('cite.snippet-url').first().text().split('›')[0]) || 'LinkedIn'

        if (!title || !href || !isLinkedInDomain(href)) return
        const key = href.toLowerCase()
        if (seen.has(key)) return
        seen.add(key)

        rows.push({
            title,
            link: href,
            source,
            desc,
            image: ''
        })
    })

    return rows
}

const parseResultImageFromPage = async (url) => {
    const target = normalizeUrl(url)
    if (!target) return ''

    try {
        const { data, status } = await axios.get(target, {
            timeout: RESULT_META_IMAGE_TIMEOUT,
            maxRedirects: 8,
            headers: {
                'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
                'Accept-Language': 'en-US,en;q=0.9',
                'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8'
            },
            validateStatus: () => true
        })

        if (status !== 200) return ''
        const html = String(data || '')
        if (!html) return ''

        const $ = cheerio.load(html)
        const candidates = [
            $('meta[property="og:image"]').attr('content'),
            $('meta[name="twitter:image"]').attr('content'),
            $('meta[name="twitter:image:src"]').attr('content'),
            $('meta[property="twitter:image:src"]').attr('content'),
            $('meta[itemprop="image"]').attr('content'),
            $('link[rel="image_src"]').attr('href')
        ]

        for (const candidate of candidates) {
            const image = normalizeImageUrl(candidate)
            if (image) return image
        }
    } catch {
        return ''
    }

    return ''
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
        if (!buf.length) return null
        return buf
    } catch {
        return null
    }
}

const formatResults = (query, results) => {
    const body = results.map((item, index) => (
        `${index + 1}. ${item.title}\n` +
        `× Source: ${item.source}\n` +
        `× Desc: ${item.desc}\n` +
        `× Link: ${item.link}`
    )).join('\n\n')

    return `${body}`
}

export default {
    name: 'linkedin',
    aliases: ['linkedinsearch', 'lisearch'],
    description: 'Cari hasil linkedin (profile/company/job/post) dari query',
    execute: async ({ sock, msg, text, prefix, command, react, useLimit }) => {
        const jid = msg.key.remoteJid
        const query = normalizeQuery(text)

        if (!query) {
            return sock.sendMessage(jid, {
                text:
                    `Contoh penggunaan:\n` +
                    `- ${prefix + command} ai`
            }, { quoted: msg })
        }

        await react('⏳')
        try {
            let results = await fetchLinkedInRawResults(query)
            if (!results.length) {
                results = await fetchBraveLinkedInResults(query)
            }

            if (!results.length) {
                await react('❌')
                return sock.sendMessage(jid, {
                    text: `❌ Tidak ada hasil linkedin untuk: ${query}`
                }, { quoted: msg })
            }

            const caption = `\`\`\`${formatResults(query, results)}\`\`\``

            const first = results[0]
            let firstImage = normalizeImageUrl(first?.image)
            if (!firstImage) {
                firstImage = await parseResultImageFromPage(first?.link)
            }

            let imageBuffer = null
            for (const candidate of [firstImage, FALLBACK_IMAGE_URL]) {
                if (!candidate) continue
                imageBuffer = await fetchImageBuffer(candidate)
                if (imageBuffer) break
            }

            if (!imageBuffer) {
                throw new Error('❌ Tidak ada gambar valid untuk dikirim')
            }

            await sock.sendMessage(jid, {
                image: imageBuffer,
                caption
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
