import settingsDb from '../../src/database/settings.js'

export default {
    name: 'onlyprivate',
    aliases: ['onlypc'],
    description: 'Atur mode bot khusus chat pribadi',
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
                text: `Format salah. gunakan: ${command} on/off`
            }, { quoted: msg })
            return
        }

        if (input === 'on') {
            if (config.onlyPrivate) {
                useLimit()
                await sock.sendMessage(jid, {
                    text: '⚠️ Onlyprivate sudah aktif.'
                }, { quoted: msg })
                return
            }

            await settingsDb.setRestrictions({ onlyGroup: false, onlyPrivate: true, onlyOwner: false, onlyPremium: false })
            useLimit()
            await sock.sendMessage(jid, {
                text: '✅ Onlyprivate berhasil diaktifkan.'
            }, { quoted: msg })
            return
        }

        if (!config.onlyPrivate) {
            useLimit()
            await sock.sendMessage(jid, {
                text: '⚠️ Onlyprivate sudah mati.'
            }, { quoted: msg })
            return
        }

        await settingsDb.setRestrictions({ onlyGroup: false, onlyPrivate: false, onlyOwner: false, onlyPremium: false })
        useLimit()
        await sock.sendMessage(jid, {
            text: '✅ Onlyprivate berhasil dimatikan.'
        }, { quoted: msg })
    }
}
