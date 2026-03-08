import axios from 'axios'
import FormData from 'form-data'
import mime from 'mime-types'
import { downloadContentFromMessage } from 'baileys'

const SUPPORTED = ['imageMessage', 'videoMessage', 'audioMessage', 'documentMessage', 'stickerMessage']

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
    for (const type of SUPPORTED) {
        if (content?.[type]) return { type, media: content[type] }
    }
    return null
}

const streamToBuffer = async (stream) => {
    const chunks = []
    for await (const chunk of stream) chunks.push(chunk)
    return Buffer.concat(chunks)
}

const mediaToBuffer = async (type, media) => {
    const streamType = type.replace('Message', '')
    const stream = await downloadContentFromMessage(media, streamType)
    return streamToBuffer(stream)
}

const guessFileName = (type, media) => {
    if (media?.fileName) return media.fileName
    const ext = mime.extension(media?.mimetype || '') || {
        imageMessage: 'jpg',
        videoMessage: 'mp4',
        audioMessage: 'mp3',
        documentMessage: 'bin',
        stickerMessage: 'webp'
    }[type] || 'bin'
    return `upload.${ext}`
}

const uploadToCatbox = async (buffer, filename) => {
    const form = new FormData()
    form.append('reqtype', 'fileupload')
    form.append('fileToUpload', buffer, filename)

    const { data } = await axios.post('https://catbox.moe/user/api.php', form, {
        headers: form.getHeaders(),
        timeout: 120000,
        maxBodyLength: Infinity,
        maxContentLength: Infinity
    })

    const url = String(data || '').trim()
    if (!/^https?:\/\//i.test(url)) throw new Error(url || 'Upload gagal')
    return url
}

const formatSize = (bytes) => {
    if (bytes >= 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(2)} MB`
    if (bytes >= 1024) return `${(bytes / 1024).toFixed(2)} KB`
    return `${bytes} B`
}

export default {
    name: 'tourl',
    aliases: ['upload', 'catbox'],
    description: 'Upload media/file ke catbox',
    execute: async ({ sock, msg, isQuoted, quotedMsg, quotedType, react, useLimit, prefix, command }) => {
        const jid = msg.key.remoteJid

        let mediaType = null
        let mediaContent = null

        if (isQuoted && quotedMsg && SUPPORTED.includes(quotedType)) {
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
                text: `Kirim/reply media atau file dengan caption ${prefix + command}`
            }, { quoted: msg })
        }

        await react('⏳')

        try {
            const buffer = await mediaToBuffer(mediaType, mediaContent)
            const filename = guessFileName(mediaType, mediaContent)
            const mimetype = mediaContent?.mimetype || mime.lookup(filename) || 'application/octet-stream'
            const url = await uploadToCatbox(buffer, filename)

            useLimit()
            await react('✅')
            await sock.sendMessage(jid, {
                text:
                    `\`\`\`✅ Upload successful\n\n` +
                    `× Type: ${mimetype}\n` +
                    `× Size: ${formatSize(buffer.length)}\n` +
                    `× Link: ${url}\`\`\``
            }, { quoted: msg })
        } catch (err) {
            await react('❌')
            await sock.sendMessage(jid, {
                text: `❌ Error: ${err.message}`
            }, { quoted: msg })
        }
    }
}
