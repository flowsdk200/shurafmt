import { downloadContentFromMessage } from 'baileys'
import { upscale } from '../../scrape/upscale.js'

const streamToBuffer = async (stream) => {
    const chunks = []
    for await (const chunk of stream) chunks.push(chunk)
    return Buffer.concat(chunks)
}

export default {
    name: 'uhd',
    aliases: ['upscaler'],
    description: 'Upscale gambar pakai Upscale.media',
    execute: async ({ sock, msg, isQuoted, quotedMsg, quotedType, react, useLimit, prefix, command }) => {
        const jid = msg.key.remoteJid
        const scale = '2X'

        let image = null
        if (isQuoted && quotedType === 'imageMessage' && quotedMsg?.imageMessage) {
            image = quotedMsg.imageMessage
        } else if (msg.message?.imageMessage) {
            image = msg.message.imageMessage
        }

        if (!image) {
            return sock.sendMessage(jid, {
                text: `❌ Kirim/reply gambar dengan caption ${prefix + command}`
            }, { quoted: msg })
        }

        await react('⏳')

        try {
            const stream = await downloadContentFromMessage(image, 'image')
            const input = await streamToBuffer(stream)
            const result = await upscale(input, {
                type: scale,
                filename: 'upscale-input.jpg',
                contentType: image?.mimetype || 'image/jpeg',
                maxPoll: 40,
                intervalMs: 2000
            })

            await sock.sendMessage(jid, {
                image: { url: result.url },
                caption: `\`\`\`${command.toUpperCase()} (${scale})\`\`\``
            }, { quoted: msg })

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
