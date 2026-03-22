export default {
    name: 'self',
    aliases: ['public'],
    description: 'Ubah mode bot self atau public',
    ownerOnly: true,
    execute: async ({ sock, msg, body, config, useLimit }) => {
        const jid = msg.key.remoteJid
        const usedPrefix = config.prefixes.find((p) => body.startsWith(p)) || ''
        const invokedCmd = usedPrefix
            ? (body.slice(usedPrefix.length).trim().split(/\s+/)[0] || '').toLowerCase()
            : ''

        const currentMode = sock.public ? 'public' : 'self'

        const setSelfMode = async () => {
            if (!sock.public) {
                useLimit()
                return sock.sendMessage(jid, {
                    text: '⚠️ Mode bot sudah self.'
                }, { quoted: msg })
            }

            sock.public = false
            config.selfMode = true
            useLimit()
            return sock.sendMessage(jid, {
                text: '✅ Self mode aktif. bot sekarang hanya bisa dipakai owner.'
            }, { quoted: msg })
        }

        const setPublicMode = async () => {
            if (sock.public) {
                useLimit()
                return sock.sendMessage(jid, {
                    text: '⚠️ Mode bot sudah public.'
                }, { quoted: msg })
            }

            sock.public = true
            config.selfMode = false
            useLimit()
            return sock.sendMessage(jid, {
                text: '✅ Public mode aktif. bot sekarang bisa dipakai semua orang.'
            }, { quoted: msg })
        }

        if (invokedCmd === 'self') return setSelfMode()
        if (invokedCmd === 'public') return setPublicMode()

        return sock.sendMessage(jid, {
            text: `❌ Command tidak valid. gunakan langsung: self / public`
        }, { quoted: msg })
    }
}
