import { downloadContentFromMessage } from 'baileys'
import FormData from 'form-data'
import axios from 'axios'

const streamToBuffer = async (stream) => {
    const chunks = []
    for await (const chunk of stream) chunks.push(chunk)
    return Buffer.concat(chunks)
}

export default {
    name: 'readqr',
    aliases: ['scanqr'],
    description: 'Baca QR dari gambar',
    execute: async ({ sock, msg, isQuoted, quotedMsg, quotedType, prefix, command, react, useLimit }) => {
        const jid = msg.key.remoteJid

        if (!isQuoted || !quotedMsg || quotedType !== 'imageMessage') {
            return sock.sendMessage(jid, {
                text: `Reply gambar QR lalu ketik ${prefix + command}`
            }, { quoted: msg })
        }

        await react('⏳')

        try {
            const stream = await downloadContentFromMessage(quotedMsg.imageMessage, 'image')
            const buffer = await streamToBuffer(stream)

            const form = new FormData()
            form.append('file', buffer, {
                filename: 'qr.png',
                contentType: quotedMsg.imageMessage?.mimetype || 'image/png'
            })

            const { data } = await axios.post('https://api.qrserver.com/v1/read-qr-code/', form, {
                headers: form.getHeaders(),
                timeout: 30000
            })

            const result = data?.[0]?.symbol?.[0]
            if (!result || result.error || !String(result.data || '').trim()) {
                throw new Error(result?.error || 'QR tidak terbaca')
            }

            useLimit()
            await sock.sendMessage(jid, {
                text: String(result.data).trim()
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
