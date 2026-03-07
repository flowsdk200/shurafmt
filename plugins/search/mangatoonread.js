import axios from 'axios'
import * as cheerio from 'cheerio'
import crypto from 'crypto'
import { sendInteractive } from '../../src/utils/message.js'
import {
    clearMangatoonReadSession,
    getMangatoonReadSession,
    setMangatoonReadSession
} from '../../src/utils/mangatoonReadSession.js'

const BASE_URL = 'https://mangatoon.mobi'
const H5_BASE_URL = 'https://h5.mangatoon.mobi'
const USER_AGENT = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36'
const REQUEST_TIMEOUT = 120000
const NEXT_EPISODE_ID_PREFIX = 'mtr:next'
const PANELS_PER_BATCH = 10

const cleanText = (value) => String(value || '')
    .replace(/\s+/g, ' ')
    .trim()

const normalizeUrl = (value, base = `${BASE_URL}/`) => {
    const raw = cleanText(value)
    if (!raw) return ''
    if (raw.startsWith('//')) return `https:${raw}`
    if (/^https?:\/\//i.test(raw)) return raw
    try {
        return new URL(raw, base).toString()
    } catch {
        return ''
    }
}

const getHeaders = (referer = `${BASE_URL}/`) => ({
    'User-Agent': USER_AGENT,
    'Accept-Language': 'id-ID,id;q=0.9,en-US;q=0.8,en;q=0.7',
    Accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
    Referer: referer
})

const getImageHeaders = (referer = `${H5_BASE_URL}/`) => ({
    'User-Agent': USER_AGENT,
    'Accept-Language': 'id-ID,id;q=0.9,en-US;q=0.8,en;q=0.7',
    Accept: 'image/avif,image/webp,image/apng,image/*,*/*;q=0.8',
    Referer: referer
})

const getMeta = ($, name, attr = 'content') =>
    cleanText(
        $(`meta[property="${name}"]`).attr(attr) ||
        $(`meta[name="${name}"]`).attr(attr) ||
        ''
    )

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

const decodeInputUrl = (rawInput) => {
    const text = cleanText(rawInput)
    if (!text || !/^https?:\/\//i.test(text)) return null

    try {
        const url = new URL(text)
        if (!/(^|\.)mangatoon\.mobi$/i.test(url.hostname)) return null

        if (url.hostname === 'h5.mangatoon.mobi' && /^\/contents\/watch$/i.test(url.pathname)) {
            const contentId = cleanText(url.searchParams.get('content_id'))
            const episodeId = cleanText(url.searchParams.get('id'))
            const language = cleanText(url.searchParams.get('_language')) || 'en'
            if (!contentId || !episodeId) return null
            return {
                kind: 'watch',
                language,
                contentId,
                episodeId,
                h5WatchUrl: `${H5_BASE_URL}/contents/watch?id=${episodeId}&content_id=${contentId}&_language=${language}`,
                webWatchUrl: `${BASE_URL}/${language}/watch/${contentId}/${episodeId}`,
                sourceUrl: url.toString()
            }
        }

        const watchMatch = url.pathname.match(/^\/([a-z-]+)\/watch\/(\d+)\/(\d+)$/i)
        if (watchMatch) {
            const [, language, contentId, episodeId] = watchMatch
            return {
                kind: 'watch',
                language: cleanText(language) || 'en',
                contentId,
                episodeId,
                h5WatchUrl: `${H5_BASE_URL}/contents/watch?id=${episodeId}&content_id=${contentId}&_language=${cleanText(language) || 'en'}`,
                webWatchUrl: url.toString(),
                sourceUrl: url.toString()
            }
        }

        const contentId = cleanText(url.searchParams.get('content_id'))
        const language = cleanText(url.pathname.split('/').filter(Boolean)[0]) || 'en'
        if (!contentId) return null

        return {
            kind: 'detail',
            language,
            contentId,
            detailUrl: url.toString(),
            sourceUrl: url.toString()
        }
    } catch {
        return null
    }
}

const fetchHtml = async (url, referer = `${BASE_URL}/`) => {
    const response = await axios.get(url, {
        timeout: REQUEST_TIMEOUT,
        maxRedirects: 5,
        validateStatus: () => true,
        headers: getHeaders(referer)
    })

    if (response.status !== 200) {
        throw new Error(`Mangatoon HTTP ${response.status}`)
    }

    const html = String(response.data || '')
    if (!html.trim()) throw new Error('Respons halaman kosong')
    return html
}

const fetchContentDetail = async (contentId, language = 'en') => {
    const id = cleanText(contentId)
    if (!id) throw new Error('Content ID Mangatoon tidak valid')

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
            'User-Agent': USER_AGENT,
            'Accept-Language': 'id-ID,id;q=0.9,en-US;q=0.8,en;q=0.7',
            Accept: 'application/json,text/plain,*/*',
            Referer: `${H5_BASE_URL}/`
        }
    })

    if (response.status !== 200) {
        throw new Error(`Mangatoon API HTTP ${response.status}`)
    }

    const payload = response.data
    if (!payload || payload.status !== 'success' || !payload.data) {
        throw new Error('Gagal ambil detail Mangatoon')
    }

    return payload.data
}

const fetchImageBuffer = async (url, referer) => {
    const response = await axios.get(url, {
        responseType: 'arraybuffer',
        timeout: REQUEST_TIMEOUT,
        maxRedirects: 5,
        validateStatus: () => true,
        headers: getImageHeaders(referer)
    })

    if (response.status !== 200) return null
    const contentType = cleanText(response.headers?.['content-type']).toLowerCase()
    if (!contentType.startsWith('image/')) return null

    const buf = Buffer.from(response.data || [])
    if (!buf.length) return null
    return buf
}

const resolveInitialWatch = async (parsedInput) => {
    if (!parsedInput) {
        throw new Error('Input harus URL Mangatoon (watch/detail)')
    }

    if (parsedInput.kind === 'watch') {
        const detail = await fetchContentDetail(parsedInput.contentId, parsedInput.language || 'en')
        return {
            language: parsedInput.language || 'en',
            contentId: parsedInput.contentId,
            episodeId: parsedInput.episodeId,
            h5WatchUrl: parsedInput.h5WatchUrl,
            webWatchUrl: parsedInput.webWatchUrl,
            author: cleanText(detail?.author?.name || detail?.author_name || detail?.author || '-') || '-',
            views: fmtCount(detail?.watch_count),
            likes: fmtCount(detail?.like_count)
        }
    }

    const detail = await fetchContentDetail(parsedInput.contentId, parsedInput.language || 'en')
    const firstEpisodeId = cleanText(detail?.first_episode?.id)

    if (!firstEpisodeId) {
        throw new Error('Tidak ada episode Mangatoon yang bisa dibuka')
    }

    return {
        language: parsedInput.language || 'en',
        contentId: parsedInput.contentId,
        episodeId: String(firstEpisodeId),
        h5WatchUrl: `${H5_BASE_URL}/contents/watch?id=${firstEpisodeId}&content_id=${parsedInput.contentId}&_language=${parsedInput.language || 'en'}`,
        webWatchUrl: `${BASE_URL}/${parsedInput.language || 'en'}/watch/${parsedInput.contentId}/${firstEpisodeId}`,
        author: cleanText(detail?.author?.name || detail?.author_name || detail?.author || '-') || '-',
        views: fmtCount(detail?.watch_count),
        likes: fmtCount(detail?.like_count)
    }
}

const parseWatchPage = (html, fallback) => {
    const $ = cheerio.load(html)
    const rawTitle = getMeta($, 'og:title') || cleanText($('title').first().text()) || '-'
    const titleMatch = rawTitle.match(/^(.*?)-((?:Episode|EP)\s*[^-]+)-MangaToon$/i)
    const title = cleanText(titleMatch?.[1]) || cleanText(rawTitle.replace(/-MangaToon$/i, '')) || '-'
    const episodeTitle = cleanText(titleMatch?.[2]) || cleanText(rawTitle) || '-'

    let contentId = cleanText(fallback?.contentId)
    let episodeId = cleanText(fallback?.episodeId)
    let language = cleanText(fallback?.language) || 'en'

    try {
        const metaUrl = new URL(getMeta($, 'og:url') || fallback?.h5WatchUrl || fallback?.webWatchUrl || '')
        contentId = cleanText(metaUrl.searchParams.get('content_id')) || contentId
        episodeId = cleanText(metaUrl.searchParams.get('id')) || episodeId
        language = cleanText(metaUrl.searchParams.get('_language')) || language
    } catch {}

    if (!contentId || !episodeId) {
        const watchMatch = html.match(/contents\/watch\?id=(\d+)&content_id=(\d+)(?:&_language=([a-z-]+))?/i)
        if (watchMatch) {
            episodeId = cleanText(watchMatch[1]) || episodeId
            contentId = cleanText(watchMatch[2]) || contentId
            language = cleanText(watchMatch[3]) || language
        }
    }

    const nextEpisodeId = cleanText((html.match(/next_episode_id\s*=\s*(\d+)/i) || [])[1])

    const images = []
    const seen = new Set()
    $('img').each((_, el) => {
        const src = normalizeUrl($(el).attr('data-src') || $(el).attr('src') || '', fallback?.h5WatchUrl || `${H5_BASE_URL}/`)
        if (!src || !/^https?:\/\//i.test(src)) return
        if (/content_cover_default\.png/i.test(src)) return
        if (!/\.(jpe?g|png|webp)(\?|$)/i.test(src)) return

        const key = src.toLowerCase()
        if (seen.has(key)) return
        seen.add(key)
        images.push(src)
    })

    const h5WatchUrl = `${H5_BASE_URL}/contents/watch?id=${episodeId}&content_id=${contentId}&_language=${language}`
    const webWatchUrl = `${BASE_URL}/${language}/watch/${contentId}/${episodeId}`
    const nextUrl = nextEpisodeId
        ? `${H5_BASE_URL}/contents/watch?id=${nextEpisodeId}&content_id=${contentId}&_language=${language}`
        : ''

    return {
        title,
        episodeTitle,
        author: cleanText(fallback?.author || '-') || '-',
        views: cleanText(fallback?.views || '-') || '-',
        likes: cleanText(fallback?.likes || '-') || '-',
        contentId,
        episodeId,
        language,
        h5WatchUrl,
        canonical: webWatchUrl,
        nextUrl,
        images
    }
}

const buildCaption = (data, startIndex, endIndex, totalCount) => (
    `\`PANEL: ${startIndex + 1}-${endIndex + 1}/${totalCount}\`\n\n` +
    `${data.title}\n\n` +
    `\`\`\`• Author: ${cleanText(data.author || '-') || '-'}\n` +
    `• Views: ${cleanText(data.views || '-') || '-'}\n` +
    `• Likes: ${cleanText(data.likes || '-') || '-'}\n` +
    `• Episode: ${data.episodeTitle}\`\`\``
)

export default {
    name: 'mangatoonread',
    aliases: ['mtr'],
    description: 'Baca episode Mangatoon (gambar) per part dengan tombol next panel',
    execute: async ({ sock, msg, text, prefix, command, sender, react, useLimit }) => {
        const jid = msg.key.remoteJid
        const input = cleanText(text)

        if (!input) {
            return sock.sendMessage(jid, {
                text: `Contoh penggunaan:\n- ${prefix + command} https://mangatoon.mobi/en/villain-girls-punishment-game?content_id=38428`
            }, { quoted: msg })
        }

        await react('⏳')

        try {
            const isNext = /^next$/i.test(input)
            let data = null
            let startIndex = 0
            let shouldUseLimit = false

            if (isNext) {
                const state = await getMangatoonReadSession(jid, sender)
                if (!state?.currentWatchUrl) {
                    throw new Error('Sesi mangatoon sudah habis. kirim ulang link watch/detail')
                }

                const currentHtml = await fetchHtml(state.currentWatchUrl, `${BASE_URL}/`)
                const currentData = parseWatchPage(currentHtml, {
                    author: state.author || '-',
                    views: state.views || '-',
                    likes: state.likes || '-'
                })
                if (!currentData.images.length) {
                    throw new Error('Tidak ada panel gambar episode yang bisa diambil')
                }

                const nextPanelStart = (Number.parseInt(state.panelIndex, 10) || 0) + 1
                if (nextPanelStart < currentData.images.length) {
                    data = currentData
                    startIndex = nextPanelStart
                } else if (currentData.nextUrl) {
                    const nextHtml = await fetchHtml(currentData.nextUrl, currentData.h5WatchUrl)
                    const nextData = parseWatchPage(nextHtml, {
                        author: state.author || '-',
                        views: state.views || '-',
                        likes: state.likes || '-'
                    })
                    if (!nextData.images.length) {
                        throw new Error('Gagal lanjut ke episode berikutnya')
                    }
                    data = nextData
                    startIndex = 0
                } else {
                    await clearMangatoonReadSession(jid, sender)
                    await sock.sendMessage(jid, {
                        text: '✅ Episode selesai. tidak ada episode berikutnya.'
                    }, { quoted: msg })
                    await react('✅')
                    return
                }
            } else {
                const parsedInput = decodeInputUrl(input)
                const resolved = await resolveInitialWatch(parsedInput)
                const html = await fetchHtml(resolved.h5WatchUrl, parsedInput?.sourceUrl || `${BASE_URL}/`)
                const parsed = parseWatchPage(html, resolved)

                if (!parsed.images.length) {
                    throw new Error('Tidak ada panel gambar episode yang bisa diambil')
                }

                data = parsed
                startIndex = 0
                shouldUseLimit = true
            }

            if (!Array.isArray(data.images) || !data.images.length) {
                throw new Error('Panel tidak ditemukan')
            }

            const endExclusive = Math.min(startIndex + PANELS_PER_BATCH, data.images.length)
            const batchUrls = data.images.slice(startIndex, endExclusive)
            if (!batchUrls.length) {
                throw new Error('Panel batch tidak ditemukan')
            }

            const buffers = []
            for (const url of batchUrls) {
                const buf = await fetchImageBuffer(url, data.h5WatchUrl)
                if (buf) buffers.push(buf)
            }

            if (!buffers.length) {
                throw new Error('Semua panel batch gagal diunduh')
            }

            const lastIndex = endExclusive - 1
            const caption = buildCaption(data, startIndex, lastIndex, data.images.length)
            const albumMessage = buffers.map((buf, i) => ({
                image: buf,
                ...(i === 0 ? { caption } : {})
            }))

            await sock.sendMessage(jid, { albumMessage }, { quoted: msg })

            await setMangatoonReadSession(jid, sender, {
                currentWatchUrl: data.h5WatchUrl,
                panelIndex: lastIndex,
                totalPanels: data.images.length,
                nextEpisodeUrl: data.nextUrl || '',
                author: data.author || '-',
                views: data.views || '-',
                likes: data.likes || '-'
            })

            const hasMorePanels = lastIndex < (data.images.length - 1)
            const footer = hasMorePanels
                ? `NEXT PANEL (${lastIndex + 1}/${data.images.length})`
                : (data.nextUrl ? 'NEXT EPISODE' : 'END')

            if (hasMorePanels || data.nextUrl) {
                await sendInteractive(sock, jid, {
                    title: hasMorePanels
                        ? 'Lanjut ke panel berikutnya ?'
                        : 'Lanjut ke episode berikutnya ?',
                    footer,
                    buttons: [
                        { id: `${NEXT_EPISODE_ID_PREFIX}`, text: 'NEXT PANEL' }
                    ]
                }, { quoted: msg })
            }

            if (shouldUseLimit) useLimit()
            await react('✅')
        } catch (err) {
            await react('❌')
            await sock.sendMessage(jid, {
                text: `❌ Error: ${cleanText(err?.message) || 'Gagal baca Mangatoon'}`
            }, { quoted: msg })
        }
    }
}
