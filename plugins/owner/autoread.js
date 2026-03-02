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
                text: `Status auto-read saat ini: ${status}\n\nGunakan:\n${prefix + command} on\n${prefix + command} off`
            }, { quoted: msg })
            return
        }

        if (input === 'on') {
            sock.autoRead = true
            config.autoRead = true
            useLimit()
            await sock.sendMessage(jid, { text: '✅ Auto-read berhasil diaktifkan.' }, { quoted: msg })
            return
        }

        if (input === 'off') {
            sock.autoRead = false
            config.autoRead = false
            useLimit()
            await sock.sendMessage(jid, { text: '✅ Auto-read berhasil dimatikan.' }, { quoted: msg })
            return
        }

        await sock.sendMessage(jid, {
            text: 'Format salah. Gunakan: autoread on/off'
        }, { quoted: msg })
    }
}
