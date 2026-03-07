export default {
    name: 'delppbot',
    aliases: ['deleteppbot'],
    description: 'Hapus foto profil bot',
    premiumOnly: true,
    execute: async ({ sock, msg, react, useLimit }) => {
        const jid = msg.key.remoteJid

        if (typeof sock.removeProfilePicture !== 'function') {
            return sock.sendMessage(jid, {
                text: '❌ Fitur hapus foto profil tidak tersedia pada versi bot ini.'
            }, { quoted: msg })
        }

        await react('⏳')

        try {
            await sock.removeProfilePicture(sock.user.id)
            useLimit()
            await react('✅')
            await sock.sendMessage(jid, {
                text: '✅ Foto profil bot berhasil dihapus'
            }, { quoted: msg })
        } catch {
            await react('❌')
            await sock.sendMessage(jid, {
                text: '❌ Gagal menghapus foto profil bot, coba lagi nanti'
            }, { quoted: msg })
        }
    }
}
