import settingsDb from '../../src/database/settings.js'

export default {
    name: 'onlyowner',
    aliases: ['onlyown'],
    description: 'Atur mode bot khusus owner',
    ownerOnly: true,
    execute: async ({ sock, msg, args, config, prefix, command, useLimit }) => {
        const jid = msg.key.remoteJid
        const input = String(args[0] || '').toLowerCase()

        if (!input) {
            useLimit()
            await sock.sendMessage(jid, {
                text: `Contoh penggunaan:\n- ${prefix + command} on\n- ${prefix + command} off`
            }, { quoted: msg })
            return
        }

        if (!['on', 'off'].includes(input)) {
            await sock.sendMessage(jid, {
                text: `Format salah. Gunakan: ${command} on/off`
            }, { quoted: msg })
            return
        }

        if (input === 'on') {
            if (config.onlyOwner) {
                useLimit()
                await sock.sendMessage(jid, {
                    text: '⚠️ Onlyowner sudah aktif.'
                }, { quoted: msg })
                return
            }

            await settingsDb.setRestrictions({ onlyGroup: false, onlyPrivate: false, onlyOwner: true, onlyPremium: false })
            useLimit()
            await sock.sendMessage(jid, {
                text: '✅ Onlyowner berhasil diaktifkan.'
            }, { quoted: msg })
            return
        }

        if (!config.onlyOwner) {
            useLimit()
            await sock.sendMessage(jid, {
                text: '⚠️ Onlyowner sudah mati.'
            }, { quoted: msg })
            return
        }

        await settingsDb.setRestrictions({ onlyGroup: false, onlyPrivate: false, onlyOwner: false, onlyPremium: false })
        useLimit()
        await sock.sendMessage(jid, {
            text: '✅ Onlyowner berhasil dimatikan.'
        }, { quoted: msg })
    }
}
