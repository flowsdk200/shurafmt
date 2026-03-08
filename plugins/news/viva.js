import axios from 'axios'
import { load } from 'cheerio'

const SITEMAP_URL = 'https://www.viva.co.id/sitemap/news/news-sitemap.xml'
const USER_AGENT = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36'
const MAX_RESULTS = 15

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

const fetchXml = async () => {
    const response = await axios.get(SITEMAP_URL, {
        timeout: 120000,
        validateStatus: () => true,
        headers: {
            'User-Agent': USER_AGENT,
            'Accept-Language': 'id-ID,id;q=0.9,en-US;q=0.8,en;q=0.7',
            Accept: 'application/xml,text/xml;q=0.9,*/*;q=0.8'
        }
    })

    if (response.status !== 200) {
        throw new Error(`Sitemap merespon status ${response.status}.`)
    }

    return String(response.data || '')
}

const parseItems = (xml) => {
    const $ = load(xml, { xmlMode: true })
    return $('url')
        .toArray()
        .map((node) => {
            const $node = $(node)
            return {
                title: cleanText($node.find('news\\:title').first().text()),
                link: cleanText($node.find('loc').first().text()),
                pubDate: cleanText($node.find('news\\:publication_date').first().text()),
                keywords: cleanText($node.find('news\\:keywords').first().text())
            }
        })
        .filter((item) => item.title && item.link)
        .slice(0, MAX_RESULTS)
}

const fetchArticleMeta = async (url) => {
    const response = await axios.get(url, {
        timeout: 120000,
        validateStatus: () => true,
        headers: {
            'User-Agent': USER_AGENT,
            'Accept-Language': 'id-ID,id;q=0.9,en-US;q=0.8,en;q=0.7',
            Accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8'
        }
    })

    if (response.status !== 200) return { image: '', description: '' }
    const html = String(response.data || '')
    const getMeta = (name) => cleanText(
        html.match(new RegExp(`<meta[^>]+(?:property|name)=["']${name}["'][^>]+content=["']([^"']+)`, 'i'))?.[1] || ''
    )

    return {
        image: getMeta('og:image') || getMeta('twitter:image'),
        description: getMeta('og:description') || getMeta('description')
    }
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
                Referer: 'https://www.viva.co.id/',
                Accept: 'image/avif,image/webp,image/apng,image/*,*/*;q=0.8'
            }
        })

        const contentType = cleanText(response.headers?.['content-type']).toLowerCase()
        if (response.status < 200 || response.status >= 400) return null
        if (!contentType.startsWith('image/')) return null

        const buffer = Buffer.from(response.data || [])
        return buffer.length ? buffer : null
    } catch {
        return null
    }
}

const formatItem = (item, index) => (
    `${index + 1}. ${item.title}\n` +
    `• Tanggal: ${toNewsDate(item.pubDate)}\n` +
    `• Link: ${item.link}`
)

export default {
    name: 'viva',
    aliases: ['vivanews'],
    description: 'VIVA',
    execute: async ({ sock, msg, react, useLimit }) => {
        const jid = msg.key.remoteJid
        await react('⏳')

        try {
            const xml = await fetchXml()
            const items = parseItems(xml)
            if (!items.length) {
                await react('❌')
                return sock.sendMessage(jid, { text: '⚠️ Tidak ada berita ditemukan dari VIVA.' }, { quoted: msg })
            }

            let firstImage = null
            const enriched = []

            for (const item of items) {
                const meta = await fetchArticleMeta(item.link)
                const merged = { ...item, description: meta.description || item.keywords || '-' }
                enriched.push(merged)

                if (!firstImage && meta.image) {
                    firstImage = await fetchImageBuffer(meta.image)
                }
            }

            if (!firstImage) {
                await react('❌')
                return sock.sendMessage(jid, { text: '❌ VIVA: Tidak ada gambar valid yang bisa diambil untuk ditampilkan.' }, { quoted: msg })
            }

            const caption = `\`\`\`${enriched.map((item, index) => formatItem(item, index)).join('\n\n')}\`\`\``
            await sock.sendMessage(jid, { image: firstImage, caption }, { quoted: msg })
            useLimit()
            await react('✅')
        } catch (err) {
            await react('❌')
            await sock.sendMessage(jid, {
                text: `❌ Gagal ambil berita VIVA: ${err.message}`
            }, { quoted: msg })
        }
    }
}
