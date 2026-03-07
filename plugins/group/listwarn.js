import { getTargetJid } from '../../src/utils/group.js'

export default {
    name: 'listwarn',
    aliases: ['warnlist'],
    description: 'Lihat daftar warn user di grup',
    groupOnly: true,
    adminOnly: true,
    execute: async ({ sock, msg, args, groupsDb, useLimit }) => {
        const jid = msg.key.remoteJid
        const targetJid = getTargetJid(msg, args[0] || '')

        if (targetJid) {
            const warn = groupsDb.getWarn(jid, targetJid)
            const phone = targetJid.split('@')[0]

            if (warn.count < 1) {
                useLimit()
                return sock.sendMessage(jid, {
                    text: `⚠️ @${phone} belum memiliki warn.`,
                    mentions: [targetJid]
                }, { quoted: msg })
            }

            useLimit()
            return sock.sendMessage(jid, {
                text:
                    `LIST WARN USER\n\n` +
                    `• User: @${phone}\n` +
                    `• Warn: ${warn.count}/3\n` +
                    `• Terakhir: ${warn.updatedAt || '-'}\n\n` +
                    `Kick otomatis saat warn 3/3`,
                mentions: [targetJid]
            }, { quoted: msg })
        }

        const warns = groupsDb.listWarns(jid)
        if (!warns.length) {
            useLimit()
            return sock.sendMessage(jid, {
                text: '⚠️ Belum ada data warn di grup ini.'
            }, { quoted: msg })
        }

        const text = warns
            .map((item, index) => {
                const phone = item.jid.split('@')[0]
                return `• User: @${phone}\n• Warn: ${item.count}/3\n• Terakhir: ${item.updatedAt || '-'}`
            })
            .join('\n\n')

        useLimit()
        return sock.sendMessage(jid, {
            text:
                `LIST WARN GRUP\n\n` +
                `${text}\n\n` +
                `Kick otomatis saat warn 3/3`,
            mentions: warns.map((item) => item.jid)
        }, { quoted: msg })
    }
}
