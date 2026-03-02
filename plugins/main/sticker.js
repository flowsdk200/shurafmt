import { downloadContentFromMessage } from 'baileys'
import { makeSticker } from '../../src/utils/exif.js'

const streamToBuffer = async (stream) => {
    const chunks = []
    for await (const chunk of stream) chunks.push(chunk)
    return Buffer.concat(chunks)
}

const SUPPORTED_TYPES = ['imageMessage', 'videoMessage', 'stickerMessage']

export default {
    name: 'sticker',
    aliases: ['s', 'stiker'],
    description: 'Buat sticker dari gambar atau video',
    execute: async ({ sock, msg, text, config, isQuoted, quotedMsg, quotedType, react, useLimit }) => {
        const jid = msg.key.remoteJid

        /** Parse optional: !sticker PackName | Author **/
        const parts = text.split('|')
        const packname = parts[0]?.trim() || String(config?.botName || 'sticker').trim()
        const author = parts[1]?.trim() || 'izizi'

        /** Determine media source: quoted reply or direct attachment **/
        const NON_CONTENT_KEYS = ['messageContextInfo', 'senderKeyDistributionMessage', 'deviceSentMessage']
        const allMsgKeys = Object.keys(msg.message || {})
        const msgType = allMsgKeys.find(k => !NON_CONTENT_KEYS.includes(k)) || allMsgKeys[0]

        let mediaContent = null
        let mediaType = null

        if (isQuoted && quotedMsg && SUPPORTED_TYPES.includes(quotedType)) {
            mediaContent = quotedMsg[quotedType]
            mediaType = quotedType.replace('Message', '')
        } else if (SUPPORTED_TYPES.includes(msgType)) {
            mediaContent = msg.message[msgType]
            mediaType = msgType.replace('Message', '')
        }

        if (!mediaContent || !mediaType) {
            return sock.sendMessage(jid, {
                text: '❌ Kirim atau reply gambar/video untuk dibuat sticker.'
            }, { quoted: msg })
        }

        await react('⏳')

        try {
            const stream = await downloadContentFromMessage(mediaContent, mediaType)
            const buffer = await streamToBuffer(stream)
            await makeSticker(sock, jid, buffer, { packname, author, quoted: msg })
            useLimit()
            await react('✅')
        } catch (err) {
            await react('❌')
            await sock.sendMessage(jid, {
                text: `❌ Gagal membuat sticker: ${err.message}`
            }, { quoted: msg })
        }
    }
}
