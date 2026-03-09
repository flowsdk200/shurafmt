import axios from 'axios'

const USER_AGENT = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/136.0.0.0 Safari/537.36'
const REQUEST_TIMEOUT = 30000
const MEDIA_TIMEOUT = 300000
const VIDEO_BUFFER_LIMIT = 150 * 1024 * 1024

const cleanText = (value) => String(value || '')
    .replace(/&#8211;/g, '-')
    .replace(/&#038;/g, '&')
    .replace(/&amp;/g, '&')
    .replace(/\s+/g, ' ')
    .trim()

const formatBytes = (value) => {
    const size = Number(value || 0)
    if (!size || !Number.isFinite(size)) return '-'
    if (size >= 1024 * 1024 * 1024) return `${(size / (1024 * 1024 * 1024)).toFixed(2)} GB`
    if (size >= 1024 * 1024) return `${(size / (1024 * 1024)).toFixed(2)} MB`
    if (size >= 1024) return `${(size / 1024).toFixed(2)} KB`
    return `${size} B`
}

const extractUrl = (text) => String(text || '').trim().match(/https?:\/\/[^\s]+/i)?.[0] || ''

const normalizeInputUrl = (input) => {
    const raw = extractUrl(input)
    if (!raw) return ''

    try {
        const parsed = new URL(raw)
        if (!/(^|\.)donghuafilm\.com$/i.test(parsed.hostname)) return ''
        parsed.hash = ''
        return parsed.toString()
    } catch {
        return ''
    }
}

const requestText = async (url) => {
    const response = await axios.get(url, {
        timeout: REQUEST_TIMEOUT,
        maxRedirects: 5,
        validateStatus: () => true,
        headers: {
            'User-Agent': USER_AGENT,
            'Accept-Language': 'id-ID,id;q=0.9,en-US;q=0.8,en;q=0.7',
            Accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
            Referer: 'https://donghuafilm.com/'
        }
    })

    return {
        status: response.status,
        html: String(response.data || ''),
        finalUrl: response.request?.res?.responseUrl || url
    }
}

const toAbsoluteUrl = (value, base) => {
    const raw = cleanText(value)
    if (!raw) return ''
    try {
        return new URL(raw, base).toString()
    } catch {
        return ''
    }
}

const decodeMirrorValue = (value) => {
    const raw = cleanText(value)
    if (!raw) return ''

    try {
        return Buffer.from(raw, 'base64').toString('utf8')
    } catch {
        return ''
    }
}

const extractVideoUrl = (html, baseUrl) => {
    const direct = html.match(/<source[^>]+src="([^"]+)"[^>]+type="video\/mp4"/i)?.[1]
    if (direct) return toAbsoluteUrl(direct, baseUrl)

    const optionMatches = [...html.matchAll(/<option[^>]+value="([^"]+)"[^>]*>/gi)]
    for (const match of optionMatches) {
        const decoded = decodeMirrorValue(match[1])
        const source = decoded.match(/<source[^>]+src="([^"]+)"/i)?.[1]
        if (source) return toAbsoluteUrl(source, baseUrl)
    }

    return ''
}

const extractMeta = (html, finalUrl) => {
    const title = cleanText(
        html.match(/<meta[^>]+property="og:title"[^>]+content="([^"]+)"/i)?.[1]
        || html.match(/<title>([^<]+)<\/title>/i)?.[1]
            ?.replace(/\s*[-–]\s*DonghuaFilm\s*$/i, '')
    ) || '-'

    const thumbnail = toAbsoluteUrl(
        html.match(/<meta[^>]+property="og:image"[^>]+content="([^"]+)"/i)?.[1],
        finalUrl
    )

    const videoUrl = extractVideoUrl(html, finalUrl)
    if (!videoUrl) {
        throw new Error('Video MP4 tidak ditemukan di halaman DonghuaFilm.')
    }

    return {
        title,
        thumbnail,
        videoUrl
    }
}

const extractPixeldrainId = (url) => {
    const match = cleanText(url).match(/pixeldrain\.com\/api\/file\/([A-Za-z0-9]+)/i)
    return match?.[1] || ''
}

const fetchPixeldrainInfo = async (fileId) => {
    if (!fileId) return null

    const response = await axios.get(`https://pixeldrain.com/api/file/${fileId}/info`, {
        timeout: REQUEST_TIMEOUT,
        validateStatus: () => true,
        headers: {
            'User-Agent': USER_AGENT,
            Accept: 'application/json,text/plain,*/*',
            Referer: 'https://donghuafilm.com/'
        }
    })

    if (response.status !== 200 || !response.data?.success) return null
    return response.data
}

const fetchVideoBuffer = async (url) => {
    const target = cleanText(url)
    if (!/^https?:\/\//i.test(target)) {
        throw new Error('URL video DonghuaFilm tidak valid.')
    }

    const response = await axios.get(target, {
        responseType: 'arraybuffer',
        timeout: MEDIA_TIMEOUT,
        maxRedirects: 5,
        maxContentLength: Infinity,
        maxBodyLength: Infinity,
        validateStatus: () => true,
        headers: {
            'User-Agent': USER_AGENT,
            Accept: 'video/mp4,application/octet-stream;q=0.9,*/*;q=0.8',
            Referer: 'https://donghuafilm.com/'
        }
    })

    if (response.status < 200 || response.status >= 400) {
        throw new Error(`Gagal mengambil video DonghuaFilm (${response.status})`)
    }

    const contentType = cleanText(response.headers?.['content-type']).toLowerCase()
    if (contentType && !contentType.includes('video') && !contentType.includes('octet-stream')) {
        throw new Error('Respons video DonghuaFilm tidak valid.')
    }

    const buffer = Buffer.from(response.data || [])
    if (!buffer.length) throw new Error('Buffer video DonghuaFilm kosong.')
    return buffer
}

const buildCaption = (meta, fileInfo) => {
    const fileName = cleanText(fileInfo?.name) || '-'
    const source = fileInfo ? 'Pixeldrain' : 'DonghuaFilm'

    return (
        `\`\`\`• Title: ${meta.title}\n` +
        `• File: ${fileName}\n` +
        `• Size: ${formatBytes(fileInfo?.size)}\`\`\``
    )
}

export default {
    name: 'donghuadl',
    aliases: ['dhdl', 'donghuafilm'],
    description: 'Download video episode dari donghuafilm',
    execute: async ({ sock, msg, text, prefix, command, react, useLimit }) => {
        const jid = msg.key.remoteJid
        const pageUrl = normalizeInputUrl(text)

        if (!pageUrl) {
            return sock.sendMessage(jid, {
                text: `Contoh penggunaan:\n- ${prefix + command} https://donghuafilm.com/martial-master-episode-637-subtitle-indonesia/`
            }, { quoted: msg })
        }

        await react('⏳')

        try {
            const { status, html, finalUrl } = await requestText(pageUrl)
            if (status !== 200 || !html) {
                throw new Error(`DonghuaFilm HTTP ${status}`)
            }

            const meta = extractMeta(html, finalUrl)
            const fileId = extractPixeldrainId(meta.videoUrl)
            const fileInfo = await fetchPixeldrainInfo(fileId)
            const sizeBytes = Number(fileInfo?.size || 0)
            const fileName = cleanText(fileInfo?.name) || `${meta.title}.mp4`

            if (sizeBytes > VIDEO_BUFFER_LIMIT) {
                await sock.sendMessage(jid, {
                    document: { url: meta.videoUrl },
                    mimetype: cleanText(fileInfo?.mime_type) || 'video/mp4',
                    fileName,
                    caption: buildCaption(meta, fileInfo)
                }, { quoted: msg })
            } else {
                const videoBuffer = await fetchVideoBuffer(meta.videoUrl)

                await sock.sendMessage(jid, {
                    video: videoBuffer,
                    mimetype: 'video/mp4',
                    caption: buildCaption(meta, fileInfo)
                }, { quoted: msg })
            }

            useLimit()
            await react('✅')
        } catch (err) {
            await react('❌')
            await sock.sendMessage(jid, {
                text: `❌ Error: ${err?.message || 'Unknown error'}`
            }, { quoted: msg })
        }
    }
}
