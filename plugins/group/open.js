export default {
    name: 'open',
    aliases: ['bukagrup', 'opengc', 'opengroup'],
    description: 'Buka grup semua member bisa kirim pesan',
    groupOnly: true,
    botAdmin: true,
    adminOnly: true,
    execute: async ({ sock, msg, groupMetadata, react, useLimit }) => {
        const jid = msg.key.remoteJid

        const isAlreadyOpen = groupMetadata?.announce === false
        if (isAlreadyOpen) {
            return sock.sendMessage(jid, {
                text: '⚠️ Grup sudah dalam kondisi terbuka.'
            }, { quoted: msg })
        }

        await react('⏳')

        try {
            await sock.groupSettingUpdate(jid, 'not_announcement')
            useLimit()
            await react('✅')
            await sock.sendMessage(jid, {
                text: `🔓 Grup dibuka. semua member kini bisa mengirim pesan di grup ini.`
            }, { quoted: msg })
        } catch (err) {
            await react('❌')
            await sock.sendMessage(jid, { text: `❌ Gagal membuka grup: ${err.message}` }, { quoted: msg })
        }
    }
}
