import { gemini } from '../../scrape/gemini.js'

export default {
    name: 'gemini',
    aliases: ['gemi', 'bard'],
    description: 'Chat dengan Gemini (non-official endpoint).',
    execute: async ({ sock, msg, text, prefix, command, react, useLimit }) => {
        const jid = msg.key.remoteJid

        if (!text?.trim()) {
            return sock.sendMessage(jid, {
                text: `Contoh penggunaan:\n- ${prefix + command} halo, siapa kamu?`
            }, { quoted: msg })
        }

        await react('⏳')

        try {
            const result = await gemini({ message: text.trim() })
            if (!result?.text) {
                await react('❌')
                return sock.sendMessage(jid, {
                    text: '❌ Gemini gak ngasih balasan. coba ulang lagi.'
                }, { quoted: msg })
            }

            useLimit()
            await react('✅')
            await sock.sendMessage(jid, {
                text: result.text
            }, { quoted: msg })
        } catch (err) {
            await react('❌')
            await sock.sendMessage(jid, {
                text: `❌ Error: ${err?.message || err}`
            }, { quoted: msg })
        }
    }
}
