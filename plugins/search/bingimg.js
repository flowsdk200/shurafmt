import axios from 'axios'
import * as cheerio from 'cheerio'
import crypto from 'crypto'

const BING_IMAGES_URL = 'https://www.bing.com/images/search'
const REQUEST_TIMEOUT = 60000
const MAX_ALBUM = 10
const MAX_CANDIDATES = 80

const cleanText = (value) => String(value || '').replace(/\s+/g, ' ').trim()

const normalizeQuery = (input) => {
    const raw = cleanText(input)
    if (!raw) return ''

    if (/^https?:\/\//i.test(raw)) {
        try {
            const u = new URL(raw)
            if (/(^|\.)bing\.com$/i.test(u.hostname) && u.pathname.startsWith('/images/search')) {
                const q = cleanText(u.searchParams.get('q'))
                if (q) return q
            }
        } catch {
            return raw
        }
    }

    return raw
}

const normalizeImageUrl = (value) => {
    const raw = cleanText(value)
    if (!raw || raw.startsWith('data:')) return ''
    if (raw.startsWith('//')) return `https:${raw}`
    if (!/^https?:\/\//i.test(raw)) return ''
    return raw
}

const canonicalImageKey = (value) => {
    const raw = normalizeImageUrl(value)
    if (!raw) return ''
    try {
        const u = new URL(raw)
        const host = u.hostname.toLowerCase().replace(/^www\./, '')
        const path = u.pathname.replace(/\/+$/, '')
        return `${host}${path}`.toLowerCase()
    } catch {
        return raw.toLowerCase()
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
        const contentType = cleanText(res.headers?.['content-type']).toLowerCase()
        if (!contentType.startsWith('image/')) return null

        const buf = Buffer.from(res.data || [])
        if (!buf.length) return null
        return buf
    } catch {
        return null
    }
}

const hashBuffer = (buf) => crypto.createHash('sha1').update(buf).digest('hex')

const fetchBingImageCandidates = async (query) => {
    const { data, status } = await axios.get(BING_IMAGES_URL, {
        params: {
            q: query,
            first: 1
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

    if (status !== 200) throw new Error(`Bing Images HTTP ${status}`)
    const html = String(data || '')
    if (!html) throw new Error('Respons Bing Images kosong')
    if (/captcha|our systems have detected unusual traffic|access denied|forbidden/i.test(html)) {
        throw new Error('Bing Images security challenge')
    }

    const $ = cheerio.load(html)
    const urls = []
    const seen = new Set()

    $('a.iusc').each((_, node) => {
        if (urls.length >= MAX_CANDIDATES) return false
        const $node = $(node)
        const metaRaw = cleanText($node.attr('m'))

        let primary = ''
        let thumb = ''

        if (metaRaw) {
            try {
                const meta = JSON.parse(metaRaw)
                primary = normalizeImageUrl(meta?.murl)
                thumb = normalizeImageUrl(meta?.turl)
            } catch {
                // ignore malformed JSON
            }
        }

        const imgEl = $node.find('img').first()
        const direct = normalizeImageUrl($node.attr('href'))
        const imgSrc = normalizeImageUrl(imgEl.attr('src'))
        const dataSrc = normalizeImageUrl(imgEl.attr('data-src'))

        let picked = ''
        for (const candidate of [primary, dataSrc, imgSrc, thumb, direct]) {
            if (!candidate) continue
            const key = canonicalImageKey(candidate)
            if (!key || seen.has(key)) continue
            seen.add(key)
            picked = candidate
            break
        }

        if (picked) urls.push(picked)
    })

    return urls
}

export default {
    name: 'bingimg',
    aliases: ['binging', 'bingimage', 'bis'],
    description: 'Cari gambar dari bing',
    execute: async ({ sock, msg, text, prefix, command, react, useLimit }) => {
        const jid = msg.key.remoteJid
        const query = normalizeQuery(text)

        if (!query) {
            return sock.sendMessage(jid, {
                text:
                    `Contoh penggunaan:\n` +
                    `- ${prefix + command} microsoft`
            }, { quoted: msg })
        }

        await react('⏳')
        try {
            const candidates = await fetchBingImageCandidates(query)
            if (!candidates.length) {
                await react('❌')
                return sock.sendMessage(jid, {
                    text: `❌ Tidak ada hasil gambar bing untuk: ${query}`
                }, { quoted: msg })
            }

            const buffers = []
            const seenHash = new Set()
            for (const url of candidates) {
                if (buffers.length >= MAX_ALBUM) break
                const buf = await fetchImageBuffer(url)
                if (!buf) continue
                const h = hashBuffer(buf)
                if (seenHash.has(h)) continue
                seenHash.add(h)
                buffers.push(buf)
            }

            if (!buffers.length) {
                await react('❌')
                return sock.sendMessage(jid, {
                    text: '❌ Semua gambar bing gagal diambil. coba query lain.'
                }, { quoted: msg })
            }

            const album = buffers.map((buf, i) => ({
                image: buf,
                ...(i === 0 ? { caption: `\`\`\`BING IMAGES RESULTS: ${query.toUpperCase()} (${buffers.length})\`\`\`` } : {})
            }))

            await sock.sendMessage(jid, { albumMessage: album }, { quoted: msg })
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
