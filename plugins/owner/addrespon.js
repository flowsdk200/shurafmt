import mime from 'mime-types'
import { downloadContentFromMessage } from 'baileys'
import responsesDb from '../../src/database/responses.js'
import { uploadToR2 } from '../../src/utils/r2.js'

const MEDIA_TYPES = new Set(['imageMessage', 'videoMessage', 'audioMessage', 'documentMessage', 'stickerMessage'])
const TEXT_TYPES = new Set(['conversation', 'extendedTextMessage'])

const streamToBuffer = async (stream) => {
    const chunks = []
    for await (const chunk of stream) chunks.push(chunk)
    return Buffer.concat(chunks)
}

const pickQuotedText = (quotedMsg, quotedType) => {
    if (quotedType === 'conversation') return String(quotedMsg?.conversation || '').trim()
    if (quotedType === 'extendedTextMessage') return String(quotedMsg?.extendedTextMessage?.text || '').trim()
    return ''
}

const getQuotedMedia = (quotedMsg, quotedType) => quotedMsg?.[quotedType] || null

const guessFileName = (type, media) => {
    if (media?.fileName) return media.fileName
    const ext = mime.extension(media?.mimetype || '') || {
        imageMessage: 'jpg',
        videoMessage: 'mp4',
        audioMessage: 'mp3',
        documentMessage: 'bin',
        stickerMessage: 'webp'
    }[type] || 'bin'
    return `respon.${ext}`
}

const sendStoredResponse = async (sock, jid, data) => {
    if (!data) return
    if (data.type === 'text') {
        await sock.sendMessage(jid, { text: data.text })
        return
    }

    if (data.type === 'image') {
        await sock.sendMessage(jid, { image: { url: data.url }, caption: data.caption || '' })
        return
    }

    if (data.type === 'video') {
        await sock.sendMessage(jid, { video: { url: data.url }, caption: data.caption || '' })
        return
    }

    if (data.type === 'audio') {
        await sock.sendMessage(jid, { audio: { url: data.url }, mimetype: data.mimetype || 'audio/mpeg', ptt: false })
        return
    }

    if (data.type === 'sticker') {
        await sock.sendMessage(jid, { sticker: { url: data.url } })
        return
    }

    await sock.sendMessage(jid, {
        document: { url: data.url },
        mimetype: data.mimetype || 'application/octet-stream',
        fileName: data.fileName || 'file',
        caption: data.caption || ''
    })
}

export default {
    name: 'addrespon',
    aliases: ['addrsp'],
    description: 'Tambah auto respon text/media',
    ownerOnly: true,
    async onMessage({ sock, msg, body, config }) {
        if (!body || msg?.key?.fromMe) return
        if (config.prefixes?.some((prefix) => body.startsWith(prefix))) return

        const key = String(body || '').trim().toLowerCase()
        if (!key) return

        const data = await responsesDb.getResponse(key)
        if (!data) return

        await sendStoredResponse(sock, msg.key.remoteJid, data)
    },
    async execute({ sock, msg, text, isQuoted, quotedMsg, quotedType, quotedMimetype, react, useLimit, prefix, command }) {
        const jid = msg.key.remoteJid
        const raw = String(text || '').trim()

        if (!raw) {
            return sock.sendMessage(jid, {
                text:
                    `Cara penggunaan:\n` +
                    `- ${prefix + command} trigger respon teks\n` +
                    `- ${prefix + command} trigger|caption opsional (reply media)\n` +
                    `- ${prefix + command} trigger (reply teks)`
            }, { quoted: msg })
        }

        const [left, ...captionParts] = raw.split('|')
        const leftText = String(left || '').trim()
        const [triggerWord, ...textParts] = leftText.split(/\s+/)
        const trigger = String(triggerWord || '').trim().toLowerCase()

        if (!trigger) {
            return sock.sendMessage(jid, {
                text: '❌ Trigger respon tidak boleh kosong.'
            }, { quoted: msg })
        }

        await react('⏳')

        if (isQuoted && quotedMsg && MEDIA_TYPES.has(quotedType)) {
            const media = getQuotedMedia(quotedMsg, quotedType)
            const streamType = quotedType.replace('Message', '')
            const stream = await downloadContentFromMessage(media, streamType)
            const buffer = await streamToBuffer(stream)
            const filename = guessFileName(quotedType, media)
            const uploaded = await uploadToR2(buffer, {
                filename,
                contentType: quotedMimetype || media?.mimetype || ''
            })

            const typeMap = {
                imageMessage: 'image',
                videoMessage: 'video',
                audioMessage: 'audio',
                documentMessage: 'document',
                stickerMessage: 'sticker'
            }
            const caption = String(captionParts.join('|') || media?.caption || '').trim()
            await responsesDb.setResponse(trigger, {
                type: typeMap[quotedType] || 'document',
                url: uploaded.url,
                r2Key: uploaded.key,
                mimetype: uploaded.mimetype,
                fileName: media?.fileName || filename,
                caption,
                createdAt: new Date().toISOString()
            })

            if (typeof useLimit === 'function') useLimit()
            await react('✅')
            return sock.sendMessage(jid, {
                text: `✅ Respon "${trigger}" berhasil disimpan sebagai ${typeMap[quotedType] || 'document'}.`
            }, { quoted: msg })
        }

        const quotedText = isQuoted && quotedMsg && TEXT_TYPES.has(quotedType)
            ? pickQuotedText(quotedMsg, quotedType)
            : ''
        const directText = textParts.join(' ').trim()
        const responseText = quotedText || directText

        if (!responseText) {
            await react('❌')
            return sock.sendMessage(jid, {
                text: '❌ Respon teks kosong. kirim teks setelah trigger atau reply teks/media.'
            }, { quoted: msg })
        }

        await responsesDb.setResponse(trigger, {
            type: 'text',
            text: responseText,
            createdAt: new Date().toISOString()
        })

        if (typeof useLimit === 'function') useLimit()
        await react('✅')
        return sock.sendMessage(jid, {
            text: `✅ Respon "${trigger}" berhasil disimpan sebagai teks.`
        }, { quoted: msg })
    }
}
