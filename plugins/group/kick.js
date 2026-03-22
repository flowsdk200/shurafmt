import { getTargetJid, translateStatus } from '../../src/utils/group.js'
import { normalizeJid } from '../../src/utils/jid.js'

export default {
    name: 'kick',
    aliases: ['remove', 'keluarkan', 'k'],
    description: 'Keluarkan member dari grup (@mention / reply / nomor)',
    groupOnly: true,
    botAdmin: true,
    adminOnly: true,
    execute: async ({ sock, msg, text, prefix, command, isOwner, sender, botJid, groupMetadata, react, useLimit }) => {
        const jid = msg.key.remoteJid

        const targetJid = getTargetJid(msg, text)
        if (!targetJid) {
            return sock.sendMessage(jid, {
                text: `❌ @mention, reply pesan target, atau ketik nomornya`
            }, { quoted: msg })
        }

        /** Jangan kick diri sendiri **/
        if (targetJid === sender) {
            return sock.sendMessage(jid, { text: '🤬 Gak bisa kick diri sendiri.' }, { quoted: msg })
        }

        /** Jangan kick bot **/
        if (targetJid === botJid) {
            return sock.sendMessage(jid, { text: '🤬 Gak bisa kick bot.' }, { quoted: msg })
        }

        /** Jangan kick sesama admin (kecuali owner bot) **/
        if (!isOwner && groupMetadata) {
            const targetParticipant = groupMetadata.participants.find(p => normalizeJid(p.id) === targetJid)
            if (targetParticipant?.admin) {
                return sock.sendMessage(jid, { text: '❌ Tidak bisa mengeluarkan sesama admin.' }, { quoted: msg })
            }
        }

        await react('⏳')

        try {
            const results = await sock.groupParticipantsUpdate(jid, [targetJid], 'remove')
            const result = results?.[0]
            const errMsg = translateStatus(result?.status, 'remove')

            if (errMsg) {
                await react('❌')
                return sock.sendMessage(jid, { text: `❌ ${errMsg}` }, { quoted: msg })
            }

            useLimit()
            await react('✅')
            const phone = targetJid.split('@')[0]
            await sock.sendMessage(jid, {
                text: `✅ @${phone} dikeluarkan dari grup.`,
                mentions: [targetJid]
            }, { quoted: msg })
        } catch (err) {
            await react('❌')
            await sock.sendMessage(jid, { text: `❌ Error: ${err.message}` }, { quoted: msg })
        }
    }
}
