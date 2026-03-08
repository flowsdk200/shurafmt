import axios from 'axios'
import { load } from 'cheerio'

const SOURCE_URL = 'https://www.jawapos.com/'
const USER_AGENT = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36'
const MAX_RESULTS = 15
const MAX_CANDIDATES = 60
const HTML_HEADERS = {
    'User-Agent': USER_AGENT,
    'Accept-Language': 'id-ID,id;q=0.9,en-US;q=0.8,en;q=0.7',
    Accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
    Referer: SOURCE_URL
}

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

const fetchHtml = async (url) => {
    try {
        const response = await axios.get(url, {
            timeout: 30000,
            responseType: 'text',
            validateStatus: () => true,
            headers: HTML_HEADERS
        })

        const html = String(response.data || '')
        console.log(`[JAWAPOS DEBUG] axios status=${response.status} url=${url} bytes=${html.length}`)
        if (response.status === 200 && html.trim()) {
            return { html, transport: 'axios', status: response.status }
        }
    } catch (err) {
        console.log(`[JAWAPOS DEBUG] axios failed url=${url} error=${err.message}`)
    }

    try {
        const response = await fetch(url, {
            headers: HTML_HEADERS
        })
        const html = await response.text()
        console.log(`[JAWAPOS DEBUG] fetch status=${response.status} url=${url} bytes=${html.length}`)
        if (response.status === 200 && html.trim()) {
            return { html, transport: 'fetch', status: response.status }
        }
    } catch (err) {
        console.log(`[JAWAPOS DEBUG] fetch failed url=${url} error=${err.message}`)
    }

    try {
        const rJinaUrl = `https://r.jina.ai/http://${url.replace(/^https?:\/\//i, '')}`
        const response = await axios.get(rJinaUrl, {
            timeout: 30000,
            responseType: 'text',
            validateStatus: () => true,
            headers: {
                'User-Agent': USER_AGENT,
                Accept: 'text/plain,text/markdown;q=0.9,*/*;q=0.8'
            }
        })
        const html = String(response.data || '')
        console.log(`[JAWAPOS DEBUG] rjina status=${response.status} url=${url} bytes=${html.length}`)
        if (response.status === 200 && html.trim()) {
            return { html, transport: 'rjina', status: response.status }
        }
    } catch (err) {
        console.log(`[JAWAPOS DEBUG] rjina failed url=${url} error=${err.message}`)
    }

    return { html: '', transport: 'none', status: 0 }
}

const fetchHomeLinks = async () => {
    const response = await fetchHtml(SOURCE_URL)
    if (response.status !== 200 || !response.html.trim()) {
        throw new Error(`Homepage kosong atau merespon status ${response.status || '-'}.`)
    }

    console.log(`[JAWAPOS DEBUG] home transport=${response.transport} status=${response.status} url=${SOURCE_URL} bytes=${response.html.length}`)

    const $ = load(response.html)
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
    const response = await fetchHtml(url)
    console.log(`[JAWAPOS DEBUG] article transport=${response.transport} status=${response.status} url=${url}`)
    if (response.status !== 200 || !response.html.trim()) return null

    const html = response.html
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
