import axios from 'axios'
import { load } from 'cheerio'
import { gotScraping } from 'got-scraping'

const SOURCE_URL = 'https://www.jawapos.com/'
const USER_AGENT = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36'
const MAX_RESULTS = 15
const MAX_CANDIDATES = 60

const cleanText = (value) => String(value || '').replace(/\s+/g, ' ').trim()

const toNewsDate = (value) => {
    if (!value) return '-'
    const parsed = new Date(value)
    if (Number.isNaN(parsed.getTime())) return cleanText(value)
    return parsed.toLocaleString('id-ID', {
        timeZone: 'Asia/Jakarta',
        year: 'numeric',
        month: '2-digit',
        day: '2-digit',
        hour: '2-digit',
        minute: '2-digit',
        hour12: false
    })
}

const truncate = (text, max = 130) => {
    const value = cleanText(text)
    if (!value) return '-'
    return value.length > max ? `${value.slice(0, max)}...` : value
}

const toAbsoluteUrl = (href, baseUrl = SOURCE_URL) => {
    const value = cleanText(href)
    if (!value) return null
    try {
        return new URL(value, baseUrl).href
    } catch {
        return null
    }
}

const ARTICLE_RE = /^https?:\/\/(?:www\.)?jawapos\.com\/[^/]+\/\d{10}\/[^/?#]+/i

const fetchHomeLinks = async () => {
    const response = await gotScraping({
        url: SOURCE_URL,
        timeout: { request: 20000 },
        responseType: 'text',
        headers: {
            'User-Agent': USER_AGENT,
            'Accept-Language': 'id-ID,id;q=0.9,en-US;q=0.8,en;q=0.7',
            Accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8'
        }
    })

    if (response.statusCode !== 200) {
        throw new Error(`Homepage merespon status ${response.statusCode}.`)
    }

    console.log(`[JAWAPOS DEBUG] home status=${response.statusCode} url=${SOURCE_URL} bytes=${String(response.body || '').length}`)

    const $ = load(String(response.body || ''))
    const links = []

    $('a[href]').each((_, node) => {
        const href = $(node).attr('href') || ''
        const abs = toAbsoluteUrl(href, SOURCE_URL)
        if (!abs) return
        if (!ARTICLE_RE.test(abs)) return
        links.push(abs)
    })

    const uniqueLinks = [...new Set(links)].slice(0, MAX_CANDIDATES)
    console.log(`[JAWAPOS DEBUG] home links=${uniqueLinks.length}`)
    return uniqueLinks
}

const fetchArticleMeta = async (url) => {
    const response = await gotScraping({
        url,
        timeout: { request: 20000 },
        responseType: 'text',
        headers: {
            'User-Agent': USER_AGENT,
            'Accept-Language': 'id-ID,id;q=0.9,en-US;q=0.8,en;q=0.7',
            Accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8'
        }
    })

    console.log(`[JAWAPOS DEBUG] article status=${response.statusCode} url=${url}`)
    if (response.statusCode !== 200) return null

    const html = String(response.body || '')
    const getMeta = (name) => cleanText(
        html.match(new RegExp(`<meta[^>]+(?:property|name)=["']${name}["'][^>]+content=["']([^"']+)`, 'i'))?.[1] || ''
    )

    const title = cleanText(
        html.match(/<meta[^>]+property=["']og:title["'][^>]+content=["']([^"']+)/i)?.[1] ||
        html.match(/<title[^>]*>([^<]+)/i)?.[1] ||
        ''
    )

    const description = getMeta('description') || getMeta('og:description')
    const image = getMeta('og:image') || getMeta('twitter:image')
    const pubDate = cleanText(
        html.match(/<meta[^>]+(?:property|name)=["']article:published_time["'][^>]+content=["']([^"']+)/i)?.[1] ||
        html.match(/<meta[^>]+(?:property|name)=["']article:modified_time["'][^>]+content=["']([^"']+)/i)?.[1] ||
        html.match(/["']datePublished["']\s*:\s*["']([^"']+)/i)?.[1] ||
        html.match(/["']dateModified["']\s*:\s*["']([^"']+)/i)?.[1] ||
        html.match(/["']published_date["']\s*:\s*["']([^"']+)/i)?.[1] ||
        html.match(/(\d{2}\s+[A-Za-zÀ-ÿ]+\s+\d{4},\s+\d{2}\.\d{2}\s+WIB)/i)?.[1] ||
        ''
    )

    const result = title ? {
        title,
        link: url,
        pubDate,
        description: description || '-',
        image
    } : null

    console.log(`[JAWAPOS DEBUG] article parsed title=${title ? 'yes' : 'no'} image=${image ? 'yes' : 'no'} date=${pubDate ? 'yes' : 'no'} url=${url}`)
    return result
}

const fetchImageBuffer = async (url) => {
    if (!/^https?:\/\//i.test(cleanText(url))) return null
    try {
        const response = await axios.get(url, {
            timeout: 120000,
            responseType: 'arraybuffer',
            validateStatus: () => true,
            headers: {
                'User-Agent': USER_AGENT,
                Referer: 'https://www.jawapos.com/',
                Accept: 'image/avif,image/webp,image/apng,image/*,*/*;q=0.8'
            }
        })

        const contentType = cleanText(response.headers?.['content-type']).toLowerCase()
        console.log(`[JAWAPOS DEBUG] image status=${response.status} type=${contentType || '-'} url=${url}`)
        if (response.status < 200 || response.status >= 400) return null
        if (!contentType.startsWith('image/')) return null

        const buffer = Buffer.from(response.data || [])
        console.log(`[JAWAPOS DEBUG] image bytes=${buffer.length} url=${url}`)
        return buffer.length ? buffer : null
    } catch {
        console.log(`[JAWAPOS DEBUG] image fetch failed url=${url}`)
        return null
    }
}

const formatItem = (item, index) => (
    `${index + 1}. ${item.title}\n` +
    `• Tanggal: ${toNewsDate(item.pubDate)}\n` +
    `• Link: ${item.link}`
)

export default {
    name: 'jawapos',
    aliases: ['jawa', 'jawa-news'],
    description: 'Jawa Pos News',
    execute: async ({ sock, msg, react, useLimit }) => {
        const jid = msg.key.remoteJid
        await react('⏳')

        try {
            const links = await fetchHomeLinks()
            if (!links.length) {
                await react('❌')
                return sock.sendMessage(jid, { text: '⚠️ Tidak ada berita ditemukan dari Jawa Pos News.' }, { quoted: msg })
            }

            let firstImage = null
            const items = []

            for (const link of links) {
                if (items.length >= MAX_RESULTS) break
                const meta = await fetchArticleMeta(link)
                if (!meta) continue

                if (!firstImage && meta.image) {
                    firstImage = await fetchImageBuffer(meta.image)
                }

                items.push(meta)
            }

            console.log(`[JAWAPOS DEBUG] items=${items.length} firstImage=${firstImage ? 'yes' : 'no'}`)

            if (!items.length) {
                await react('❌')
                return sock.sendMessage(jid, { text: '⚠️ Tidak ada berita ditemukan dari Jawa Pos News.' }, { quoted: msg })
            }

            if (!firstImage) {
                await react('❌')
                return sock.sendMessage(jid, { text: '❌ Jawa Pos News: Tidak ada gambar valid yang bisa diambil untuk ditampilkan.' }, { quoted: msg })
            }

            const caption = `\`\`\`${items.map((item, index) => formatItem(item, index)).join('\n\n')}\`\`\``
            await sock.sendMessage(jid, { image: firstImage, caption }, { quoted: msg })
            useLimit()
            await react('✅')
        } catch (err) {
            await react('❌')
            await sock.sendMessage(jid, {
                text: `❌ Gagal ambil berita Jawa Pos News: ${err.message}`
            }, { quoted: msg })
        }
    }
}
