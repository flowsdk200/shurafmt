import axios from 'axios'
import * as cheerio from 'cheerio'
import crypto from 'crypto'

const SEARCH_URL = 'https://mangatoon.mobi/en/search'
const REQUEST_TIMEOUT = 30000
const MAX_RESULTS = 15

const cleanText = (value) => String(value || '')
    .replace(/\*+/g, '')
    .replace(/\s+/g, ' ')
    .trim()

const normalizeUrl = (value) => {
    const raw = cleanText(value)
    if (!raw) return ''
    if (raw.startsWith('//')) return `https:${raw}`
    if (/^https?:\/\//i.test(raw)) return raw
    try {
        return new URL(raw, SEARCH_URL).toString()
    } catch {
        return ''
    }
}

const normalizeQuery = (rawInput) => {
    const text = cleanText(rawInput)
    if (!text) return ''

    if (/^https?:\/\//i.test(text)) {
        try {
            const url = new URL(text)
            if (/(^|\.)mangatoon\.mobi$/i.test(url.hostname)) {
                const word = cleanText(url.searchParams.get('word'))
                if (word) return word
            }
        } catch {
            return text
        }
    }

    return text
}

const buildApiUrl = (path, params = {}) => {
    const encodedKeys = []
    for (const key in params) encodedKeys.push(encodeURIComponent(key))
    encodedKeys.sort()

    const signSource = encodedKeys
        .map((encodedKey) => `${encodedKey}=${encodeURIComponent(params[decodeURIComponent(encodedKey)])}`)
        .join('&')

    const sign = crypto
        .createHash('md5')
        .update(`${path}${signSource}66c10a61bd916c23f3b33810d3785d17`)
        .digest('hex')

    const query = Object.keys(params)
        .map((key) => `${encodeURIComponent(key)}=${encodeURIComponent(params[key])}`)
        .join('&')

    return `https://sg.mangatoon.mobi${path}?sign=${sign}&${query}`
}

const fetchSearchHtml = async (query) => {
    const response = await axios.get(SEARCH_URL, {
        params: { word: query },
        timeout: REQUEST_TIMEOUT,
        maxRedirects: 5,
        validateStatus: () => true,
        headers: {
            'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
            'Accept-Language': 'en-US,en;q=0.9,id-ID;q=0.8,id;q=0.7',
            Accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8'
        }
    })

    if (response.status !== 200) {
        throw new Error(`HTTP ${response.status}`)
    }

    const html = String(response.data || '')
    if (!html.trim()) throw new Error('Respons kosong')
    return html
}

const fetchContentDetail = async (contentId, language = 'en') => {
    const id = cleanText(contentId)
    if (!id) return null

    const url = buildApiUrl('/api/content/detail', {
        id,
        _: String(Math.floor(Date.now() / 1000)),
        _language: language || 'en',
        _platform: 'web',
        _preference: 'girl',
        _udid: crypto.randomUUID(),
        _v: '3.07.00',
        _webp: 'false'
    })

    const response = await axios.get(url, {
        timeout: REQUEST_TIMEOUT,
        maxRedirects: 5,
        validateStatus: () => true,
        headers: {
            'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
            'Accept-Language': 'en-US,en;q=0.9,id-ID;q=0.8,id;q=0.7',
            Accept: 'application/json,text/plain,*/*'
        }
    })

    if (response.status !== 200) return null
    const data = response.data
    if (!data || data.status !== 'success' || !data.data) return null
    return data.data
}

const fetchImageBuffer = async (url) => {
    const target = normalizeUrl(url)
    if (!target) return null

    try {
        const response = await axios.get(target, {
            responseType: 'arraybuffer',
            timeout: REQUEST_TIMEOUT,
            maxRedirects: 5,
            validateStatus: () => true,
            headers: {
                'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
                'Accept-Language': 'en-US,en;q=0.9,id-ID;q=0.8,id;q=0.7',
                Accept: 'image/avif,image/webp,image/apng,image/*,*/*;q=0.8',
                Referer: 'https://mangatoon.mobi/'
            }
        })

        if (response.status !== 200) return null
        const contentType = cleanText(response.headers?.['content-type']).toLowerCase()
        if (!contentType.startsWith('image/')) return null

        const buffer = Buffer.from(response.data || [])
        if (!buffer.length) return null
        return buffer
    } catch {
        return null
    }
}

const fmtCount = (value) => {
    const num = Number(value)
    if (!Number.isFinite(num) || num < 0) return '-'
    if (num >= 1_000_000_000) {
        const n = num / 1_000_000_000
        return `${Number.isInteger(n) ? n.toFixed(0) : n.toFixed(1).replace(/\.0$/, '')}B`
    }
    if (num >= 1_000_000) {
        const n = num / 1_000_000
        return `${Number.isInteger(n) ? n.toFixed(0) : n.toFixed(1).replace(/\.0$/, '')}M`
    }
    if (num >= 1_000) {
        const n = num / 1_000
        return `${Number.isInteger(n) ? n.toFixed(0) : n.toFixed(1).replace(/\.0$/, '')}K`
    }
    return String(Math.trunc(num))
}

const parseRows = (html) => {
    const $ = cheerio.load(html)
    const rows = []
    const seen = new Set()

    $('.have-result > div').each((_, sectionEl) => {
        const section = cleanText($(sectionEl).find('.top-line .type-title').first().text()) || '-'

        $(sectionEl).find('.recommend-comics .recommend-item').each((__, itemEl) => {
            if (rows.length >= MAX_RESULTS) return

            const a = $(itemEl).find('a').first()
            const title = cleanText($(itemEl).find('.recommend-comics-title span').first().text())
            const tags = cleanText($(itemEl).find('.comics-type span').first().text())
            const link = normalizeUrl(a.attr('href'))
            const image = normalizeUrl(
                $(itemEl).find('.comics-image img').attr('data-src') ||
                $(itemEl).find('.comics-image img').attr('src')
            )

            if (!title || !link) return

            const key = link.toLowerCase()
            if (seen.has(key)) return
            seen.add(key)

            rows.push({
                title,
                section,
                tags: tags || '-',
                link,
                image
            })
        })
    })

    return rows.slice(0, MAX_RESULTS)
}

const parseLinkInfo = (url) => {
    try {
        const u = new URL(url)
        return {
            contentId: cleanText(u.searchParams.get('content_id')),
            language: cleanText(u.pathname.split('/').filter(Boolean)[0]) || 'en'
        }
    } catch {
        return { contentId: '', language: 'en' }
    }
}

const filterReadableRows = async (rows) => {
    const results = []

    for (const row of rows) {
        if (results.length >= MAX_RESULTS) break
        try {
            const { contentId, language } = parseLinkInfo(row.link)
            const detail = await fetchContentDetail(contentId, language)
            if (!detail || Number.parseInt(detail?.type || 0, 10) !== 1) continue
            if (!detail?.first_episode?.id) continue
            results.push({
                ...row,
                author: cleanText(detail?.author?.name || detail?.author_name || detail?.author || '-') || '-',
                views: fmtCount(detail?.watch_count),
                likes: fmtCount(detail?.like_count)
            })
        } catch {}
    }

    return results
}

const formatItem = (item, index) => (
    `${index + 1}. ${item.title}\n` +
    `• Author: ${item.author || '-'}\n` +
    `• Views: ${item.views || '-'}\n` +
    `• Likes: ${item.likes || '-'}\n` +
    `• Tags: ${item.tags}\n` +
    `• Link: ${item.link}`
)

const buildCaption = (rows) => rows.map((item, idx) => formatItem(item, idx)).join('\n\n')

export default {
    name: 'mangatoon',
    aliases: ['mtoon'],
    description: 'Cari komik dan novel dari MangaToon',
    execute: async ({ sock, msg, text, prefix, command, react, useLimit }) => {
        const jid = msg.key.remoteJid
        const query = normalizeQuery(text)

        if (!query) {
            return sock.sendMessage(jid, {
                text: `Contoh penggunaan:\n- ${prefix + command} villain`
            }, { quoted: msg })
        }

        await react('⏳')

        try {
            const html = await fetchSearchHtml(query)
            const baseRows = parseRows(html)
            const rows = await filterReadableRows(baseRows)
            if (!rows.length) {
                throw new Error('Tidak ada hasil MangaToon')
            }

            const caption = buildCaption(rows)
            const firstImage = normalizeUrl(rows[0]?.image)

            if (firstImage) {
                const imageBuffer = await fetchImageBuffer(firstImage)
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
                text: `❌ Error: ${cleanText(err?.message) || 'Gagal ambil data MangaToon'}`
            }, { quoted: msg })
        }
    }
}
