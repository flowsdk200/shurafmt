import { getBuffer, toVideo } from '../../src/utils/converter.js'

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

const parseInput = (input) => {
    const text = cleanText(input)
    if (!text) return { id: '', ext: '' }

    if (!/^https?:\/\//i.test(text)) {
        const id = text.match(/^[a-z0-9]{6,24}$/i)?.[0] || ''
        return { id, ext: '' }
    }

    try {
        const url = new URL(text)
        const host = url.hostname.toLowerCase()

        if (/(^|\.)videy\.co$/i.test(host)) {
            const idFromQuery = cleanText(url.searchParams.get('id'))
            if (idFromQuery) return { id: idFromQuery, ext: '' }

            const parts = url.pathname.split('/').filter(Boolean)
            if (parts[0] === 'v' && parts[1]) return { id: cleanText(parts[1]), ext: '' }
        }

        if (/(^|\.)cdn\.videy\.co$/i.test(host)) {
            const m = url.pathname.match(/^\/([a-z0-9]+)\.([a-z0-9]+)$/i)
            if (m) return { id: cleanText(m[1]), ext: cleanText(m[2]).toLowerCase() }
        }
    } catch {
        return { id: '', ext: '' }
    }

    return { id: '', ext: '' }
}

const pickExtFromId = (id) => {
    const value = cleanText(id)
    if (!value || value.length === 8) return 'mp4'
    if (value.length === 9 && value.endsWith('1')) return 'mp4'
    if (value.length === 9 && value.endsWith('2')) return 'mov'
    return 'mp4'
}

const buildVideoUrl = (id, extHint = '') => {
    const ext = cleanText(extHint).toLowerCase() || pickExtFromId(id)
    return `https://cdn.videy.co/${id}.${ext}`
}

const request = async (url, method = 'GET', extraHeaders = {}) => {
    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT)
    try {
        const response = await fetch(url, {
            method,
            redirect: 'follow',
            headers: {
                'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
                'Accept': '*/*',
                ...extraHeaders
            },
            signal: controller.signal
        })
        return response
    } finally {
        clearTimeout(timer)
    }
}

const probeFile = async (url) => {
    let response = await request(url, 'HEAD')
    if (response.status >= 400 || response.status < 200) {
        response = await request(url, 'GET', { Range: 'bytes=0-1' })
    }

    if (!(response.status === 200 || response.status === 206)) {
        throw new Error(`Videy CDN HTTP ${response.status}`)
    }

    const finalUrl = cleanText(response.url || url)
    const mime = cleanText(response.headers.get('content-type') || '').toLowerCase() || 'application/octet-stream'
    const bytes = Number(response.headers.get('content-length') || 0)
    return { finalUrl, mime, bytes }
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

const normalizeMime = (mime, ext) => {
    const m = cleanText(mime).toLowerCase()
    const e = cleanText(ext).toLowerCase()
    if (e === 'mp4' && (m === 'video/x-m4v' || m === 'application/octet-stream' || !m)) return 'video/mp4'
    if (e === 'mov' && (m === 'video/x-m4v' || m === 'application/octet-stream' || !m)) return 'video/quicktime'
    return m || 'application/octet-stream'
}

const buildCaption = (meta) =>
    `\`\`\`× Title: Videy Video\n` +
    `× ID: ${meta.id}\n` +
    `× Ext: ${meta.ext}\n` +
    `× Size: ${meta.size}\n` +
    `× Mime: ${meta.mime}\`\`\``

export default {
    name: 'videy',
    aliases: ['videydl', 'vydl'],
    description: 'Download video dari link videy',
    execute: async ({ sock, msg, text, prefix, command, react, useLimit }) => {
        const jid = msg.key.remoteJid
        const { id, ext } = parseInput(text)

        if (!id) {
            return sock.sendMessage(jid, {
                text:
                    `Contoh penggunaan:\n` +
                    `- ${prefix + command} https://videy.co/v/?id=vwJvwPim1`
            }, { quoted: msg })
        }

        await react('⏳')
        try {
            const pickedExt = ext || pickExtFromId(id)
            const directUrl = buildVideoUrl(id, pickedExt)
            const file = await probeFile(directUrl)

            const meta = {
                id,
                ext: pickedExt,
                mime: normalizeMime(file.mime, pickedExt),
                size: formatBytes(file.bytes),
                pageUrl: `https://videy.co/v/?id=${id}`
            }

            if (/^video\//i.test(meta.mime)) {
                const raw = await getBuffer(file.finalUrl || directUrl, { timeout: 120000, maxRedirects: 5 })
                const converted = await toVideo(raw, pickedExt === 'mov' ? 'mov' : 'mp4')
                const video = converted?.data || converted
                const outputBytes = Buffer.isBuffer(video) ? video.length : 0
                const outputMeta = {
                    ...meta,
                    ext: 'mp4',
                    mime: 'video/mp4',
                    size: formatBytes(outputBytes)
                }
                const caption = buildCaption(outputMeta)

                await sock.sendMessage(jid, {
                    video,
                    mimetype: 'video/mp4',
                    caption
                }, { quoted: msg })
            } else {
                const caption = buildCaption(meta)
                await sock.sendMessage(jid, {
                    document: { url: file.finalUrl || directUrl },
                    mimetype: meta.mime,
                    fileName: `${id}.${pickedExt}`,
                    caption
                }, { quoted: msg })
            }

            useLimit()
            await react('✅')
        } catch (err) {
            await react('❌')
            await sock.sendMessage(jid, {
                text: `❌ Gagal Videy download: ${err?.message || 'Unknown error'}`
            }, { quoted: msg })
        }
    }
}
