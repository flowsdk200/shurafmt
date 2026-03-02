import { getTargetJid, translateStatus } from '../../src/utils/group.js'
import { normalizeJid } from '../../src/utils/jid.js'

export default {
    name: 'demote',
    aliases: ['cabut', 'dem'],
    description: 'Cabut status admin dari member grup (@mention / reply / nomor)',
    groupOnly: true,
    botAdmin: true,
    adminOnly: true,
    execute: async ({ sock, msg, text, prefix, command, botJid, groupMetadata, react, useLimit }) => {
        const jid = msg.key.remoteJid

        const targetJid = getTargetJid(msg, text)
        if (!targetJid) {
            return sock.sendMessage(jid, {
                text: `❌ Tentukan target dengan @mention, reply pesan mereka, atau ketik nomornya.\n\nContoh:\n${prefix + command} @user`
            }, { quoted: msg })
        }

        /** Jangan demote bot sendiri **/
        if (targetJid === botJid) {
            return sock.sendMessage(jid, { text: '❌ Tidak bisa mencabut status admin bot itu sendiri.' }, { quoted: msg })
        }

        /** Cek apakah target memang admin **/
        if (groupMetadata) {
            const targetParticipant = groupMetadata.participants.find(p => normalizeJid(p.id) === targetJid)
            if (!targetParticipant?.admin) {
                return sock.sendMessage(jid, { text: '❌ pengguna ini bukan admin.' }, { quoted: msg })
            }
        }

        await react('⏳')

        try {
            const results = await sock.groupParticipantsUpdate(jid, [targetJid], 'demote')
            const result = results?.[0]
            const errMsg = translateStatus(result?.status, 'demote')

            if (errMsg) {
                await react('❌')
                return sock.sendMessage(jid, { text: `❌ ${errMsg}` }, { quoted: msg })
            }

            useLimit()
            await react('✅')
            const phone = targetJid.split('@')[0]
            await sock.sendMessage(jid, {
                text: `✅ Status admin @${phone} berhasil dicabut.`,
                mentions: [targetJid]
            }, { quoted: msg })
        } catch (err) {
            await react('❌')
            await sock.sendMessage(jid, { text: `❌ Gagal mencabut admin: ${err.message}` }, { quoted: msg })
        }
    }
}
