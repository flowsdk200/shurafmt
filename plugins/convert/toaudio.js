import { downloadContentFromMessage } from 'baileys'
import { toAudio } from '../../src/utils/converter.js'

const streamToBuffer = async (stream) => {
    const chunks = []
    for await (const chunk of stream) chunks.push(chunk)
    return Buffer.concat(chunks)
}

export default {
    name: 'toaudio',
    aliases: ['tomp3', 'mp3'],
    description: 'Convert audio/video (reply) jadi audio',
    usage: '(reply audio/video)',
    execute: async ({ sock, msg, isQuoted, quotedMsg, quotedType, prefix, command, react, useLimit }) => {
        const jid = msg.key.remoteJid

        if (!isQuoted || !quotedMsg || !quotedType) {
            return sock.sendMessage(jid, {
                text: `❌ Reply audio/video dengan caption ${prefix + command}`
            }, { quoted: msg })
        }

        if (!['audioMessage', 'videoMessage'].includes(quotedType)) {
            return sock.sendMessage(jid, {
                text: '❌ Media yang di reply harus audio atau video.'
            }, { quoted: msg })
        }

        await react('⏳')

        try {
            const mediaContent = quotedMsg[quotedType]
            const mediaType = quotedType.replace('Message', '')
            const ext = quotedType === 'videoMessage' ? 'mp4' : 'mp3'

            const stream = await downloadContentFromMessage(mediaContent, mediaType)
            const buffer = await streamToBuffer(stream)
            const converted = await toAudio(buffer, ext)

            if (!converted?.data) throw new Error('Gagal convert ke audio')

            useLimit()
            await sock.sendMessage(jid, {
                audio: converted.data,
                mimetype: 'audio/mpeg',
                ptt: false
            }, { quoted: msg })
            await react('✅')
        } catch (err) {
            await react('❌')
            await sock.sendMessage(jid, {
                text: `❌ Error: ${err.message}`
            }, { quoted: msg })
        }
    }
}
