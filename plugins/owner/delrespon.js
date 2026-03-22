import responsesDb from '../../src/database/responses.js'
import { deleteFromR2 } from '../../src/utils/r2.js'

export default {
    name: 'delrespon',
    aliases: ['delrsp'],
    description: 'Hapus auto respon',
    ownerOnly: true,
    async execute({ sock, msg, text, prefix, command, react, useLimit }) {
        const jid = msg.key.remoteJid
        const key = String(text || '').trim().toLowerCase()

        if (!key) {
            return sock.sendMessage(jid, {
                text: `Cara penggunaan:\n- ${prefix + command} trigger`
            }, { quoted: msg })
        }

        await react('⏳')

        const current = await responsesDb.deleteResponse(key)
        if (!current) {
            await react('❌')
            return sock.sendMessage(jid, {
                text: `❌ Respon "${key}" tidak ditemukan.`
            }, { quoted: msg })
        }

        if (current.r2Key) {
            await deleteFromR2(current.r2Key).catch(() => {})
        }

        if (typeof useLimit === 'function') useLimit()
        await react('✅')
        return sock.sendMessage(jid, {
            text: `✅ Respon "${key}" berhasil dihapus.`
        }, { quoted: msg })
    }
}
