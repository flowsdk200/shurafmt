import axios from 'axios'
import * as cheerio from 'cheerio'

const BASE_URL = 'https://apkmody.com'
const SEARCH_API = `${BASE_URL}/wp-json/wp/v2/search`
const POST_API = `${BASE_URL}/wp-json/wp/v2/posts`
const VERSION_API = `${BASE_URL}/wp-json/apkmody/v1/posts`
const MAX_RESULTS = 15
const REQUEST_TIMEOUT = 30000
const DETAIL_CONCURRENCY = 4

const cleanText = (value) => String(value || '')
    .replace(/\*+/g, '')
    .replace(/\s+/g, ' ')
    .trim()

const decodeHtmlText = (html) => {
    const raw = cleanText(html)
    if (!raw) return ''
    const $ = cheerio.load(`<div>${raw}</div>`)
    return cleanText($('div').text())
}

const normalizeUrl = (value) => {
    const raw = cleanText(value)
    if (!raw) return ''
    if (raw.startsWith('//')) return `https:${raw}`
    if (!/^https?:\/\//i.test(raw)) return ''
    return raw
}

const normalizeQuery = (rawInput) => {
    const text = cleanText(rawInput)
    if (!text) return ''

    if (/^https?:\/\//i.test(text)) {
        try {
            const url = new URL(text)
            if (/(^|\.)apkmody\.com$/i.test(url.hostname)) {
                const parts = url.pathname.split('/').filter(Boolean)
                if (parts[0] === 'search' && parts[1]) {
                    return decodeURIComponent(cleanText(parts[1]))
                }
                const q = cleanText(url.searchParams.get('s') || url.searchParams.get('q') || url.searchParams.get('search'))
                if (q) return q
            }
        } catch {
            return text
        }
    }

    return text
}

const formatDate = (iso) => {
    const raw = cleanText(iso)
    if (!raw) return '-'
    const date = new Date(raw)
    if (Number.isNaN(date.getTime())) return raw
    return new Intl.DateTimeFormat('en-GB', {
        day: '2-digit',
        month: 'short',
        year: 'numeric',
        hour: '2-digit',
        minute: '2-digit',
        hour12: false,
        timeZone: 'UTC'
    }).format(date).replace(',', '')
}

const isAppsUrl = (value) => {
    const raw = normalizeUrl(value)
    if (!raw) return false
    try {
        const url = new URL(raw)
        return /(^|\.)apkmody\.com$/i.test(url.hostname) && url.pathname.startsWith('/apps/')
    } catch {
        return false
    }
}

const buildDownloadUrl = (appUrl) => {
    const raw = normalizeUrl(appUrl)
    if (!raw || !isAppsUrl(raw)) return '-'
    const normalized = raw.replace(/\/+$/, '')
    return `${normalized}/download`
}

const fetchJson = async (url, params = {}) => {
    const response = await axios.get(url, {
        timeout: REQUEST_TIMEOUT,
        maxRedirects: 5,
        validateStatus: () => true,
        params,
        headers: {
            'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
            'Accept-Language': 'en-US,en;q=0.9',
            'Accept': 'application/json,text/plain,*/*'
        }
    })

    if (response.status !== 200) {
        throw new Error(`HTTP ${response.status}`)
    }

    if (typeof response.data !== 'object') {
        throw new Error('Respons JSON tidak valid')
    }

    return response.data
}

const fetchSearchIndex = async (query) => {
    const data = await fetchJson(SEARCH_API, {
        search: query,
        per_page: 30
    })

    if (!Array.isArray(data)) {
        throw new Error('Format hasil search tidak valid')
    }

    const rows = []
    const seen = new Set()

    for (const row of data) {
        if (rows.length >= MAX_RESULTS) break

        const id = Number(row?.id)
        const link = normalizeUrl(row?.url)
        const title = decodeHtmlText(row?.title)

        if (!Number.isInteger(id) || id <= 0) continue
        if (!isAppsUrl(link)) continue

        const key = link.toLowerCase()
        if (seen.has(key)) continue
        seen.add(key)

        rows.push({
            id,
            title: title || '-',
            link
        })
    }

    return rows
}

const parsePostDetail = (post, fallback) => {
    const title = decodeHtmlText(post?.title?.rendered) || fallback?.title || '-'
    const desc = decodeHtmlText(post?.excerpt?.rendered) || '-'
    const link = normalizeUrl(post?.link) || fallback?.link || '-'
    const published = formatDate(post?.date)
    const updated = formatDate(post?.modified || post?.date)

    const media = post?._embedded?.['wp:featuredmedia']?.[0] || {}
    const image = normalizeUrl(
        media?.source_url ||
        media?.media_details?.sizes?.full?.source_url
    )

    const author = cleanText(post?._embedded?.author?.[0]?.name) || '-'

    const termGroups = Array.isArray(post?._embedded?.['wp:term']) ? post._embedded['wp:term'] : []
    let category = '-'
    for (const group of termGroups) {
        if (!Array.isArray(group)) continue
        const found = group.find((t) => cleanText(t?.taxonomy) === 'category' && cleanText(t?.name))
        if (found) {
            category = decodeHtmlText(found.name) || '-'
            break
        }
    }

    return {
        postId: cleanText(post?.id) || cleanText(fallback?.id) || '-',
        slug: cleanText(post?.slug) || '-',
        status: cleanText(post?.status) || '-',
        type: cleanText(post?.type) || '-',
        lang: cleanText(post?.lang) || '-',
        title,
        source: 'APKMody',
        version: '-',
        author,
        category,
        published,
        updated,
        translation: cleanText(
            Object.entries(post?.translations || {})
                .map(([code, id]) => `${code}:${id}`)
                .join(', ')
        ) || '-',
        cover: cleanText(
            media?.media_type && media?.mime_type
                ? `${media.media_type}/${media.mime_type} ${media?.media_details?.width || '-'}x${media?.media_details?.height || '-'}`
                : '-'
        ) || '-',
        desc,
        link,
        download: buildDownloadUrl(link),
        image
    }
}

const fetchDetail = async (item) => {
    const [postResult, versionResult] = await Promise.allSettled([
        fetchJson(`${POST_API}/${item.id}`, { _embed: 1 }),
        fetchJson(`${VERSION_API}/${item.id}`)
    ])

    const post = postResult.status === 'fulfilled' ? postResult.value : null
    if (!post || typeof post !== 'object') {
        return {
            postId: item.id || '-',
            slug: '-',
            status: '-',
            type: '-',
            lang: '-',
            title: item.title,
            source: 'APKMody',
            version: '-',
            author: '-',
            category: '-',
            published: '-',
            updated: '-',
            translation: '-',
            cover: '-',
            desc: '-',
            link: item.link,
            download: buildDownloadUrl(item.link),
            image: ''
        }
    }

    const detail = parsePostDetail(post, item)

    if (versionResult.status === 'fulfilled') {
        const version = cleanText(versionResult.value?.version)
        if (version) detail.version = version
    }

    return detail
}

const mapLimit = async (items, limit, iteratee) => {
    const list = Array.isArray(items) ? items : []
    const max = Math.max(1, Number(limit) || 1)
    const results = new Array(list.length)
    let cursor = 0

    const worker = async () => {
        while (true) {
            const idx = cursor
            if (idx >= list.length) return
            cursor += 1
            results[idx] = await iteratee(list[idx], idx)
        }
    }

    const workers = Array.from({ length: Math.min(max, list.length) }, () => worker())
    await Promise.all(workers)
    return results
}

const formatItem = (item, idx) =>
    `${idx + 1}. ${item.title}\n` +
    `× Author: ${item.author}\n` +
    `× Version: ${item.version}\n` +
    `× Category: ${item.category}\n` +
    `× Link: ${item.link}\n` +
    `× Download: ${item.download || '-'}`

const formatRows = (rows) => rows.map((item, idx) => formatItem(item, idx)).join('\n\n')

export default {
    name: 'apkmody',
    aliases: ['apkmodysearch', 'mody'],
    description: 'Cari aplikasi dari APKMody',
    execute: async ({ sock, msg, text, prefix, command, react, useLimit }) => {
        const jid = msg.key.remoteJid
        const query = normalizeQuery(text)

        if (!query) {
            return sock.sendMessage(jid, {
                text: `Contoh penggunaan:\n- ${prefix + command} tiktok`
            }, { quoted: msg })
        }

        await react('⏳')
        try {
            const indexRows = await fetchSearchIndex(query)

            if (!indexRows.length) {
                await react('❌')
                return sock.sendMessage(jid, {
                    text: `❌ Tidak ditemukan hasil apkmody untuk: ${query}`
                }, { quoted: msg })
            }

            const details = await mapLimit(indexRows.slice(0, MAX_RESULTS), DETAIL_CONCURRENCY, fetchDetail)
            const validRows = details.filter((row) => row && cleanText(row.link))

            if (!validRows.length) {
                await react('❌')
                return sock.sendMessage(jid, {
                    text: `❌ Tidak ditemukan hasil apkmody untuk: ${query}`
                }, { quoted: msg })
            }

            const caption = `\`\`\`${formatRows(validRows)}\`\`\``
            const firstImage = normalizeUrl(validRows[0]?.image)

            if (firstImage) {
                await sock.sendMessage(jid, {
                    image: { url: firstImage },
                    caption
                }, { quoted: msg })
            } else {
                await sock.sendMessage(jid, {
                    text: caption
                }, { quoted: msg })
            }

            useLimit()
            await react('✅')
        } catch (err) {
            await react('❌')
            await sock.sendMessage(jid, {
                text: `❌ Gagal search apkmody: ${err?.message || 'Unknown error'}`
            }, { quoted: msg })
        }
    }
}
