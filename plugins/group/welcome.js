export default {
    name: 'welcome',
    aliases: ['wel'],
    description: 'Toggle welcome message grup (on/off/status)',
    groupOnly: true,
    adminOnly: true,
    execute: async ({ sock, msg, args, groupsDb, config, useLimit }) => {
        const jid = msg.key.remoteJid
        const input = (args[0] || '').toLowerCase()

        const defaultWelcome = config?.groupDefaults?.welcome ?? true
        const current = groupsDb.getSetting(jid, 'welcome', defaultWelcome) === true

        if (!input || ['status', 'cek', 'check'].includes(input)) {
            useLimit()
            return sock.sendMessage(jid, {
                text: `Status welcome grup saat ini: ${current ? 'on' : 'off'}\n\nGunakan:\n- welcome on\n- welcome off\n- welcome status`
            }, { quoted: msg })
        }

        if (input !== 'on' && input !== 'off') {
            return sock.sendMessage(jid, {
                text: '❌ Format salah. gunakan: welcome on/off/status'
            }, { quoted: msg })
        }

        const next = input === 'on'
        if (next === current) {
            useLimit()
            return sock.sendMessage(jid, {
                text: `⚠️ Welcome grup sudah ${current ? 'on' : 'off'}.`
            }, { quoted: msg })
        }

        groupsDb.setSetting(jid, 'welcome', next)
        useLimit()
        return sock.sendMessage(jid, {
            text: `✅ Welcome message berhasil di ${next ? 'aktifkan' : 'matikan'}.`
        }, { quoted: msg })
    }
}
