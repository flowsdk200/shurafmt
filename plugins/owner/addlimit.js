import { getTargetJid } from '../../src/utils/group.js'

export default {
    name: 'addlimit',
    aliases: ['al'],
    description: 'Tambah limit user',
    ownerOnly: true,
    execute: async ({ sock, msg, text, prefix, command, usersDb, react, useLimit }) => {
        const jid = msg.key.remoteJid

        const match = text.match(/(\d+)\s*$/)
        if (!match) {
            return sock.sendMessage(jid, {
                text: `❌ Format: ${prefix + command} @user/nomor/reply <jumlah>\n\nContoh: ${prefix + command} @user 50`
            }, { quoted: msg })
        }

        const amount = parseInt(match[1])
        const targetText = text.slice(0, text.lastIndexOf(match[0])).trim()
        const targetJid = getTargetJid(msg, targetText)

        if (!targetJid) {
            return sock.sendMessage(jid, {
                text: '❌ Tentukan target dengan @mention, reply pesan mereka, atau ketik nomornya.'
            }, { quoted: msg })
        }

        await react('⏳')

        const user = usersDb.getUser(targetJid)
        const before = user.limit ?? 0
        usersDb.updateUser(targetJid, { limit: before + amount })
        useLimit()
        await react('✅')

        return sock.sendMessage(jid, {
            text: `✅ Limit @${targetJid.split('@')[0]} ditambah *${amount}*.\nSekarang: *${before + amount}*`,
            mentions: [targetJid]
        }, { quoted: msg })
    }
}
