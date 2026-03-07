const formatNow = () => {
    const now = new Date()
    const day = String(now.getDate()).padStart(2, '0')
    const month = now.toLocaleString('id-ID', { month: 'short', timeZone: 'Asia/Jakarta' })
    const year = now.toLocaleString('id-ID', { year: 'numeric', timeZone: 'Asia/Jakarta' })
    const time = now.toLocaleString('id-ID', {
        hour: '2-digit',
        minute: '2-digit',
        hour12: false,
        timeZone: 'Asia/Jakarta'
    }).replace(':', '.')
    return `${day} ${month} ${year}, ${time}`
}

const renderCloseText = (template, groupName) => String(template || '')
    .replaceAll('{group}', groupName || '-')
    .replaceAll('{time}', formatNow())

export default {
    name: 'close',
    aliases: ['tutupgrup', 'closegc', 'closegroup'],
    description: 'Tutup grup hanya admin yang bisa kirim pesan',
    groupOnly: true,
    botAdmin: true,
    adminOnly: true,
    execute: async ({ sock, msg, groupMetadata, groupsDb, react, useLimit }) => {
        const jid = msg.key.remoteJid

        const isAlreadyClosed = groupMetadata?.announce === true
        if (isAlreadyClosed) {
            return sock.sendMessage(jid, {
                text: '⚠️ Grup sudah dalam kondisi tertutup.'
            }, { quoted: msg })
        }

        await react('⏳')

        try {
            await sock.groupSettingUpdate(jid, 'announcement')
            useLimit()
            await react('✅')
            const customText = groupsDb.getSetting(jid, 'closeText', '')
            const text = customText
                ? renderCloseText(customText, groupMetadata?.subject || jid)
                : '🔒 Grup ditutup. hanya admin yang bisa mengirim pesan di grup ini.'
            await sock.sendMessage(jid, {
                text
            }, { quoted: msg })
        } catch (err) {
            await react('❌')
            await sock.sendMessage(jid, { text: `❌ Error: ${err.message}` }, { quoted: msg })
        }
    }
}
