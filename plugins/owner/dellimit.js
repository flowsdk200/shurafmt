import { getTargetJid } from '../../src/utils/group.js'

export default {
    name: 'dellimit',
    aliases: ['dl', 'resetlimit'],
    description: 'Kurangi atau reset limit user',
    ownerOnly: true,
    execute: async ({ sock, msg, text, prefix, command, usersDb, react, useLimit }) => {
        const jid = msg.key.remoteJid

        const match = text.match(/(\d+)\s*$/)
        const amount = match ? parseInt(match[1]) : null
        const targetText = amount !== null ? text.slice(0, text.lastIndexOf(match[0])).trim() : text.trim()
        const targetJid = getTargetJid(msg, targetText)

        if (!targetJid) {
            return sock.sendMessage(jid, {
                text: `❌ Format:\n• ${prefix + command} @user <jumlah> — kurangi limit\n• ${prefix + command} @user — reset ke 0`
            }, { quoted: msg })
        }

        await react('⏳')

        const user = usersDb.getUser(targetJid)
        const before = user.limit ?? 0

        if (amount !== null) {
            const after = Math.max(0, before - amount)
            usersDb.updateUser(targetJid, { limit: after })
            useLimit()
            await react('✅')
            return sock.sendMessage(jid, {
                text: `✅ Limit @${targetJid.split('@')[0]} dikurangi ${amount}. sekarang: ${after}`,
                mentions: [targetJid]
            }, { quoted: msg })
        } else {
            usersDb.updateUser(targetJid, { limit: 0 })
            useLimit()
            await react('✅')
            return sock.sendMessage(jid, {
                text: `✅ Limit @${targetJid.split('@')[0]} direset ke 0.`,
                mentions: [targetJid]
            }, { quoted: msg })
        }
    }
}
