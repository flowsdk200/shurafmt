export default {
    name: 'goodbye',
    aliases: ['bye', 'left'],
    description: 'Toggle goodbye message grup (on/off/status)',
    groupOnly: true,
    adminOnly: true,
    execute: async ({ sock, msg, args, groupsDb, config, prefix, command, useLimit }) => {
        const jid = msg.key.remoteJid
        const input = (args[0] || '').toLowerCase()

        const defaultGoodbye = config?.groupDefaults?.goodbye ?? true
        const current = groupsDb.getSetting(jid, 'goodbye', defaultGoodbye) === true

        if (!input || ['status', 'cek', 'check'].includes(input)) {
            useLimit()
            return sock.sendMessage(jid, {
                text: `Contoh penggunaan:\n- ${prefix + command} on\n- ${prefix + command} off`
            }, { quoted: msg })
        }

        if (input !== 'on' && input !== 'off') {
            return sock.sendMessage(jid, {
                text: `❌ Format salah.\n\nGunakan:\n- ${prefix + command} on/off`
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
