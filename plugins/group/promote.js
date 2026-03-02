import { getTargetJid, translateStatus } from '../../src/utils/group.js'
import { normalizeJid } from '../../src/utils/jid.js'

export default {
    name: 'promote',
    aliases: ['jadmin', 'pro'],
    description: 'Jadikan member sebagai admin grup (@mention / reply / nomor)',
    groupOnly: true,
    botAdmin: true,
    adminOnly: true,
    execute: async ({ sock, msg, text, prefix, command, groupMetadata, react, useLimit }) => {
        const jid = msg.key.remoteJid

        const targetJid = getTargetJid(msg, text)
        if (!targetJid) {
            return sock.sendMessage(jid, {
                text: `❌ Tentukan target dengan @mention, reply pesan mereka, atau ketik nomornya.\n\nContoh:\n${prefix + command} @user`
            }, { quoted: msg })
        }

        /** Cek apakah target sudah admin **/
        if (groupMetadata) {
            const targetParticipant = groupMetadata.participants.find(p => normalizeJid(p.id) === targetJid)
            if (targetParticipant?.admin) {
                return sock.sendMessage(jid, { text: '❌ Pengguna ini sudah menjadi admin.' }, { quoted: msg })
            }
        }

        await react('⏳')

        try {
            const results = await sock.groupParticipantsUpdate(jid, [targetJid], 'promote')
            const result = results?.[0]
            const errMsg = translateStatus(result?.status, 'promote')

            if (errMsg) {
                await react('❌')
                return sock.sendMessage(jid, { text: `❌ ${errMsg}` }, { quoted: msg })
            }

            useLimit()
            await react('✅')
            const phone = targetJid.split('@')[0]
            await sock.sendMessage(jid, {
                text: `✅ @${phone} berhasil dijadikan admin grup.`,
                mentions: [targetJid]
            }, { quoted: msg })
        } catch (err) {
            await react('❌')
            await sock.sendMessage(jid, { text: `❌ Gagal mempromosikan: ${err.message}` }, { quoted: msg })
        }
    }
}
