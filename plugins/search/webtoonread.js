import axios from 'axios'
import * as cheerio from 'cheerio'
import { sendInteractive } from '../../src/utils/message.js'
import {
    setWebtoonsReadSession,
    getWebtoonsReadSession,
    clearWebtoonsReadSession
} from '../../src/utils/webtoonsReadSession.js'

const USER_AGENT = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36'
const REQUEST_TIMEOUT = 120000
const NEXT_EPISODE_ID_PREFIX = 'wtr:next'
const PANELS_PER_BATCH = 10

const cleanText = (value) => String(value || '')
    .replace(/\s+/g, ' ')
    .trim()

const normalizeUrl = (value, base = 'https://m.webtoons.com/') => {
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

const toEpisodeNo = (value) => {
    const n = Number.parseInt(cleanText(value), 10)
    return Number.isFinite(n) ? n : 0
}

const decodeInputUrl = (rawInput) => {
    const text = cleanText(rawInput)
    if (!text) return ''
    if (!/^https?:\/\//i.test(text)) return ''

    try {
        const url = new URL(text)
        if (!/(^|\.)webtoons\.com$/i.test(url.hostname)) return ''
        return url.toString()
    } catch {
        return ''
    }
}

const parseViewerPage = (html, requestedUrl) => {
    const $ = cheerio.load(html)
    const canonical = normalizeUrl($('link[rel="canonical"]').attr('href') || requestedUrl, requestedUrl)
    const title = cleanText($('.subj_info .subj').first().text()) || cleanText($('meta[property="og:site_name"]').attr('content')) || '-'
    const episodeTitle = cleanText($('.subj_info .subj_episode').first().text()) || cleanText($('title').first().text()) || '-'

    let titleNo = '-'
    let episodeNo = '-'
    try {
        const u = new URL(canonical || requestedUrl)
        titleNo = cleanText(u.searchParams.get('title_no')) || '-'
        episodeNo = cleanText(u.searchParams.get('episode_no')) || '-'
    } catch {}

    const currentEpisodeNo = toEpisodeNo(episodeNo)
    const explicitNextUrl = normalizeUrl($('a.pg_next._nextEpisode').attr('href') || '', canonical || requestedUrl)
    const episodeLinks = []
    const seenEpisodes = new Set()
    $('a[href*="/viewer?title_no="]').each((_, el) => {
        const href = normalizeUrl($(el).attr('href') || '', canonical || requestedUrl)
        if (!href) return
        try {
            const u = new URL(href)
            const epNo = toEpisodeNo(u.searchParams.get('episode_no'))
            if (!epNo || seenEpisodes.has(epNo)) return
            seenEpisodes.add(epNo)
            episodeLinks.push({ episodeNo: epNo, href })
        } catch {}
    })
    episodeLinks.sort((a, b) => a.episodeNo - b.episodeNo)
    const derivedNextUrl = episodeLinks.find((item) => item.episodeNo > currentEpisodeNo)?.href || ''
    const nextUrl = explicitNextUrl || derivedNextUrl

    const images = []
    const seen = new Set()
    $('#_imageList img._images').each((_, el) => {
        const src = normalizeUrl($(el).attr('data-url') || $(el).attr('src') || '', canonical || requestedUrl)
        if (!src) return
        if (!/^https?:\/\//i.test(src)) return

        const key = src.toLowerCase()
        if (seen.has(key)) return
        seen.add(key)

        if (/warning/i.test(src) || /age[_-]?limit/i.test(src)) return
        if (!/\.(jpe?g|png|webp)(\?|$)/i.test(src)) return
        images.push(src)
    })

    return {
        title,
        episodeTitle,
        titleNo,
        episodeNo,
        canonical: canonical || requestedUrl,
        nextUrl,
        images
    }
}

const extractLatestViewerUrlFromList = (html, requestedUrl) => {
    const $ = cheerio.load(html)
    const episodes = []
    const seen = new Set()

    $('#_listUl a[href*="/viewer?title_no="], a[href*="/viewer?title_no="]').each((_, el) => {
        const href = normalizeUrl($(el).attr('href') || '', requestedUrl)
        if (!href) return
        try {
            const u = new URL(href)
            const epNo = toEpisodeNo(u.searchParams.get('episode_no'))
            if (!epNo || seen.has(epNo)) return
            seen.add(epNo)
            episodes.push({ episodeNo: epNo, href })
        } catch {}
    })

    if (!episodes.length) return ''
    episodes.sort((a, b) => a.episodeNo - b.episodeNo)
    return episodes[0]?.href || ''
}

const fetchViewerHtml = async (url) => {
    const response = await axios.get(url, {
        timeout: REQUEST_TIMEOUT,
        maxRedirects: 5,
        validateStatus: () => true,
        headers: {
            'User-Agent': USER_AGENT,
            'Accept-Language': 'id-ID,id;q=0.9,en-US;q=0.8,en;q=0.7',
            Accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8'
        }
    })

    if (response.status !== 200) {
        throw new Error(`Webtoons HTTP ${response.status}`)
    }

    const html = String(response.data || '')
    if (!html.trim()) throw new Error('Respons halaman kosong')
    return html
}

const fetchImageBuffer = async (url, referer) => {
    const response = await axios.get(url, {
        responseType: 'arraybuffer',
        timeout: REQUEST_TIMEOUT,
        maxRedirects: 5,
        validateStatus: () => true,
        headers: {
            'User-Agent': USER_AGENT,
            'Accept-Language': 'id-ID,id;q=0.9,en-US;q=0.8,en;q=0.7',
            Accept: 'image/avif,image/webp,image/apng,image/*,*/*;q=0.8',
            Referer: referer || 'https://m.webtoons.com/'
        }
    })

    if (response.status !== 200) return null
    const contentType = cleanText(response.headers?.['content-type']).toLowerCase()
    if (!contentType.startsWith('image/')) return null

    const buf = Buffer.from(response.data || [])
    if (!buf.length) return null
    return buf
}

const buildCaption = (data, startIndex, endIndex, totalCount, sentCount) => (
    `\`PANEL: ${startIndex + 1}-${endIndex + 1}/${totalCount}\`\n\n` +
    `${data.title}\n\n` +
    `\`\`\`• Episode: ${data.episodeNo}\n` +
    `• Episode title: ${data.episodeTitle}\n` +
    `• No: ${data.titleNo}\`\`\``
)

export default {
    name: 'webtoonread',
    aliases: ['webtoonsread', 'wtoonread', 'wtr'],
    description: 'Baca episode Webtoons (gambar) per part dengan tombol next part',
    execute: async ({ sock, msg, text, prefix, command, sender, react, useLimit }) => {
        const jid = msg.key.remoteJid
        const input = cleanText(text)
        if (!input) {
            return sock.sendMessage(jid, {
                text: `Contoh penggunaan:\n- ${prefix + command} https://m.webtoons.com/id/drama/change-me/episode-1/viewer?title_no=3495&episode_no=1`
            }, { quoted: msg })
        }

        await react('⏳')

        try {
            const isNext = /^next$/i.test(input)

            let data = null
            let startIndex = 0
            let shouldUseLimit = false

            if (isNext) {
                const state = await getWebtoonsReadSession(jid, sender)
                if (!state?.currentViewerUrl) {
                    throw new Error('Sesi webtoons sudah habis. kirim ulang link episode/list')
                }

                const currentHtml = await fetchViewerHtml(state.currentViewerUrl)
                const currentData = parseViewerPage(currentHtml, state.currentViewerUrl)
                if (!currentData.images.length) {
                    throw new Error('Tidak ada panel gambar episode yang bisa diambil')
                }

                const nextPanelStart = (Number.parseInt(state.panelIndex, 10) || 0) + 1
                if (nextPanelStart < currentData.images.length) {
                    data = currentData
                    startIndex = nextPanelStart
                } else if (currentData.nextUrl) {
                    const nextHtml = await fetchViewerHtml(currentData.nextUrl)
                    const nextData = parseViewerPage(nextHtml, currentData.nextUrl)
                    if (!nextData.images.length) {
                        throw new Error('Gagal lanjut ke episode berikutnya')
                    }
                    data = nextData
                    startIndex = 0
                } else {
                    await clearWebtoonsReadSession(jid, sender)
                    await sock.sendMessage(jid, {
                        text: '✅ Episode selesai. tidak ada episode berikutnya.'
                    }, { quoted: msg })
                    await react('✅')
                    return
                }
            } else {
                const viewerUrl = decodeInputUrl(input)
                if (!viewerUrl) {
                    throw new Error('Input harus URL Webtoons (viewer/list)')
                }

                const html = await fetchViewerHtml(viewerUrl)
                let parsed = parseViewerPage(html, viewerUrl)

                if (!parsed.images.length) {
                    const resolvedViewerUrl = extractLatestViewerUrlFromList(html, viewerUrl)
                    if (resolvedViewerUrl) {
                        const viewerHtml = await fetchViewerHtml(resolvedViewerUrl)
                        parsed = parseViewerPage(viewerHtml, resolvedViewerUrl)
                    }
                }

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
                const buf = await fetchImageBuffer(url, data.canonical)
                if (buf) buffers.push(buf)
            }

            if (!buffers.length) {
                throw new Error('Semua panel batch gagal diunduh')
            }

            const lastIndex = endExclusive - 1
            const caption = buildCaption(data, startIndex, lastIndex, data.images.length, buffers.length)
            const albumMessage = buffers.map((buf, i) => ({
                image: buf,
                ...(i === 0 ? { caption: `${caption}` } : {})
            }))
            await sock.sendMessage(jid, { albumMessage }, { quoted: msg })

            await setWebtoonsReadSession(jid, sender, {
                currentViewerUrl: data.canonical,
                panelIndex: lastIndex,
                totalPanels: data.images.length,
                nextEpisodeUrl: data.nextUrl || ''
            })

            const hasNextPanel = lastIndex + 1 < data.images.length
            const hasNextEpisode = !!data.nextUrl
            if (hasNextPanel || hasNextEpisode) {
                const nextStart = lastIndex + 1
                const nextEnd = Math.min(nextStart + PANELS_PER_BATCH, data.images.length)
                await sendInteractive(sock, jid, {
                    title: 'Lanjut ke panel berikutnya?',
                    footer: hasNextPanel
                        ? `NEXT PANEL (${nextStart + 1}-${nextEnd}/${data.images.length})`
                        : 'NEXT EPISODE',
                    buttons: [{
                        id: NEXT_EPISODE_ID_PREFIX,
                        text: 'NEXT PANEL'
                    }]
                }, { quoted: msg })
            } else {
                await clearWebtoonsReadSession(jid, sender)
            }

            if (shouldUseLimit) useLimit()
            await react('✅')
        } catch (err) {
            await react('❌')
            await sock.sendMessage(jid, {
                text: `❌ Error: ${cleanText(err?.message) || 'Gagal ambil data episode webtoons'}`
            }, { quoted: msg })
        }
    }
}
