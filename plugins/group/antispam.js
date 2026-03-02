export default {
    name: 'antispam',
    aliases: ['spamguard', 'spam'],
    description: 'Toggle antispam grup (on/off/status)',
    groupOnly: true,
    adminOnly: true,
    execute: async ({ sock, msg, args, groupsDb, useLimit }) => {
        const jid = msg.key.remoteJid
        const input = (args[0] || '').toLowerCase()

        const group = groupsDb.getGroup(jid)
        const current = group?.settings?.antispam === true

        if (!input || ['status', 'cek', 'check'].includes(input)) {
            useLimit()
            return sock.sendMessage(jid, {
                text: `Status antispam grup saat ini: ${current ? 'on' : 'off'}\n\nGunakan:\n- antispam on\n- antispam off\n- antispam status`
            }, { quoted: msg })
        }

        if (input !== 'on' && input !== 'off') {
            return sock.sendMessage(jid, {
                text: '❌ Format salah. gunakan: antispam on/off/status'
            }, { quoted: msg })
        }

        const next = input === 'on'
        if (next === current) {
            useLimit()
            return sock.sendMessage(jid, {
                text: `⚠️ Antispam grup sudah ${current ? 'on' : 'off'}.`
            }, { quoted: msg })
        }

        groupsDb.setSetting(jid, 'antispam', next)

        useLimit()
        return sock.sendMessage(jid, {
            text: `✅ Antispam grup berhasil di ${next ? 'aktifkan' : 'matikan'}.`
        }, { quoted: msg })
    }
}
