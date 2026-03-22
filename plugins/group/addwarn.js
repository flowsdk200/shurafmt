import { getTargetJid, translateStatus } from '../../src/utils/group.js'
import { normalizeJid } from '../../src/utils/jid.js'

export default {
    name: 'addwarn',
    aliases: ['warn'],
    description: 'Tambah peringatan user di grup',
    groupOnly: true,
    botAdmin: true,
    adminOnly: true,
    execute: async ({ sock, msg, args, sender, botJid, groupMetadata, groupsDb, usersDb, config, react, useLimit }) => {
        const jid = msg.key.remoteJid
        const targetJid = getTargetJid(msg, args[0] || '')

        if (!targetJid) {
            return sock.sendMessage(jid, {
                text: '❌ @mention, reply pesan target, atau ketik nomornya'
            }, { quoted: msg })
        }

        if (targetJid === sender) {
            return sock.sendMessage(jid, { text: '❌ Tidak bisa warn diri sendiri.' }, { quoted: msg })
        }

        if (targetJid === botJid) {
            return sock.sendMessage(jid, { text: '❌ Tidak bisa warn bot.' }, { quoted: msg })
        }

        const targetNumber = String(targetJid.split('@')[0] || '').replace(/[^0-9]/g, '')
        const isTargetOwner =
            config.ownerNumbers.includes(targetNumber) ||
            usersDb.isOwner(targetJid)

        if (isTargetOwner) {
            return sock.sendMessage(jid, { text: '❌ Tidak bisa warn owner bot.' }, { quoted: msg })
        }

        const targetParticipant = groupMetadata?.participants?.find((p) => normalizeJid(p.id) === targetJid)
        if (targetParticipant?.admin) {
            return sock.sendMessage(jid, { text: '❌ Tidak bisa warn admin grup.' }, { quoted: msg })
        }

        const warn = groupsDb.addWarn(jid, targetJid)
        const phone = targetJid.split('@')[0]

        if (warn.count < 3) {
            useLimit()
            return sock.sendMessage(jid, {
                text:
                    `⚠️ @${phone} mendapatkan warn ${warn.count}/3.`,
                mentions: [targetJid]
            }, { quoted: msg })
        }

        await react('⏳')

        try {
            const results = await sock.groupParticipantsUpdate(jid, [targetJid], 'remove')
            const result = results?.[0]
            const errMsg = translateStatus(result?.status, 'remove')

            if (errMsg) {
                await react('❌')
                useLimit()
                return sock.sendMessage(jid, {
                    text:
                        `⚠️ @${phone} sudah mencapai warn 3/3.\n` +
                        `❌ Gagal auto-kick: ${errMsg}`,
                    mentions: [targetJid]
                }, { quoted: msg })
            }

            groupsDb.clearWarn(jid, targetJid)
            useLimit()
            await react('✅')
            return sock.sendMessage(jid, {
                text: `@${phone} sudah mencapai warn 3/3 dan otomatis dikeluarkan dari grup.`,
                mentions: [targetJid]
            }, { quoted: msg })
        } catch (err) {
            await react('❌')
            useLimit()
            return sock.sendMessage(jid, {
                text:
                    `⚠️ @${phone} sudah mencapai warn 3/3.\n` +
                    `❌ Gagal auto-kick: ${err.message}`,
                mentions: [targetJid]
            }, { quoted: msg })
        }
    }
}
