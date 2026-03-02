import { downloadContentFromMessage } from 'baileys'
import { toVideo } from '../../src/utils/converter.js'

const streamToBuffer = async (stream) => {
    const chunks = []
    for await (const chunk of stream) chunks.push(chunk)
    return Buffer.concat(chunks)
}

export default {
    name: 'toptv',
    aliases: ['ptv'],
    description: 'Convert video (reply) jadi PTV/video note',
    usage: '(reply video)',
    execute: async ({ sock, msg, isQuoted, quotedMsg, quotedType, prefix, command, react, useLimit }) => {
        const jid = msg.key.remoteJid

        if (!isQuoted || !quotedMsg || !quotedType) {
            return sock.sendMessage(jid, {
                text: `❌ Reply ke video terlebih dahulu.`
            }, { quoted: msg })
        }

        if (quotedType !== 'videoMessage') {
            return sock.sendMessage(jid, {
                text: '❌ Media yang di-reply harus video.'
            }, { quoted: msg })
        }

        await react('⏳')

        try {
            const mediaContent = quotedMsg[quotedType]
            const stream = await downloadContentFromMessage(mediaContent, 'video')
            const buffer = await streamToBuffer(stream)
            const converted = await toVideo(buffer, 'mp4')

            if (!converted?.data) throw new Error('Gagal convert ke PTV')

            useLimit()
            await sock.sendMessage(jid, {
                video: converted.data,
                mimetype: 'video/mp4',
                ptv: true
            }, { quoted: msg })
            await react('✅')
        } catch (err) {
            await react('❌')
            await sock.sendMessage(jid, {
                text: `❌ Gagal convert ke PTV: ${err.message}`
            }, { quoted: msg })
        }
    }
}
