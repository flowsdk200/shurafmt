import { downloadContentFromMessage } from 'baileys'
import { normalizeJid } from '../../src/utils/jid.js'

export default {
    name: 'rvo',
    aliases: ['vo', 'antiviewonce'],
    description: 'Ungkap isi pesan view-once',
    usage: '(reply ke pesan view-once)',
    execute: async ({ sock, msg, isQuoted, quotedMsg, quotedType, contextInfo, sender, useLimit }) => {
        const jid = msg.key.remoteJid

        if (!isQuoted || !quotedMsg || !quotedType) {
            return sock.sendMessage(jid, { text: '❌ Reply ke pesan view-once terlebih dahulu.' }, { quoted: msg })
        }

        const voContent = quotedMsg[quotedType]

        if (!voContent?.viewOnce) {
            return sock.sendMessage(jid, { text: '❌ Pesan yang di-reply bukan view-once.' }, { quoted: msg })
        }

        /** Ambil pengirim asli view-once dari contextInfo yang sudah di-pass handler.
         *  Normalize JID: @lid → @s.whatsapp.net agar mention valid di WA. **/
        const voSenderRaw = normalizeJid(contextInfo?.participant || contextInfo?.remoteJid) || sender
        const voSenderNum = voSenderRaw?.split('@')[0] || '?'

        try {
            const mediaType = quotedType.replace('Message', '')
            const stream = await downloadContentFromMessage(voContent, mediaType)
            const chunks = []
            for await (const chunk of stream) chunks.push(chunk)
            const buffer = Buffer.concat(chunks)

            const caption = `👀 View once dari @${voSenderNum}`
            const mentions = voSenderRaw ? [voSenderRaw] : []

            if (quotedType === 'imageMessage') {
                useLimit()
                await sock.sendMessage(jid, { image: buffer, caption, mentions })
            } else if (quotedType === 'videoMessage') {
                useLimit()
                await sock.sendMessage(jid, { video: buffer, caption, mentions })
            } else if (quotedType === 'audioMessage') {
                useLimit()
                await sock.sendMessage(jid, {
                    audio: buffer,
                    mimetype: voContent.mimetype || 'audio/mp4',
                    ptt: voContent.ptt || false
                })
            } else {
                await sock.sendMessage(jid, { text: '❌ Tipe media view-once ini belum didukung.' }, { quoted: msg })
            }
        } catch (err) {
            await sock.sendMessage(jid, { text: `❌ Gagal mengunduh media: ${err.message}` }, { quoted: msg })
        }
    }
}
