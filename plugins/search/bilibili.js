import axios from 'axios'
import vm from 'node:vm'
import { gotScraping } from 'got-scraping'

const SEARCH_BASE_URL = 'https://www.bilibili.tv/id/search-result'
const MAX_RESULTS = 15
const REQUEST_TIMEOUT = 30000
const FALLBACK_IMAGE_URL = 'https://p.bstarstatic.com/fe-lib/images/web/share-cover.png@1200w_630h_1e_1c_1f.webp'

const cleanText = (value) => String(value || '')
    .replace(/\*+/g, '')
    .replace(/\s+/g, ' ')
    .trim()

const normalizeQuery = (rawInput) => {
    const text = cleanText(rawInput)
    if (!text) return ''

    if (/^https?:\/\//i.test(text)) {
        try {
            const parsed = new URL(text)
            if (/(^|\.)bilibili\.tv$/i.test(parsed.hostname) && parsed.pathname.includes('/search-result')) {
                const q = cleanText(parsed.searchParams.get('q'))
                if (q) return q
            }
        } catch {
            return text
        }
    }

    return text
}

const normalizeImageUrl = (value) => {
    const raw = cleanText(value)
    if (!raw || raw.startsWith('data:')) return ''
    if (raw.startsWith('//')) return `https:${raw}`
    if (/^https?:\/\//i.test(raw)) return raw
    return ''
}

const extractInitialStateScript = (html) => {
    const source = String(html || '')
    const marker = 'window.__initialState='
    const start = source.indexOf(marker)
    if (start < 0) return ''

    const end = source.indexOf('</script>', start)
    if (end < 0) return ''

    return source.slice(start, end).trim()
}

const evaluateInitialState = (scriptText) => {
    const context = {
        window: {},
        Map,
        console: {
            log() {},
            warn() {},
            error() {}
        }
    }

    vm.createContext(context)
    vm.runInContext(String(scriptText || ''), context, { timeout: 2500 })

    return context.window?.__initialState || null
}

const buildItemLink = (item) => {
    const seasonId = cleanText(item?.season_id)
    if (seasonId) return `https://www.bilibili.tv/id/play/${seasonId}`

    const aid = cleanText(item?.aid)
    if (aid) return `https://www.bilibili.tv/id/video/${aid}`

    return ''
}

const parseResults = (state) => {
    const sections = Array.isArray(state?.searchAll?.allList) ? state.searchAll.allList : []
    const rows = []
    const seen = new Set()

    for (const section of sections) {
        const sectionType = cleanText(section?.type || '')
        const sectionName = cleanText(section?.title || sectionType || '-')
        const items = Array.isArray(section?.items) ? section.items : []

        for (const item of items) {
            const title = cleanText(item?.title)
            const link = buildItemLink(item)
            if (!title || !link) continue

            const dedupKey = link.toLowerCase()
            if (seen.has(dedupKey)) continue
            seen.add(dedupKey)

            const views = cleanText(item?.view || '')
            const duration = cleanText(item?.duration || '')
            const uploader = cleanText(item?.author?.nickname || '')
            const status = cleanText(item?.index_show || item?.label || '')
            const detailDesc = cleanText(item?.description || '').slice(0, 180)
            const highlightDesc = Array.isArray(item?.highlights)
                ? cleanText(item.highlights.map((h) => cleanText(h?.str || h)).join('')).slice(0, 180)
                : ''

            rows.push({
                title,
                link,
                source: cleanText(`Bilibili ${sectionName || sectionType || ''}`) || 'Bilibili',
                views,
                duration,
                uploader,
                status,
                desc: detailDesc || highlightDesc,
                image: normalizeImageUrl(item?.cover || '')
            })
        }
    }

    return rows.slice(0, MAX_RESULTS)
}

const fetchSearchHtml = async (query) => {
    const url = `${SEARCH_BASE_URL}?q=${encodeURIComponent(query)}`
    const { statusCode, body } = await gotScraping(url, {
        throwHttpErrors: false,
        timeout: {
            request: REQUEST_TIMEOUT
        },
        retry: {
            limit: 0
        },
        headers: {
            'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/138.0.0.0 Safari/537.36',
            'Accept-Language': 'id-ID,id;q=0.9,en-US;q=0.8,en;q=0.7',
            'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8'
        }
    })

    if (statusCode !== 200) throw new Error(`HTTP ${statusCode}`)

    const html = String(body || '')
    if (!html.trim()) throw new Error('Halaman kosong')
    if (/access denied|captcha|just a moment|enable javascript|cloudflare/i.test(html)) {
        throw new Error('Halaman terproteksi/challenge')
    }

    return html
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

        const buffer = Buffer.from(res.data || [])
        return buffer.length ? buffer : null
    } catch {
        return null
    }
}

const resolveImageBuffer = async (rows) => {
    const candidates = [
        rows[0]?.image,
        ...rows.slice(1, 5).map((item) => item.image),
        FALLBACK_IMAGE_URL
    ].filter(Boolean)

    for (const candidate of candidates) {
        const img = await fetchImageBuffer(candidate)
        if (img) return img
    }

    return null
}

const formatCaption = (item, idx) => {
    const lines = [
        `${idx + 1}. ${item.title}`,
        `× Source: ${item.source}`
    ]

    if (cleanText(item.views)) lines.push(`× Views: ${item.views}`)
    if (cleanText(item.duration)) lines.push(`× Duration: ${item.duration}`)
    if (cleanText(item.uploader)) lines.push(`× Uploader: ${item.uploader}`)
    if (cleanText(item.status)) lines.push(`× Status: ${item.status}`)
    if (cleanText(item.desc)) lines.push(`× Desc: ${item.desc}`)

    lines.push(`× Link: ${item.link}`)
    return lines.join('\n')
}

export default {
    name: 'bilibili',
    aliases: ['bilisearch', 'bili'],
    description: 'Cari anime/video di bilibili TV',
    execute: async ({ sock, msg, text, prefix, command, react, useLimit }) => {
        const jid = msg.key.remoteJid
        const query = normalizeQuery(text)

        if (!query) {
            return sock.sendMessage(jid, {
                text: `Contoh penggunaan:\n- ${prefix + command} solo leveling`
            }, { quoted: msg })
        }

        await react('⏳')

        try {
            const html = await fetchSearchHtml(query)
            const stateScript = extractInitialStateScript(html)
            if (!stateScript) throw new Error('❌ State script tidak ditemukan')

            const state = evaluateInitialState(stateScript)
            const rows = parseResults(state)

            if (!rows.length) {
                await react('❌')
                return sock.sendMessage(jid, {
                    text: `❌ Tidak ditemukan hasil bilibili untuk: ${query}`
                }, { quoted: msg })
            }

            const displayRows = rows.slice(0, MAX_RESULTS)
            const allCaptions = displayRows
                .map((item, idx) => formatCaption(item, idx))
                .join('\n\n')
            const caption = `\`\`\`${allCaptions}\`\`\``
            const imageBuffer = await resolveImageBuffer(rows)

            if (imageBuffer) {
                await sock.sendMessage(jid, {
                    image: imageBuffer,
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
            return sock.sendMessage(jid, {
                text: `❌ Error: ${err.message}`
            }, { quoted: msg })
        }
    }
}
