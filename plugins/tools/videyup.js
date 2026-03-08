import axios from 'axios'
import FormData from 'form-data'
import mime from 'mime-types'
import { downloadContentFromMessage } from 'baileys'

const VIDEY_EMAIL = 'shirodixs@gmail.com'
const VIDEY_PASSWORD = 'Tai12345678'
const LOGIN_URL = 'https://api.videy.co/api/account/login'
const UPLOAD_URL = 'https://videy.co/api/upload'
const PAGE_URL = 'https://videy.co/uploads'
const USER_AGENT = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36'
const SUPPORTED_MIME = new Set(['video/mp4', 'video/quicktime'])

let authCache = null

const unwrapMessage = (raw = {}) => {
    let m = raw
    const wrappers = ['ephemeralMessage', 'viewOnceMessage', 'viewOnceMessageV2', 'documentWithCaptionMessage']
    for (const key of wrappers) {
        if (m?.[key]?.message) m = m[key].message
    }
    return m
}

const pickCurrentMedia = (msg) => {
    const content = unwrapMessage(msg?.message || {})
    if (content?.videoMessage) return { type: 'videoMessage', media: content.videoMessage }
    if (content?.documentMessage) return { type: 'documentMessage', media: content.documentMessage }
    return null
}

const streamToBuffer = async (stream) => {
    const chunks = []
    for await (const chunk of stream) chunks.push(chunk)
    return Buffer.concat(chunks)
}

const mediaToBuffer = async (type, media) => {
    const streamType = type === 'documentMessage' ? 'document' : 'video'
    const stream = await downloadContentFromMessage(media, streamType)
    return streamToBuffer(stream)
}

const formatSize = (bytes) => {
    if (bytes >= 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(2)} MB`
    if (bytes >= 1024) return `${(bytes / 1024).toFixed(2)} KB`
    return `${bytes} B`
}

const makeVisitorId = () => 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
    const r = Math.random() * 16 | 0
    const v = c === 'x' ? r : (r & 0x3 | 0x8)
    return v.toString(16)
})

const getAuthHeaders = async () => {
    if (authCache?.key && authCache?.secret) {
        return {
            'X-API-KEY': authCache.key,
            'X-API-SECRET': authCache.secret
        }
    }

    const { data } = await axios.post(LOGIN_URL, null, {
        params: {
            email: VIDEY_EMAIL,
            password: VIDEY_PASSWORD
        },
        headers: {
            'Accept': 'application/json, text/plain, */*',
            'Origin': 'https://videy.co',
            'Referer': PAGE_URL,
            'User-Agent': USER_AGENT
        },
        timeout: 30000
    })

    if (!data?.status || !data?.token_key || !data?.token_secret) {
        throw new Error(data?.error || 'Login Videy gagal')
    }

    authCache = {
        key: data.token_key,
        secret: data.token_secret
    }

    return {
        'X-API-KEY': authCache.key,
        'X-API-SECRET': authCache.secret
    }
}

const uploadToVidey = async (buffer, filename) => {
    const headers = await getAuthHeaders()
    const visitorId = makeVisitorId()
    const form = new FormData()
    form.append('file', buffer, {
        filename,
        contentType: mime.lookup(filename) || 'video/mp4'
    })

    const { data } = await axios.post(UPLOAD_URL, form, {
        params: { visitorId },
        headers: {
            ...form.getHeaders(),
            ...headers,
            'Accept': 'application/json, text/plain, */*',
            'Origin': 'https://videy.co',
            'Referer': PAGE_URL,
            'User-Agent': USER_AGENT
        },
        timeout: 120000,
        maxBodyLength: Infinity,
        maxContentLength: Infinity
    })

    if (!data?.id || !data?.link) {
        throw new Error('Upload Videy gagal')
    }

    return data
}

export default {
    name: 'videyup',
    aliases: ['videyupload', 'vup'],
    description: 'Upload video ke Videy',
    execute: async ({ sock, msg, isQuoted, quotedMsg, quotedType, react, prefix, command, useLimit }) => {
        const jid = msg.key.remoteJid

        let mediaType = null
        let mediaContent = null

        if (isQuoted && quotedMsg && ['videoMessage', 'documentMessage'].includes(quotedType)) {
            mediaType = quotedType
            mediaContent = quotedMsg[quotedType]
        } else {
            const current = pickCurrentMedia(msg)
            if (current) {
                mediaType = current.type
                mediaContent = current.media
            }
        }

        if (!mediaType || !mediaContent) {
            return sock.sendMessage(jid, {
                text: `Kirim/reply video dengan caption ${prefix + command}`
            }, { quoted: msg })
        }

        const mimetype = mediaContent?.mimetype || ''
        if (!SUPPORTED_MIME.has(mimetype)) {
            return sock.sendMessage(jid, {
                text: '❌ Format video yang didukung hanya MP4 dan MOV.'
            }, { quoted: msg })
        }

        await react('⏳')

        try {
            const buffer = await mediaToBuffer(mediaType, mediaContent)
            const filename = mediaContent?.fileName || `videy.${mime.extension(mimetype) || 'mp4'}`
            const result = await uploadToVidey(buffer, filename)

            useLimit()
            await react('✅')
            await sock.sendMessage(jid, {
                text:
                    '```✅ VIDEY UPLOAD SUCCESS\n\n' +
                    `× Name: ${filename}\n` +
                    `× Type: ${mimetype}\n` +
                    `× Size: ${formatSize(buffer.length)}\n` +
                    `× Link: ${result.link}` +
                    '```'
            }, { quoted: msg })
        } catch (err) {
            authCache = null
            await react('❌')
            await sock.sendMessage(jid, {
                text: `❌ Error: ${err.message}`
            }, { quoted: msg })
        }
    }
}
