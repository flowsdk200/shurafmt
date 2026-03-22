export default {
    name: 'delppgc',
    aliases: ['deleteppgc'],
    description: 'Hapus foto profil grup',
    groupOnly: true,
    adminOnly: true,
    botAdmin: true,
    execute: async ({ sock, msg, react, useLimit }) => {
        const jid = msg.key.remoteJid

        if (typeof sock.removeProfilePicture !== 'function') {
            return sock.sendMessage(jid, {
                text: '❌ Fitur hapus foto profil tidak tersedia pada versi bot ini.'
            }, { quoted: msg })
        }

        await react('⏳')

        try {
            await sock.removeProfilePicture(jid)
            useLimit()
            await react('✅')
            await sock.sendMessage(jid, {
                text: '✅ Foto profil grup berhasil dihapus'
            }, { quoted: msg })
        } catch {
            await react('❌')
            await sock.sendMessage(jid, {
                text: '❌ Gagal menghapus foto profil grup, coba lagi nanti'
            }, { quoted: msg })
        }
    }
}
