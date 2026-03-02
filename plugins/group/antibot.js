export default {
    name: 'antibot',
    aliases: ['ab'],
    description: 'Toggle antibot grup (on/off/status)',
    groupOnly: true,
    botAdmin: true,
    adminOnly: true,
    execute: async ({ sock, msg, args, groupsDb, useLimit }) => {
        const jid = msg.key.remoteJid
        const input = (args[0] || '').toLowerCase()

        const group = groupsDb.getGroup(jid)
        const current = group?.settings?.antibot === true

        if (!input || ['status', 'cek', 'check'].includes(input)) {
            useLimit()
            return sock.sendMessage(jid, {
                text: `Status antibot grup saat ini: ${current ? 'on' : 'off'}\n\nGunakan:\n- antibot on\n- antibot off\n- antibot status`
            }, { quoted: msg })
        }

        if (input !== 'on' && input !== 'off') {
            return sock.sendMessage(jid, {
                text: '❌ Format salah. gunakan: antibot on/off/status'
            }, { quoted: msg })
        }

        const next = input === 'on'
        if (next === current) {
            useLimit()
            return sock.sendMessage(jid, {
                text: `⚠️ Antibot grup sudah ${current ? 'on' : 'off'}.`
            }, { quoted: msg })
        }

        groupsDb.setSetting(jid, 'antibot', next)

        useLimit()
        return sock.sendMessage(jid, {
            text: `✅ Antibot grup berhasil di ${next ? 'aktifkan' : 'matikan'}.`
        }, { quoted: msg })
    }
}
