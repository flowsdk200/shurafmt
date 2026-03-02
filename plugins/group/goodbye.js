export default {
    name: 'goodbye',
    aliases: ['bye', 'left'],
    description: 'Toggle goodbye message grup (on/off/status)',
    groupOnly: true,
    adminOnly: true,
    execute: async ({ sock, msg, args, groupsDb, useLimit }) => {
        const jid = msg.key.remoteJid
        const input = (args[0] || '').toLowerCase()

        const current = groupsDb.getSetting(jid, 'goodbye', true) === true

        if (!input || ['status', 'cek', 'check'].includes(input)) {
            useLimit()
            return sock.sendMessage(jid, {
                text: `Status goodbye grup saat ini: ${current ? 'on' : 'off'}\n\nGunakan:\n- goodbye on\n- goodbye off\n- goodbye status`
            }, { quoted: msg })
        }

        if (input !== 'on' && input !== 'off') {
            return sock.sendMessage(jid, {
                text: '❌ Format salah. gunakan: goodbye on/off/status'
            }, { quoted: msg })
        }

        const next = input === 'on'
        if (next === current) {
            useLimit()
            return sock.sendMessage(jid, {
                text: `⚠️ Goodbye grup sudah ${current ? 'on' : 'off'}.`
            }, { quoted: msg })
        }

        groupsDb.setSetting(jid, 'goodbye', next)
        useLimit()
        return sock.sendMessage(jid, {
            text: `✅ Goodbye message berhasil di ${next ? 'aktifkan' : 'matikan'}.`
        }, { quoted: msg })
    }
}
