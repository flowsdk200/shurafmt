import { sendDelete } from '../../src/utils/message.js'

export default {
    name: 'delete',
    aliases: ['del'],
    description: 'Hapus pesan target di grup via reply',
    groupOnly: true,
    botAdmin: true,
    adminOnly: true,
    execute: async ({ sock, msg, prefix, command, react, useLimit }) => {
        const jid = msg.key.remoteJid
        const quoted = msg.quoted

        if (!quoted?.key?.id) {
            return sock.sendMessage(jid, {
                text: `reply pesan lalu ketik ${prefix + command}`
            }, { quoted: msg })
        }

        await react('⏳')

        try {
            await sendDelete(sock, jid, quoted.key)
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
