import axios from 'axios'

const API_SEARCH = 'https://ws75.aptoide.com/api/7/apps/search'
const API_META = 'https://ws75.aptoide.com/api/7/getAppMeta'
const REQUEST_TIMEOUT = 30000

const cleanText = (value) => String(value || '')
    .replace(/\s+/g, ' ')
    .trim()

const normalizeUrl = (value) => {
    const raw = cleanText(value)
    if (!raw) return ''
    if (raw.startsWith('//')) return `https:${raw}`
    if (!/^https?:\/\//i.test(raw)) return ''
    return raw
}

const parsePoolApkInfo = (apkUrl) => {
    const raw = normalizeUrl(apkUrl)
    if (!raw) return null

    try {
        const url = new URL(raw)
        if (!/(^|\.)apk\.aptoide\.com$/i.test(url.hostname)) return null

        const parts = url.pathname.split('/').filter(Boolean)
        if (parts.length < 2) return null

        const storeName = cleanText(parts[0]) || '-'
        const fileName = decodeURIComponent(parts[1] || '')

        const m = fileName.match(/^([a-z0-9-]+)-(\d+)-(\d+)-([a-f0-9]{32})\.apk$/i)
        if (!m) return null

        return {
            storeName,
            package: m[1].replace(/-/g, '.'),
            versionCode: m[2],
            appId: m[3]
        }
    } catch {
        return null
    }
}

const isAptoideHost = (host = '') => /(^|\.)aptoide\.com$/i.test(host) || /(^|\.)apk\.aptoide\.com$/i.test(host)

const parseInput = (rawInput) => {
    const text = cleanText(rawInput)
    if (!text) return { type: 'empty', value: '' }

    if (!/^https?:\/\//i.test(text)) {
        return { type: 'query', value: text }
    }

    const normalized = normalizeUrl(text)
    if (!normalized) return { type: 'invalid_url', value: text }

    try {
        const url = new URL(normalized)
        if (!isAptoideHost(url.hostname)) return { type: 'invalid_url', value: text }

        if (/\.apk$/i.test(url.pathname)) {
            return { type: 'direct_apk', value: url.toString(), inferred: parsePoolApkInfo(url.toString()) }
        }

        const appId = cleanText(url.searchParams.get('app_id'))
        const storeName = cleanText(url.searchParams.get('store_name'))
        if (appId && /^\d+$/.test(appId)) {
            return { type: 'app_id', value: Number(appId), storeName }
        }

        return { type: 'query', value: text }
    } catch {
        return { type: 'invalid_url', value: text }
    }
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

const fetchJson = async (url, params = {}) => {
    const response = await axios.get(url, {
        timeout: REQUEST_TIMEOUT,
        validateStatus: () => true,
        params,
        headers: {
            'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
            'Accept': 'application/json,text/plain,*/*',
            'Accept-Language': 'en-US,en;q=0.9'
        }
    })

    if (response.status !== 200) throw new Error(`HTTP ${response.status}`)
    if (!response.data || typeof response.data !== 'object') throw new Error('Respons JSON tidak valid')
    return response.data
}

const getBySearch = async (query) => {
    const search = await fetchJson(API_SEARCH, { query, limit: 1 })
    const first = search?.datalist?.list?.[0]
    if (!first?.id) throw new Error('Aplikasi tidak ditemukan di Aptoide')
    const meta = await fetchJson(API_META, { app_id: first.id })
    return meta?.data || first
}

const getByAppId = async (appId) => {
    const meta = await fetchJson(API_META, { app_id: appId })
    if (!meta?.data) throw new Error('Metadata aplikasi tidak ditemukan')
    return meta.data
}

const toInfo = (node, directApk = '', inferred = null) => {
    const stats = node?.stats || {}
    const file = node?.file || {}
    const urls = node?.urls || {}
    const dev = node?.developer || {}
    const store = node?.store || {}
    const infer = inferred || {}

    const download = normalizeUrl(directApk || file?.path || file?.path_alt)
    if (!download) throw new Error('Link download APK tidak ditemukan')

    const link = normalizeUrl(urls?.w || urls?.m)
    const title = cleanText(node?.name || infer?.package) || 'Aptoide App'
    const fileName = decodeURIComponent(download.split('/').pop()?.split('?')[0] || `${title}.apk`)

    return {
        title,
        fileName,
        package: cleanText(node?.package || infer?.package) || '-',
        appId: cleanText(node?.id || infer?.appId) || '-',
        uname: cleanText(node?.uname) || '-',
        developer: cleanText(dev?.name) || '-',
        store: cleanText(store?.name || infer?.storeName) || '-',
        version: cleanText(file?.vername) || '-',
        versionCode: cleanText(file?.vercode || infer?.versionCode) || '-',
        rating: formatRating(stats?.rating?.avg, stats?.rating?.total),
        downloads: formatCount(stats?.downloads),
        size: formatBytes(file?.filesize || node?.size),
        malware: cleanText(file?.malware?.rank) || '-',
        link: link || '-',
        download
    }
}

const probeFile = async (url) => {
    try {
        const head = await axios.head(url, {
            timeout: REQUEST_TIMEOUT,
            maxRedirects: 5,
            validateStatus: () => true,
            headers: {
                'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
                'Accept': '*/*'
            }
        })

        if (head.status < 400) {
            return {
                finalUrl: cleanText(head.request?.res?.responseUrl || url),
                mime: cleanText(head.headers?.['content-type']) || 'application/vnd.android.package-archive',
                bytes: Number(head.headers?.['content-length']) || 0
            }
        }
    } catch {
        // fallback to GET Range
    }

    const get = await axios.get(url, {
        timeout: REQUEST_TIMEOUT,
        maxRedirects: 5,
        responseType: 'arraybuffer',
        validateStatus: () => true,
        headers: {
            'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
            'Accept': '*/*',
            'Range': 'bytes=0-1'
        }
    })

    if (!(get.status === 200 || get.status === 206)) {
        throw new Error(`HTTP ${get.status}`)
    }

    return {
        finalUrl: cleanText(get.request?.res?.responseUrl || url),
        mime: cleanText(get.headers?.['content-type']) || 'application/vnd.android.package-archive',
        bytes: Number(get.headers?.['content-length']) || 0
    }
}

const buildCaption = (info, size) =>
    `\`\`\`× Title: ${info.title}\n` +
    `× Package: ${info.package}\n` +
    `× Developer: ${info.developer}\n` +
    `× Version: ${info.version} (${info.versionCode})\n` +
    `× Rating: ${info.rating}\n` +
    `× Downloads: ${info.downloads}\n` +
    `× Size: ${size}\n` +
    `× Malware: ${info.malware}\`\`\``

export default {
    name: 'aptoidedl',
    aliases: ['aptdl', 'aptoidedownload'],
    description: 'Download APK dari Aptoide',
    execute: async ({ sock, msg, text, prefix, command, react, useLimit }) => {
        const jid = msg.key.remoteJid
        const parsed = parseInput(text)

        if (parsed.type === 'empty') {
            return sock.sendMessage(jid, {
                text:
                    `Contoh penggunaan:\n` +
                    `- ${prefix + command} https://instagram.en.aptoide.com/?store_name=appupdater&app_id=73785005`
            }, { quoted: msg })
        }

        if (parsed.type === 'invalid_url') {
            return sock.sendMessage(jid, {
                text: '❌ URL tidak valid untuk Aptoide'
            }, { quoted: msg })
        }

        await react('⏳')
        try {
            let info

            if (parsed.type === 'direct_apk') {
                const appIdFromPool = Number(parsed?.inferred?.appId || 0)
                if (Number.isInteger(appIdFromPool) && appIdFromPool > 0) {
                    const data = await getByAppId(appIdFromPool)
                    info = toInfo(data, parsed.value, parsed.inferred)
                } else {
                    info = toInfo({}, parsed.value, parsed.inferred)
                }
            } else if (parsed.type === 'app_id') {
                const data = await getByAppId(parsed.value)
                info = toInfo(data)
            } else {
                const data = await getBySearch(parsed.value)
                info = toInfo(data)
            }

            const fileMeta = await probeFile(info.download)
            const caption = buildCaption(info, fileMeta.bytes ? formatBytes(fileMeta.bytes) : info.size)

            await sock.sendMessage(jid, {
                document: { url: fileMeta.finalUrl || info.download },
                mimetype: 'application/vnd.android.package-archive',
                fileName: info.fileName,
                caption
            }, { quoted: msg })

            useLimit()
            await react('✅')
        } catch (err) {
            await react('❌')
            await sock.sendMessage(jid, {
                text: `❌ Gagal Aptoide download: ${err?.message || 'Unknown error'}`
            }, { quoted: msg })
        }
    }
}
