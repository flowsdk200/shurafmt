import axios from 'axios'

const API_SEARCH = 'https://ws75.aptoide.com/api/7/apps/search'
const API_META = 'https://ws75.aptoide.com/api/7/getAppMeta'
const MAX_RESULTS = 10
const REQUEST_TIMEOUT = 30000
const DETAIL_CONCURRENCY = 4

const cleanText = (value) => String(value || '')
    .replace(/\*+/g, '')
    .replace(/\s+/g, ' ')
    .trim()

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
            const parsed = new URL(text)
            if (/(^|\.)aptoide\.com$/i.test(parsed.hostname) && parsed.pathname.includes('/search')) {
                const q = cleanText(parsed.searchParams.get('query') || parsed.searchParams.get('q'))
                if (q) return q
            }
        } catch {
            return text
        }
    }

    return text
}

const formatBytes = (bytes) => {
    const n = Number(bytes || 0)
    if (!Number.isFinite(n) || n <= 0) return '-'
    const units = ['B', 'KB', 'MB', 'GB', 'TB']
    let size = n
    let idx = 0
    while (size >= 1024 && idx < units.length - 1) {
        size /= 1024
        idx += 1
    }
    const fixed = size >= 100 ? 0 : size >= 10 ? 1 : 2
    return `${size.toFixed(fixed).replace(/\.0+$/, '')} ${units[idx]}`
}

const formatCount = (value) => {
    const n = Number(value)
    if (!Number.isFinite(n) || n < 0) return '-'
    if (n < 1000) return String(Math.floor(n))

    const units = [
        { v: 1e9, s: 'B' },
        { v: 1e6, s: 'M' },
        { v: 1e3, s: 'K' }
    ]
    for (const unit of units) {
        if (n >= unit.v) {
            const val = n / unit.v
            const out = val >= 100 ? val.toFixed(0) : val >= 10 ? val.toFixed(1) : val.toFixed(2)
            return `${out.replace(/\.0+$/, '')}${unit.s}`
        }
    }
    return String(Math.floor(n))
}

const formatRating = (avg, total) => {
    const a = Number(avg)
    const t = Number(total)
    if (!Number.isFinite(a) && !Number.isFinite(t)) return '-'
    if (Number.isFinite(a) && Number.isFinite(t)) return `${a.toFixed(2)} (${formatCount(t)})`
    if (Number.isFinite(a)) return a.toFixed(2)
    return formatCount(t)
}

const fetchSearch = async (query) => {
    const response = await axios.get(API_SEARCH, {
        timeout: REQUEST_TIMEOUT,
        validateStatus: () => true,
        params: {
            query,
            limit: MAX_RESULTS
        },
        headers: {
            'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
            'Accept': 'application/json,text/plain,*/*',
            'Accept-Language': 'en-US,en;q=0.9'
        }
    })

    if (response.status !== 200) throw new Error(`HTTP ${response.status}`)
    if (!response.data || typeof response.data !== 'object') throw new Error('Respons JSON tidak valid')

    const rows = Array.isArray(response.data?.datalist?.list) ? response.data.datalist.list : []
    return rows.slice(0, MAX_RESULTS)
}

const fetchMeta = async (appId) => {
    const id = Number(appId)
    if (!Number.isInteger(id) || id <= 0) return null

    const response = await axios.get(API_META, {
        timeout: REQUEST_TIMEOUT,
        validateStatus: () => true,
        params: {
            app_id: id
        },
        headers: {
            'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
            'Accept': 'application/json,text/plain,*/*',
            'Accept-Language': 'en-US,en;q=0.9'
        }
    })

    if (response.status !== 200) return null
    if (!response.data || typeof response.data !== 'object') return null
    return response.data?.data || null
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

const toRow = (base, meta) => {
    const node = meta || base || {}
    const stats = node?.stats || base?.stats || {}
    const file = node?.file || base?.file || {}
    const urls = node?.urls || base?.urls || {}
    const store = node?.store || base?.store || {}
    const dev = node?.developer || base?.developer || {}

    return {
        title: cleanText(node?.name || base?.name) || '-',
        source: 'Aptoide',
        appId: cleanText(node?.id || base?.id) || '-',
        uname: cleanText(node?.uname || base?.uname) || '-',
        store: cleanText(store?.name) || '-',
        package: cleanText(node?.package || base?.package) || '-',
        developer: cleanText(dev?.name) || '-',
        version: cleanText(file?.vername) || '-',
        versionCode: cleanText(file?.vercode) || '-',
        rating: formatRating(stats?.rating?.avg, stats?.rating?.total),
        downloads: formatCount(stats?.downloads),
        size: formatBytes(file?.filesize || node?.size || base?.size),
        malware: cleanText(file?.malware?.rank) || '-',
        added: cleanText(node?.added || base?.added) || '-',
        updated: cleanText(node?.updated || base?.updated || node?.modified || base?.modified) || '-',
        desc: cleanText(dev?.website || dev?.email || '-'),
        link: normalizeUrl(urls?.w || urls?.m) || '-',
        download: normalizeUrl(file?.path || file?.path_alt) || '-',
        image: normalizeUrl(node?.icon || base?.icon) || ''
    }
}

const formatItem = (item, idx) =>
    `${idx + 1}. ${item.title}\n` +
    `× Package: ${item.package}\n` +
    `× Developer: ${item.developer}\n` +
    `× Version: ${item.version} (${item.versionCode})\n` +
    `× Rating: ${item.rating}\n` +
    `× Downloads: ${item.downloads}\n` +
    `× Size: ${item.size}\n` +
    `× Malware: ${item.malware}\n` +
    `× Link: ${item.link}\n` +
    `× Download: ${item.download}`

const formatRows = (rows) => rows.map((item, idx) => formatItem(item, idx)).join('\n\n')

export default {
    name: 'aptoide',
    aliases: ['aptoidesearch', 'apts'],
    description: 'Cari aplikasi dari Aptoide',
    execute: async ({ sock, msg, text, prefix, command, react, useLimit }) => {
        const jid = msg.key.remoteJid
        const query = normalizeQuery(text)

        if (!query) {
            return sock.sendMessage(jid, {
                text: `Contoh penggunaan:\n- ${prefix + command} instagram`
            }, { quoted: msg })
        }

        await react('⏳')
        try {
            const searchRows = await fetchSearch(query)
            if (!searchRows.length) {
                await react('❌')
                return sock.sendMessage(jid, {
                    text: `❌ Tidak ditemukan hasil aptoide untuk: ${query}`
                }, { quoted: msg })
            }

            const detailRows = await mapLimit(searchRows, DETAIL_CONCURRENCY, async (base) => {
                const meta = await fetchMeta(base?.id)
                return toRow(base, meta)
            })

            const rows = detailRows.filter((row) => row && cleanText(row.title))
            if (!rows.length) {
                await react('❌')
                return sock.sendMessage(jid, {
                    text: `❌ Tidak ditemukan hasil aptoide untuk: ${query}`
                }, { quoted: msg })
            }

            const caption = `\`\`\`${formatRows(rows)}\`\`\``
            const firstImage = normalizeUrl(rows[0]?.image)

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
                text: `❌ Gagal search aptoide: ${err?.message || 'Unknown error'}`
            }, { quoted: msg })
        }
    }
}
