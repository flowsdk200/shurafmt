import { getBuffer } from '../../src/utils/converter.js'
import { makeSticker } from '../../src/utils/exif.js'

export default {
    name: 'brat',
    aliases: ['brattext'],
    description: 'Buat sticker brat dari teks',
    execute: async ({ sock, msg, text, config, react, useLimit, prefix, pushName, command }) => {
        const jid = msg.key.remoteJid
        const q = String(text || '').trim()

        if (!q) {
            return sock.sendMessage(jid, {
                text: `Contoh penggunaan:\n- ${prefix + command} halo bang`
            }, { quoted: msg })
        }

        await react('⏳')

        try {
            const url = `https://api.siputzx.my.id/api/m/brat?text=${encodeURIComponent(q)}&isAnimated=false&delay=500`
            const buffer = await getBuffer(url, { timeout: 60000 })
            await makeSticker(sock, jid, buffer, {
                packname: String(pushName),
                quoted: msg
            })
            useLimit()
            await react('✅')
        } catch (err) {
            await react('❌')
            await sock.sendMessage(jid, {
                text: `❌ Error: ${err?.message}`
            }, { quoted: msg })
        }
    }
}
