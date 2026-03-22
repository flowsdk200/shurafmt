import { getTargetJid } from '../../src/utils/group.js'

export default {
    name: 'delowner',
    aliases: ['do', 'removeowner'],
    description: 'Hapus owner bot',
    ownerOnly: true,
    execute: async ({ sock, msg, text, prefix, command, usersDb, config, sender, react, useLimit }) => {
        const jid = msg.key.remoteJid

        const targetJid = getTargetJid(msg, text)
        if (!targetJid) {
            return sock.sendMessage(jid, {
                text: `Cara penggunaan:\n- ${prefix + command} @user/nomor/reply\n\nContoh penggunaan:\n ${prefix + command} 6285226344606`
            }, { quoted: msg })
        }

        const targetNum = targetJid.split('@')[0]

        if (config.ownerNumbers.includes(targetNum)) {
            return sock.sendMessage(jid, {
                text: `❌ @${targetNum} adalah owner utama, tidak bisa dihapus.`,
                mentions: [targetJid]
            }, { quoted: msg })
        }

        if (!usersDb.isOwner(targetJid)) {
            return sock.sendMessage(jid, {
                text: `❌ @${targetNum} bukan owner.`,
                mentions: [targetJid]
            }, { quoted: msg })
        }

        await react('⏳')
        usersDb.removeOwner(targetJid)
        useLimit()
        await react('✅')

        return sock.sendMessage(jid, {
            text: `✅ @${targetNum} berhasil dihapus dari owner.`,
            mentions: [targetJid]
        }, { quoted: msg })
    }
}
