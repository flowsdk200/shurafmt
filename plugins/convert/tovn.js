import { downloadContentFromMessage, getAudioDuration, getAudioWaveform } from 'baileys'
import { toPTT } from '../../src/utils/converter.js'

const streamToBuffer = async (stream) => {
    const chunks = []
    for await (const chunk of stream) chunks.push(chunk)
    return Buffer.concat(chunks)
}

export default {
    name: 'tovn',
    aliases: ['vn', 'toptt'],
    description: 'Convert audio/video (reply) jadi voice note',
    usage: '(reply audio/video)',
    execute: async ({ sock, msg, isQuoted, quotedMsg, quotedType, prefix, command, react, useLimit }) => {
        const jid = msg.key.remoteJid

        if (!isQuoted || !quotedMsg || !quotedType) {
            return sock.sendMessage(jid, {
                text: `❌ Gunakan dengan cara reply audio/video dengan caption ${prefix + command}.`
            }, { quoted: msg })
        }

        if (!['audioMessage', 'videoMessage'].includes(quotedType)) {
            return sock.sendMessage(jid, {
                text: '❌ Media yang di reply harus audio atau video.'
            }, { quoted: msg })
        }

        await react('⏳')

        try {
            const mediaContent = quotedMsg[quotedType]
            const mediaType = quotedType.replace('Message', '')
            const ext = quotedType === 'videoMessage' ? 'mp4' : 'mp3'

            const stream = await downloadContentFromMessage(mediaContent, mediaType)
            const buffer = await streamToBuffer(stream)

            const converted = await toPTT(buffer, ext)
            if (!converted?.data) throw new Error('Gagal convert ke voice note')

            let seconds
            let waveform
            try {
                seconds = await getAudioDuration(converted.data)
                waveform = await getAudioWaveform(converted.data)
            } catch (e) {
                throw new Error(`Waveform/duration gagal dihitung oleh baileys (${e?.message || e}). Pastikan dependency opsional \`audio-decode\` tersedia.`)
            }

            useLimit()
            await sock.sendMessage(jid, {
                audio: converted.data,
                mimetype: 'audio/ogg; codecs=opus',
                ptt: true,
                ...(Number.isFinite(seconds) && seconds > 0 ? { seconds } : {}),
                waveform
            }, { quoted: msg })
            await react('✅')
        } catch (err) {
            await react('❌')
            await sock.sendMessage(jid, {
                text: `❌ Error: ${err.message}`
            }, { quoted: msg })
        }
    }
}
