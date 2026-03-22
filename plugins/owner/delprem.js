import { getTargetJid } from '../../src/utils/group.js'

export default {
    name: 'delprem',
    aliases: ['delpremium', 'delp', 'dp'],
    description: 'Cabut premium user',
    ownerOnly: true,
    execute: async ({ sock, msg, text, usersDb, react, prefix, command, useLimit }) => {
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

        if (!usersDb.isPremium(targetJid)) {
            await react('❌')
            return sock.sendMessage(jid, {
                text: `❌ @${targetNum} bukan pengguna premium aktif.`,
                mentions: [targetJid]
            }, { quoted: msg })
        }

        usersDb.removePremium(targetJid)
        useLimit()
        await react('✅')
        return sock.sendMessage(jid, {
            text: `✅ Status premium @${targetNum} (${targetName}) berhasil dicabut.`,
            mentions: [targetJid]
        }, { quoted: msg })
    }
}
