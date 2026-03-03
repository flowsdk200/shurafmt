import { translateStatus } from '../../src/utils/group.js'

export default {
    name: 'add',
    aliases: ['tambah'],
    description: 'Tambahkan member ke grup via nomor HP',
    groupOnly: true,
    botAdmin: true,
    adminOnly: true,
    execute: async ({ sock, msg, text, prefix, command, react, useLimit }) => {
        const jid = msg.key.remoteJid
        const phone = text?.replace(/[^0-9]/g, '')
        if (!phone || phone.length < 7) {
            return sock.sendMessage(jid, {
                text: `❌ Masukkan nomor yang ingin ditambahkan.`
            }, { quoted: msg })
        }

        const targetJid = `${phone}@s.whatsapp.net`

        await react('⏳')

        try {
            const results = await sock.groupParticipantsUpdate(jid, [targetJid], 'add')
            const result = results?.[0]
            const errMsg = translateStatus(result?.status, 'add')

            if (errMsg) {
                await react('❌')
                return sock.sendMessage(jid, { text: `❌ ${errMsg}` }, { quoted: msg })
            }

            useLimit()
            await react('✅')
            /*
            await sock.sendMessage(jid, {
                text: `✅ @${phone} berhasil ditambahkan ke grup.`,
                mentions: [targetJid]
            }, { quoted: msg })
            */
        } catch (err) {
            await react('❌')
            await sock.sendMessage(jid, { text: `❌ Gagal menambahkan: ${err.message}` }, { quoted: msg })
        }
    }
}
