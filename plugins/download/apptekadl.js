import axios from 'axios'

const BASE_URL = 'https://appteka.store'
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

const isApptekaHost = (host = '') => /(^|\.)appteka\.store$/i.test(host)

const parseInput = (rawInput) => {
    const text = cleanText(rawInput)
    if (!text) return { type: 'empty', value: '' }

    if (!/^https?:\/\//i.test(text)) {
        if (/^[a-z0-9]+$/i.test(text)) {
            return {
                type: 'app_page',
                value: `${BASE_URL}/app/${text}`,
                appId: text
            }
        }
        return { type: 'invalid', value: text }
    }

    const url = normalizeUrl(text)
    if (!url) return { type: 'invalid', value: text }

    try {
        const parsed = new URL(url)
        if (!isApptekaHost(parsed.hostname)) return { type: 'invalid', value: text }

        if (/\/get\/.+\.apk$/i.test(parsed.pathname)) {
            return { type: 'direct_apk', value: parsed.toString() }
        }

        const parts = parsed.pathname.split('/').filter(Boolean)
        if ((parts[0] === 'app' || parts[0] === 'apps') && parts[1]) {
            return {
                type: 'app_page',
                value: `${BASE_URL}/app/${parts[1]}`,
                appId: parts[1]
            }
        }

        return { type: 'invalid', value: text }
    } catch {
        return { type: 'invalid', value: text }
    }
}

const requestText = async (url) => {
    const response = await axios.get(url, {
        timeout: REQUEST_TIMEOUT,
        maxRedirects: 5,
        validateStatus: () => true,
        headers: {
            'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
            'Accept-Language': 'en-US,en;q=0.9',
            'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8'
        }
    })

    return {
        statusCode: response.status,
        finalUrl: cleanText(response.request?.res?.responseUrl || url) || url,
        body: String(response.data || '')
    }
}

const requestMeta = async (url) => {
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
                statusCode: head.status,
                finalUrl: cleanText(head.request?.res?.responseUrl || url) || url,
                headers: head.headers || {},
                contentType: cleanText(head.headers?.['content-type']).toLowerCase(),
                contentLength: Number(cleanText(head.headers?.['content-length'])) || 0
            }
        }
    } catch {
        // fallback GET range
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

    return {
        statusCode: get.status,
        finalUrl: cleanText(get.request?.res?.responseUrl || url) || url,
        headers: get.headers || {},
        contentType: cleanText(get.headers?.['content-type']).toLowerCase(),
        contentLength: Number(cleanText(get.headers?.['content-length'])) || 0
    }
}

const decodeEscapedUrl = (value) => cleanText(value)
    .replace(/\\\//g, '/')
    .replace(/\\u0026/gi, '&')
    .replace(/\\u003d/gi, '=')
    .replace(/\\u002b/gi, '+')

const extractApkUrlFromHtml = (html) => {
    const source = String(html || '')
    const matches = [...source.matchAll(/\\"link\\":\\"(https:[^"]+?\.apk[^"]*)\\"/gi)]
    for (const row of matches) {
        const decoded = normalizeUrl(decodeEscapedUrl(row[1] || ''))
        if (decoded && /\/get\/.+\.apk$/i.test(decoded)) return decoded
    }
    return ''
}

const parseJsonObjectsFromScripts = (html) => {
    const source = String(html || '')
    const scripts = [...source.matchAll(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/gi)]
    const out = []

    for (const script of scripts) {
        const body = cleanText(script?.[1])
        if (!body) continue
        try {
            const parsed = JSON.parse(body)
            if (Array.isArray(parsed)) out.push(...parsed)
            else if (parsed && typeof parsed === 'object') out.push(parsed)
        } catch {}
    }

    return out
}

const pickSoftwareMeta = (html, appId = '') => {
    const objects = parseJsonObjectsFromScripts(html)
    const list = objects.filter((row) => {
        const type = cleanText(row?.['@type'])
        return /SoftwareApplication|MobileApplication/i.test(type)
    })

    if (!list.length) return null

    if (appId) {
        const picked = list.find((row) => {
            const url = cleanText(row?.url || row?.downloadUrl)
            return url.includes(`/${appId}`)
        })
        if (picked) return picked
    }

    return list[0]
}

const parseApkFileInfo = (apkUrl) => {
    const raw = normalizeUrl(apkUrl)
    if (!raw) {
        return {
            fileName: 'appteka.apk',
            packageId: '-',
            version: '-',
            versionCode: '-'
        }
    }

    let fileName = 'appteka.apk'
    try {
        const url = new URL(raw)
        fileName = decodeURIComponent(url.pathname.split('/').pop() || 'appteka.apk')
    } catch {}

    const base = fileName.replace(/\.apk$/i, '')
    const m = base.match(/^(.+)_([^_]+)_([0-9]+)$/)

    if (!m) {
        return {
            fileName,
            packageId: '-',
            version: '-',
            versionCode: '-'
        }
    }

    return {
        fileName,
        packageId: cleanText(m[1]) || '-',
        version: cleanText(m[2]) || '-',
        versionCode: cleanText(m[3]) || '-'
    }
}

const formatCount = (value) => {
    const n = Number(value)
    if (!Number.isFinite(n) || n < 0) return '-'
    if (n < 1000) return String(Math.floor(n))
    if (n >= 1e9) return `${(n / 1e9).toFixed(n >= 1e10 ? 0 : 1).replace(/\.0$/, '')}B`
    if (n >= 1e6) return `${(n / 1e6).toFixed(n >= 1e7 ? 0 : 1).replace(/\.0$/, '')}M`
    return `${(n / 1e3).toFixed(n >= 1e4 ? 0 : 1).replace(/\.0$/, '')}K`
}

const formatRating = (value, count) => {
    const r = Number(value)
    const c = Number(count)
    if (!Number.isFinite(r) && !Number.isFinite(c)) return '-'
    if (Number.isFinite(r) && Number.isFinite(c)) return `${Number(r.toFixed(2))} (${formatCount(c)})`
    if (Number.isFinite(r)) return String(Number(r.toFixed(2)))
    return formatCount(c)
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

const formatDate = (value) => {
    const raw = cleanText(value)
    if (!raw) return '-'
    const date = new Date(raw)
    if (Number.isNaN(date.getTime())) return raw
    return new Intl.DateTimeFormat('id-ID', {
        day: '2-digit',
        month: 'short',
        year: 'numeric'
    }).format(date)
}

const buildCaption = (info) =>
    `\`\`\`• Title: ${info.title}\n` +
    `• Package: ${info.packageId}\n` +
    `• Version: ${info.version} (${info.versionCode})\n` +
    `• Android: ${info.android}\n` +
    `• Rating: ${info.rating}\n` +
    `• Downloads: ${info.downloads}\n` +
    `• Category: ${info.category}\n` +
    `• Size: ${info.size}\n` +
    `• Updated: ${info.updated}\`\`\``

const resolveAppMetadata = async (appPageUrl, appId) => {
    const page = await requestText(appPageUrl)
    if (page.statusCode !== 200) throw new Error(`Appteka HTTP ${page.statusCode}`)
    if (!page.body.trim()) throw new Error('Halaman Appteka kosong')

    const apkUrl = extractApkUrlFromHtml(page.body)
    if (!apkUrl) throw new Error('Link APK tidak ditemukan')

    const ld = pickSoftwareMeta(page.body, appId) || {}
    const apkInfo = parseApkFileInfo(apkUrl)

    return {
        apkUrl,
        fileName: apkInfo.fileName,
        title: cleanText(ld?.name) || apkInfo.packageId || 'Appteka App',
        packageId: apkInfo.packageId,
        version: apkInfo.version !== '-' ? apkInfo.version : (cleanText(ld?.softwareVersion) || '-'),
        versionCode: apkInfo.versionCode,
        android: cleanText(ld?.operatingSystem) || '-',
        category: cleanText(ld?.applicationCategory) || '-',
        updated: formatDate(ld?.datePublished),
        rating: formatRating(ld?.aggregateRating?.ratingValue, ld?.aggregateRating?.ratingCount),
        downloads: formatCount(ld?.interactionStatistic?.userInteractionCount),
        sizeLabel: cleanText(ld?.fileSize) || '-',
        link: page.finalUrl || appPageUrl
    }
}

export default {
    name: 'apptekadl',
    aliases: ['apptekadownload', 'aptedl'],
    description: 'Download APK dari Appteka',
    execute: async ({ sock, msg, text, prefix, command, react, useLimit }) => {
        const jid = msg.key.remoteJid
        const parsed = parseInput(text)

        if (parsed.type === 'empty') {
            return sock.sendMessage(jid, {
                text: `Contoh penggunaan:\n- ${prefix + command} https://appteka.store/app/110r268612`
            }, { quoted: msg })
        }

        if (parsed.type === 'invalid') {
            return sock.sendMessage(jid, {
                text: '❌ URL/ID Appteka tidak valid'
            }, { quoted: msg })
        }

        await react('⏳')
        try {
            let apkUrl = ''
            let fileName = 'appteka.apk'
            let info = {
                title: 'Appteka App',
                packageId: '-',
                version: '-',
                versionCode: '-',
                android: '-',
                rating: '-',
                downloads: '-',
                category: '-',
                size: '-',
                updated: '-',
                link: '-'
            }

            if (parsed.type === 'direct_apk') {
                apkUrl = parsed.value
                const apkInfo = parseApkFileInfo(apkUrl)
                fileName = apkInfo.fileName
                info = {
                    ...info,
                    title: apkInfo.packageId !== '-' ? apkInfo.packageId : 'Appteka App',
                    packageId: apkInfo.packageId,
                    version: apkInfo.version,
                    versionCode: apkInfo.versionCode,
                    link: apkUrl
                }
            } else {
                const resolved = await resolveAppMetadata(parsed.value, parsed.appId)
                apkUrl = resolved.apkUrl
                fileName = resolved.fileName
                info = {
                    ...info,
                    title: resolved.title,
                    packageId: resolved.packageId,
                    version: resolved.version,
                    versionCode: resolved.versionCode,
                    android: resolved.android,
                    rating: resolved.rating,
                    downloads: resolved.downloads,
                    category: resolved.category,
                    updated: resolved.updated,
                    size: resolved.sizeLabel,
                    link: resolved.link
                }
            }

            const fileMeta = await requestMeta(apkUrl)
            if (fileMeta.statusCode >= 400) throw new Error(`HTTP ${fileMeta.statusCode}`)

            const finalUrl = normalizeUrl(fileMeta.finalUrl || apkUrl)
            if (!finalUrl || !/\/get\/.+\.apk$/i.test(finalUrl)) {
                throw new Error('Link akhir bukan APK Appteka')
            }

            const mime = cleanText(fileMeta.contentType).toLowerCase()
            if (mime && !/application\/vnd\.android\.package-archive|application\/octet-stream/i.test(mime)) {
                throw new Error(`Mime tidak valid: ${mime}`)
            }

            if (Number(fileMeta.contentLength) > 0) {
                info.size = formatBytes(fileMeta.contentLength)
            }

            const caption = buildCaption(info)
            await sock.sendMessage(jid, {
                document: { url: finalUrl },
                mimetype: 'application/vnd.android.package-archive',
                fileName,
                caption
            }, { quoted: msg })

            useLimit()
            await react('✅')
        } catch (err) {
            await react('❌')
            await sock.sendMessage(jid, {
                text: `❌ Gagal Appteka download: ${err?.message || 'Unknown error'}`
            }, { quoted: msg })
        }
    }
}
