import axios from 'axios'
import { load } from 'cheerio'

const SITEMAP_URL = 'https://www.validnews.id/terkini/terkini_sitemap.xml'
const USER_AGENT = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36'
const DEFAULT_LIMIT = 15
const MAX_LIMIT = 15
const DEFAULT_MAX_CANDIDATES = 60
const IMAGE_EXTENSIONS = /\.(jpe?g|png|webp|gif|bmp|svg|avif|heic|heif)(\?|$)/i
const VIDEO_EXTENSIONS = /\.(3gp|avi|flv|m4v|mkv|mov|mp4|mpg|mpeg|m3u8|webm|wmv|ogv)(\?|$)/i

const normalizeText = (value) => String(value || '').trim()

const toNewsDate = (value) => {
    if (!value) return '-'

    const parsed = new Date(value)
    if (Number.isNaN(parsed.getTime())) return normalizeText(value)

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

const stripHtml = (value) => {
    if (!value) return '-'
    return String(value)
        .replace(/<[^>]*>/g, ' ')
        .replace(/&nbsp;/gi, ' ')
        .replace(/&amp;/g, '&')
        .replace(/&lt;/g, '<')
        .replace(/&gt;/g, '>')
        .replace(/&quot;/g, '"')
        .replace(/&#39;/g, "'")
        .replace(/\s+/g, ' ')
        .trim()
}

const truncate = (value, max = 150) => {
    const text = normalizeText(value)
    if (!text) return '-'
    return text.length > max ? `${text.slice(0, max)}...` : text
}

const parseArgs = (args = []) => {
    const result = { limit: DEFAULT_LIMIT }

    for (const token of args) {
        const fixed = normalizeText(token).toLowerCase()
        if (!fixed) continue

        if (fixed.startsWith('limit=')) {
            const value = Number(fixed.replace('limit=', ''))
            if (Number.isInteger(value) && value > 0) {
                result.limit = Math.min(MAX_LIMIT, Math.max(1, value))
            }
            continue
        }

        if (/^\d+$/.test(fixed)) {
            const value = Number(fixed)
            if (Number.isInteger(value) && value > 0) {
                result.limit = Math.min(MAX_LIMIT, Math.max(1, value))
            }
        }
    }

    return result
}

const parseIndonesianDate = (dateRaw, timeRaw = '') => {
    const dateText = normalizeText(dateRaw)
    const timeText = normalizeText(timeRaw)
    const monthMap = {
        januari: '01',
        februari: '02',
        maret: '03',
        april: '04',
        mei: '05',
        juni: '06',
        juli: '07',
        agustus: '08',
        september: '09',
        oktober: '10',
        november: '11',
        desember: '12'
    }

    const matched = dateText.match(/(\d{1,2})\s+([a-z]+)\s+(\d{4})/i)
    if (!matched) return dateText

    const day = matched[1].padStart(2, '0')
    const month = monthMap[normalizeText(matched[2]).toLowerCase()]
    const year = matched[3]
    if (!month) return dateText

    const time = /^\d{1,2}:\d{2}$/.test(timeText) ? `${timeText}:00` : '00:00:00'
    return `${year}-${month}-${day}T${time}+07:00`
}

const parseSitemap = (xmlText) => {
    const $ = load(xmlText, { xmlMode: true })
    const rows = []

    $('url').each((_, node) => {
        const $node = $(node)
        const link = normalizeText($node.find('loc').first().text())
        const dateRaw = normalizeText($node.find('lastmod').first().text())
        if (!link) return
        if (!/^https?:\/\/(?:www\.)?validnews\.id\/[^\/]+\/[^\/]+/i.test(link)) return

        rows.push({
            link,
            date: dateRaw
        })
    })

    return rows
}

const isImageUrl = (url) => {
    const value = normalizeText(url).toLowerCase()
    if (!value) return false
    if (!value.startsWith('http://') && !value.startsWith('https://')) return false
    if (VIDEO_EXTENSIONS.test(value)) return false
    return IMAGE_EXTENSIONS.test(value) || /\/(image|images?|photo|media|thumbnail)\//i.test(value)
}

const imageRequestHeaders = (url) => {
    try {
        const parsed = new URL(url)
        return {
            'User-Agent': USER_AGENT,
            Accept: 'image/avif,image/webp,image/apng,image/*,*/*;q=0.8',
            Referer: `${parsed.origin}/`,
            Origin: parsed.origin,
        }
    } catch {
        return {
            'User-Agent': USER_AGENT,
            Accept: 'image/avif,image/webp,image/apng,image/*,*/*;q=0.8',
        }
    }
}

const resolveImageBuffer = async (url) => {
    if (!isImageUrl(url)) return null

    try {
        const response = await axios.get(url, {
            timeout: 120000,
            headers: imageRequestHeaders(url),
            responseType: 'arraybuffer',
            validateStatus: () => true
        })

        if (response.status < 200 || response.status >= 400) return null
        const type = String(response.headers['content-type'] || '').toLowerCase()
        if (!type.startsWith('image/')) return null

        const buffer = Buffer.from(response.data || [])
        return buffer.length ? buffer : null
    } catch {
        return null
    }
}

const extractMeta = async (url, fallbackDate = '-') => {
    const response = await axios.get(url, {
        timeout: 120000,
        headers: {
            'User-Agent': USER_AGENT,
            Referer: 'https://www.google.com/',
            'Accept-Language': 'id-ID,id;q=0.9,en-US;q=0.8,en;q=0.7',
        },
        validateStatus: () => true,
    })

    if (response.status < 200 || response.status >= 400) return null

    const html = typeof response.data === 'string' ? response.data : ''
    const $ = load(html)

    const nextDataText = $('script#__NEXT_DATA__').first().text()
    let nextDataDate
    let nextDataImage
    if (nextDataText) {
        try {
            const parsed = JSON.parse(nextDataText)
            const data = parsed?.props?.pageProps?.data || null
            if (data?.date) {
                nextDataDate = parseIndonesianDate(data.date, data.time)
            }
            if (data?.mainPhoto) {
                nextDataImage = normalizeText(data.mainPhoto)
            }
        } catch {
            // ignore malformed next data
        }
    }

    const title = normalizeText(
        $('meta[property="og:title"]').attr('content') ||
        $('meta[name="twitter:title"]').attr('content') ||
        $('meta[name="title"]').attr('content') ||
        $('h1').first().text() ||
        'Untitled'
    )

    let description = normalizeText(
        $('meta[name="description"]').attr('content') ||
        $('meta[property="og:description"]').attr('content') ||
        ''
    )
    if (!description && nextDataText) {
        try {
            const parsed = JSON.parse(nextDataText)
            description = stripHtml(parsed?.props?.pageProps?.data?.lowerTitle || '')
        } catch {
            description = ''
        }
    }
    description = stripHtml(description || '-')

    const candidateImages = [
        $('meta[property="og:image"]').attr('content'),
        $('meta[property="og:image:url"]').attr('content'),
        $('meta[name="twitter:image"]').attr('content'),
        $('meta[name="twitter:image:src"]').attr('content'),
        $('meta[name="thumbnailUrl"]').attr('content'),
        $('meta[itemprop="image"]').attr('content'),
        $('link[rel="preload"][as="image"]').first().attr('href'),
        nextDataImage
    ].map((item) => normalizeText(item)).filter(Boolean)
    const uniqueCandidates = [...new Set(candidateImages)]

    let imageBuffer = null
    for (const candidate of uniqueCandidates) {
        imageBuffer = await resolveImageBuffer(candidate)
        if (imageBuffer) break
    }
    if (!imageBuffer) return null

    const dateRaw = nextDataDate
        || $('meta[property="article:published_time"]').attr('content')
        || $('meta[name="date"]').attr('content')
        || fallbackDate
        || '-'
    const date = toNewsDate(stripHtml(dateRaw))

    return {
        title,
        link: url,
        date,
        description: description || '-',
        imageBuffer
    }
}

const formatItem = ({ title, link, date, description }) =>
    `${title}\n• Tanggal: ${date}\n• Link: ${link}`

const buildMessage = (items, limit) =>
    items.slice(0, limit).map((item, index) => `\`\`\`${index + 1}. ${formatItem(item)}\`\`\``).join('\n\n')

export default {
    name: 'validnews',
    aliases: ['valid'],
    description: 'ValidNews',
    execute: async ({ sock, msg, args, react, useLimit }) => {
        const jid = msg.key.remoteJid
        const { limit } = parseArgs(args)

        await react('⏳')

        try {
            const response = await axios.get(SITEMAP_URL, {
                timeout: 120000,
                headers: {
                    'User-Agent': USER_AGENT,
                    'Accept-Language': 'id-ID,id;q=0.9,en-US;q=0.8,en;q=0.7'
                },
                validateStatus: () => true,
            })

            if (response.status >= 400) {
                throw new Error(`Sitemap merespon status ${response.status}.`)
            }

            const rows = parseSitemap(String(response.data || ''))
            const result = []

            for (const row of rows.slice(0, DEFAULT_MAX_CANDIDATES)) {
                if (result.length >= limit) break

                const meta = await extractMeta(row.link, row.date)
                if (!meta?.imageBuffer) continue
                result.push(meta)
            }

            if (!result.length) {
                await react('❌')
                return sock.sendMessage(jid, {
                    text: '⚠️ Tidak ada berita ditemukan dari ValidNews.'
                }, { quoted: msg })
            }

            const caption = buildMessage(result, limit)
            await sock.sendMessage(jid, {
                image: result[0].imageBuffer,
                caption
            }, { quoted: msg })

            useLimit()
            await react('✅')
        } catch (err) {
            await react('❌')
            await sock.sendMessage(jid, {
                text: `❌ Gagal ambil berita ValidNews: ${err.message}`
            }, { quoted: msg })
        }
    }
}
