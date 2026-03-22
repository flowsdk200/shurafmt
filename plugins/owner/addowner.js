import { getTargetJid } from '../../src/utils/group.js'

export default {
    name: 'addowner',
    aliases: ['ao'],
    description: 'Tambah owner bot',
    ownerOnly: true,
    execute: async ({ sock, msg, text, prefix, command, usersDb, react, useLimit }) => {
        const jid = msg.key.remoteJid

        const targetJid = getTargetJid(msg, text)
        if (!targetJid) {
            return sock.sendMessage(jid, {
                text: `❌ Cara penggunaan:\n- ${prefix + command} @user/nomor/reply\n\nContoh:\n- ${prefix + command} 6285226344606`
            }, { quoted: msg })
        }

        if (usersDb.isOwner(targetJid)) {
            return sock.sendMessage(jid, {
                text: `❌ @${targetJid.split('@')[0]} sudah menjadi owner.`,
                mentions: [targetJid]
            }, { quoted: msg })
        }

        await react('⏳')
        usersDb.addOwner(targetJid)
        useLimit()
        await react('✅')

        return sock.sendMessage(jid, {
            text: `✅ @${targetJid.split('@')[0]} berhasil ditambahkan sebagai owner.`,
            mentions: [targetJid]
        }, { quoted: msg })
    }
}
