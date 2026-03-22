import axios from 'axios'
import * as cheerio from 'cheerio'

const BASE_URL = 'https://sfile.co'
const REQUEST_TIMEOUT = 30000
const USER_AGENT = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36'

const clean = (value) => String(value || '').replace(/\s+/g, ' ').trim()
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms))

const isSfileHost = (host = '') => /(^|\.)sfile\.co$/i.test(host)

const normalizeInput = (raw) => {
    const text = clean(raw)
    if (!text) return ''

    if (/^[a-zA-Z0-9]{6,}$/i.test(text)) {
        return `${BASE_URL}/${text}`
    }

    try {
        const url = new URL(text)
        if (!isSfileHost(url.hostname)) return ''

        const parts = url.pathname.split('/').filter(Boolean)
        if (!parts.length) return ''

        if (parts[0] === 'download' && parts[1]) {
            return `${BASE_URL}/${parts[1]}`
        }

        if (/^[a-zA-Z0-9]+$/i.test(parts[0])) {
            return `${BASE_URL}/${parts[0]}`
        }
    } catch {
        return ''
    }

    return ''
}

const decodeHtml = (value) => clean(value).replace(/&amp;/g, '&')
const normalizeTitle = (value) => clean(value)
    .replace(/^download\s+/i, '')
    .replace(/\s*\.\s*apk$/i, '')
    .replace(/\.apk$/i, '')
    .trim() || '-'

const extractSizeText = (value) => {
    const text = clean(value)
    if (!text) return ''
    const match = text.match(/size\s+([0-9.,]+\s*(?:kb|mb|gb|tb))/i)
    return clean(match?.[1] || '')
}

const normalizeDisplaySizeText = (value) => {
    const text = clean(value)
    if (!text) return '-'

    const match = text.match(/^([0-9]+(?:[.,][0-9]+)?)\s*(B|KB|MB|GB|TB)$/i)
    if (!match) return text

    const amount = Number(match[1].replace(',', '.'))
    const unit = String(match[2] || '').toUpperCase()
    if (!Number.isFinite(amount) || amount <= 0) return text

    const units = ['B', 'KB', 'MB', 'GB', 'TB']
    const idx = units.indexOf(unit)
    if (idx < 0) return text

    let bytes = amount
    for (let i = 0; i < idx; i += 1) bytes *= 1024

    return formatBytes(bytes)
}

const parseSetCookies = (setCookie) => {
    const cookieMap = {}
    const rows = Array.isArray(setCookie) ? setCookie : []
    for (const row of rows) {
        const part = String(row || '').split(';')[0]
        const idx = part.indexOf('=')
        if (idx <= 0) continue
        const key = clean(part.slice(0, idx))
        const val = clean(part.slice(idx + 1))
        if (!key) continue
        cookieMap[key] = val
    }
    return cookieMap
}

const toCookieHeader = (cookieMap) => Object.entries(cookieMap)
    .map(([k, v]) => `${k}=${v}`)
    .join('; ')

const fetchHtml = async (url, { cookies = {}, referer = '' } = {}) => {
    const headers = {
        'User-Agent': USER_AGENT,
        'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
        'Accept-Language': 'id-ID,id;q=0.9,en-US;q=0.8,en;q=0.7'
    }

    const cookieHeader = toCookieHeader(cookies)
    if (cookieHeader) headers.Cookie = cookieHeader
    if (referer) headers.Referer = referer

    const response = await axios.get(url, {
        timeout: REQUEST_TIMEOUT,
        maxRedirects: 8,
        validateStatus: () => true,
        headers
    })

    if (response.status >= 400) {
        throw new Error(`HTTP ${response.status}`)
    }

    const html = String(response.data || '')
    if (!html.trim()) {
        throw new Error('Respons kosong')
    }

    return {
        statusCode: response.status,
        finalUrl: clean(response.request?.res?.responseUrl || response.config?.url || url),
        html,
        setCookies: parseSetCookies(response.headers?.['set-cookie'])
    }
}

const extractDownloadMeta = (html) => {
    const $ = cheerio.load(String(html || ''))
    const block = $('[data-dw-url]').first()
    const dataDw = clean(block.attr('data-dw-url'))
    const waitRaw = Number(clean(block.attr('data-wait-seconds')))
    const waitSeconds = Number.isFinite(waitRaw) && waitRaw > 0 ? waitRaw : 7
    const descMeta = clean(
        $('meta[name="description"]').attr('content') ||
        $('meta[property="og:description"]').attr('content')
    )
    const titleRaw = clean(
        $('h1').first().text() ||
        $('meta[property="og:title"]').attr('content') ||
        $('title').first().text()
    )
    const normalizedDw = decodeHtml(dataDw)
    const directDw = /^https?:\/\//i.test(normalizedDw) ? normalizedDw : `${BASE_URL}${normalizedDw.startsWith('/') ? '' : '/'}${normalizedDw}`

    return {
        downloadPageUrl: directDw,
        waitSeconds,
        title: normalizeTitle(titleRaw),
        sizeText: extractSizeText(descMeta)
    }
}

const isExpiredPage = (html) => {
    const text = clean(html).toLowerCase()
    return text.includes('expired download link') ||
        text.includes('generate new link') ||
        text.includes('download link has expired') ||
        text.includes('session download tidak valid')
}

const extractDirectUrl = (html) => {
    const source = String(html || '')
    const escaped = source.match(/https?:\\\/\\\/download\d+\.sfile\.co\\\/downloadfile\\\/[^"']+/i)
    if (escaped?.[0]) return decodeHtml(escaped[0].replace(/\\\//g, '/'))

    const plain = source.match(/https?:\/\/download\d+\.sfile\.co\/downloadfile\/[^"'\\s<]+/i)
    if (plain?.[0]) return decodeHtml(plain[0])

    const varRef = source.match(/directDownloadUrl\s*=\s*['"]([^'"]+)['"]/i)
    if (varRef?.[1]) return decodeHtml(varRef[1].replace(/\\\//g, '/'))

    const $ = cheerio.load(source)
    const attr = decodeHtml(clean($('[data-direct-download]').first().attr('data-direct-download')))
    if (attr) return attr

    return ''
}

const resolveSfileDownload = async (fileUrl) => {
    let lastError = 'Gagal resolve download link'

    for (let attempt = 1; attempt <= 3; attempt += 1) {
        const cookies = {}

        const page = await fetchHtml(fileUrl)
        Object.assign(cookies, page.setCookies)

        const meta = extractDownloadMeta(page.html)
        if (!meta.downloadPageUrl) {
            throw new Error('data-dw-url tidak ditemukan')
        }

        await sleep((meta.waitSeconds + 1) * 1000)

        const downloadPage = await fetchHtml(meta.downloadPageUrl, {
            cookies,
            referer: page.finalUrl || fileUrl
        })
        Object.assign(cookies, downloadPage.setCookies)

        if (isExpiredPage(downloadPage.html)) {
            lastError = 'Sesi download tidak valid (expired/challenge)'
            continue
        }

        const directUrl = extractDirectUrl(downloadPage.html)
        if (!directUrl) {
            lastError = 'Direct URL tidak ditemukan di halaman download'
            continue
        }

        try {
            const parsed = new URL(directUrl)
            if (!isSfileHost(parsed.hostname)) {
                lastError = 'Host direct URL tidak valid'
                continue
            }
        } catch {
            lastError = 'Format direct URL tidak valid'
            continue
        }

        return {
            title: meta.title,
            sizeText: meta.sizeText || '',
            filePageUrl: page.finalUrl || fileUrl,
            directUrl
        }
    }

    throw new Error(lastError)
}

const probeFileMeta = async (url) => {
    const response = await axios.head(url, {
        timeout: REQUEST_TIMEOUT,
        maxRedirects: 5,
        validateStatus: () => true,
        headers: {
            'User-Agent': USER_AGENT,
            'Accept': '*/*'
        }
    })

    if (response.status >= 400) {
        throw new Error(`HTTP ${response.status}`)
    }

    const finalUrl = clean(response.request?.res?.responseUrl || response.config?.url || url)
    const mime = clean(response.headers?.['content-type']) || 'application/octet-stream'
    const len = Number(clean(response.headers?.['content-length']))

    let fileName = 'sfile.bin'
    try {
        const parsed = new URL(finalUrl)
        fileName = decodeURIComponent(parsed.pathname.split('/').pop() || 'sfile.bin')
    } catch {
        // keep default
    }

    return {
        finalUrl,
        mime,
        bytes: Number.isFinite(len) ? len : 0,
        fileName
    }
}

const formatBytes = (bytes) => {
    const n = Number(bytes || 0)
    if (!Number.isFinite(n) || n <= 0) return '-'
    const units = ['B', 'KB', 'MB', 'GB']
    let size = n
    let idx = 0
    while (size >= 1000 && idx < units.length - 1) {
        size /= 1000
        idx += 1
    }
    const fixed = size >= 100 ? 0 : size >= 10 ? 0 : 2
    return `${size.toFixed(fixed).replace(/\.0+$/, '')} ${units[idx]}`
}

const buildCaption = ({ title, fileName, size, mime }) => (
    `• Name: ${fileName}\n` +
    `• Size: ${size}\n` +
    `• Mime: ${mime || '-'}`
)

export default {
    name: 'sfiledl',
    aliases: ['sfdl'],
    description: 'Download file dari Sfile',
    execute: async ({ sock, msg, text, prefix, command, react, useLimit }) => {
        const jid = msg.key.remoteJid
        const fileUrl = normalizeInput(text)

        if (!fileUrl) {
            return sock.sendMessage(jid, {
                text: `Contoh penggunaan:\n- ${prefix + command} https://sfile.co/1BhVvGk0V8U`
            }, { quoted: msg })
        }

        await react('⏳')
        try {
            const resolved = await resolveSfileDownload(fileUrl)
            const meta = await probeFileMeta(resolved.directUrl)

            const caption = buildCaption({
                title: resolved.title,
                fileName: meta.fileName,
                size: formatBytes(meta.bytes) === '-' ? normalizeDisplaySizeText(resolved.sizeText || '-') : formatBytes(meta.bytes),
                mime: meta.mime
            })

            await sock.sendMessage(jid, {
                document: { url: meta.finalUrl },
                mimetype: meta.mime || 'application/octet-stream',
                fileName: meta.fileName,
                caption
            }, { quoted: msg })

            useLimit()
            await react('✅')
        } catch (err) {
            await react('❌')
            await sock.sendMessage(jid, {
                text: `❌ Gagal Sfile download: ${err?.message || 'Unknown error'}`
            }, { quoted: msg })
        }
    }
}
