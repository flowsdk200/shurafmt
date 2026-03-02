import { downloadContentFromMessage } from 'baileys'
import { enhanceHd } from '../../scrape/hd.js'

export default {
    name: 'hd',
    aliases: ['enhance', 'upscale', 'hdr'],
    description: 'Enhance kualitas gambar jadi HD',
    execute: async ({ sock, msg, text, isQuoted, quotedMsg, quotedType, react, useLimit, prefix, command }) => {
        const jid = msg.key.remoteJid

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
            const chunks = []
            for await (const chunk of stream) chunks.push(chunk)
            const result = await enhanceHd(Buffer.concat(chunks), { upscale: 2, maxPoll: 30 })

            await sock.sendMessage(jid, {
                image: { url: result.url },
                caption: `\`\`\`HD (2X)\`\`\``
            }, { quoted: msg })

            useLimit()
            await react('✅')
        } catch (err) {
            await react('❌')
            await sock.sendMessage(jid, {
                text: `❌ Gagal: ${err.message || 'enhancehd error.'}`
            }, { quoted: msg })
        }
    }
}
