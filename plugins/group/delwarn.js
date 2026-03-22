import { getTargetJid } from '../../src/utils/group.js'

export default {
    name: 'delwarn',
    aliases: ['clearwarn', 'unwarn'],
    description: 'Hapus warn user di grup',
    groupOnly: true,
    adminOnly: true,
    execute: async ({ sock, msg, args, groupsDb, useLimit }) => {
        const jid = msg.key.remoteJid
        const targetJid = getTargetJid(msg, args[0] || '')

        if (!targetJid) {
            return sock.sendMessage(jid, {
                text: '❌ @mention, reply pesan target, atau ketik nomornya'
            }, { quoted: msg })
        }

        const phone = targetJid.split('@')[0]
        const warn = groupsDb.getWarn(jid, targetJid)
        if (warn.count < 1) {
            useLimit()
            return sock.sendMessage(jid, {
                text: `⚠️ @${phone} belum memiliki warn.`,
                mentions: [targetJid]
            }, { quoted: msg })
        }

        groupsDb.clearWarn(jid, targetJid)
        useLimit()
        return sock.sendMessage(jid, {
            text: `✅ Warn @${phone} berhasil dihapus.`,
            mentions: [targetJid]
        }, { quoted: msg })
    }
}
