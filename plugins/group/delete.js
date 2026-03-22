import { normalizeJid } from '../../src/utils/jid.js'

export default {
    name: 'delete',
    aliases: ['del'],
    description: 'Hapus pesan target di grup via reply',
    groupOnly: true,
    botAdmin: true,
    adminOnly: true,
    execute: async ({ sock, msg, prefix, command, useLimit, isQuoted, contextInfo, botJid }) => {
        const jid = msg.key.remoteJid

        if (!isQuoted || !contextInfo?.stanzaId) {
            return sock.sendMessage(jid, {
                text: `reply pesan user lalu ketik ${prefix + command}`
            }, { quoted: msg })
        }

        const quotedSender = normalizeJid(contextInfo.participant || '')
        const deletingOwnBotMessage = quotedSender === botJid

        await sock.sendMessage(jid, {
            delete: {
                remoteJid: jid,
                fromMe: deletingOwnBotMessage,
                id: contextInfo.stanzaId,
                participant: quotedSender || undefined
            }
        })

        useLimit()
    }
}
