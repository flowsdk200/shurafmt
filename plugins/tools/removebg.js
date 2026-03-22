import { downloadContentFromMessage } from 'baileys'
import { rmbg } from '../../scrape/removebg.js'

const streamToBuffer = async (stream) => {
    const chunks = []
    for await (const chunk of stream) chunks.push(chunk)
    return Buffer.concat(chunks)
}

export default {
    name: 'removebg',
    aliases: ['rmbg', 'nobg'],
    description: 'Hapus background gambar',
    execute: async ({ sock, msg, isQuoted, quotedMsg, quotedType, prefix, command, react, useLimit }) => {
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
            const input = await streamToBuffer(stream)
            const output = await rmbg(input)

            await sock.sendMessage(jid, {
                image: output,
                caption: `\`\`\`✅ BACKGROUND REMOVED.\`\`\``
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
