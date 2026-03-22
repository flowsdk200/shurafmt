import axios from 'axios'
import * as cheerio from 'cheerio'

const SEARCH_URL = 'https://r.jina.ai/http://komikindo.id/?s={q}&post_type=wp-manga'
const DEFAULT_LIMIT = 5
const MAX_LIMIT = 5
const USER_AGENT = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36'

const METADATA_MAP = {
    'judul alternatif': 'altTitle',
    status: 'status',
    pengarang: 'author',
    ilustrator: 'illustrator',
    grafis: 'artStyle',
    tema: 'genre',
    konten: 'contentType',
    'jenis komik': 'type',
    official: 'official',
    retail: 'retail'
}

const normalizeText = (value) => String(value || '').trim()
const normalizeMetadataText = (value) => normalizeText(value).replace(/\s+/g, ' ')

const parseLimit = (text) => {
    const raw = normalizeText(text)
    const match = raw.match(/\blimit=(\d+)\b/i)
    if (!match?.[1]) return DEFAULT_LIMIT

    const value = Number(match[1])
    if (!Number.isInteger(value) || value <= 0) return DEFAULT_LIMIT
    return Math.min(MAX_LIMIT, value)
}

const removeLimitToken = (text) => normalizeText(String(text || '')).replace(/\blimit=\d+\b/gi, '').trim()

const shortText = (text, max = 220) => {
    const normalized = normalizeMetadataText(text)
    if (!normalized) return '-'
    if (normalized.length <= max) return normalized
    return `${normalized.slice(0, max - 3).trim()}...`
}

const canonicalKomikUrl = (value) => {
    const raw = normalizeText(value)
    if (!raw) return null

    const base = raw
        .split('?')[0]
        .replace(/\/+$/, '')
        .replace('https://komikindo.id', 'https://komikindo.ch')
        .replace('http://komikindo.id', 'https://komikindo.ch')

    try {
        const parsed = new URL(base)
        parsed.pathname = parsed.pathname.endsWith('/') ? parsed.pathname : `${parsed.pathname}/`
        return parsed.toString()
    } catch {
        return base
    }
}

const parseResults = (markdown, limit = DEFAULT_LIMIT) => {
    const start = normalizeText(markdown || '').indexOf('Komik Hasil Pencarian')
    if (start < 0) return []

    const afterStart = markdown.slice(start)
    const stop = afterStart.indexOf('\nKomik Terpopuler')
    const block = stop < 0 ? afterStart : afterStart.slice(0, stop)

    const lines = block.split('\n')
    const results = []
    const seen = new Set()
    const itemRegex = /^### \[(.+?)\]\((https?:\/\/[^\s"\)]+)(?:\s+"[^"]*")?\)/

    for (let i = 0; i < lines.length; i++) {
        const line = normalizeText(lines[i])
        const match = itemRegex.exec(line)
        if (!match) continue

        const title = normalizeText(match[1])
        const url = normalizeText(match[2])
        if (!title || !url) continue
        if (!/komikindo\.(?:id|ch)\//.test(url)) continue
        if (seen.has(url)) continue

        let rating = '-'
        for (let j = i + 1; j < Math.min(i + 4, lines.length); j++) {
            const current = normalizeText(lines[j])
            const score = current.match(/^_(.+?)_$/)
            if (score?.[1]) {
                rating = normalizeText(score[1])
                break
            }
            if (current.startsWith('### [') || current.startsWith('Komik Terpopuler')) break
        }

        seen.add(url)
        results.push({
            title,
            url,
            rating
        })
        if (results.length >= limit) break
    }

    return results
}

const parseMetadataFromSideBar = ($) => {
    const result = {}

    $('.infox .spe span').each((_, el) => {
        const line = normalizeMetadataText($(el).text())
        const match = line.match(/^(.+?)\s*:\s*(.+)$/)
        if (!match) return

        const key = normalizeMetadataText(match[1]).toLowerCase()
        const val = normalizeMetadataText(match[2])
        const field = METADATA_MAP[key]
        if (!field || val === '-') return

        if (field === 'official') {
            const personLinks = $(el)
                .find('.person .data .name')
                .map((_, person) => normalizeMetadataText($(person).text()))
                .get()
                .filter(Boolean)

            result[field] = personLinks.length ? personLinks.join(', ') : val
            return
        }

        if (!val) return
        result[field] = val
    })

    return result
}

const parseChapters = ($) => {
    const list = $('.epsbr .barunew')
        .map((_, el) => normalizeMetadataText($(el).text()))
        .get()
        .filter(Boolean)

    if (!list.length) return { chapterAwal: '-', chapterBaru: '-' }

    return {
        chapterAwal: list[0],
        chapterBaru: list[list.length - 1]
    }
}

const parseKomikMetadata = (html) => {
    const $ = cheerio.load(html || '')
    const meta = parseMetadataFromSideBar($)
    const chapters = parseChapters($)
    const fromLabel = {
        chapterAwal: normalizeMetadataText($('.epsbr.chapter-awal .barunew').first().text()),
        chapterBaru: normalizeMetadataText($('div.epsbr:not(.chapter-awal) .barunew').first().text())
    }

    return {
        rating: normalizeMetadataText($('[itemprop=\"ratingValue\"]').first().text()),
        description: shortText($('.shortcsc').first().text()),
        chapterAwal: fromLabel.chapterAwal || chapters.chapterAwal || '-',
        chapterBaru: fromLabel.chapterBaru || chapters.chapterBaru || '-',
        ...meta
    }
}

const fetchKomikMetadata = async (url) => {
    const detailUrl = canonicalKomikUrl(url)
    if (!detailUrl) return null

    try {
        const response = await axios.get(detailUrl, {
            timeout: 25000,
            headers: {
                'User-Agent': USER_AGENT,
                Accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
                Referer: 'https://komikindo.ch/'
            },
            validateStatus: () => true
        })

        if (response.status < 200 || response.status >= 400) return null
        return parseKomikMetadata(response.data)
    } catch {
        return null
    }
}

const buildResultMetadata = (item, detail = {}) => ({
    title: item.title,
    url: canonicalKomikUrl(item.url) || item.url,
    rating: detail.rating || item.rating || '-',
    altTitle: detail.altTitle || '-',
    status: detail.status || '-',
    author: detail.author || '-',
    illustrator: detail.illustrator || '-',
    artStyle: detail.artStyle || '-',
    genre: detail.genre || '-',
    contentType: detail.contentType || '-',
    type: detail.type || '-',
    retail: detail.retail || '-',
    official: detail.official || '-',
    chapterAwal: detail.chapterAwal || '-',
    chapterBaru: detail.chapterBaru || '-',
    description: detail.description || '-'
})

const formatResults = (items = []) => items
    .map((item, index) => (
        `${index + 1}. ${item.title}\n` +
        `• Rating: ${item.rating}\n` +
        `• Judul Alternatif: ${item.altTitle}\n` +
        `• Status: ${item.status}\n` +
        `• Pengarang: ${item.author}\n` +
        `• Ilustrator: ${item.illustrator}\n` +
        `• Grafis: ${item.artStyle}\n` +
        `• Tema: ${item.genre}\n` +
        `• Jenis: ${item.type}\n` +
        `• Retail: ${item.retail}\n` +
        `• Official: ${item.official}\n` +
        `• Chapter Awal: ${item.chapterAwal}\n` +
        `• Chapter Baru: ${item.chapterBaru}\n` +
        `• Deskripsi: ${item.description}\n` +
        `• Link: ${item.url}`
    ))
    .join('\n\n')

export default {
    name: 'komikindo',
    aliases: ['ki', 'komikindoch'],
    description: 'Cari komik di komikindo',
    execute: async ({ sock, msg, text, prefix, command, args, react, useLimit }) => {
        const jid = msg.key.remoteJid
        const q = normalizeText(String(text || ''))
        const limit = parseLimit(Array.isArray(args) ? args.join(' ') : q)
        const query = removeLimitToken(q)

        if (!query) {
            return sock.sendMessage(jid, {
                text: `Contoh penggunaan:\n- ${prefix + command} shoujo jiten`
            }, { quoted: msg })
        }

        await react('⏳')

        try {
            const endpoint = SEARCH_URL.replace('{q}', encodeURIComponent(query))
            const response = await axios.get(endpoint, {
                timeout: 25000,
                headers: {
                    'User-Agent': USER_AGENT
                },
                validateStatus: () => true
            })

            if (response.status < 200 || response.status >= 400) {
                await react('❌')
                return sock.sendMessage(jid, {
                    text: `❌ Gagal mengambil data komikindo (${response.status}).`
                }, { quoted: msg })
            }

            const results = parseResults(String(response.data || ''), limit)
            if (!results.length) {
                await react('❌')
                return sock.sendMessage(jid, {
                    text: `❌ Tidak ditemukan hasil untuk: ${query}`
                }, { quoted: msg })
            }

            const items = []
            for (const item of results) {
                const detail = await fetchKomikMetadata(item.url)
                items.push(buildResultMetadata(item, detail || {}))
            }

            const caption = `\`\`\`${formatResults(items)}\`\`\``
            await sock.sendMessage(jid, { text: caption }, { quoted: msg })

            useLimit()
            await react('✅')
        } catch (err) {
            await react('❌')
            await sock.sendMessage(jid, {
                text: `❌ Error: ${err.message}`
            }, { quoted: msg })
        }
    }
}
