const REQUEST_TIMEOUT = 30000

const cleanText = (value) => String(value || '')
    .replace(/\s+/g, ' ')
    .trim()

const normalizeInput = (input) => {
    const text = cleanText(input)
    if (!text) return ''

    if (/^https?:\/\//i.test(text)) return text
    if (/\.apk$/i.test(text) && /^[a-z0-9._-]+$/i.test(text)) return `https://f-droid.org/repo/${text}`
    if (/^[a-z0-9._-]+$/i.test(text)) return `https://f-droid.org/en/packages/${text}/`
    return ''
}

const isAllowedFdroidUrl = (urlString) => {
    try {
        const url = new URL(urlString)
        if (url.protocol !== 'https:') return false
        return /(^|\.)f-droid\.org$/i.test(url.hostname)
    } catch {
        return false
    }
}

const isApkUrl = (urlString) => {
    try {
        const url = new URL(urlString)
        return /\.apk$/i.test(url.pathname)
    } catch {
        return false
    }
}

const isPackagePageUrl = (urlString) => {
    try {
        const url = new URL(urlString)
        if (!/(^|\.)f-droid\.org$/i.test(url.hostname)) return false
        const parts = url.pathname.split('/').filter(Boolean)
        return parts[0] === 'en' && parts[1] === 'packages' && Boolean(parts[2])
    } catch {
        return false
    }
}

const requestText = async (url) => {
    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT)
    try {
        const res = await fetch(url, {
            method: 'GET',
            redirect: 'follow',
            signal: controller.signal,
            headers: {
                'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
                'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8'
            }
        })
        const body = await res.text()
        return {
            statusCode: res.status,
            finalUrl: res.url || url,
            body: String(body || '')
        }
    } finally {
        clearTimeout(timer)
    }
}

const pickLatestApkFromHtml = (html) => {
    const source = String(html || '')
    const matches = [...source.matchAll(/https:\/\/f-droid\.org\/repo\/[a-z0-9._-]+_\d+\.apk/gi)]
        .map((m) => cleanText(m[0]))

    if (!matches.length) return ''

    const unique = [...new Set(matches)]
    unique.sort((a, b) => {
        const av = Number((a.match(/_(\d+)\.apk$/i) || [])[1] || 0)
        const bv = Number((b.match(/_(\d+)\.apk$/i) || [])[1] || 0)
        return bv - av
    })

    return unique[0] || ''
}

const resolveToApkUrl = async (inputUrl) => {
    if (isApkUrl(inputUrl)) return inputUrl
    if (!isPackagePageUrl(inputUrl)) {
        throw new Error('URL harus link APK langsung atau link package F-Droid')
    }

    const page = await requestText(inputUrl)
    if (page.statusCode !== 200) throw new Error(`HTTP ${page.statusCode}`)
    if (!page.body.trim()) throw new Error('Halaman package kosong')

    const apkUrl = pickLatestApkFromHtml(page.body)
    if (!apkUrl) throw new Error('Link APK tidak ditemukan di halaman package')
    return apkUrl
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
                'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
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
                    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
                    'Accept': '*/*',
                    'Range': 'bytes=0-1'
                }
            })
        }

        const finalUrl = response.url || url
        if (!response.ok && response.status !== 206) {
            throw new Error(`HTTP ${response.status}`)
        }

        const contentType = cleanText(response.headers.get('content-type')).toLowerCase()
        const contentLengthRaw = cleanText(response.headers.get('content-length'))
        const contentLength = Number(contentLengthRaw)

        return {
            finalUrl,
            contentType,
            contentLength: Number.isFinite(contentLength) ? contentLength : 0
        }
    } finally {
        clearTimeout(timer)
    }
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

const parseFileInfo = (urlString) => {
    try {
        const url = new URL(urlString)
        const fileName = decodeURIComponent(url.pathname.split('/').pop() || 'fdroid.apk')
        const base = fileName.replace(/\.apk$/i, '')
        const pkg = cleanText(base.split('_')[0] || '-')
        const versionCode = cleanText(base.split('_')[1] || '-')
        return {
            fileName: fileName || 'fdroid.apk',
            packageId: pkg || '-',
            versionCode: versionCode || '-'
        }
    } catch {
        return {
            fileName: 'fdroid.apk',
            packageId: '-',
            versionCode: '-'
        }
    }
}

const buildCaption = ({ fileName, packageId, versionCode, size, mime, link }) => (
    `\`\`\`• File: ${fileName}\n` +
    `• Package: ${packageId}\n` +
    `• Version: ${versionCode}\n` +
    `• Size: ${size}\n` +
    `• Mime: ${mime}\`\`\``
)

export default {
    name: 'fdroiddl',
    aliases: ['fdrdl', 'fdroidapk'],
    description: 'Download APK dari F-Droid',
    execute: async ({ sock, msg, text, prefix, command, react, useLimit }) => {
        const jid = msg.key.remoteJid
        const input = normalizeInput(text)

        if (!input) {
            return sock.sendMessage(jid, {
                text: `Contoh penggunaan:\n- ${prefix + command} https://f-droid.org/repo/com.termux.api_1002.apk`
            }, { quoted: msg })
        }

        if (!isAllowedFdroidUrl(input)) {
            return sock.sendMessage(jid, {
                text: '❌ URL harus dari domain f-droid.org'
            }, { quoted: msg })
        }

        await react('⏳')
        try {
            const apkUrl = await resolveToApkUrl(input)
            const meta = await requestMeta(apkUrl)
            if (!isAllowedFdroidUrl(meta.finalUrl) || !isApkUrl(meta.finalUrl)) {
                throw new Error('Redirect URL bukan file APK F-Droid')
            }

            const mime = meta.contentType || 'application/vnd.android.package-archive'
            if (!/android\.package-archive|application\/octet-stream/i.test(mime)) {
                throw new Error(`Mime tidak valid: ${mime || '-'}`)
            }

            const info = parseFileInfo(meta.finalUrl)
            const caption = buildCaption({
                fileName: info.fileName,
                packageId: info.packageId,
                versionCode: info.versionCode,
                size: formatBytes(meta.contentLength),
                mime,
                link: meta.finalUrl
            })

            await sock.sendMessage(jid, {
                document: { url: meta.finalUrl },
                mimetype: 'application/vnd.android.package-archive',
                fileName: info.fileName,
                caption
            }, { quoted: msg })

            useLimit()
            await react('✅')
        } catch (err) {
            await react('❌')
            await sock.sendMessage(jid, {
                text: `❌ Gagal F-Droid download: ${err?.message || 'Unknown error'}`
            }, { quoted: msg })
        }
    }
}
