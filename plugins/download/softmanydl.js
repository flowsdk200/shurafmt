import * as cheerio from 'cheerio'

const REQUEST_TIMEOUT = 30000
const USER_AGENT = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36'

const cleanText = (value) => String(value || '').replace(/\s+/g, ' ').trim()

const normalizeUrl = (value) => {
    const raw = cleanText(value)
    if (!raw) return ''
    if (raw.startsWith('//')) return `https:${raw}`
    if (/^https?:\/\//i.test(raw)) return raw
    return ''
}

const normalizeInput = (value) => normalizeUrl(value)

const isSoftmanyDomain = (hostname = '') =>
    /(^|\.)softmany\.com$/i.test(hostname) || /(^|\.)softmany\.net$/i.test(hostname)

const isSoftmanyPageUrl = (value) => {
    try {
        const url = new URL(value)
        return isSoftmanyDomain(url.hostname) && /\/android(\/|$)/i.test(url.pathname)
    } catch {
        return false
    }
}

const isDirectApkUrl = (value) => {
    try {
        const url = new URL(value)
        return /\.apk$/i.test(url.pathname)
    } catch {
        return false
    }
}

const requestText = async (url) => {
    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT)
    try {
        const response = await fetch(url, {
            method: 'GET',
            redirect: 'follow',
            signal: controller.signal,
            headers: {
                'User-Agent': USER_AGENT,
                'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
                'Accept-Language': 'id-ID,id;q=0.9,en-US;q=0.8,en;q=0.7'
            }
        })
        const body = await response.text()
        return {
            statusCode: response.status,
            finalUrl: response.url || url,
            body: String(body || '')
        }
    } finally {
        clearTimeout(timer)
    }
}

const requestMeta = async (url) => {
    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT)
    try {
        const head = await fetch(url, {
            method: 'HEAD',
            redirect: 'follow',
            signal: controller.signal,
            headers: {
                'User-Agent': USER_AGENT,
                'Accept': '*/*'
            }
        })

        let response = head
        if (!head.ok || !cleanText(head.headers.get('content-type'))) {
            response = await fetch(url, {
                method: 'GET',
                redirect: 'follow',
                signal: controller.signal,
                headers: {
                    'User-Agent': USER_AGENT,
                    'Accept': '*/*',
                    'Range': 'bytes=0-1'
                }
            })
        }

        const headers = Object.fromEntries(response.headers.entries())
        const finalUrl = response.url || url
        const contentType = cleanText(headers['content-type']).toLowerCase()
        const contentLength = Number(cleanText(headers['content-length']))

        return {
            statusCode: response.status,
            finalUrl,
            headers,
            contentType,
            contentLength: Number.isFinite(contentLength) ? contentLength : 0
        }
    } finally {
        clearTimeout(timer)
    }
}

const buildDownloadPageUrl = (inputUrl) => {
    const parsed = new URL(inputUrl)
    if (/\/android\/download\/?$/i.test(parsed.pathname)) return parsed.toString()
    if (/\/android\/?$/i.test(parsed.pathname)) {
        parsed.pathname = parsed.pathname.replace(/\/+$/, '') + '/download'
        parsed.search = ''
        parsed.hash = ''
        return parsed.toString()
    }
    if (/\/android\//i.test(parsed.pathname)) {
        parsed.pathname = '/android/download'
        parsed.search = ''
        parsed.hash = ''
        return parsed.toString()
    }
    throw new Error('URL harus halaman aplikasi SoftMany Android')
}

const decodeDwToken = (downloadUrl) => {
    try {
        const parsed = new URL(downloadUrl)
        if (!/(^|\.)dw\.softmany\.net$/i.test(parsed.hostname)) return ''
        const token = cleanText(parsed.pathname.split('/').filter(Boolean)[0])
        if (!token) return ''
        const decoded = Buffer.from(token, 'base64').toString('utf8')
        return /^https?:\/\//i.test(decoded) ? decoded : ''
    } catch {
        return ''
    }
}

const extractDownloadData = (html) => {
    const $ = cheerio.load(String(html || ''))
    const button = $('a.new-download-btn[rel="nofollow"]').first()
    const href = normalizeUrl(button.attr('href'))

    const titleRaw = cleanText($('h1.section-title').first().text()) || cleanText(button.find('strong').first().text())
    const title = titleRaw.replace(/^download\s+/i, '') || '-'

    const subtitle = cleanText(button.find('small').first().text()) || '-'
    const image = normalizeUrl($('.app-img-sc img.app-image').first().attr('src'))

    return {
        title,
        subtitle,
        image,
        downloadUrl: href
    }
}

const extractFilenameFromDisposition = (contentDisposition = '') => {
    const raw = cleanText(contentDisposition)
    if (!raw) return ''
    const m = raw.match(/filename\*?=(?:UTF-8''|")?([^\";]+)/i)
    if (!m) return ''
    try {
        return decodeURIComponent(m[1]).replace(/"/g, '')
    } catch {
        return m[1].replace(/"/g, '')
    }
}

const guessFileName = (url, headers = {}) => {
    const fromHeader = extractFilenameFromDisposition(headers['content-disposition'])
    if (fromHeader) return fromHeader
    try {
        const parsed = new URL(url)
        const last = decodeURIComponent(parsed.pathname.split('/').pop() || '')
        if (last) return last
    } catch {
        return 'softmany.apk'
    }
    return 'softmany.apk'
}

const formatBytes = (bytes) => {
    const n = Number(bytes || 0)
    if (!Number.isFinite(n) || n <= 0) return '-'
    const units = ['B', 'KB', 'MB', 'GB']
    let size = n
    let idx = 0
    while (size >= 1024 && idx < units.length - 1) {
        size /= 1024
        idx += 1
    }
    const fixed = size >= 100 ? 0 : size >= 10 ? 1 : 2
    return `${size.toFixed(fixed).replace(/\.0+$/, '')} ${units[idx]}`
}

const resolveApkFromInput = async (inputUrl) => {
    if (isDirectApkUrl(inputUrl)) {
        return {
            title: '-',
            subtitle: '-',
            image: '',
            sourcePage: '',
            candidateUrl: inputUrl,
            decodedUrl: ''
        }
    }

    if (!isSoftmanyPageUrl(inputUrl)) {
        throw new Error('URL harus dari halaman aplikasi SoftMany Android atau link APK langsung')
    }

    const downloadPageUrl = buildDownloadPageUrl(inputUrl)
    const page = await requestText(downloadPageUrl)
    if (page.statusCode !== 200) throw new Error(`SoftMany HTTP ${page.statusCode}`)
    if (!page.body.trim()) throw new Error('Halaman download SoftMany kosong')

    const data = extractDownloadData(page.body)
    if (!data.downloadUrl) throw new Error('Link download tidak ditemukan di halaman SoftMany')

    const decoded = decodeDwToken(data.downloadUrl)
    return {
        title: data.title,
        subtitle: data.subtitle,
        image: data.image,
        sourcePage: page.finalUrl || downloadPageUrl,
        candidateUrl: data.downloadUrl,
        decodedUrl: decoded
    }
}

const buildCaption = ({
    title,
    subtitle,
    fileName,
    size,
    mime,
    sourcePage,
    resolvedUrl,
    decodedUrl
}) => (
    `\`\`\`• Title: ${title || '-'}\n` +
    `• File: ${fileName}\n` +
    `• Size: ${size}\n` +
    `• Mime: ${mime}\`\`\``
)

export default {
    name: 'softmanydl',
    aliases: ['softdl', 'sfmdl'],
    description: 'Download APK dari SoftMany',
    execute: async ({ sock, msg, text, prefix, command, react, useLimit }) => {
        const jid = msg.key.remoteJid
        const inputUrl = normalizeInput(text)

        if (!inputUrl) {
            return sock.sendMessage(jid, {
                text: `Contoh penggunaan:\n- ${prefix + command} https://viamaker.id.softmany.com/android`
            }, { quoted: msg })
        }

        await react('⏳')
        try {
            const resolved = await resolveApkFromInput(inputUrl)
            const targetUrl = resolved.candidateUrl

            const meta = await requestMeta(targetUrl)
            if (meta.statusCode >= 400) throw new Error(`HTTP ${meta.statusCode}`)

            const finalUrl = normalizeUrl(meta.finalUrl)
            if (!finalUrl || !isDirectApkUrl(finalUrl)) {
                throw new Error('Link akhir bukan file APK')
            }

            const mime = meta.contentType || 'application/octet-stream'
            if (!/android\.package-archive|application\/octet-stream/i.test(mime)) {
                throw new Error(`Mime tidak valid: ${mime || '-'}`)
            }

            const fileName = guessFileName(finalUrl, meta.headers)
            const caption = buildCaption({
                title: resolved.title,
                subtitle: resolved.subtitle,
                fileName,
                size: formatBytes(meta.contentLength),
                mime,
                sourcePage: resolved.sourcePage,
                resolvedUrl: finalUrl,
                decodedUrl: resolved.decodedUrl
            })

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
                text: `❌ Gagal SoftMany download: ${err?.message || 'Unknown error'}`
            }, { quoted: msg })
        }
    }
}
