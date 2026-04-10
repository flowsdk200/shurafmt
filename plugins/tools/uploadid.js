import mime from 'mime-types'
import { downloadContentFromMessage } from 'baileys'
import { uploadToR2 } from '../../src/utils/r2.js'

const ALLOWED = ['imageMessage', 'documentMessage']

const unwrapMessage = (raw = {}) => {
    let message = raw
    const wrappers = [
        'ephemeralMessage',
        'viewOnceMessage',
        'viewOnceMessageV2',
        'documentWithCaptionMessage'
    ]
    for (const key of wrappers) {
        if (message?.[key]?.message) message = message[key].message
    }
    return message
}

const pickCurrentMedia = (msg) => {
    const content = unwrapMessage(msg?.message || {})
    for (const type of ALLOWED) {
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
    const ext = mime.extension(media?.mimetype || '') || (type === 'imageMessage' ? 'jpg' : 'pdf')
    return `id-card.${ext}`
}

const formatSize = (bytes) => {
    const value = Math.max(0, Number(bytes) || 0)
    if (value >= 1024 * 1024) return `${(value / (1024 * 1024)).toFixed(2)} MB`
    if (value >= 1024) return `${(value / 1024).toFixed(2)} KB`
    return `${value} B`
}

export default {
    name: 'uploadid',
    aliases: ['setid', 'idcard'],
    description: 'Upload dan simpan ID card untuk verifikasi github student',
    ignoreLimit: true,
    execute: async ({ sock, msg, isGroup, isQuoted, quotedMsg, quotedType, usersDb, react, prefix, command, sender }) => {
        const jid = msg.key.remoteJid

        if (isGroup) {
            return sock.sendMessage(jid, {
                text: `upload id card hanya di private chat.\ncontoh:\n- kirim/reply foto id lalu ketik ${prefix + command}`
            }, { quoted: msg })
        }

        let mediaType = null
        let media = null

        if (isQuoted && quotedMsg && ALLOWED.includes(quotedType)) {
            mediaType = quotedType
            media = quotedMsg[quotedType]
        } else {
            const current = pickCurrentMedia(msg)
            if (current) {
                mediaType = current.type
                media = current.media
            }
        }

        if (!mediaType || !media) {
            return sock.sendMessage(jid, {
                text: `reply/kirim foto atau dokumen id card dengan caption ${prefix + command}`
            }, { quoted: msg })
        }

        await react('⏳')

        try {
            const buffer = await mediaToBuffer(mediaType, media)
            if (!Buffer.isBuffer(buffer) || !buffer.length) {
                throw new Error('file id card kosong')
            }

            const fileName = guessFileName(mediaType, media)
            const mimetype = media?.mimetype || mime.lookup(fileName) || 'application/octet-stream'
            const uploaded = await uploadToR2(buffer, {
                filename: fileName,
                contentType: mimetype
            })

            const saved = usersDb.setGhsIdCard(sender, {
                url: uploaded.url,
                r2Key: uploaded.key,
                mimetype: uploaded.mimetype,
                fileName,
                size: buffer.length
            })

            await react('✅')
            return sock.sendMessage(jid, {
                text: [
                    '*ID CARD TERSIMPAN*',
                    '',
                    `- File: ${saved.fileName || fileName}`,
                    `- Type: ${saved.mimetype || mimetype}`,
                    `- Size: ${formatSize(saved.size)}`,
                    `- Link: ${saved.url}`,
                    '',
                    `lanjut verifikasi:\n- ${prefix}ghs email, password, otp`
                ].join('\n')
            }, { quoted: msg })
        } catch (err) {
            await react('❌')
            return sock.sendMessage(jid, {
                text: `❌ gagal upload id card: ${String(err?.message || err)}`
            }, { quoted: msg })
        }
    }
}
