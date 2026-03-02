export default {
    name: 'close',
    aliases: ['tutupgrup', 'closegc', 'closegroup'],
    description: 'Tutup grup hanya admin yang bisa kirim pesan',
    groupOnly: true,
    botAdmin: true,
    adminOnly: true,
    execute: async ({ sock, msg, groupMetadata, react, useLimit }) => {
        const jid = msg.key.remoteJid

        const isAlreadyClosed = groupMetadata?.announce === true
        if (isAlreadyClosed) {
            return sock.sendMessage(jid, {
                text: '⚠️ Grup sudah dalam kondisi tertutup.'
            }, { quoted: msg })
        }

        await react('⏳')

        try {
            await sock.groupSettingUpdate(jid, 'announcement')
            useLimit()
            await react('✅')
            await sock.sendMessage(jid, {
                text: `🔒 Grup ditutup. hanya admin yang bisa mengirim pesan di grup ini.`
            }, { quoted: msg })
        } catch (err) {
            await react('❌')
            await sock.sendMessage(jid, { text: `❌ Gagal menutup grup: ${err.message}` }, { quoted: msg })
        }
    }
}
