import { getTargetJid } from '../../src/utils/group.js'

export default {
    name: 'delban',
    aliases: ['unban', 'db'],
    description: 'Hapus ban user',
    ownerOnly: true,
    execute: async ({ sock, msg, text, usersDb, react, useLimit }) => {
        const jid = msg.key.remoteJid
        const targetJid = getTargetJid(msg, text)

        if (!targetJid) {
            return sock.sendMessage(jid, {
                text: '❌ Tentukan target dengan @mention, reply pesan mereka, atau ketik nomornya.'
            }, { quoted: msg })
        }

        await react('⏳')

        const targetUser = usersDb.getUser(targetJid)
        const targetName = targetUser.name || targetJid.split('@')[0]
        const targetNum = targetJid.split('@')[0]

        if (!usersDb.isBanned(targetJid)) {
            await react('❌')
            return sock.sendMessage(jid, {
                text: `❌ @${targetNum} tidak sedang diban.`,
                mentions: [targetJid]
            }, { quoted: msg })
        }

        usersDb.unban(targetJid)
        useLimit()
        await react('✅')
        return sock.sendMessage(jid, {
            text: `✅ Status ban @${targetNum} berhasil dihapus.`,
            mentions: [targetJid]
        }, { quoted: msg })
    }
}
