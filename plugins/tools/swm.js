import { downloadContentFromMessage } from 'baileys'
import { makeSticker } from '../../src/utils/exif.js'

const streamToBuffer = async (stream) => {
    const chunks = []
    for await (const chunk of stream) chunks.push(chunk)
    return Buffer.concat(chunks)
}

export default {
    name: 'swm',
    aliases: ['stickerwm', 'stikerwm', 'wm'],
    description: 'Buat sticker dengan packname custom',
    execute: async ({ sock, msg, text, isQuoted, quotedMsg, quotedType, prefix, command, react, useLimit }) => {
        const jid = msg.key.remoteJid
        const packname = String(text || '').trim()
        const currentType = msg?.message?.imageMessage
            ? 'imageMessage'
            : msg?.message?.videoMessage
                ? 'videoMessage'
                : msg?.message?.stickerMessage
                    ? 'stickerMessage'
                    : null
        const currentMsg = currentType ? msg.message : null

        if (!packname) {
            return sock.sendMessage(jid, {
                text:
                    `Cara penggunaan:\n` +
                    `- ${prefix + command} packname + reply media\n` +
                    `- kirim gambar/video dengan caption ${prefix + command} packname\n\n` +
                    `Contoh:\n` +
                    `- ${prefix + command} riflowsxz + reply gambar/video/stiker`
            }, { quoted: msg })
        }

        let mediaType = null
        let media = null

        if (isQuoted && quotedMsg && ['imageMessage', 'videoMessage', 'stickerMessage'].includes(quotedType)) {
            mediaType = quotedType
            media = quotedMsg[quotedType]
        } else if (currentType && currentMsg?.[currentType]) {
            mediaType = currentType
            media = currentMsg[currentType]
        }

        if (!mediaType || !media) {
            return sock.sendMessage(jid, {
                text: '❌ Balas media (gambar/video/stiker) atau kirim media dengan caption command.'
            }, { quoted: msg })
        }

        if (mediaType === 'videoMessage' && Number(media?.seconds || 0) > 20) {
            return sock.sendMessage(jid, {
                text: '❌ Durasi video maksimal 20 detik.'
            }, { quoted: msg })
        }

        await react('⏳')

        try {
            const stream = await downloadContentFromMessage(media, mediaType.replace('Message', ''))
            const buffer = await streamToBuffer(stream)

            await makeSticker(sock, jid, buffer, { packname, quoted: msg })

            useLimit()
            await react('✅')
        } catch (err) {
            await react('❌')
            await sock.sendMessage(jid, {
                text: `❌ Error: ${err.message}`
            }, { quoted: msg })
        }
    }
}
