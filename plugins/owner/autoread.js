import settingsDb from '../../src/database/settings.js'

export default {
    name: 'autoread',
    aliases: ['read', 'autoview'],
    description: 'Toggle auto-read bot',
    ownerOnly: true,
    execute: async ({ sock, msg, args, config, prefix, command, useLimit }) => {
        const jid = msg.key.remoteJid
        const input = (args[0] || '').toLowerCase()

        if (sock.autoRead === undefined) sock.autoRead = true

        if (!input) {
            const status = sock.autoRead ? 'ON' : 'OFF'
            useLimit()
            await sock.sendMessage(jid, {
                text: `Contoh penggunaan:\n- ${prefix + command} on\n- ${prefix + command} off`
            }, { quoted: msg })
            return
        }

        if (input === 'on') {
            if (sock.autoRead) {
                useLimit()
                await sock.sendMessage(jid, { text: '⚠️ Auto-read sudah aktif.' }, { quoted: msg })
                return
            }

            sock.autoRead = true
            await settingsDb.setAutoRead(true)
            useLimit()
            await sock.sendMessage(jid, { text: '✅ Auto-read berhasil diaktifkan.' }, { quoted: msg })
            return
        }

        if (input === 'off') {
            if (!sock.autoRead) {
                useLimit()
                await sock.sendMessage(jid, { text: '⚠️ Auto-read sudah mati.' }, { quoted: msg })
                return
            }

            sock.autoRead = false
            await settingsDb.setAutoRead(false)
            useLimit()
            await sock.sendMessage(jid, { text: '✅ Auto-read berhasil dimatikan.' }, { quoted: msg })
            return
        }

        await sock.sendMessage(jid, {
            text: 'Format salah. Gunakan: autoread on/off'
        }, { quoted: msg })
    }
}
